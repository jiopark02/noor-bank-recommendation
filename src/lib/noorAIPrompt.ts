// Noor AI System Prompt - English version

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

  return `You are Noor AI, a financial assistant for international students.

## Identity and tone
- Name: Noor
- Tone: warm, practical, and concise
- Style: clear explanations, minimal jargon, friendly but professional

## Current user context
${contextSection}

## Core expertise
1. Banking for international students (including no-SSN options, account setup docs, fees)
2. Credit cards and credit building (starter cards, utilization, payment habits)
3. Visa-related practical guidance (F-1/J-1 basics, OPT/CPT timelines)
4. Student tax fundamentals (high-level only; no professional tax advice)
5. Transfers and exchange basics
6. Housing setup basics for students
7. Scholarships and student support resources

## Response rules
- Be direct and actionable.
- Personalize using user context when available.
- For complex topics, use short bullet points or numbered steps.
- If uncertain, say so and suggest a safe next step.
- Never claim legal/tax certainty; recommend official school/IRS/USCIS resources when needed.
- Keep answers concise unless the user asks for detail.

## Safety rules
- Do not fabricate data, prices, or policy requirements.
- Do not expose or request sensitive credentials.
- Do not provide legal representation or definitive immigration/legal advice.

${userContext.visaExpiry ? `
## Visa expiry signal
User visa expiry: ${userContext.visaExpiry}
${isVisaExpiringSoon(userContext.visaExpiry) ? 'The visa may be expiring soon. Prioritize clear, urgent next steps.' : ''}
` : ''}

You are the Noor app assistant. When relevant, guide users to app sections like Banking, Housing, Visa, Deals, and Chat.`;
}

function buildContextSection(ctx: UserContext): string {
  const lines: string[] = [];

  if (ctx.firstName) {
    lines.push(`- Name: ${ctx.firstName}${ctx.lastName ? ` ${ctx.lastName}` : ''}`);
  }
  if (ctx.university) {
    lines.push(`- University: ${ctx.university}`);
  }
  if (ctx.institutionType) {
    lines.push(
      `- Institution type: ${ctx.institutionType === 'community_college' ? 'Community college' : 'University'}`
    );
  }
  if (ctx.visaType) {
    lines.push(`- Visa: ${ctx.visaType}`);
  }
  if (ctx.hasSSN !== undefined) {
    lines.push(`- SSN: ${ctx.hasSSN ? 'Yes' : 'No'}`);
  }
  if (ctx.hasCreditHistory !== undefined) {
    lines.push(`- US credit history: ${ctx.hasCreditHistory ? 'Yes' : 'No'}`);
  }
  if (ctx.isTransferStudent) {
    lines.push('- Transfer student: Yes');
    if (ctx.targetSchools?.length) {
      lines.push(`- Target schools: ${ctx.targetSchools.join(', ')}`);
    }
  }
  if (ctx.campusSide) {
    lines.push(`- Campus area: ${ctx.campusSide}`);
  }
  if (ctx.monthlyIncome) {
    lines.push(`- Monthly income: $${ctx.monthlyIncome.toLocaleString()}`);
  }
  if (ctx.monthlySpending) {
    lines.push(`- Monthly spending: $${ctx.monthlySpending.toLocaleString()}`);
  }

  return lines.length > 0 ? lines.join('\n') : '- No profile context available';
}

function isVisaExpiringSoon(expiryDate: string): boolean {
  const expiry = new Date(expiryDate);
  const today = new Date();
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return daysUntilExpiry <= 90 && daysUntilExpiry > 0;
}

export const QUICK_PROMPTS = [
  { label: 'Open account without SSN', prompt: 'Can I open a bank account without an SSN?' },
  { label: 'Best first credit card', prompt: 'What is a good first credit card for international students?' },
  { label: 'OPT timeline', prompt: 'When should I apply for OPT?' },
  { label: 'Build credit fast', prompt: 'How can I build US credit safely and quickly?' },
  { label: 'Cheap international transfer', prompt: 'What is the cheapest way to transfer money internationally?' },
  { label: 'Student tax basics', prompt: 'What tax forms do international students usually need?' },
];

export function getContextualPrompts(ctx: UserContext): Array<{ label: string; prompt: string }> {
  const prompts: Array<{ label: string; prompt: string }> = [];

  if (!ctx.hasSSN) {
    prompts.push({
      label: 'No-SSN banking options',
      prompt: 'Show me student-friendly banks where I can open an account without SSN.',
    });
  }

  if (!ctx.hasCreditHistory) {
    prompts.push({
      label: 'Start credit history',
      prompt: 'How do I start building US credit from zero?',
    });
  }

  if (ctx.visaType === 'F-1') {
    prompts.push({
      label: 'Prepare for OPT',
      prompt: 'What should I do now to prepare my OPT application?',
    });
  }

  if (ctx.isTransferStudent) {
    prompts.push({
      label: 'Transfer scholarships',
      prompt: 'What scholarships are good for transfer students?',
    });
  }

  if (ctx.institutionType === 'community_college') {
    prompts.push({
      label: 'Transfer pathway',
      prompt: 'Can you explain transfer pathways from community college to a 4-year university?',
    });
  }

  return prompts.length > 0 ? prompts : QUICK_PROMPTS.slice(0, 4);
}
