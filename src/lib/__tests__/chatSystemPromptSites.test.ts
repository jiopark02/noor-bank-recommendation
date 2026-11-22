import { describe, it } from "vitest";
import { codeBySourceFile, expectAllowlistHolds, word, type ProbeTarget } from "./sourceProbe";

/**
 * Which application files build a system message for a model, or call the
 * builders of the chat system prompt's parts.
 *
 * The system message decides what the model is told and which of the user's
 * data rides along with it: the profile (generateSystemPrompt), stored memory
 * (formatMemoryForPrompt) and bank state (buildPlaidCapabilityBlock). Each
 * target has its own allowlist of files, so a new file reaching one of them
 * fails here and has to be added with a reason, which makes the addition
 * visible in review. An allowlisted file that stops reaching its target fails
 * too, so the list cannot go stale. A reason starting with "definition:"
 * marks the file that defines the builder.
 *
 * chatPromptAssembly.test.ts executes the chat route and checks what its
 * system message says, and plaidEgressWiring.test.ts checks where the chat
 * route reads bank data; neither tracks which files build one.
 *
 * Code is read with comments removed. A system message is an object literal
 * whose role key is the string "system"; a type naming "system" in a union
 * does not count. It executes nothing. Limit: a role or a builder passed
 * through a variable, or a prompt sent without a role key, is not seen.
 * Limit: a "system" after the role key followed by | is taken for a type
 * union and excluded, so an expression continuing with || is excluded too.
 */

const TARGETS: ProbeTarget[] = [
  {
    name: 'role "system" messages',
    pattern: /["']?\brole["']?\s*:\s*["']system["'](?!\s*\|)/,
    allowed: {
      // The assembled chat system prompt, first in the OpenRouter messages.
      "app/api/chat/route.ts": "sends the chat system prompt to the chat model",
      // The fact-extraction prompt for the extraction model.
      "app/api/cron/extract-facts/route.ts": "sends the extraction prompt to the cron model",
      // The summary prompt for the summary model.
      "app/api/cron/summarize/route.ts": "sends the summary prompt to the cron model",
    },
  },
  {
    name: "generateSystemPrompt",
    pattern: word("generateSystemPrompt"),
    allowed: {
      // Builds the base prompt from the server-loaded user context.
      "lib/noorAIPrompt.ts": "definition: the base system prompt builder",
      // Builds the base of the chat system prompt from the merged context.
      "app/api/chat/route.ts": "builds the chat system prompt",
    },
  },
  {
    name: "formatMemoryForPrompt",
    pattern: word("formatMemoryForPrompt"),
    allowed: {
      // Wraps facts and summaries in <user_memory>.
      "lib/aiMemory.ts": "definition: the memory block builder",
      // Appends the memory block when memory is enabled.
      "app/api/chat/route.ts": "appends stored memory to the chat system prompt",
    },
  },
  {
    name: "buildPlaidCapabilityBlock",
    pattern: word("buildPlaidCapabilityBlock"),
    allowed: {
      // Builds the sealed "What you can see this turn" block from bank state.
      "lib/plaidChatContext.ts": "definition: the bank-state block builder",
      // Appends the bank-state block inside the capability-scaffold branch.
      "app/api/chat/route.ts": "appends bank state to the chat system prompt",
    },
  },
];

describe("chat system prompt sites", () => {
  for (const target of TARGETS) {
    it(`only allowlisted files reach ${target.name}`, () => {
      expectAllowlistHolds(codeBySourceFile(), target);
    });
  }
});
