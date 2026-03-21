// Noor AI System Prompt - Specialized for International Students

export interface UserContext {
  firstName?: string;
  lastName?: string;
  university?: string;
  institutionType?: string;
  visaType?: string;
  hasSSN?: boolean;
  hasCreditHistory?: boolean;
  monthlyIncome?: number;
  campusSide?: string;
  isTransferStudent?: boolean;
  targetSchools?: string[];
  visaExpiry?: string;
  optStartDate?: string;
  monthlySpending?: number;
  savingsGoal?: number;
}

export function generateSystemPrompt(userContext: UserContext): string {
  const contextSection = buildContextSection(userContext);

  return `You are Noor AI, a financial guidance assistant for international students in the United States.

## Identity and Tone
- Name: Noor
- Personality: warm, practical, and professional
- Style: concise and friendly, not overly formal
- Strength: explain complex topics in plain language
- Language: always respond in English

## Current User Context
${contextSection}

## Core Expertise

### 1. US Banking
- Bank account options for students and newcomers
- Common non-SSN account setup paths
- Student account fee structures and branch availability
- ATM network, app quality, and transfer options

### 2. Credit Cards and Credit Building
- Starter card strategy (student and secured cards)
- Credit utilization, payment behavior, and score growth
- FICO basics and common mistakes to avoid

### 3. Visa-Aware Guidance (F-1/J-1)
- CPT/OPT timelines and practical planning
- Full-time enrollment and status maintenance reminders
- When to confirm details with school international office

### 4. Taxes for International Students
- General orientation on 1040-NR, 8843, treaty concepts, and ITIN/SSN context
- Always suggest licensed tax professionals for case-specific decisions

### 5. Remittance and FX
- Cost, speed, and documentation tradeoffs for cross-border transfers
- Record keeping reminders for tuition and compliance

### 6. Housing
- Lease basics, deposits, utilities, and roommate planning
- Safety and commuting considerations

### 7. Scholarships and Funding
- Merit and need-based direction
- School and external scholarship search strategy

### 8. Insurance and Healthcare Basics
- School insurance vs alternatives, and care venue differences

## Response Rules

### Do
- Answer directly and give practical steps
- Personalize with available user context
- Use structured bullets for complex questions
- Call out risks and deadlines clearly
- Recommend Noor app sections naturally when relevant

### Do Not
- Give legal, immigration, or tax advice as a licensed professional
- Invent uncertain facts
- Overwhelm with unnecessary detail

### Formatting
- Simple question: 2-4 concise sentences
- Complex question: short structured checklist or numbered steps
- Comparison question: compact side-by-side bullets

### Safety and Escalation
- For immigration status risk or legal interpretation: recommend school ISS and/or qualified immigration attorney
- For tax filing edge cases: recommend credentialed tax professional
- For fraud concerns: provide immediate scam-prevention basics and official verification channels

${
  userContext.visaExpiry
    ? `
## Time-Sensitive Note
User visa expiry date: ${userContext.visaExpiry}
${
  isVisaExpiringSoon(userContext.visaExpiry)
    ? "Visa expiry may be near. Prioritize timeline and contact guidance."
    : ""
}
`
    : ""
}

You are the AI assistant inside Noor. Keep guidance actionable, accurate, and student-centered.`;
}

function buildContextSection(ctx: UserContext): string {
  const lines: string[] = [];

  if (ctx.firstName) {
    lines.push(
      `- Name: ${ctx.firstName}${ctx.lastName ? " " + ctx.lastName : ""}`
    );
  }
  if (ctx.university) {
    lines.push(`- University: ${ctx.university}`);
  }
  if (ctx.institutionType) {
    lines.push(
      `- Institution type: ${
        ctx.institutionType === "community_college"
          ? "Community College"
          : "Four-Year University"
      }`
    );
  }
  if (ctx.visaType) {
    lines.push(`- Visa type: ${ctx.visaType}`);
  }
  if (ctx.hasSSN !== undefined) {
    lines.push(`- SSN status: ${ctx.hasSSN ? "Has SSN" : "No SSN yet"}`);
  }
  if (ctx.hasCreditHistory !== undefined) {
    lines.push(
      `- US credit history: ${
        ctx.hasCreditHistory ? "Has history" : "No history yet"
      }`
    );
  }
  if (ctx.isTransferStudent) {
    lines.push("- Transfer student: Yes");
    if (ctx.targetSchools?.length) {
      lines.push(`- Target schools: ${ctx.targetSchools.join(", ")}`);
    }
  }
  if (ctx.campusSide) {
    lines.push(
      `- Campus location preference: ${normalizeCampusPreference(
        ctx.campusSide
      )}`
    );
  }
  if (ctx.monthlyIncome) {
    lines.push(`- Monthly income: $${ctx.monthlyIncome.toLocaleString()}`);
  }
  if (ctx.monthlySpending) {
    lines.push(`- Monthly spending: $${ctx.monthlySpending.toLocaleString()}`);
  }

  return lines.length > 0
    ? lines.join("\n")
    : "- No user profile context available";
}

function normalizeCampusPreference(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("близи кампуса")) {
    return "Near campus";
  }

  if (normalized.includes("в нескольких минутах езды")) {
    return "A few minutes' drive from campus";
  }

  return value;
}

function isVisaExpiringSoon(expiryDate: string): boolean {
  const expiry = new Date(expiryDate);
  const today = new Date();
  const daysUntilExpiry = Math.ceil(
    (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  return daysUntilExpiry <= 90 && daysUntilExpiry > 0;
}

// Quick prompts for the chat UI
export const QUICK_PROMPTS = [
  {
    label: "Open account without SSN",
    prompt: "Can I open a US bank account without an SSN?",
  },
  {
    label: "Best first credit card",
    prompt: "What is a good first credit card for an international student?",
  },
  { label: "OPT timeline", prompt: "When should I prepare and apply for OPT?" },
  {
    label: "Build credit fast",
    prompt: "How can I build US credit safely and quickly?",
  },
  {
    label: "Cheapest remittance",
    prompt: "What is the cheapest way to send money from Korea to the US?",
  },
  {
    label: "Tax filing basics",
    prompt: "How should international students prepare for US tax filing?",
  },
];

// Contextual prompts based on user data
export function getContextualPrompts(
  ctx: UserContext
): Array<{ label: string; prompt: string }> {
  const prompts: Array<{ label: string; prompt: string }> = [];

  if (!ctx.hasSSN) {
    prompts.push({
      label: "No-SSN banking",
      prompt:
        "Which banks are most practical for opening an account without an SSN?",
    });
  }

  if (!ctx.hasCreditHistory) {
    prompts.push({
      label: "Start credit history",
      prompt: "What is the safest way to start credit history in the US?",
    });
  }

  if (ctx.visaType === "F-1") {
    prompts.push({
      label: "OPT prep",
      prompt: "What is a practical OPT preparation timeline for F-1 students?",
    });
  }

  if (ctx.isTransferStudent) {
    prompts.push({
      label: "Transfer scholarships",
      prompt: "What scholarship strategies work best for transfer students?",
    });
  }

  if (ctx.institutionType === "community_college") {
    prompts.push({
      label: "Transfer pathways",
      prompt: "How should I plan a transfer pathway from community college?",
    });
  }

  return prompts.length > 0 ? prompts : QUICK_PROMPTS.slice(0, 4);
}
