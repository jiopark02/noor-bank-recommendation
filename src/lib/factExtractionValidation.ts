/**
 * factExtractionValidation — checks the extraction model's parsed output before
 * the extract-facts cron acts on it. Pure: no I/O; an item that fails a check is
 * dropped and logged, and the rest of the session continues.
 *
 * old_number values are checked against the number of existing facts the
 * caller actually numbered in the prompt, so a fact that was not shown to the
 * model can never be superseded or expired.
 */

import type { UserFactCategory } from "@/lib/aiMemory";
import { isUserFactCategory } from "@/lib/userFactCategories";

// fact 텍스트 최대 길이 (검증). 초과 시 해당 항목 drop.
const MAX_FACT_LENGTH = 500;
// 한 세션에서 supersede + expire 합계 상한. 초과 시 폭주로 간주.
const MAX_SUPERSEDE_EXPIRE = 30;

// --- LLM 출력 타입 (파싱 후 검증 전) ---

interface RawNewFact {
  category?: unknown;
  fact?: unknown;
  confidence?: unknown;
}
interface RawSupersede {
  old_number?: unknown;
  category?: unknown;
  fact?: unknown;
  confidence?: unknown;
}
interface RawExpire {
  old_number?: unknown;
}
interface RawExtractionOutput {
  new_facts?: unknown;
  supersede?: unknown;
  expire?: unknown;
}

// --- 검증 통과 후 타입 ---

interface ValidNewFact {
  category: UserFactCategory;
  fact: string;
  confidence: number;
}
interface ValidSupersede {
  oldNumber: number;
  category: UserFactCategory;
  fact: string;
  confidence: number;
}
interface ValidExpire {
  oldNumber: number;
}
interface ValidatedExtraction {
  newFacts: ValidNewFact[];
  supersede: ValidSupersede[];
  expire: ValidExpire[];
}

/**
 * confidence를 0~1로 정규화. 숫자 아니거나 누락 → 1.0, 범위 밖 → clamp.
 */
function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1.0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Whether the category is one of USER_FACT_CATEGORIES (userFactCategories.ts).
 */
function isValidCategory(value: unknown): value is UserFactCategory {
  return isUserFactCategory(value);
}

/**
 * fact 텍스트가 비어있지 않은 string이고 길이 제한 내인지.
 * 통과 시 trim된 문자열 반환, 실패 시 null.
 */
function validateFactText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_FACT_LENGTH) return null;
  return trimmed;
}

/**
 * old_number가 1 ~ factsCount 범위의 정수인지.
 */
function isValidOldNumber(value: unknown, factsCount: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= factsCount
  );
}

/**
 * 파싱된 LLM 출력을 검증해 ValidatedExtraction을 만든다.
 * 개별 항목이 잘못되면 그 항목만 drop하고 로그. 세션 전체는 계속.
 *
 * @param raw          parseExtractionJson 결과
 * @param factsCount   기존 facts 개수 (old_number 범위 검증용)
 * @param sessionId    로그용
 */
function validateExtraction(
  raw: RawExtractionOutput,
  factsCount: number,
  sessionId: string
): ValidatedExtraction {
  const result: ValidatedExtraction = {
    newFacts: [],
    supersede: [],
    expire: [],
  };

  // 배열이 아니면 빈 배열로 간주.
  const rawNew: unknown[] = Array.isArray(raw.new_facts) ? raw.new_facts : [];
  const rawSup: unknown[] = Array.isArray(raw.supersede) ? raw.supersede : [];
  const rawExp: unknown[] = Array.isArray(raw.expire) ? raw.expire : [];

  // --- new_facts ---
  for (const item of rawNew) {
    const nf = (item ?? {}) as RawNewFact;
    const factText = validateFactText(nf.fact);
    if (factText === null) {
      console.warn(
        `Extract cron: session ${sessionId} dropped new_fact ` +
          `(invalid/empty/too-long text).`
      );
      continue;
    }
    if (!isValidCategory(nf.category)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped new_fact ` +
          `(invalid category: ${String(nf.category)}).`
      );
      continue;
    }
    result.newFacts.push({
      category: nf.category,
      fact: factText,
      confidence: normalizeConfidence(nf.confidence),
    });
  }

  // 중복 old_number 추적 (supersede + expire 공유).
  const usedNumbers = new Set<number>();

  // --- supersede ---
  for (const item of rawSup) {
    const sp = (item ?? {}) as RawSupersede;
    if (!isValidOldNumber(sp.old_number, factsCount)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped supersede ` +
          `(old_number out of range: ${String(sp.old_number)}).`
      );
      continue;
    }
    const oldNumber = sp.old_number as number;
    if (usedNumbers.has(oldNumber)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped supersede ` +
          `(duplicate old_number: ${oldNumber}).`
      );
      continue;
    }
    const factText = validateFactText(sp.fact);
    if (factText === null) {
      console.warn(
        `Extract cron: session ${sessionId} dropped supersede ` +
          `(invalid/empty/too-long text).`
      );
      continue;
    }
    if (!isValidCategory(sp.category)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped supersede ` +
          `(invalid category: ${String(sp.category)}).`
      );
      continue;
    }
    usedNumbers.add(oldNumber);
    result.supersede.push({
      oldNumber,
      category: sp.category,
      fact: factText,
      confidence: normalizeConfidence(sp.confidence),
    });
  }

  // --- expire ---
  for (const item of rawExp) {
    const ep = (item ?? {}) as RawExpire;
    if (!isValidOldNumber(ep.old_number, factsCount)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped expire ` +
          `(old_number out of range: ${String(ep.old_number)}).`
      );
      continue;
    }
    const oldNumber = ep.old_number as number;
    if (usedNumbers.has(oldNumber)) {
      console.warn(
        `Extract cron: session ${sessionId} dropped expire ` +
          `(duplicate old_number: ${oldNumber}).`
      );
      continue;
    }
    usedNumbers.add(oldNumber);
    result.expire.push({ oldNumber });
  }

  // --- 상한 검증: supersede + expire 합계 ---
  if (result.supersede.length + result.expire.length > MAX_SUPERSEDE_EXPIRE) {
    console.warn(
      `Extract cron: session ${sessionId} exceeded supersede+expire cap ` +
        `(${result.supersede.length + result.expire.length} > ` +
        `${MAX_SUPERSEDE_EXPIRE}). Dropping all supersede/expire; ` +
        `keeping new_facts. Manual/follow-up review may be needed.`
    );
    result.supersede = [];
    result.expire = [];
  }

  return result;
}

export { validateExtraction };
export type { RawExtractionOutput, ValidatedExtraction };
