/**
 * Strict JSON helpers for API routes and clients (unknown bodies, not implicit any).
 */

export async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function asPlainObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function readString(
  obj: Record<string, unknown>,
  key: string
): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

export function readNonEmptyString(
  obj: Record<string, unknown>,
  key: string
): string | undefined {
  const s = readString(obj, key);
  return s && s.trim() !== "" ? s : undefined;
}

export function readRecord(
  obj: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  return asPlainObject(v);
}

export function readStringProp(obj: unknown, key: string): string | undefined {
  return readString(asPlainObject(obj), key);
}

export function readFiniteNumber(
  obj: Record<string, unknown>,
  key: string
): number | undefined {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function readErrorMessage(data: unknown): string | undefined {
  return readString(asPlainObject(data), "error");
}
