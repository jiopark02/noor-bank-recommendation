import { describe, it, expect } from "vitest";
import {
  detectCrisisSignal,
  hasPriorCrisisSignal,
  normalizeCrisisText,
  type CrisisCategory,
} from "@/lib/crisisSignals";
import { CRISIS_NOTICES } from "@/lib/crisisNotice";

const FIRST_PERSON: Array<[string, CrisisCategory]> = [
  ["I want to kill myself", "self_harm"],
  ["i keep thinking about killing myself", "self_harm"],
  ["I've been feeling suicidal lately", "self_harm"],
  ["I think about suicide every day", "self_harm"],
  ["I want to end my life", "self_harm"],
  ["sometimes I just want to end it all", "self_harm"],
  ["I might take my own life", "self_harm"],
  ["hi i want to die", "self_harm"],
  ["I wanted to die after I saw my credit card bill", "self_harm"],
  ["I wish I was dead", "self_harm"],
  ["honestly I'd be better off dead", "self_harm"],
  ["there's no reason to live anymore", "self_harm"],
  ["I have no reason to go on", "self_harm"],
  ["I don't want to live anymore", "self_harm"],
  ["I don’t want to live", "self_harm"],
  ["I dont want to be alive", "self_harm"],
  ["I don't want to be here anymore", "self_harm"],
  ["I don't want to live like this", "self_harm"],
  ["I don't want to live this way anymore", "self_harm"],
  ["I want to hurt myself", "self_harm"],
  ["I've been hurting myself again", "self_harm"],
  ["I cut myself last night", "self_harm"],
  ["I've been cutting myself", "self_harm"],
  ["I started self-harming", "self_harm"],
  ["I thought about an overdose", "self_harm"],
  ["my life is not worth living", "self_harm"],
  ["SUICIDE", "self_harm"],
  ["I want to hurt someone", "harm_to_others"],
  ["I'm going to kill my landlord", "harm_to_others"],
  ["I'll hurt him if he touches my money again", "harm_to_others"],
  ["I'm thinking about hurting my roommate", "harm_to_others"],
  ["I'm gonna beat up my ex", "harm_to_others"],
  ["I think I have an eating disorder", "eating"],
  ["I might be anorexic", "eating"],
  ["I struggled with bulimia in college", "eating"],
  ["I've been starving myself to save money on food", "eating"],
  ["I make myself throw up after meals", "eating"],
  ["I made myself sick after dinner", "eating"],
  ["I purge after I eat", "eating"],
  ["I binge eat when I'm stressed about bills", "eating"],
];

const THIRD_PERSON: Array<[string, CrisisCategory]> = [
  ["User said they want to hurt themselves", "self_harm"],
  ["User is thinking about killing himself", "self_harm"],
  ["User mentioned she wants to kill herself", "self_harm"],
  ["The user wants to end their life", "self_harm"],
  ["User said he wishes he was dead", "self_harm"],
  ["User has been cutting themself", "self_harm"],
  ["User talked about suicide", "self_harm"],
  ["User wants to harm herself", "self_harm"],
  ["User is starving herself", "eating"],
  ["User makes himself vomit", "eating"],
  ["User said they are going to hurt someone", "harm_to_others"],
];

const NEGATIVE: string[] = [
  "I want to kill my budget overspending",
  "this rent is killing me",
  "is a car loan financial suicide?",
  "co-signing would be credit suicide",
  "quitting now would be career suicide",
  "I'm dying to save more this year",
  "how can I kill two birds with one stone on my loans",
  "I stopped eating out to save money",
  "I'm starving, what's a cheap lunch?",
  "I don't want to live paycheck to paycheck",
  "I want to live with my parents to save on rent",
  "I don't want to live with roommates",
  "that late payment hurt my credit",
  "I need to cut my expenses",
  "should I purge my old subscriptions?",
  "I want to purge the old accounts I never use",
  "how do I end my lease early",
  "I'll take my own lunch to work",
  "my phone battery is dead",
  "I'm dead broke until Friday",
  "I'll shoot you a question about taxes later",
  "I binge-watched a show instead of budgeting",
  "my side hustle is killing it",
  "I'm going to beat my savings goal",
  "the fees are going to hurt",
  "I'm going to kill it at my new job",
  "I want to hurt less when tax season comes",
  "rent hikes are murder",
  "can I cancel my gym membership",
  "what's the best way to pay off my credit card",
  "how much should I save for an emergency fund",
  "is it worth refinancing my student loans",
  "hello",
  "",
];

describe("detectCrisisSignal", () => {
  it.each(FIRST_PERSON)("first person: %s", (text, category) => {
    expect(detectCrisisSignal(text)).toBe(category);
  });

  it.each(THIRD_PERSON)("third person: %s", (text, category) => {
    expect(detectCrisisSignal(text)).toBe(category);
  });

  it.each(NEGATIVE)("financial idiom, no signal: %s", (text) => {
    expect(detectCrisisSignal(text)).toBeNull();
  });

  it("the corpora are at least the planned size", () => {
    expect(FIRST_PERSON.length).toBeGreaterThanOrEqual(30);
    expect(THIRD_PERSON.length).toBeGreaterThanOrEqual(10);
    expect(NEGATIVE.length).toBeGreaterThanOrEqual(30);
  });

  it("does not suppress negation", () => {
    expect(detectCrisisSignal("I'm not suicidal")).toBe("self_harm");
  });

  it("self_harm outranks harm_to_others, which outranks eating", () => {
    expect(
      detectCrisisSignal("I want to hurt someone and then kill myself")
    ).toBe("self_harm");
    expect(
      detectCrisisSignal("I've been purging and I want to hurt someone")
    ).toBe("harm_to_others");
  });

  it("an exception phrase does not hide a real signal in the same message", () => {
    expect(
      detectCrisisSignal("this car loan is financial suicide and I want to die")
    ).toBe("self_harm");
  });

  it("finishes on a 1 MB input in linear time", () => {
    const big = "kill my budget ".repeat(70000) + "x";
    expect(big.length).toBeGreaterThan(1_000_000);
    const started = Date.now();
    expect(detectCrisisSignal(big)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("normalizeCrisisText", () => {
  it("lower-cases, maps curly apostrophes, replaces punctuation and collapses spaces", () => {
    expect(normalizeCrisisText("  I DON’T,\n\twant!!  ")).toBe("i don't want");
  });

  it("removes the exception phrases", () => {
    expect(normalizeCrisisText("Financial suicide, really?")).toBe("really");
  });
});

describe("hasPriorCrisisSignal", () => {
  it("true when a user row carries a signal", () => {
    expect(
      hasPriorCrisisSignal([
        { role: "user", content: "how do I budget?" },
        { role: "assistant", content: "Here is how." },
        { role: "user", content: "I want to die" },
      ])
    ).toBe(true);
  });

  it("ignores assistant rows, including Noor's own notices", () => {
    const notices = Object.values(CRISIS_NOTICES).flatMap((n) => [
      n.standard,
      n.escalated,
    ]);
    expect(
      hasPriorCrisisSignal([
        { role: "user", content: "how do I budget?" },
        ...notices.map((content) => ({ role: "assistant", content })),
      ])
    ).toBe(false);
  });

  it("false on no rows and on null content", () => {
    expect(hasPriorCrisisSignal([])).toBe(false);
    expect(hasPriorCrisisSignal([{ role: "user", content: null }])).toBe(false);
  });
});
