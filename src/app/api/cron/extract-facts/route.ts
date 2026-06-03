import { NextRequest, NextResponse } from "next/server";
import {
  isAiMemoryEnabled,
  getSessionsNeedingFactsExtraction,
  markFactsExtracted,
  getSessionMessages,
  getUserFacts,
  saveUserFact,
  supersedeUserFact,
  expireUserFact,
  isUniqueViolation,
  recordCronRun,        // ← 추가
  deleteOldCronRuns,    // ← 추가
  type ChatSession,
  type DbChatMessage,
  type UserFact,
  type UserFactCategory,
  type NewUserFact,
} from "@/lib/aiMemory";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// OpenRouter fact-extraction model. Sonnet is used for extraction accuracy (CTO decision).
// Defaults to the "latest" alias (retire-immune); the tilde (~) prefix is required
// for latest aliases on OpenRouter — without it the API returns "not a valid model ID".
// Override via the EXTRACTION_MODEL env var (e.g. pin to "anthropic/claude-sonnet-4.6")
// if output stability ever requires it. Resilience to output-format drift is handled
// in the parser, not by pinning the model. (Same pattern as SUMMARY_MODEL in the summarize cron.)
const EXTRACTION_MODEL =
  process.env.EXTRACTION_MODEL?.trim() || "~anthropic/claude-sonnet-latest";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// 한 세션에서 LLM에 넘기는 최대 메시지 수 (PR4와 동일).
const MAX_MESSAGES_PER_EXTRACTION = 200;
// fact 추출 출력은 JSON(new_facts/supersede/expire 배열)이라 요약(1024)보다
// 큰 토큰이 필요할 수 있음. 넉넉하게 3072.
const EXTRACTION_MAX_TOKENS = 3072;
// LLM 호출이라 배치는 작게 (PR4 SUMMARIZE_BATCH_LIMIT와 동일).
const EXTRACT_BATCH_LIMIT = 8;
// LLM에 참고로 넘기는 기존 active facts 최대 개수.
const EXISTING_FACTS_LIMIT = 200;
// fact 텍스트 최대 길이 (검증). 초과 시 해당 항목 drop.
const MAX_FACT_LENGTH = 500;
// 한 세션에서 supersede + expire 합계 상한. 초과 시 폭주로 간주.
const MAX_SUPERSEDE_EXPIRE = 30;
// cron_runs 보존 기간(일). 이 cron 끝에서 best-effort 정리.
const CRON_RUNS_RETENTION_DAYS = 180;

// user_facts.category 허용값 (검증용).
const VALID_CATEGORIES: ReadonlyArray<UserFactCategory> = [
  "financial",
  "personal",
  "goal",
  "preference",
  "visa",
  "banking",
  "other",
];

/**
 * OpenRouter API 키를 환경변수에서 읽어온다.
 * 없거나 빈 문자열이면 null. (PR4와 동일)
 */
function resolveOpenRouterApiKey(): string | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  return apiKey.trim();
}

/**
 * OpenRouter chat completions를 호출해 raw 문자열 응답을 반환한다.
 *
 * PR4 callOpenRouterForSummary와 동일한 throw 기반 동작.
 * 실패 시 throw → 바깥 세션 try/catch가 받아 processFailed 처리.
 */
async function callOpenRouterForExtraction(
  apiKey: string,
  systemPrompt: string,
  userContent: string
): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      max_tokens: EXTRACTION_MAX_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed: ${response.status} ${response.statusText}` +
        (errorBody ? ` — ${errorBody.slice(0, 300)}` : "")
    );
  }

  // HTTP 200이어도 본문이 JSON이 아닐 수 있음 (게이트웨이 오류 페이지 등).
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("OpenRouter response was not valid JSON");
  }

  const content: unknown =
    (data as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenRouter response missing message content");
  }

  return content;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a fact-extraction assistant for Noor, a financial guidance app for international students.

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
- category must be one of: financial, personal, goal, preference, visa, banking, other.
- confidence is a number between 0 and 1.

DO NOT EXTRACT:
- Hypotheticals, hopes, vague future wishes — anything not currently in progress.
  NG: "User wants to apply for OPT someday."
  NG: "User hopes to buy a house."
  NG: "If the user earns $2000, ..."
  OK: "User is applying for OPT after graduation."   (in progress = fact)
  OK: "User's monthly rent is $1,700."               (confirmed current fact)
  The distinction: sentences that only contain "plan to / hope to / want to / someday"
  are NOT facts, even for the goal category. Only extract things in progress or already
  decided. When in doubt, do not extract.
- Advice or general information Noor gave (not facts about the user).
- Greetings and small talk.
- Live financial figures that Plaid handles (account balances, transaction amounts).
  Even if the conversation mentions "I have $3000 in checking", do NOT make it a fact.
- Full sensitive identifiers (complete SSN, full card numbers).

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
 * 세션 메시지를 "User:" / "Noor:" 형식으로 직렬화. (PR4 패턴)
 */
function buildConversationText(messages: DbChatMessage[]): string {
  const trimmed =
    messages.length > MAX_MESSAGES_PER_EXTRACTION
      ? messages.slice(messages.length - MAX_MESSAGES_PER_EXTRACTION)
      : messages;
  return trimmed
    .map((m) => {
      const speaker = m.role === "user" ? "User" : "Noor";
      return `${speaker}: ${m.content}`;
    })
    .join("\n\n");
}

/**
 * 기존 active facts를 LLM 프롬프트용으로 번호 매겨 직렬화.
 * factsArray[0] -> [1], factsArray[1] -> [2], ...
 */
function buildExistingFactsText(facts: UserFact[]): string {
  if (facts.length === 0) {
    return "(none)";
  }
  return facts
    .map((f, i) => `[${i + 1}] (${f.category}) ${f.fact}`)
    .join("\n");
}

// --- LLM 출력 타입 (파싱 후 검증 전) ---

interface RawNewFact {
  category?: unknown;
  fact?: unknown;
  confidence?: unknown;
}
interface RawSupersede {
  old_number?: unknown;
  category?: unknown;
  fact?: unknown;
  confidence?: unknown;
}
interface RawExpire {
  old_number?: unknown;
}
interface RawExtractionOutput {
  new_facts?: unknown;
  supersede?: unknown;
  expire?: unknown;
}

// --- 검증 통과 후 타입 ---

interface ValidNewFact {
  category: UserFactCategory;
  fact: string;
  confidence: number;
}
interface ValidSupersede {
  oldNumber: number;
  category: UserFactCategory;
  fact: string;
  confidence: number;
}
interface ValidExpire {
  oldNumber: number;
}
interface ValidatedExtraction {
  newFacts: ValidNewFact[];
  supersede: ValidSupersede[];
  expire: ValidExpire[];
}

/**
 * LLM raw 문자열에서 markdown fence를 제거하고 JSON.parse.
 * 파싱 실패 시 throw (바깥 세션 try/catch가 받음).
 */
function parseExtractionJson(raw: string): RawExtractionOutput {
  let text = raw.trim();
  // ```json ... ``` 또는 ``` ... ``` fence 제거.
  if (text.startsWith("```")) {
    // 첫 줄(``` 또는 ```json)을 제거.
    const firstNewline = text.indexOf("\n");
    if (firstNewline !== -1) {
      text = text.slice(firstNewline + 1);
    }
    // 끝의 ``` 제거.
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

/**
 * confidence를 0~1로 정규화. 숫자 아니거나 누락 → 1.0, 범위 밖 → clamp.
 */
function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1.0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * category가 7종 enum 중 하나인지.
 */
function isValidCategory(value: unknown): value is UserFactCategory {
  return (
    typeof value === "string" &&
    (VALID_CATEGORIES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * fact 텍스트가 비어있지 않은 string이고 길이 제한 내인지.
 * 통과 시 trim된 문자열 반환, 실패 시 null.
 */
function validateFactText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_FACT_LENGTH) return null;
  return trimmed;
}

/**
 * old_number가 1 ~ factsCount 범위의 정수인지.
 */
function isValidOldNumber(value: unknown, factsCount: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= factsCount
  );
}

/**
 * 파싱된 LLM 출력을 검증해 ValidatedExtraction을 만든다.
 * 개별 항목이 잘못되면 그 항목만 drop하고 로그. 세션 전체는 계속.
 *
 * @param raw          parseExtractionJson 결과
 * @param factsCount   기존 facts 개수 (old_number 범위 검증용)
 * @param sessionId    로그용
 */
function validateExtraction(
  raw: RawExtractionOutput,
  factsCount: number,
  sessionId: string
): ValidatedExtraction {
  const result: ValidatedExtraction = {
    newFacts: [],
    supersede: [],
    expire: [],
  };

  // 배열이 아니면 빈 배열로 간주.
  const rawNew: unknown[] = Array.isArray(raw.new_facts) ? raw.new_facts : [];
  const rawSup: unknown[] = Array.isArray(raw.supersede) ? raw.supersede : [];
  const rawExp: unknown[] = Array.isArray(raw.expire) ? raw.expire : [];

  // --- new_facts ---
  for (const item of rawNew) {
    const nf = (item ?? {}) as RawNewFact;
    const factText = validateFactText(nf.fact);
    if (factText === null) {
      console.warn(
        `Extract cron: session ${sessionId} dropped new_fact ` +
          `(invalid/empty/too-long text).`
      );
      continue;
    }
    if (!isValidCategory(nf.category)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped new_fact ` +
          `(invalid category: ${String(nf.category)}).`
      );
      continue;
    }
    result.newFacts.push({
      category: nf.category,
      fact: factText,
      confidence: normalizeConfidence(nf.confidence),
    });
  }

  // 중복 old_number 추적 (supersede + expire 공유).
  const usedNumbers = new Set<number>();

  // --- supersede ---
  for (const item of rawSup) {
    const sp = (item ?? {}) as RawSupersede;
    if (!isValidOldNumber(sp.old_number, factsCount)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped supersede ` +
          `(old_number out of range: ${String(sp.old_number)}).`
      );
      continue;
    }
    const oldNumber = sp.old_number as number;
    if (usedNumbers.has(oldNumber)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped supersede ` +
          `(duplicate old_number: ${oldNumber}).`
      );
      continue;
    }
    const factText = validateFactText(sp.fact);
    if (factText === null) {
      console.warn(
        `Extract cron: session ${sessionId} dropped supersede ` +
          `(invalid/empty/too-long text).`
      );
      continue;
    }
    if (!isValidCategory(sp.category)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped supersede ` +
          `(invalid category: ${String(sp.category)}).`
      );
      continue;
    }
    usedNumbers.add(oldNumber);
    result.supersede.push({
      oldNumber,
      category: sp.category,
      fact: factText,
      confidence: normalizeConfidence(sp.confidence),
    });
  }

  // --- expire ---
  for (const item of rawExp) {
    const ep = (item ?? {}) as RawExpire;
    if (!isValidOldNumber(ep.old_number, factsCount)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped expire ` +
          `(old_number out of range: ${String(ep.old_number)}).`
      );
      continue;
    }
    const oldNumber = ep.old_number as number;
    if (usedNumbers.has(oldNumber)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped expire ` +
          `(duplicate old_number: ${oldNumber}).`
      );
      continue;
    }
    usedNumbers.add(oldNumber);
    result.expire.push({ oldNumber });
  }

  // --- 상한 검증: supersede + expire 합계 ---
  if (result.supersede.length + result.expire.length > MAX_SUPERSEDE_EXPIRE) {
    console.warn(
      `Extract cron: session ${sessionId} exceeded supersede+expire cap ` +
        `(${result.supersede.length + result.expire.length} > ` +
        `${MAX_SUPERSEDE_EXPIRE}). Dropping all supersede/expire; ` +
        `keeping new_facts. Manual/follow-up review may be needed.`
    );
    result.supersede = [];
    result.expire = [];
  }

  return result;
}

// 세션 1개 처리 결과 카운트.
interface SessionFactStats {
  saved: number;
  skipped: number;
  superseded: number;
  expired: number;
  failed: number;
}

/**
 * 세션 1개의 facts를 추출·반영한다.
 *
 * 흐름: 빈 세션 처리 → 메시지 조회 → 기존 facts 조회(번호 매김) →
 *       LLM 호출 → 파싱·검증 → supersede→expire→new_facts 실행 →
 *       markFactsExtracted.
 *
 * LLM/파싱 실패는 throw → 바깥 세션 try/catch가 받음 (세션 미완료, 재시도).
 * 개별 fact DB 실패는 stats.failed에 집계하고 계속 진행.
 */
async function extractOneSession(
  apiKey: string,
  session: ChatSession,
  stats: SessionFactStats
): Promise<void> {
  // 1. 빈 세션 → LLM 없이 완료 표시.
  if (session.message_count === 0) {
    await markFactsExtracted(session.id, session.user_id);
    return;
  }

  // 2. 세션 메시지 조회 (최근 200개, 시간순).
  const recent = await getSessionMessages(session.id, session.user_id, {
    limit: MAX_MESSAGES_PER_EXTRACTION,
    order: "desc",
  });
  const messages = recent.reverse();

  // 3. message_count > 0 인데 메시지 0개 → 완료 표시 후 종료.
  if (messages.length === 0) {
    console.warn(
      `Extract cron: session ${session.id} has message_count=` +
        `${session.message_count} but 0 messages found — marking extracted.`
    );
    await markFactsExtracted(session.id, session.user_id);
    return;
  }

  // 4. 기존 active facts 조회 + 번호 매김 스냅샷.
  //    factsArray는 이후 LLM 응답 해석·실행이 끝날 때까지 변형 금지.
  const factsArray = await getUserFacts(session.user_id, {
    limit: EXISTING_FACTS_LIMIT,
  });

  // 5. LLM 호출.
  const conversationText = buildConversationText(messages);
  const existingFactsText = buildExistingFactsText(factsArray);
  const userContent =
    `[Existing facts]  (most recent first)\n${existingFactsText}\n\n` +
    `[Conversation]\n${conversationText}`;

  const rawOutput = await callOpenRouterForExtraction(
    apiKey,
    EXTRACTION_SYSTEM_PROMPT,
    userContent
  );
  if (!rawOutput.trim()) {
    throw new Error(
      `Extraction model returned empty output for session ${session.id}`
    );
  }

  // 6. 파싱 + 검증. (파싱 실패 시 throw)
  const parsed = parseExtractionJson(rawOutput);
  const validated = validateExtraction(
    parsed,
    factsArray.length,
    session.id
  );

  // 7. 분기 실행 — 순서 고정: supersede → expire → new_facts.
  //    fact 작업 단위 try/catch. 하나 실패해도 나머지 계속.

  // 7-1) supersede
  for (const item of validated.supersede) {
    const oldFact = factsArray[item.oldNumber - 1];
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
      // supersedeUserFact 내부 부분 실패 가능 (old superseded됐는데
      // new insert 실패). 동일 내용으로 saveUserFact 1회 복구 시도.
      try {
        await saveUserFact(session.user_id, payload);
        stats.superseded++;
      } catch (recoveryError) {
        stats.failed++;
        console.error(
          `Extract cron: supersede failed for session ${session.id}, ` +
            `fact #${item.oldNumber} (${oldFact.id}); recovery saveUserFact ` +
            `also failed.`,
          supersedeError,
          recoveryError
        );
      }
    }
  }

  // 7-2) expire
  for (const item of validated.expire) {
    const oldFact = factsArray[item.oldNumber - 1];
    try {
      await expireUserFact(oldFact.id, session.user_id);
      stats.expired++;
    } catch (expireError) {
      stats.failed++;
      console.error(
        `Extract cron: expire failed for session ${session.id}, ` +
          `fact #${item.oldNumber} (${oldFact.id}).`,
        expireError
      );
    }
  }

  // 7-3) new_facts — saveUserFact + 23505 분기 (factsSaved/Skipped 정확 카운트)
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
      if (isUniqueViolation(saveError)) {
        // 동일 텍스트 active fact 이미 존재 — upsert와 동일하게 흡수.
        stats.skipped++;
      } else {
        stats.failed++;
        console.error(
          `Extract cron: saveUserFact failed for session ${session.id}.`,
          saveError
        );
      }
    }
  }

  // 8. 완료 표시. 개별 fact 실패가 있어도 세션은 추출 완료로 마크
  //    (미완료로 두면 다음 cron이 세션 전체를 재추출 → 중복/오류).
  //    markFactsExtracted 실패 시 throw → 바깥 세션 try/catch가
  //    processFailed로 처리 (CRITICAL 로그는 GET 핸들러에서).
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

  // processFailed 세션도 부분 성공 fact가 factsSaved 등에 합산될 수 있음
  //  — 세션은 실패해도 일부 fact가 DB에 반영됐을 수 있기 때문.
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
  };

  try {
    const toExtract = await getSessionsNeedingFactsExtraction(
      EXTRACT_BATCH_LIMIT
    );
    for (const session of toExtract) {
      const sessionStats: SessionFactStats = {
        saved: 0,
        skipped: 0,
        superseded: 0,
        expired: 0,
        failed: 0,
      };
      try {
        await extractOneSession(apiKey, session, sessionStats);
        stats.processed++;
      } catch (error) {
        stats.processFailed++;
        // markFactsExtracted 실패를 포함한 세션 단위 실패. 일부 fact가
        // 이미 반영됐는데 완료 마크가 안 됐을 수 있어 다음 cron이 세션을
        // 재추출 → 이미 superseded된 번호 재시도 위험. CRITICAL로 남김.
        console.error(
          `Extract cron: CRITICAL — session ${session.id} failed during ` +
            `extraction (facts may be partially applied and the session ` +
            `may be re-processed next run):`,
          error
        );
      } finally {
        // 세션 처리 도중 일부라도 반영된 fact 카운트는 합산.
        stats.factsSaved += sessionStats.saved;
        stats.factsSkipped += sessionStats.skipped;
        stats.factsSuperseded += sessionStats.superseded;
        stats.factsExpired += sessionStats.expired;
        stats.factsFailed += sessionStats.failed;
      }
    }
  } catch (error) {
    console.error(
      "Extract cron: getSessionsNeedingFactsExtraction failed:",
      error
    );
    infraError =
      `getSessionsNeedingFactsExtraction failed: ` +
      `${error instanceof Error ? error.message : String(error)}`;
  }

  console.info("Extract cron complete:", stats);

  // cron_runs에 실행 기록 (격리). items_*는 세션 단위 (factsFailed는 stats에만).
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
    console.error("Extract cron: failed to record cron_runs row:", recordError);
  }

  // cron_runs 보존 정리 (격리 — 느슨한 작업, 실패해도 다음 run에서 정리됨).
  try {
    const deleted = await deleteOldCronRuns(CRON_RUNS_RETENTION_DAYS);
    if (deleted > 0) {
      console.info(`Extract cron: cleaned up ${deleted} old cron_runs row(s).`);
    }
  } catch (cleanupError) {
    console.warn(
      "Extract cron: cron_runs cleanup failed (will retry next run):",
      cleanupError
    );
  }

  return NextResponse.json({
    success: true,
    ...stats,
  });
}
