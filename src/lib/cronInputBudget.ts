/**
 * cronInputBudget — bounds what the memory crons (summarize, extract-facts)
 * send to their model. Pure: no I/O; the only side effect is the log call a
 * caller passes in (or console by default).
 *
 * Lengths are measured in UTF-16 code units (String.prototype.length), and a
 * cut never falls between the two halves of a surrogate pair.
 *
 * - A message longer than CRON_MAX_MESSAGE_CHARS keeps its first
 *   CRON_MESSAGE_HEAD_CHARS and last CRON_MESSAGE_TAIL_CHARS, with a marker
 *   naming how much was left out between them.
 * - The conversation keeps the newest messages that fit in
 *   CRON_MAX_CONVERSATION_CHARS; once one does not fit, it and every older
 *   message are left out, so the part sent is one unbroken stretch.
 * - The existing-facts block keeps the leading facts (the caller passes them
 *   newest first) that fit in CRON_MAX_EXISTING_FACTS_CHARS. The returned array
 *   is exactly the facts that were numbered in the text, so a number the model
 *   gives back can only name a fact it was shown.
 * - At most CRON_MAX_NEW_FACTS_PER_SESSION new facts are kept from one answer.
 *
 * These limits do not read or change anything the crisis check or the memory
 * output filter see: both run on the model's answer, not on this input.
 */

// Unvalidated defaults. Revisit after launch against llm_calls.prompt_tokens
// and latency_ms for the cron_summarize and cron_extract_facts routes. These
// are separate from the chat route's input limits on purpose.
export const CRON_MAX_MESSAGE_CHARS = 4000;
export const CRON_MESSAGE_HEAD_CHARS = 3000;
export const CRON_MESSAGE_TAIL_CHARS = 1000;
export const CRON_MAX_CONVERSATION_CHARS = 48000;
export const CRON_MAX_EXISTING_FACTS_CHARS = 20000;
export const CRON_MAX_NEW_FACTS_PER_SESSION = 20;

const MESSAGE_SEPARATOR = "\n\n";
const FACT_SEPARATOR = "\n";
const NO_FACTS_TEXT = "(none)";

export type CronLog = (message: string, ...args: unknown[]) => void;

export interface CronConversationMessage {
  role: string;
  content: string;
}

export interface CronConversation {
  /** The serialized messages, oldest first. */
  text: string;
  /** Messages that were sent with their middle left out. */
  truncated: number;
  /** Oldest messages left out because the conversation budget was full. */
  dropped: number;
}

export interface CronFactLine {
  category: string;
  fact: string;
}

export interface CronExistingFacts<T> {
  /** The facts numbered in `text`, in the same order: facts[i] is [i + 1]. */
  facts: T[];
  text: string;
  /** Facts left out because the facts budget was full. */
  dropped: number;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** The marker put where the middle of a long message was left out. */
export function omissionMarker(omitted: number): string {
  return `[… ${omitted} characters omitted …]`;
}

/**
 * The message unchanged when it is at most CRON_MAX_MESSAGE_CHARS long;
 * otherwise its head and tail around an omission marker. The marker sits on a
 * line of its own and starts and ends with a bracket, so it never joins the
 * digits on either side into one longer number.
 */
export function truncateCronMessage(content: string): string {
  if (content.length <= CRON_MAX_MESSAGE_CHARS) return content;

  let headEnd = CRON_MESSAGE_HEAD_CHARS;
  if (isHighSurrogate(content.charCodeAt(headEnd - 1))) headEnd -= 1;

  let tailStart = content.length - CRON_MESSAGE_TAIL_CHARS;
  if (isLowSurrogate(content.charCodeAt(tailStart))) tailStart += 1;

  return (
    content.slice(0, headEnd) +
    "\n" +
    omissionMarker(tailStart - headEnd) +
    "\n" +
    content.slice(tailStart)
  );
}

/**
 * Serializes messages (oldest first) as "User: …" / "Noor: …" blocks, each
 * message truncated, keeping the newest that fit in
 * CRON_MAX_CONVERSATION_CHARS.
 */
export function buildCronConversationText(
  messages: readonly CronConversationMessage[]
): CronConversation {
  const kept: string[] = [];
  let total = 0;
  let truncated = 0;
  let index = messages.length - 1;

  for (; index >= 0; index -= 1) {
    const message = messages[index];
    const content = truncateCronMessage(message.content);
    const speaker = message.role === "user" ? "User" : "Noor";
    const line = `${speaker}: ${content}`;
    const added =
      line.length + (kept.length > 0 ? MESSAGE_SEPARATOR.length : 0);
    if (total + added > CRON_MAX_CONVERSATION_CHARS) break;
    total += added;
    kept.push(line);
    if (content !== message.content) truncated += 1;
  }

  kept.reverse();
  return {
    text: kept.join(MESSAGE_SEPARATOR),
    truncated,
    dropped: index + 1,
  };
}

/**
 * Numbers the facts "[1] (category) fact", … and keeps the leading ones whose
 * lines fit in CRON_MAX_EXISTING_FACTS_CHARS. The text is "(none)" when no
 * fact is kept.
 */
export function budgetExistingFacts<T extends CronFactLine>(
  facts: readonly T[]
): CronExistingFacts<T> {
  const kept: T[] = [];
  const lines: string[] = [];
  let total = 0;

  for (let i = 0; i < facts.length; i += 1) {
    const line = `[${i + 1}] (${facts[i].category}) ${facts[i].fact}`;
    const added = line.length + (lines.length > 0 ? FACT_SEPARATOR.length : 0);
    if (total + added > CRON_MAX_EXISTING_FACTS_CHARS) break;
    total += added;
    kept.push(facts[i]);
    lines.push(line);
  }

  return {
    facts: kept,
    text: lines.length === 0 ? NO_FACTS_TEXT : lines.join(FACT_SEPARATOR),
    dropped: facts.length - kept.length,
  };
}

/**
 * The first CRON_MAX_NEW_FACTS_PER_SESSION items, in the order given. When
 * some are left out, logs how many — and nothing else: no fact text, no user
 * or session id.
 */
export function capNewFacts<T>(
  items: T[],
  warn: CronLog = (...args) => console.warn(...args)
): T[] {
  if (items.length <= CRON_MAX_NEW_FACTS_PER_SESSION) return items;
  warn(
    "[cron-facts-cap] dropped=%d",
    items.length - CRON_MAX_NEW_FACTS_PER_SESSION
  );
  return items.slice(0, CRON_MAX_NEW_FACTS_PER_SESSION);
}

/**
 * One line per session with how much of the input was left out. Counts only:
 * no content, no user or session id. `factsDropped` is given by the
 * extract-facts cron only.
 */
export function logCronInputBudget(
  route: "cron_summarize" | "cron_extract_facts",
  conversation: Pick<CronConversation, "truncated" | "dropped">,
  factsDropped?: number,
  info: CronLog = (...args) => console.info(...args)
): void {
  if (factsDropped === undefined) {
    info(
      "[cron-input] route=%s truncated=%d dropped=%d",
      route,
      conversation.truncated,
      conversation.dropped
    );
    return;
  }
  info(
    "[cron-input] route=%s truncated=%d dropped=%d facts_dropped=%d",
    route,
    conversation.truncated,
    conversation.dropped,
    factsDropped
  );
}
