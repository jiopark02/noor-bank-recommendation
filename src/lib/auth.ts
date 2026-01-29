// Shared authentication utilities

// Simple hash function for password (in production, use bcrypt)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'noor_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// User type for local store
export interface LocalUser {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  profile: Record<string, unknown>;
}

// In-memory user store for development when Supabase is unavailable
// This persists across requests within the same server instance
const globalForAuth = globalThis as unknown as {
  localUserStore: Map<string, LocalUser> | undefined;
};

export const localUserStore = globalForAuth.localUserStore ?? new Map<string, LocalUser>();

if (process.env.NODE_ENV !== 'production') {
  globalForAuth.localUserStore = localUserStore;
}

// Find user by email
export function findUserByEmail(email: string): LocalUser | undefined {
  const normalizedEmail = email.toLowerCase().trim();
  return localUserStore.get(normalizedEmail);
}

// Add user to local store
export function addUser(user: LocalUser): void {
  const normalizedEmail = user.email.toLowerCase().trim();
  localUserStore.set(normalizedEmail, {
    ...user,
    email: normalizedEmail,
  });
}

// Check if email exists
export function emailExists(email: string): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  return localUserStore.has(normalizedEmail);
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}
