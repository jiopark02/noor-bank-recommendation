// Comprehensive Validation Utilities

// ============================================
// PASSWORD VALIDATION
// ============================================

export interface PasswordValidation {
  isValid: boolean;
  strength: 'weak' | 'medium' | 'strong';
  score: number; // 0-100
  errors: string[];
  checks: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
  };
}

export function validatePassword(password: string): PasswordValidation {
  const checks = {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  };

  const errors: string[] = [];
  if (!checks.minLength) errors.push('Password must be at least 8 characters');
  if (!checks.hasUppercase) errors.push('Password must contain an uppercase letter');
  if (!checks.hasLowercase) errors.push('Password must contain a lowercase letter');
  if (!checks.hasNumber) errors.push('Password must contain a number');
  if (!checks.hasSpecial) errors.push('Password must contain a special character (!@#$%^&*)');

  const passedChecks = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passedChecks / 5) * 100);

  let strength: 'weak' | 'medium' | 'strong' = 'weak';
  if (passedChecks >= 5) strength = 'strong';
  else if (passedChecks >= 3) strength = 'medium';

  return {
    isValid: passedChecks === 5,
    strength,
    score,
    errors,
    checks,
  };
}

export function getPasswordStrengthColor(strength: 'weak' | 'medium' | 'strong'): string {
  switch (strength) {
    case 'strong': return '#10B981'; // green
    case 'medium': return '#F59E0B'; // yellow
    case 'weak': return '#EF4444'; // red
  }
}

export function getPasswordStrengthLabel(strength: 'weak' | 'medium' | 'strong'): string {
  switch (strength) {
    case 'strong': return 'Strong';
    case 'medium': return 'Medium';
    case 'weak': return 'Weak';
  }
}

// ============================================
// EMAIL VALIDATION
// ============================================

export interface EmailValidation {
  isValid: boolean;
  error: string | null;
  suggestion: string | null;
  isEdu: boolean;
}

const EMAIL_TYPO_CORRECTIONS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'icloud.co': 'icloud.com',
  'icoud.com': 'icloud.com',
};

export function validateEmail(email: string): EmailValidation {
  const trimmedEmail = email.trim().toLowerCase();

  // Basic format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return {
      isValid: false,
      error: 'Please enter a valid email address',
      suggestion: null,
      isEdu: false,
    };
  }

  // Check for common typos
  const domain = trimmedEmail.split('@')[1];
  const correction = EMAIL_TYPO_CORRECTIONS[domain];
  if (correction) {
    const correctedEmail = trimmedEmail.replace(domain, correction);
    return {
      isValid: true,
      error: null,
      suggestion: `Did you mean ${correctedEmail}?`,
      isEdu: false,
    };
  }

  // Check if .edu email
  const isEdu = domain.endsWith('.edu');

  return {
    isValid: true,
    error: null,
    suggestion: null,
    isEdu,
  };
}

// ============================================
// CURRENCY FORMATTING
// ============================================

export function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value.replace(/[,$]/g, '')) : value;
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}

// ============================================
// NAME SANITIZATION
// ============================================
export function sanitizeNameField(value: unknown): string {
  // SECURITY (prompt injection): firstName/lastName are interpolated raw into
  // the system prompt's "## Current User Context" section as a markdown list
  // line. A newline in the value lets an attacker break out of that line and
  // inject a fake section (e.g. "\n## SYSTEM OVERRIDE ..."). We strip control
  // characters (incl. newlines/tabs) and cap length. We deliberately do NOT
  // restrict to ASCII letters: the product serves a global beginner audience,
  // so names like "José" or "김성원" must pass. The goal is to prevent line
  // breakout, not to validate name "correctness".
  if (typeof value !== "string") return "";
  const stripped = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, 100);
}

// ============================================
// SESSION MANAGEMENT
// ============================================

export interface SessionConfig {
  staySignedIn: boolean;
  lastActivity: number;
  expiresAt: number;
}

const SESSION_KEY = 'noor_session';
const SESSION_DURATION_REMEMBER = 365 * 24 * 60 * 60 * 1000; // 1 year

export function createSession(staySignedIn: boolean): SessionConfig {
  const now = Date.now();
  const session: SessionConfig = {
    staySignedIn,
    lastActivity: now,
    expiresAt: staySignedIn ? now + SESSION_DURATION_REMEMBER : 0, // 0 = session storage (browser close)
  };

  if (staySignedIn) {
    // Persist across browser sessions
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    // Clear on browser close - use sessionStorage
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.removeItem(SESSION_KEY);
  }
  return session;
}

export function getSession(): SessionConfig | null {
  // Check localStorage first (persistent), then sessionStorage (browser session)
  const stored = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function updateSessionActivity(): void {
  const session = getSession();
  if (!session) return;
  session.lastActivity = Date.now();

  if (session.staySignedIn) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

// ============================================
// LOCAL AUTH STATE CLEANUP
// ============================================
// SECURITY: Chat history was mirrored to localStorage under "noor_chat_history"
// and was NOT cleared on logout, leaving prior users' plaintext financial
// conversations readable on a shared device (via DevTools, or via the old
// "Export My Data" path, which dumped localStorage to a file; that path has
// been removed, and data export is now served by a server API).
// This central helper purges all local auth/profile/chat state and must be
// called from every logout-equivalent path (explicit logout, account delete,
// and the SIGNED_OUT auth event covering other-tab logout / token expiry).
// noor_chat_history is removed in full (not per-user) because the goal is
// shared-device hygiene: no account's history should linger after sign-out.
// SCOPE SPLIT (deliberate, see purgeAllNoorLocalState below):
//   - clearLocalAuthState = LOGOUT / SIGNED_OUT path. Purges only the sensitive
//     subset (auth + profile + chat + the Plaid keys). This is the
//     shared-device hygiene boundary; it is intentionally a curated subset, NOT
//     a blanket noor_ sweep (a logout should not, for example, reset the
//     device's language preference).
//   - purgeAllNoorLocalState = ACCOUNT DELETION path. Blanket noor_ prefix
//     sweep of local + session storage, because the account no longer exists.
export function clearLocalAuthState(): void {
  clearSession(); // noor_session (local + sessionStorage)
  localStorage.removeItem('noor_user_id');
  localStorage.removeItem('noor_user_profile');
  localStorage.removeItem('noor_chat_history');
  // Plaid keys: the app no longer writes these, but earlier builds stored
  // account balances, transactions and connection details under them. Clear
  // them on logout so nothing an older build left survives on a shared device.
  localStorage.removeItem('noor_plaid_connections');
  localStorage.removeItem('noor_plaid_accounts');
  localStorage.removeItem('noor_plaid_transactions');
}

// Drops the Plaid keys from the browser. The app no longer writes them — bank
// data is read from the server on every visit — but earlier builds stored
// account balances, transactions and connection details under them, and those
// values can still be on a device. Callers, all removing leftovers rather than
// live state:
//   - ClientLayout's mount effect, on every page;
//   - the dashboard's mount effect, unconditionally on every visit;
//   - a CONFIRMED disconnect in usePlaidConnections (the server returned 200,
//     which /api/plaid/disconnect does only after the row deletion succeeded).
// Neither reacts to a failed read. Clearing local state on a transient error is
// what once produced a "connected but shows disconnected" loop, and that is
// why the disconnect call sits on the success path only.
//
// All three keys go, none of them pruned per item. Nothing reads them, so
// removing them costs nothing.
//
// No typeof window guard, matching clearLocalAuthState above: every caller runs
// only in the browser (mount effects and a click handler).
export function clearPlaidLocalState(): void {
  localStorage.removeItem('noor_plaid_connections');
  localStorage.removeItem('noor_plaid_accounts');
  localStorage.removeItem('noor_plaid_transactions');
}

/**
 * Full local-state purge for ACCOUNT DELETION (not logout).
 *
 * Sweeps EVERY key with the "noor_" prefix from both localStorage and
 * sessionStorage. This deliberately does NOT iterate a static key list: a
 * hand-maintained whitelist was abandoned here after 2026-07-03 live testing
 * found noor_plaid_accounts / noor_plaid_transactions surviving deletion, and a
 * full setItem sweep then surfaced ~17 further noor_* keys missing from the
 * list — including dynamically suffixed keys (e.g. noor_visa_info_<country>)
 * that no static list can ever cover. Deletion is terminal, so over-deleting
 * costs nothing (device preferences included), while under-deleting leaves bank
 * and personal data on shared devices. A prefix sweep can't drift.
 */
export function purgeAllNoorLocalState(): void {
  for (const store of [localStorage, sessionStorage]) {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && key.startsWith("noor_")) keys.push(key);
    }
    // Collect first, then remove — removing while iterating shifts indices.
    for (const key of keys) store.removeItem(key);
  }
}

// ============================================
// ERROR MESSAGES
// ============================================

export const ERROR_MESSAGES = {
  // Auth
  INVALID_CREDENTIALS: 'Invalid email or password',

  // Network
  SERVER_ERROR: 'Something went wrong. Please try again later.',
};

// ============================================
// USER PROFILE COMPLETION
// ============================================

export interface ProfileCompletion {
  percentage: number;
  missingFields: string[];
  requiredFields: string[];
  optionalFields: string[];
}

export function calculateProfileCompletion(profile: Record<string, unknown> | null): ProfileCompletion {
  const requiredFields = ['firstName', 'lastName', 'email', 'university', 'countryOfOrigin'];
  const optionalFields = ['phone', 'monthlyIncome', 'monthlyExpenses', 'bankingNeeds'];

  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  for (const field of requiredFields) {
    if (!profile || !profile[field]) {
      missingRequired.push(field);
    }
  }

  for (const field of optionalFields) {
    if (!profile || !profile[field]) {
      missingOptional.push(field);
    }
  }

  const totalFields = requiredFields.length + optionalFields.length;
  const completedFields = totalFields - missingRequired.length - missingOptional.length;
  const percentage = Math.round((completedFields / totalFields) * 100);

  return {
    percentage,
    missingFields: [...missingRequired, ...missingOptional],
    requiredFields: missingRequired,
    optionalFields: missingOptional,
  };
}

// ============================================
// TERMS & CONDITIONS
// ============================================

export interface TermsAcceptance {
  accepted: boolean;
  timestamp: string | null;
  version: string;
}

const TERMS_KEY = 'noor_terms_accepted';
const CURRENT_TERMS_VERSION = '1.0.0';

export function hasAcceptedTerms(): boolean {
  const stored = localStorage.getItem(TERMS_KEY);
  if (!stored) return false;
  try {
    const data: TermsAcceptance = JSON.parse(stored);
    return data.accepted && data.version === CURRENT_TERMS_VERSION;
  } catch {
    return false;
  }
}

export function acceptTerms(): void {
  const acceptance: TermsAcceptance = {
    accepted: true,
    timestamp: new Date().toISOString(),
    version: CURRENT_TERMS_VERSION,
  };
  localStorage.setItem(TERMS_KEY, JSON.stringify(acceptance));
}
