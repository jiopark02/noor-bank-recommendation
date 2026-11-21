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
  AUTH_UNAVAILABLE: "AUTH_UNAVAILABLE",
  SHARE_INVALID_REQUEST: "SHARE_INVALID_REQUEST",
  SHARE_NO_PARTNER: "SHARE_NO_PARTNER",
  SHARE_NO_CONNECTION: "SHARE_NO_CONNECTION",
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
  AUTH_UNAVAILABLE: "We couldn't confirm your sign-in right now. Please try again in a moment.",
  SHARE_INVALID_REQUEST: "That request isn't valid.",
  SHARE_NO_PARTNER: "There's no one else in your household to share with.",
  SHARE_NO_CONNECTION: "We couldn't find that bank connection on your account.",
};

/** The role as shown on screen. */
export function householdRoleLabel(role: "owner" | "member"): string {
  return role === "owner" ? "Manager" : "Member";
}

/** Everything else the household screens show. */
export const HOUSEHOLD_UI = {
  settingsSection: "Household",
  settingsRowLabel: "Household",
  settingsRowDescription: "Share Noor with one other person",

  title: "Household",
  loading: "Loading your household…",
  cardUnavailable: "We couldn't load your household right now.",
  cardInvite: "Invite someone",
  alone: "You're the only person in your household.",
  explainer: "A household is two people at most. The Manager can invite one other person.",
  you: "You",
  emailLabel: "Their email address",
  createButton: "Create invite link",
  creating: "Creating…",
  formNote:
    "They need a Noor account with this email. We don't send an email — you share the link yourself.",
  linkCreated: "Invite link created",
  copyLink: "Copy link",
  copied: "Copied",
  linkNote:
    "This link works once and expires in 24 hours. We can't show it again after you leave this page.",
  linkSignInNote: "Ask them to sign in to Noor first, then open the link.",
  pendingPrefix: "Invite pending for",
  expiresPrefix: "Expires",
  cancelInvite: "Cancel invite",
  cancelling: "Cancelling…",
  newLink: "Create a new link",
  newLinkNote: "Creating a new link turns off the old one.",
  cancelled: "Invite cancelled.",
  memberCannotInvite: "Only the Manager can invite someone.",
  full: "Your household already has two people.",
  leaveButton: "Leave household",
  leaveTitle: "Leave this household?",
  leaveBody: "You'll go back to a household of your own. The other person stays in this one.",
  leaveManagerNote: "They'll become the Manager.",
  leaveConfirm: "Leave",
  leaveStay: "Stay",
  leftHousehold: "You left the household.",

  acceptTitle: "Join a household",
  checking: "Checking your invite…",
  invitedNamed: (name: string) => `${name} invited you to join their household.`,
  invitedUnnamed: "You've been invited to join a household.",
  joinMoves: "Joining moves you out of your current household.",
  joinButton: "Join household",
  joining: "Joining…",
  notNow: "Not now",
  joined: "You've joined the household.",
  joinUnconfirmed: "We couldn't confirm whether you joined. Check your household.",
  goToHousehold: "Go to Household",
  leaveCurrentButton: "Leave my current household",
  leavingCurrent: "Leaving…",
  leftPrevious: "You left your previous household.",
  openLinkAgain: "Open the invite link again to continue.",
  tryAgain: "Try again",

  shareQuestion: (bank: string, name: string | null) =>
    `Share ${bank || "this bank"} with ${name ?? "the other person in your household"}?`,
  shareExplainer: (name: string | null) =>
    `If you share, ${name ?? "they"} can see this bank's accounts and balances on their screens and in their Noor AI chat. You can change this anytime in Settings → Household.`,
  shareButton: "Share",
  shareSaving: "Saving…",
  shareFailed: "We couldn't save that. Try again.",
  sharingSection: "Bank sharing",
  sharingNote: (name: string | null) =>
    `Choose which of your banks ${name ?? "the other person in your household"} can see.`,
  sharingNoBanks: "You haven't connected a bank yet.",
  sharingUnavailable: "We couldn't load your bank sharing right now.",
  sharedLabel: "Shared",
  notSharedLabel: "Not shared",
  stopSharing: "Stop sharing",

  sessionEnded: "Your session has ended. Please sign in again.",
  sessionUnconfirmed: "We couldn't confirm you're signed in. Try again.",
  reload: "Reload",
  network: "We couldn't reach Noor. Check your connection and try again.",
} as const;
