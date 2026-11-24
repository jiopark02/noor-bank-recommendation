/**
 * crisisSignals — finds a crisis signal in a piece of user text: a sign the
 * user may harm themselves, harm someone else, or is struggling with eating.
 * Pure and dependency-free: no I/O, no logging, no environment reads, so the
 * chat route, the chat client, the demo chat and the memory crons can all use
 * it, including from a client bundle.
 *
 * HOW TEXT IS MATCHED
 * The text is normalized first: lower case, curly apostrophes to "'", every
 * character other than a-z, 0-9, "'" and space to a space, runs of spaces to
 * one. Known financial idioms that contain a signal word ("financial
 * suicide", "purge my old subscriptions") are then removed, and the patterns
 * below are tested on what is left. Patterns are phrases, never a single word
 * such as "die", "kill" or "dead", and "kill" / "hurt" take only a reflexive
 * pronoun or a person as their object. "kill my boss's idea", "shoot <person>
 * a text" and "purge my credit card statements" are removed as idioms. The
 * exceptions name the non-human object they remove, so "kill my boss's wife"
 * and "purge my stomach" still match.
 *
 * WHAT IS DELIBERATELY NOT DONE
 * Negation is not suppressed ("I'm not suicidal" matches): a notice shown in
 * error costs less than one withheld. English only. No pattern has a nested
 * quantifier, so matching time stays linear in the input length.
 *
 * WHY EVERY PATTERN IS A LITERAL
 * Every pattern is written as a regular expression literal, with no pattern
 * built from a string. A pattern built from a string spells a word boundary
 * as "\\b" and depends on that escape reaching the built server and browser
 * bundles unchanged; if it does not, the pattern stops matching without any
 * error. The shared groups are therefore repeated in each pattern that uses
 * them:
 *   reflexive pronoun, first and third person, so a fact or summary written
 *   about the user ("User wants to hurt themselves") matches as well:
 *     (?:my ?self|him ?self|her ?self|them ?sel(?:f|ves))
 *   possessive:
 *     (?:my|his|her|their)
 *   person:
 *     (?:him|her|them|someone|somebody|people|my (?:wife|husband|partner|
 *     boyfriend|girlfriend|roommate|landlord|boss|mom|dad|mother|father|
 *     brother|sister|kid|kids|son|daughter|ex))
 * A change to one of these groups is made in every pattern that repeats it.
 */

export type CrisisCategory = "self_harm" | "harm_to_others" | "eating";

// Removed before matching: phrases with a signal word that are about money.
const EXCEPTIONS: RegExp[] = [
  /\b(?:financial|credit|career|social) suicide\b/g,
  /\bdying to\b/g,
  /\bkill two birds\b/g,
  /\bpurg\w* (?:my |your |their |his |her |our |the |all |those |these )?(?:old |unused )?(?:credit card |bank |budget )?(?:files|accounts|subscriptions|cards|data|statements|receipts|records|spreadsheet|spreadsheets|budget|transactions|emails|inbox|history)\b/g,
  /\bshoot(?:ing)? (?:him|her|them|someone|somebody|people|my (?:wife|husband|partner|boyfriend|girlfriend|roommate|landlord|boss|mom|dad|mother|father|brother|sister|kid|kids|son|daughter|ex)) an? (?:text|email|message|note|line|dm|question)\b/g,
  /\b(?:kill(?:ing)?|hurt(?:ing)?|shoot(?:ing)?|stab(?:bing)?|strangl(?:e|ing)|beat(?:ing)? up) (?:him|her|them|someone|somebody|people|my (?:wife|husband|partner|boyfriend|girlfriend|roommate|landlord|boss|mom|dad|mother|father|brother|sister|kid|kids|son|daughter|ex))'s (?:idea|ideas|plan|plans|proposal|proposals|budget|project|projects|deal|deals|chances)\b/g,
];

const SELF_HARM: RegExp[] = [
  /\bkill(?:ing)? (?:my ?self|him ?self|her ?self|them ?sel(?:f|ves))\b/,
  /\bsuicid(?:e|al)\b/,
  /\bend(?:ing)? (?:my|his|her|their) life\b/,
  /\bend(?:ing)? it all\b/,
  /\btake (?:my|his|her|their) (?:own )?life\b/,
  /\b(?:wants?(?:ed)? to|wanna) die\b/,
  /\bwish(?:es)? (?:i|he|she|they) (?:was|were) dead\b/,
  /\bbetter off dead\b/,
  /\bno reason to (?:live|go on)\b/,
  // "live" only at the end of the message or before "anymore", "like this"
  // or "this way", so "I don't want to live paycheck to paycheck" does not
  // match.
  /\b(?:do(?:es)?|did) ?(?:n'?t|not) want to (?:live anymore\b|live like this\b|live this way\b|live$|be alive\b|be here anymore\b)/,
  /\b(?:hurt(?:ing)?|harm(?:ing)?|cut(?:ting)?) (?:my ?self|him ?self|her ?self|them ?sel(?:f|ves))\b/,
  /\bself ?harm(?:ing)?\b/,
  /\boverdos(?:e|ing)\b/,
  /\bnot worth living\b/,
];

const HARM_TO_OTHERS: RegExp[] = [
  /\b(?:want to|wants to|going to|gonna|i'?ll|i will|thinking (?:of|about)) (?:kill(?:ing)?|hurt(?:ing)?|shoot(?:ing)?|stab(?:bing)?|strangl(?:e|ing)|beat(?:ing)? up) (?:him|her|them|someone|somebody|people|my (?:wife|husband|partner|boyfriend|girlfriend|roommate|landlord|boss|mom|dad|mother|father|brother|sister|kid|kids|son|daughter|ex))\b/,
];

const EATING: RegExp[] = [
  /\b(?:anorexi|bulimi)\w*/,
  /\beating disorder\b/,
  /\bstarv(?:e|es|ing) (?:my ?self|him ?self|her ?self|them ?sel(?:f|ves))\b/,
  /\bma(?:ke|kes|king|de) (?:my ?self|him ?self|her ?self|them ?sel(?:f|ves)) (?:throw up|vomit|sick)\b/,
  /\bpurg(?:e|es|ed|ing)\b/,
  /\bbinge (?:eat|eating)\b/,
];

// Highest priority first: when a message matches more than one category, the
// notice for the first one is shown.
const CATEGORIES: Array<[CrisisCategory, RegExp[]]> = [
  ["self_harm", SELF_HARM],
  ["harm_to_others", HARM_TO_OTHERS],
  ["eating", EATING],
];

function matchesAny(normalized: string, patterns: RegExp[]): boolean {
  for (let i = 0; i < patterns.length; i += 1) {
    if (patterns[i].test(normalized)) return true;
  }
  return false;
}

/** The text the patterns are tested on. Exported for tests. */
export function normalizeCrisisText(text: string): string {
  let normalized = text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/ +/g, " ")
    .trim();
  for (let i = 0; i < EXCEPTIONS.length; i += 1) {
    normalized = normalized.replace(EXCEPTIONS[i], " ");
  }
  return normalized.replace(/ +/g, " ").trim();
}

/** The highest-priority crisis category the text signals, or null. */
export function detectCrisisSignal(text: string): CrisisCategory | null {
  if (!text) return null;
  const normalized = normalizeCrisisText(text);
  if (normalized === "") return null;
  for (let i = 0; i < CATEGORIES.length; i += 1) {
    const [category, patterns] = CATEGORIES[i];
    if (matchesAny(normalized, patterns)) return category;
  }
  return null;
}

/**
 * True when any user row carries a signal of the given category, whether or
 * not it is that row's highest-priority one. Assistant rows are not read:
 * they hold the notices Noor itself showed, which name the same topics.
 */
export function hasPriorCrisisSignal(
  rows: ReadonlyArray<{ role: string; content: string | null }>,
  category: CrisisCategory
): boolean {
  let patterns: RegExp[] = [];
  for (let i = 0; i < CATEGORIES.length; i += 1) {
    if (CATEGORIES[i][0] === category) patterns = CATEGORIES[i][1];
  }
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.role !== "user" || !row.content) continue;
    const normalized = normalizeCrisisText(row.content);
    if (normalized !== "" && matchesAny(normalized, patterns)) return true;
  }
  return false;
}
