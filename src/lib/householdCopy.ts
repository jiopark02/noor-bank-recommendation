/**
 * The household API's answer codes and the sentence each one carries. No
 * imports, so the routes and the browser screens read the same text.
 *
 * Roles are shown as "Manager" (schema value 'owner') and "Member" (schema
 * value 'member'); the schema values themselves do not change.
 */

export const HOUSEHOLD_CODES = {
  INVITE_UNAVAILABLE: "INVITE_UNAVAILABLE",
  EMAIL_UNCONFIRMED: "EMAIL_UNCONFIRMED",
  HOUSEHOLD_FULL: "HOUSEHOLD_FULL",
  ALREADY_MEMBER: "ALREADY_MEMBER",
  MUST_LEAVE_FIRST: "MUST_LEAVE_FIRST",
  HOUSEHOLD_CHANGED: "HOUSEHOLD_CHANGED",
  INVITE_SELF: "INVITE_SELF",
  INVALID_EMAIL: "INVALID_EMAIL",
  NOT_OWNER: "NOT_OWNER",
  LEAVE_SOLO: "LEAVE_SOLO",
  INVITE_LIMIT_REACHED: "INVITE_LIMIT_REACHED",
  INVITE_CHECK_UNAVAILABLE: "INVITE_CHECK_UNAVAILABLE",
  ADMIN_UNCONFIGURED: "ADMIN_UNCONFIGURED",
  SERVER_ERROR: "SERVER_ERROR",
  REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE",
} as const;

export type HouseholdCode = (typeof HOUSEHOLD_CODES)[keyof typeof HOUSEHOLD_CODES];

export const SERVER_FAULT_MESSAGE =
  "Something went wrong on our end. Please check back in a moment.";

export const HOUSEHOLD_MESSAGES: Record<HouseholdCode, string> = {
  INVITE_UNAVAILABLE:
    "This invite link isn't valid for your account. It may have expired, been replaced, or been made for a different email address.",
  EMAIL_UNCONFIRMED: "Confirm your email address before joining a household.",
  HOUSEHOLD_FULL: "This household already has two people.",
  ALREADY_MEMBER: "You're already in this household.",
  MUST_LEAVE_FIRST:
    "You're already in a household with someone else. Leave it to join this one.",
  HOUSEHOLD_CHANGED: "Your household just changed. Please try again.",
  INVITE_SELF: "That's your own email address. Enter the other person's.",
  INVALID_EMAIL: "Enter a valid email address.",
  NOT_OWNER: "Only the Manager can do that.",
  LEAVE_SOLO: "You're the only person in this household.",
  INVITE_LIMIT_REACHED:
    "You've created too many invite links today. Try again tomorrow.",
  INVITE_CHECK_UNAVAILABLE: SERVER_FAULT_MESSAGE,
  ADMIN_UNCONFIGURED: SERVER_FAULT_MESSAGE,
  SERVER_ERROR: SERVER_FAULT_MESSAGE,
  REQUEST_TOO_LARGE: "Request is too large.",
};

/** The role as shown on screen. */
export function householdRoleLabel(role: "owner" | "member"): string {
  return role === "owner" ? "Manager" : "Member";
}
