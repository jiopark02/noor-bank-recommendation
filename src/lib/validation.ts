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
// PHONE VALIDATION & FORMATTING
// ============================================

export function formatPhoneNumber(value: string): string {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '');

  // Format as (xxx) xxx-xxxx
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export function validatePhone(phone: string): { isValid: boolean; error: string | null } {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) {
    return { isValid: true, error: null }; // Optional field
  }
  if (digits.length !== 10) {
    return { isValid: false, error: 'Phone number must be 10 digits' };
  }
  return { isValid: true, error: null };
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

export function parseCurrency(value: string): number {
  const num = parseFloat(value.replace(/[,$]/g, ''));
  return isNaN(num) ? 0 : num;
}

// ============================================
// FORM VALIDATION
// ============================================

export interface FormField {
  value: string | number | boolean | null;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  customValidator?: (value: unknown) => string | null;
}

export interface FormValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export function validateForm(fields: Record<string, FormField>): FormValidationResult {
  const errors: Record<string, string> = {};

  for (const [fieldName, field] of Object.entries(fields)) {
    const { value, required, minLength, maxLength, pattern, customValidator } = field;

    // Required check
    if (required && (value === null || value === undefined || value === '')) {
      errors[fieldName] = 'This field is required';
      continue;
    }

    // Skip other validations if value is empty and not required
    if (value === null || value === undefined || value === '') continue;

    const strValue = String(value);

    // Min length check
    if (minLength !== undefined && strValue.length < minLength) {
      errors[fieldName] = `Must be at least ${minLength} characters`;
      continue;
    }

    // Max length check
    if (maxLength !== undefined && strValue.length > maxLength) {
      errors[fieldName] = `Must be at most ${maxLength} characters`;
      continue;
    }

    // Pattern check
    if (pattern && !pattern.test(strValue)) {
      errors[fieldName] = 'Invalid format';
      continue;
    }

    // Custom validator
    if (customValidator) {
      const customError = customValidator(value);
      if (customError) {
        errors[fieldName] = customError;
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

// ============================================
// NAME VALIDATION
// ============================================

export function validateName(name: string): { isValid: boolean; error: string | null } {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { isValid: false, error: 'Name is required' };
  }
  if (trimmed.length < 2) {
    return { isValid: false, error: 'Name must be at least 2 characters' };
  }
  if (!/^[a-zA-Z\s'-]+$/.test(trimmed)) {
    return { isValid: false, error: 'Name can only contain letters, spaces, hyphens, and apostrophes' };
  }
  return { isValid: true, error: null };
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
const ACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
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

export function isSessionValid(): boolean {
  const session = getSession();
  if (!session) return false;

  const now = Date.now();

  // For "stay signed in" sessions, check expiration
  if (session.staySignedIn && session.expiresAt > 0 && now > session.expiresAt) {
    clearSession();
    return false;
  }

  // For non-persistent sessions (expiresAt = 0), they auto-clear on browser close
  // Just check inactivity timeout
  if (!session.staySignedIn) {
    const inactiveTime = now - session.lastActivity;
    if (inactiveTime > ACTIVITY_TIMEOUT) {
      return false; // Session timed out but don't clear yet (for "still there?" prompt)
    }
  }

  return true;
}

export function isInactivityWarning(): boolean {
  const session = getSession();
  if (!session || session.staySignedIn) return false;

  const inactiveTime = Date.now() - session.lastActivity;
  return inactiveTime > ACTIVITY_TIMEOUT && inactiveTime < ACTIVITY_TIMEOUT * 2;
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

// ============================================
// ERROR MESSAGES
// ============================================

export const ERROR_MESSAGES = {
  // Auth
  INVALID_CREDENTIALS: 'Invalid email or password',
  EMAIL_EXISTS: 'An account with this email already exists',
  EMAIL_NOT_FOUND: 'No account found with this email',
  PASSWORD_MISMATCH: "Passwords don't match",
  WEAK_PASSWORD: 'Password does not meet requirements',

  // Network
  NETWORK_ERROR: 'Unable to connect. Please check your internet connection.',
  SERVER_ERROR: 'Something went wrong. Please try again later.',
  TIMEOUT_ERROR: 'Request timed out. Please try again.',

  // Form
  REQUIRED_FIELD: 'This field is required',
  INVALID_EMAIL: 'Please enter a valid email address',
  INVALID_PHONE: 'Please enter a valid phone number',

  // Session
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  SESSION_TIMEOUT: 'You have been inactive. Please sign in again.',
};

// ============================================
// API HELPERS
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit = {},
  timeout: number = 10000
): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(id);

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || data.message || ERROR_MESSAGES.SERVER_ERROR,
      };
    }

    return {
      success: true,
      data,
    };
  } catch (error) {
    clearTimeout(id);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { success: false, error: ERROR_MESSAGES.TIMEOUT_ERROR };
      }
      if (error.message.includes('fetch')) {
        return { success: false, error: ERROR_MESSAGES.NETWORK_ERROR };
      }
    }

    return { success: false, error: ERROR_MESSAGES.SERVER_ERROR };
  }
}

// ============================================
// NOTIFICATION PREFERENCES
// ============================================

export interface NotificationPreferences {
  emailNotifications: boolean;
  pushNotifications: boolean;
  visaReminders: boolean;
  budgetAlerts: boolean;
  newDeals: boolean;
  forumReplies: boolean;
  weeklySummary: boolean;
}

const NOTIFICATION_KEY = 'noor_notification_prefs';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  emailNotifications: true,
  pushNotifications: true,
  visaReminders: true,
  budgetAlerts: true,
  newDeals: true,
  forumReplies: true,
  weeklySummary: true,
};

export function getNotificationPreferences(): NotificationPreferences {
  const stored = localStorage.getItem(NOTIFICATION_KEY);
  if (!stored) return DEFAULT_NOTIFICATION_PREFS;
  try {
    return { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function saveNotificationPreferences(prefs: Partial<NotificationPreferences>): void {
  const current = getNotificationPreferences();
  const updated = { ...current, ...prefs };
  localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(updated));
}

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
// DATA EXPORT (GDPR)
// ============================================

export function exportUserData(): string {
  const data: Record<string, unknown> = {};

  // Collect all user data from localStorage
  const keys = [
    'noor_user_id',
    'noor_user_profile',
    'noor_chat_history',
    'noor_savings_goals',
    'noor_finance_progress',
    'noor_notification_prefs',
    'noor_session',
  ];

  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value) {
      try {
        data[key] = JSON.parse(value);
      } catch {
        data[key] = value;
      }
    }
  }

  return JSON.stringify(data, null, 2);
}

export function downloadUserData(): void {
  const data = exportUserData();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `noor-data-export-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
