import { NextRequest, NextResponse } from "next/server";
import {
  isAiMemoryEnabled,
  getSessionsNeedingFactsExtraction,
  markFactsExtracted,
  writeCronBackoff,
  writeCronCountedFailure,
  writeCronGiveUp,
  getEarliestSharedSourceTime,
  getSessionMessages,
  getUserFacts,
  saveUserFact,
  supersedeUserFact,
  expireUserFact,
  isUniqueViolation,
  isSensitiveFactRejected,
  recordCronRun,
  deleteOldCronRuns,
  type ChatSession,
  type DbChatMessage,
  type NewUserFact,
} from "@/lib/aiMemory";
import { asPlainObject } from "@/lib/requestJson";
import { errorCodeForLog } from "@/lib/errorCodeForLog";
import {
  validateExtraction,
  type RawExtractionOutput,
} from "@/lib/factExtractionValidation";
import {
  budgetExistingFacts,
  buildCronConversationText,
  capNewFacts,
  logCronInputBudget,
  type CronConversation,
} from "@/lib/cronInputBudget";
import {
  buildCronLlmCallRow,
  type ObservedLlmCall,
} from "@/lib/llmCallTelemetry";
import { recordLlmCall } from "@/lib/llmCallLog";
import { SESSION_CANDIDATE_LIMIT } from "@/lib/cronRetryBound";
import {
  cronRunItems,
  runMemoryCronBatch,
  type StageTracker,
} from "@/lib/memoryCronBatch";
import {
  OPENROUTER_URL,
  buildOpenRouterRequestBody,
  resolveOpenRouterApiKey,
} from "@/lib/openRouterRequest";
import {
  CRON_LLM_TIMEOUT_MS,
  cronRunHasBudgetForAnotherCall,
  logLlmTimeout,
} from "@/lib/llmTimeouts";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Fact-extraction model: the EXTRACTION_MODEL env var when set, otherwise the
// "latest" alias below. The tilde (~) prefix is required for latest aliases on
// OpenRouter — without it the API returns "not a valid model ID".
// Every request is routed under the provider preferences in openRouterRequest.ts,
// so the model this resolves to must have an endpoint those preferences accept,
// or each call fails. If the alias moves to a model without one, pin a specific
// model id through EXTRACTION_MODEL and redeploy. Resilience to output-format
// drift is handled in the parser, not by pinning the model. (Same pattern as
// SUMMARY_MODEL in the summarize cron.)
const EXTRACTION_MODEL =
  process.env.EXTRACTION_MODEL?.trim() || "~anthropic/claude-sonnet-latest";

// Most recent messages of one session passed to the model.
const MAX_MESSAGES_PER_EXTRACTION = 200;
// The extraction output is JSON (new_facts / supersede / expire arrays), so it
// can need a larger token budget than a summary does.
const EXTRACTION_MAX_TOKENS = 3072;
// Sessions per run; kept small because each one is a model call.
const EXTRACT_BATCH_LIMIT = 8;
// Most existing active facts read and passed to the model for reference.
const EXISTING_FACTS_LIMIT = 200;
// cron_runs retention in days; best-effort cleanup at the end of this cron.
const CRON_RUNS_RETENTION_DAYS = 180;

/**
 * Calls OpenRouter chat completions and returns the raw string response.
 *
 * Throws on failure, like the summarize cron's model call; the caller's
 * per-session handling records the session as failed.
 *
 * Every exit records one llm_calls row first. recordLlmCall never rejects
 * (llmCallLog.ts), so the `finally` cannot replace the error this throws or the
 * content it returns.
 *
 * What the call observed (the status, whether it timed out) is also copied to
 * `tracker.call`, from which the batch loop decides how a failure counts.
 */
async function callOpenRouterForExtraction(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  ctx: { userId: string; sessionId: string },
  tracker: StageTracker
): Promise<string> {
  const startedAtMs = Date.now();
  const signal = AbortSignal.timeout(CRON_LLM_TIMEOUT_MS);
  const observed: ObservedLlmCall = {
    httpStatus: null,
    jsonParsed: false,
    data: null,
  };
  try {
    return await requestExtraction(
      apiKey,
      systemPrompt,
      userContent,
      observed,
      signal
    );
  } finally {
    observed.timedOut = signal.aborted && !observed.jsonParsed;
    if (observed.timedOut) {
      logLlmTimeout("cron_extract_facts", EXTRACTION_MODEL, CRON_LLM_TIMEOUT_MS);
    }
    tracker.call = {
      httpStatus: observed.httpStatus,
      timedOut: observed.timedOut,
    };
    await recordLlmCall(
      buildCronLlmCallRow({
        route: "cron_extract_facts",
        requestModel: EXTRACTION_MODEL,
        startedAtMs,
        latencyMs: Date.now() - startedAtMs,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
        observed,
      })
    );
  }
}

async function requestExtraction(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  observed: ObservedLlmCall,
  signal: AbortSignal
): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(
      buildOpenRouterRequestBody({
        model: EXTRACTION_MODEL,
        maxTokens: EXTRACTION_MAX_TOKENS,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      })
    ),
  });
  observed.httpStatus = response.status;

  if (!response.ok) {
    // The error body is never read: it can echo the request, which carries the
    // conversation and the user's facts. It is cancelled, so the connection
    // is released now rather than whenever the runtime collects the response.
    // The thrown error carries the status only, as its message and as a
    // log-safe code.
    try {
      await response.body?.cancel();
    } catch {
      // Nothing more to release.
    }
    throw Object.assign(
      new Error(`OpenRouter request failed: ${response.status} ${response.statusText}`),
      { code: `http_${response.status}` }
    );
  }

  // A 200 response can still carry a body that is not JSON (a gateway error
  // page, for example).
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("OpenRouter response was not valid JSON");
  }
  observed.jsonParsed = true;
  observed.data = asPlainObject(data);

  const content: unknown =
    (data as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenRouter response missing message content");
  }

  return content;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a fact-extraction assistant for Noor, a personal finance guidance app for people who are just getting started with managing their money.

You will receive (1) a list of existing known facts about the user, and (2) a conversation between the user and Noor AI. Your job is to extract durable facts about the USER and reconcile them with the existing facts.

OUTPUT: Respond with ONLY a JSON object. No markdown, no code fences, no commentary. The object has exactly three array fields:

{
  "new_facts": [ { "category": "...", "fact": "...", "confidence": 0.9 } ],
  "supersede": [ { "old_number": 1, "category": "...", "fact": "...", "confidence": 1.0 } ],
  "expire": [ { "old_number": 3 } ]
}

All three arrays may be empty. Output {"new_facts":[],"supersede":[],"expire":[]} if there is nothing to extract.

EXTRACT — durable, currently-true facts about the user:
- Each fact must be in ENGLISH, one concise sentence.
- category must be one of: financial, personal, goal, preference, banking, other.
- confidence is a number between 0 and 1.
- Store a fact only if it would change the next piece of advice Noor gives. If knowing it would not change any advice, do not extract it.

DO NOT EXTRACT:
- Hypotheticals, hopes, vague future wishes — anything not currently in progress.
  NG: "User wants to apply for a credit card someday."
  NG: "User hopes to buy a house."
  NG: "If the user earns $2000, ..."
  OK: "User is opening a checking account this month."   (in progress = fact)
  OK: "User's monthly rent is $1,700."               (confirmed current fact)
  The distinction: sentences that only contain "plan to / hope to / want to / someday"
  are NOT facts, even for the goal category. Only extract things in progress or already
  decided. When in doubt, do not extract.
- Advice or general information Noor gave (not facts about the user).
- Greetings and small talk.
- Live financial figures that Plaid handles (account balances, transaction amounts).
  Even if the conversation mentions "I have $3000 in checking", do NOT make it a fact.
- Anything the connected bank feed can provide (balances, transaction amounts, merchant
  names, account lists). Do not remember what Plaid can provide. DO extract amounts and
  schedules the user states that the bank feed cannot know (money from family abroad,
  cash rent, unlinked accounts, scholarship dates).
  OK: "User receives about $800 a month from family abroad, in cash."
  NG: "User has $3,000 in checking."
- Full sensitive identifiers (complete SSN, full card numbers).
- Immigration or visa status: visa type, F-1, OPT, CPT, I-20, work authorization, or
  residency status. Do not store it under any category.
  NG: "User is in the US on an F-1 student visa."
- Emotions, mood, stress, mental health, or anything about self-harm, suicide, harming
  others, or eating problems — even if stated as a current fact. This rule applies even
  if the fact would change advice.
  NG: "User feels anxious and overwhelmed about money."
  NG: "User has had thoughts of hurting themselves."

EXISTING FACTS — reconcile:
- The existing facts are given as a numbered list. [1] is the most recently created.
- If the conversation CONTRADICTS an existing fact (e.g. existing "rent is $1500" vs
  conversation "I moved, rent is now $1700"), put that existing fact's number in
  "supersede" with the new corrected content.
- If an existing fact is no longer true and there is no replacement value, put its
  number in "expire" (only old_number needed).
- If a fact is already in the existing list with the SAME content, do NOT put it in
  new_facts. Omit it, or use supersede only if the content actually changed.
- Use each existing number at most once across supersede and expire combined.`;

/**
 * Serializes the session's messages as "User:" / "Noor:" blocks under the
 * length budget in cronInputBudget.ts: a long message loses its middle, and
 * the oldest messages are left out first.
 */
function buildConversationText(messages: DbChatMessage[]): CronConversation {
  const trimmed =
    messages.length > MAX_MESSAGES_PER_EXTRACTION
      ? messages.slice(messages.length - MAX_MESSAGES_PER_EXTRACTION)
      : messages;
  return buildCronConversationText(trimmed);
}

/**
 * Strips a markdown code fence from the model's raw string and parses it as
 * JSON. Throws when it does not parse (the caller's per-session handling
 * catches it).
 */
function parseExtractionJson(raw: string): RawExtractionOutput {
  let text = raw.trim();
  // Strip a ```json ... ``` or ``` ... ``` fence.
  if (text.startsWith("```")) {
    // Drop the opening fence line (``` or ```json).
    const firstNewline = text.indexOf("\n");
    if (firstNewline !== -1) {
      text = text.slice(firstNewline + 1);
    }
    // Drop the closing ```.
    if (text.endsWith("```")) {
      text = text.slice(0, text.length - 3);
    }
    text = text.trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Extraction output was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Extraction output is not a JSON object");
  }
  return parsed as RawExtractionOutput;
}

// Fact outcome counts for one session.
interface SessionFactStats {
  saved: number;
  skipped: number;
  superseded: number;
  expired: number;
  failed: number;
  // Not stored because an output filter refused it (an identifier-shaped
  // string or crisis content).
  filtered: number;
}

/**
 * Extracts one session's facts and applies them.
 *
 * Flow: empty session → read where another member's shared bank data entered
 *       the session → read the messages from before it → read existing facts
 *       and number the
 *       leading ones that fit the facts budget (existing.facts) → LLM call →
 *       parse and validate → supersede → expire → new_facts →
 *       markFactsExtracted.
 *
 * A model or parse failure throws to the caller's per-session handling (the
 * session stays unfinished and is retried). A failed write of one fact is
 * counted in stats.failed and the rest continue.
 *
 * Records on `tracker` each stage it reaches (see memoryCronBatch.ts). If any
 * fact write failed, the session is not marked done: it throws in the store
 * stage, and the whole session is extracted again on a later run.
 */
async function extractOneSession(
  apiKey: string,
  session: ChatSession,
  stats: SessionFactStats,
  tracker: StageTracker
): Promise<void> {
  // 1. Empty session: mark it done without a model call.
  if (session.message_count === 0) {
    await markFactsExtracted(session.id, session.user_id);
    return;
  }

  // 2. Where another household member's shared bank data entered the
  //    session, if it did. Facts are extracted only from what was said
  //    before that moment. It is read before the messages, never after (see
  //    getEarliestSharedSourceTime), and a failed read throws here, before
  //    the model is called. Then read the session's most recent messages
  //    from before it, and put them in time order.
  const sharedFrom = await getEarliestSharedSourceTime(session.id, session.user_id);

  const recent = await getSessionMessages(session.id, session.user_id, {
    limit: MAX_MESSAGES_PER_EXTRACTION,
    order: "desc",
    before: sharedFrom ?? undefined,
  });
  const messages = recent.reverse();

  // 3. No message to read: mark it done and stop. Either nothing was said
  //    before the shared data entered, or message_count is positive but no
  //    message was found.
  if (messages.length === 0) {
    if (sharedFrom !== null) {
      console.log(
        `Extract cron: session ${session.id} has no message from before ` +
          "shared bank data entered it — marking extracted."
      );
    } else {
      console.warn(
        `Extract cron: session ${session.id} has message_count=` +
          `${session.message_count} but 0 messages found — marking extracted.`
      );
    }
    await markFactsExtracted(session.id, session.user_id);
    return;
  }

  // 4. Read the user's active facts. Only the leading ones that fit the
  //    facts budget become existing.facts and are numbered for the model
  //    (step 5). Neither array may change until execution ends: old_number
  //    is resolved by index into existing.facts.
  const factsArray = await getUserFacts(session.user_id, {
    limit: EXISTING_FACTS_LIMIT,
  });

  // 5. Model call.
  const conversation = buildConversationText(messages);
  // Only the leading facts that fit the facts budget are numbered for the
  // model. old_number is checked and resolved against existing.facts, the
  // same array, so a fact left out here cannot be superseded or expired by
  // this run; it stays active as it is.
  const existing = budgetExistingFacts(factsArray);
  logCronInputBudget("cron_extract_facts", conversation, existing.dropped);
  const userContent =
    `[Existing facts]  (most recent first)\n${existing.text}\n\n` +
    `[Conversation]\n${conversation.text}`;

  tracker.stage = "call";
  const rawOutput = await callOpenRouterForExtraction(
    apiKey,
    EXTRACTION_SYSTEM_PROMPT,
    userContent,
    { userId: session.user_id, sessionId: session.id },
    tracker
  );
  tracker.stage = "interpret";
  if (!rawOutput.trim()) {
    throw new Error(
      `Extraction model returned empty output for session ${session.id}`
    );
  }

  // 6. Parse and validate (throws when it does not parse).
  const parsed = parseExtractionJson(rawOutput);
  const validated = validateExtraction(
    parsed,
    existing.facts.length,
    session.id
  );
  validated.newFacts = capNewFacts(validated.newFacts);

  tracker.stage = "store";

  // 7. Apply in a fixed order: supersede, then expire, then new_facts.
  //    Each fact write has its own try/catch; one failure does not stop the
  //    rest.

  // 7-1) supersede
  for (const item of validated.supersede) {
    const oldFact = existing.facts[item.oldNumber - 1];
    const payload: NewUserFact = {
      category: item.category,
      fact: item.fact,
      confidence: item.confidence,
      source_session_id: session.id,
      extracted_by_model: EXTRACTION_MODEL,
    };
    try {
      await supersedeUserFact(session.user_id, oldFact.id, payload);
      stats.superseded++;
    } catch (supersedeError) {
      // The output filter rejects a replacement (an identifier-shaped string or
      // crisis content) before the old fact is touched, so there is nothing to recover: the old fact
      // stays active and the replacement is not stored.
      if (isSensitiveFactRejected(supersedeError)) {
        stats.filtered++;
        continue;
      }
      // supersedeUserFact can fail partway (the old fact superseded, the new
      // insert failed). Try once to recover by saving the same payload.
      try {
        await saveUserFact(session.user_id, payload);
        stats.superseded++;
      } catch (recoveryError) {
        // The same active fact text already exists: the fact the model asked
        // for is in place, as with a new fact below.
        if (isUniqueViolation(recoveryError)) {
          stats.skipped++;
          continue;
        }
        stats.failed++;
        console.error(
          "[memory-cron] route=cron_extract_facts step=supersede session=%s fact=%s code=%s recovery_code=%s",
          session.id,
          oldFact.id,
          errorCodeForLog(supersedeError),
          errorCodeForLog(recoveryError)
        );
      }
    }
  }

  // 7-2) expire
  for (const item of validated.expire) {
    const oldFact = existing.facts[item.oldNumber - 1];
    try {
      await expireUserFact(oldFact.id, session.user_id);
      stats.expired++;
    } catch (expireError) {
      stats.failed++;
      console.error(
        "[memory-cron] route=cron_extract_facts step=expire session=%s fact=%s code=%s",
        session.id,
        oldFact.id,
        errorCodeForLog(expireError)
      );
    }
  }

  // 7-3) new_facts: saveUserFact, with a unique violation (23505) counted as
  //      skipped rather than saved
  for (const item of validated.newFacts) {
    const payload: NewUserFact = {
      category: item.category,
      fact: item.fact,
      confidence: item.confidence,
      source_session_id: session.id,
      extracted_by_model: EXTRACTION_MODEL,
    };
    try {
      await saveUserFact(session.user_id, payload);
      stats.saved++;
    } catch (saveError) {
      if (isSensitiveFactRejected(saveError)) {
        // Not stored: the output filter rejected the fact (an identifier-shaped
        // string or crisis content).
        stats.filtered++;
      } else if (isUniqueViolation(saveError)) {
        // An active fact with the same text already exists; absorb it as an
        // upsert would.
        stats.skipped++;
      } else {
        stats.failed++;
        console.error(
          "[memory-cron] route=cron_extract_facts step=save_fact session=%s code=%s",
          session.id,
          errorCodeForLog(saveError)
        );
      }
    }
  }

  // 8. Mark the session done only when every fact write succeeded (a filtered
  //    or duplicate fact is not a failure). Otherwise throw in the store
  //    stage: the session is not marked, and it is extracted again on a later
  //    run. There a fact already stored is absorbed only when the new answer
  //    repeats its text ignoring case (the unique index covers lower(fact));
  //    a fact worded differently is stored as another row.
  if (stats.failed > 0) {
    throw new Error(
      `Extract cron: ${stats.failed} fact write(s) failed for session ${session.id}`
    );
  }
  await markFactsExtracted(session.id, session.user_id);
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.trim() === "") {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "Cron not configured" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (provided !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiMemoryEnabled()) {
    return NextResponse.json({
      success: true,
      skipped: "AI memory disabled",
    });
  }

  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) {
    console.error("Extract cron: OPENROUTER_API_KEY not configured");
    return NextResponse.json(
      { error: "Extraction model not configured" },
      { status: 503 }
    );
  }

  // A failed session's partly applied facts still count toward factsSaved and
  // the other fact counts, since some of its facts may already be stored.
  const startedAt = new Date();
  let infraError: string | null = null;
  const stats = {
    processed: 0,
    processFailed: 0,
    factsSaved: 0,
    factsSkipped: 0,
    factsSuperseded: 0,
    factsExpired: 0,
    factsFailed: 0,
    factsFiltered: 0,
    // How the failed sessions were recorded (see memoryCronBatch.ts):
    // counted or not, given up, and state writes that failed (those
    // sessions are selected again on a later run).
    counted: 0,
    notCounted: 0,
    givenUp: 0,
    stateWriteFailed: 0,
    // Sessions not started because the run deadline was reached, or because
    // an earlier failure stopped the run; they stay eligible.
    deferred: 0,
    stoppedSkipped: 0,
    stopped: false,
  };

  // Every error line and cron_runs.error carry identifiers and an error code
  // only (errorCodeForLog): an error's message, details or cause can carry a
  // row or the provider's answer.
  // Set once the candidate read has returned, so a rejection of the batch is
  // labelled by where it happened.
  let candidatesRead = false;
  try {
    const batch = await runMemoryCronBatch<ChatSession>({
      route: "cron_extract_facts",
      now: Date.now,
      runStartedAtMs: startedAt.getTime(),
      candidateLimit: SESSION_CANDIDATE_LIMIT,
      batchLimit: EXTRACT_BATCH_LIMIT,
      hasBudget: cronRunHasBudgetForAnotherCall,
      fetchCandidates: async (limit, nowIso) => {
        const candidates = await getSessionsNeedingFactsExtraction(limit, nowIso);
        candidatesRead = true;
        return candidates;
      },
      failuresOf: (s) => s.facts_failures,
      processSession: async (s, tracker) => {
        const sessionStats: SessionFactStats = {
          saved: 0,
          skipped: 0,
          superseded: 0,
          expired: 0,
          failed: 0,
          filtered: 0,
        };
        try {
          await extractOneSession(apiKey, s, sessionStats, tracker);
        } finally {
          // Add whatever facts were applied, even if the session failed
          // partway.
          stats.factsSaved += sessionStats.saved;
          stats.factsSkipped += sessionStats.skipped;
          stats.factsSuperseded += sessionStats.superseded;
          stats.factsExpired += sessionStats.expired;
          stats.factsFailed += sessionStats.failed;
          stats.factsFiltered += sessionStats.filtered;
        }
      },
      onSessionError: (s, error) => {
        // Facts may be partially applied; the session is not marked done and
        // is extracted again on a later run.
        console.error(
          "[memory-cron] route=cron_extract_facts step=session session=%s code=%s",
          s.id,
          errorCodeForLog(error)
        );
      },
      writeBackoff: (s, next) =>
        writeCronBackoff("facts", s.id, s.user_id, next),
      writeCountedFailure: (s, before, next) =>
        writeCronCountedFailure("facts", s.id, s.user_id, before, next),
      writeGiveUp: (s, before, reason, at) =>
        writeCronGiveUp("facts", s.id, s.user_id, before, reason, at),
    });
    const items = cronRunItems(batch);
    stats.processed = items.itemsProcessed;
    stats.processFailed = items.itemsFailed;
    stats.counted = batch.counted;
    stats.notCounted = batch.notCounted;
    stats.givenUp = batch.givenUp;
    stats.stateWriteFailed = batch.stateWriteFailed;
    stats.deferred = batch.deferred;
    stats.stoppedSkipped = batch.stoppedSkipped;
    stats.stopped = batch.stopped;
  } catch (error) {
    const step = candidatesRead ? "batch" : "candidates";
    const code = errorCodeForLog(error);
    console.error("[memory-cron] route=cron_extract_facts step=%s code=%s", step, code);
    infraError = `${step} code=${code}`;
  }

  console.info("Extract cron complete:", stats);

  // Record the run in cron_runs (isolated). items_* count sessions; factsFailed
  // appears only in stats.
  // A session given up this run failed this run, so it is among the failed
  // items and the run's status reflects it.
  try {
    await recordCronRun({
      jobName: "extract-facts",
      startedAt,
      itemsProcessed: stats.processed,
      itemsFailed: stats.processFailed,
      stats,
      error: infraError,
      forceFailed: infraError !== null,
    });
  } catch (recordError) {
    console.error(
      "[memory-cron] route=cron_extract_facts step=record code=%s",
      errorCodeForLog(recordError)
    );
  }

  // cron_runs retention cleanup (isolated and best-effort; a failure is cleaned
  // up on a later run).
  try {
    const deleted = await deleteOldCronRuns(CRON_RUNS_RETENTION_DAYS);
    if (deleted > 0) {
      console.info(`Extract cron: cleaned up ${deleted} old cron_runs row(s).`);
    }
  } catch (cleanupError) {
    // A later run cleans up what this one could not.
    console.warn(
      "[memory-cron] route=cron_extract_facts step=cleanup code=%s",
      errorCodeForLog(cleanupError)
    );
  }

  return NextResponse.json({
    success: true,
    ...stats,
  });
}
