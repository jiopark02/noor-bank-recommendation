/**
 * HTML encoding for values placed in an email body. A module of its own so
 * the email builders can use it without importing the Resend sender.
 */

/**
 * The five characters that can change the meaning of HTML text or of a quoted
 * attribute. The quotes are written as escapes, so a masker that does not
 * understand regex literals (serverLogEmailProbe.test.ts) is not confused by
 * a literal quote inside one.
 */
const HTML_SPECIAL_PATTERN = /[&<>\u0022\u0027]/g;

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Encodes a value for an HTML text node or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(HTML_SPECIAL_PATTERN, (ch) => HTML_ENTITIES[ch]);
}
