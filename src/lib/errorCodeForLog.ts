import { logSafeCode } from "@/lib/householdInvite";

/**
 * The code of a thrown error, or of the database error it wraps as its cause,
 * for a log line: through logSafeCode, so only a short word of letters,
 * digits and underscores, else "none" or "invalid". The error itself is never
 * logged: a database error's message and details can carry the row it
 * refused, and a chat row's content can carry bank figures.
 */
export function errorCodeForLog(error: unknown): string {
  try {
    const own = (error as { code?: unknown } | null | undefined)?.code;
    if (typeof own === "string" && own !== "") return logSafeCode(own);
    const cause = (error as { cause?: unknown } | null | undefined)?.cause;
    return logSafeCode((cause as { code?: unknown } | null | undefined)?.code);
  } catch {
    return "none";
  }
}
