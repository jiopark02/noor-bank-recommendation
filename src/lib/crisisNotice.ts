/**
 * crisisNotice — the fixed notices shown when a crisis signal is detected
 * (crisisSignals.ts), and how a notice is joined to the model's reply.
 *
 * The notice is fixed text attached by code, so it reaches the user whatever
 * the model writes, and on error responses as well. Contacts are US only and
 * name no police or emergency number. 988 is in every notice and comes first
 * where another contact is named: the other contacts are not crisis lines
 * (ANAD) or may be unreachable from some prepaid plans (741741).
 *
 * Only a type is imported, so this module stays safe for a client bundle.
 */

import type { CrisisCategory } from "./crisisSignals";

export type CrisisVariant = "standard" | "escalated";

// Contact details verified 2026-10-27.
export const CRISIS_NOTICES: Record<
  CrisisCategory,
  { standard: string; escalated: string }
> = {
  self_harm: {
    standard:
      "If you are thinking about suicide or hurting yourself, please reach out now. In the US, call or text 988 to reach the 988 Suicide & Crisis Lifeline, free and available 24/7. You can also text HOME to 741741 to reach Crisis Text Line, also 24/7. Noor is an AI and cannot help in a crisis, but a trained person can.",
    escalated:
      "This has come up more than once, so to be direct: please call or text 988 right now. A trained person will answer, free and 24/7. You do not have to handle this alone.",
  },
  harm_to_others: {
    standard:
      "If you feel you might hurt someone, please pause and reach out for support now. Call or text 988 to talk with a trained counselor, free and 24/7. 988 is for anyone in emotional distress, not only for thoughts of suicide. Noor is an AI and cannot help in this situation.",
    escalated:
      "This has come up more than once. Please step away from the situation and call or text 988 right now. A trained counselor will answer, free and 24/7.",
  },
  eating: {
    standard:
      "If you are struggling with eating, such as not eating, purging, or bingeing, support is available. If you are in distress right now, call or text 988, free and 24/7. For ongoing support, call the ANAD Helpline at 1-888-375-7767 on weekdays. Noor is an AI and cannot give medical help.",
    escalated:
      "This has come up more than once. If you feel unsafe, call or text 988 right now. Please also talk to a doctor soon, or call the ANAD Helpline at 1-888-375-7767 on weekdays.",
  },
};

/**
 * The reply shown and stored for a turn that carried a crisis signal: the
 * notice first, then the model's reply. When the model gave no usable reply
 * (empty, or the fallback text that stands in for an empty reply), the
 * notice alone. The fallback text is passed in so this module does not import
 * the server-side response handling.
 */
export function composeCrisisReply(
  notice: string,
  modelMessage: string | null | undefined,
  emptyReplyText: string
): string {
  if (
    modelMessage === null ||
    modelMessage === undefined ||
    modelMessage.trim() === "" ||
    modelMessage === emptyReplyText
  ) {
    return notice;
  }
  return `${notice}\n\n${modelMessage}`;
}
