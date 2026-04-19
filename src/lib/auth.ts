// Shared authentication utilities

import bcrypt from "bcrypt";

const BCRYPT_SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
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
  return bcrypt.compare(password, hash);
}
