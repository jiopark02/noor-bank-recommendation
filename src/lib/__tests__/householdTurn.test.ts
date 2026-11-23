import { describe, it, expect, afterEach } from "vitest";
import { isHouseholdTurn, resolveSharedStateEnabled } from "../plaidChatContext";

/**
 * Which messages count as about the household, so another member's shared
 * bank data may enter the turn (isHouseholdTurn), and the switch that allows
 * any of it (resolveSharedStateEnabled).
 *
 * Mutations and the test each one turns red:
 *   the word match made a substring match                         -> T3
 *   "we", "us" or "we're" put back among the household words      -> T4
 *   "our" or "ours" put back among the household words            -> N17
 *   the accented "fiancé" / "fiancée" no longer folded            -> N17
 *   the name compared without sanitizeNameField                   -> T5
 *   a name matched inside a longer word                           -> T5
 *   a name matched in lower case                                  -> T5, N17
 *   a name in a script without case required to be a capital      -> N17
 *   the switch read after trimming or case folding                -> switch
 */

describe("isHouseholdTurn — household words (T3)", () => {
  it.each([
    "Can my partner and I afford a house?",
    "What does my WIFE have in savings?",
    "how much is in our joint account",
    "my husband's credit card",
    "the household budget",
    "honey wants a new car",
    "should I tell my love about this",
    "my fiancee and I are saving",
  ])("is a household turn: %s", (message) => {
    expect(isHouseholdTurn(message, [])).toBe(true);
  });

  it.each([
    "how many hours do I work",
    "I have four credit cards",
    "jointly is not a word I use",
    "my partnership agreement",
    "honeymoon budget",
    "what is a babel fish",
    "",
  ])("is not a household turn: %s", (message) => {
    expect(isHouseholdTurn(message, [])).toBe(false);
  });
});

describe("isHouseholdTurn — we, us and we're alone are not enough (T4)", () => {
  it.each([
    "we need to save more",
    "can we afford it",
    "tell us what to do",
    "we're behind on rent",
    "Is the US dollar going up?",
    "We bought a car",
  ])("is not a household turn: %s", (message) => {
    expect(isHouseholdTurn(message, [])).toBe(false);
  });
});

describe("isHouseholdTurn — the sharing member's first name (T5)", () => {
  it.each([
    ["How much does Alex have?", "Alex"],
    ["How much does Alex have?", "alex"],
    ["What about Zoë's savings?", "Zoë"],
    ["Is Jordan okay with this", "  Jordan  "],
    ["Ask Mary Ann first", "Mary Ann"],
    // The name is cleaned before it is compared: a newline in the stored
    // name becomes a space.
    ["Ask Mary Ann first", "Mary\nAnn"],
  ])("names the member: %s (%j)", (message, name) => {
    expect(isHouseholdTurn(message, [name])).toBe(true);
  });

  it.each([
    ["Alexander has a job", "Alex"],
    ["the zoë-like name", "Zo"],
    ["nothing here", null],
    ["A is for apple", "A"],
    ["Ask Mary first", "Mary\nAnn"],
    ["how much does alex have", "Alex"],
  ])("does not name the member: %s (%j)", (message, name) => {
    expect(isHouseholdTurn(message, [name])).toBe(false);
  });

  it("a name counts only where the message writes it with a capital letter", () => {
    expect(isHouseholdTurn("Did Bill pay the rent?", ["Bill"])).toBe(true);
    expect(isHouseholdTurn("did my bill go up?", ["Bill"])).toBe(false);
    expect(isHouseholdTurn("I will save more", ["Will"])).toBe(false);
    expect(isHouseholdTurn("Can Penny cover it?", ["penny"])).toBe(true);
    expect(isHouseholdTurn("save every penny", ["Penny"])).toBe(false);
  });

  it("any one of several members' names is enough", () => {
    expect(isHouseholdTurn("What does Sam think?", [null, "Alex", "Sam"])).toBe(true);
  });
});

describe("isHouseholdTurn — our, fiancé and the capital rule (N17)", () => {
  it.each([
    "What are our options for an index fund?",
    "Is that money ours?",
    "OUR rent went up",
  ])("our and ours alone are not enough: %s", (message) => {
    expect(isHouseholdTurn(message, [])).toBe(false);
  });

  it.each([
    "my fiancé and I are saving",
    "my fiancée wants a budget",
    "My FIANCÉ has a loan",
    // e followed by the combining acute accent
    "my fiancé and I",
    "my fiancée and I",
  ])("the accented spellings of fiancé are household words: %s", (message) => {
    expect(isHouseholdTurn(message, [])).toBe(true);
  });

  it.each([
    ["can frank help?", "Frank"],
    ["I hope so", "Hope"],
    ["what art should I buy", "Art"],
  ])("a name that is also a word does not count in lower case: %s", (message, name) => {
    expect(isHouseholdTurn(message, [name])).toBe(false);
  });

  it.each([
    ["Can Frank help?", "Frank"],
    ["Does Hope agree?", "hope"],
  ])("the same name written as a name counts: %s", (message, name) => {
    expect(isHouseholdTurn(message, [name])).toBe(true);
  });

  it("a name in a script without case matches as written", () => {
    expect(isHouseholdTurn("지민 잔고 알려줘", ["지민"])).toBe(true);
  });
});

describe("resolveSharedStateEnabled", () => {
  const saved = process.env.AI_HOUSEHOLD_SHARED_STATE;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_HOUSEHOLD_SHARED_STATE;
    else process.env.AI_HOUSEHOLD_SHARED_STATE = saved;
  });

  it("is on only for exactly \"on\"", () => {
    process.env.AI_HOUSEHOLD_SHARED_STATE = "on";
    expect(resolveSharedStateEnabled()).toBe(true);
  });

  it.each([undefined, "", "ON", " on", "on ", "true", "1", "yes", "off"])(
    "is off for %j",
    (value) => {
      if (value === undefined) delete process.env.AI_HOUSEHOLD_SHARED_STATE;
      else process.env.AI_HOUSEHOLD_SHARED_STATE = value;
      expect(resolveSharedStateEnabled()).toBe(false);
    }
  );
});
