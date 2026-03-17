import { NextRequest, NextResponse } from 'next/server';
import { generateSystemPrompt, UserContext } from '@/lib/noorAIPrompt';
import { orchestrate, ChatMessageInput, SafeUserContext } from '@/lib/aiOrchestrator';

export const dynamic = 'force-dynamic';

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

function getOpenRouterApiKey(): string | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === '') return null;
  return apiKey;
}

const DEMO_RESPONSES: Record<string, string> = {
  '안녕': "Hi! I'm Noor AI 🙌 Ask me anything about banking, credit, visa basics, housing, and student finance in the US.",
  'hello': "Hi! I'm Noor AI 🙌 I can help with banking, visa questions, housing, and money tips for international students.",
  'hi': "Hi! I'm Noor AI 🙌 How can I help today?",
  'ssn 없이 계좌': `Yes, you can often open a bank account without an SSN. 🏦

**Common student-friendly options:**
1. **Chase** - Often possible in branch with passport + I-20
2. **Bank of America** - Common choice near many campuses
3. **Wells Fargo** - Frequently used by international students

**Typical documents:**
- Passport
- I-20 or DS-2019
- School enrollment/admission proof
- US address proof

Check the Banking section for personalized options.`,
  'bank': `Here are the best banks for international students! 🏦

**Top Recommendations:**
1. **Chase Bank** - Can open with passport + I-20
2. **Bank of America** - International student friendly
3. **Wells Fargo** - No SSN required in-branch

Check out our Banking section for personalized recommendations!`,
  '크레딧 카드': `You can start building credit even without long credit history. 💳

**Good starter paths:**
- Secured cards (deposit-backed): Discover it Secured, Capital One Secured
- Student cards: Discover it Student, Journey Student

**Tips:**
- Keep utilization low (under 30%)
- Pay on time, every month
- Start with one card only

See the Funding section for detailed comparisons.`,
  '비자': `Here are key F-1 basics. 📋

**Important reminders:**
- Maintain full-time enrollment
- Off-campus work generally needs CPT/OPT authorization
- Keep travel signatures and school records up to date

**Work pathways:**
- CPT during program (if eligible)
- OPT after graduation (STEM extension may apply)

Use the Visa section to track your checklist.`,
  '집': `Here are practical housing tips for international students. 🏠

**Typical order:**
1. Campus housing for first term
2. Nearby apartments after settling in
3. Roommates to reduce costs

**Checklist:**
- Rent + deposit
- Utilities included or not
- Commute and safety

Use the Housing section for listings near campus.`,
  'default': `Hi, I'm Noor AI 🙌

I can help with:
- 🏦 Opening bank accounts
- 💳 Building credit
- 📋 Visa-related basics
- 🏠 Housing setup
- 💰 Student financial planning

Ask me anything.

---
*Running in demo mode. For full answers, configure your API key.*`,
};

function getDemoResponse(message: string): string {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('안녕') || lowerMessage === 'hi' || lowerMessage === 'hello') {
    return DEMO_RESPONSES['안녕'];
  }
  if (
    lowerMessage.includes('ssn') &&
    (lowerMessage.includes('계좌') || lowerMessage.includes('bank') || lowerMessage.includes('없이'))
  ) {
    return DEMO_RESPONSES['ssn 없이 계좌'];
  }
  if (lowerMessage.includes('bank') || lowerMessage.includes('은행') || lowerMessage.includes('계좌')) {
    return DEMO_RESPONSES['bank'];
  }
  if (
    lowerMessage.includes('credit') ||
    lowerMessage.includes('크레딧') ||
    lowerMessage.includes('카드') ||
    lowerMessage.includes('신용')
  ) {
    return DEMO_RESPONSES['크레딧 카드'];
  }
  if (
    lowerMessage.includes('visa') ||
    lowerMessage.includes('비자') ||
    lowerMessage.includes('f-1') ||
    lowerMessage.includes('opt') ||
    lowerMessage.includes('cpt')
  ) {
    return DEMO_RESPONSES['비자'];
  }
  if (
    lowerMessage.includes('house') ||
    lowerMessage.includes('housing') ||
    lowerMessage.includes('집') ||
    lowerMessage.includes('아파트') ||
    lowerMessage.includes('rent') ||
    lowerMessage.includes('렌트')
  ) {
    return DEMO_RESPONSES['집'];
  }
  return DEMO_RESPONSES['default'];
}

function mapSafeContextToPromptContext(safeContext: SafeUserContext): UserContext {
  return {
    university: typeof safeContext.university === 'string' ? safeContext.university : undefined,
    institutionType:
      typeof safeContext.institutionType === 'string' ? safeContext.institutionType : undefined,
    visaType: typeof safeContext.visaType === 'string' ? safeContext.visaType : undefined,
    hasSSN: typeof safeContext.hasSSN === 'boolean' ? safeContext.hasSSN : undefined,
    campusSide: typeof safeContext.campusSide === 'string' ? safeContext.campusSide : undefined,
  };
}

function buildSafeContextSection(safeContext: SafeUserContext): string {
  const entries = Object.entries(safeContext).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) {
    return 'No safe financial context available.';
  }

  return entries
    .map(([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
}

async function callOpenRouter(
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessageInput[]
): Promise<{ message: string; usage?: { input_tokens?: number; output_tokens?: number } }> {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  const data = (await response.json()) as OpenRouterResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenRouter request failed (${response.status})`);
  }

  const message = data.choices?.[0]?.message?.content || '';
  return {
    message,
    usage: {
      input_tokens: data.usage?.prompt_tokens,
      output_tokens: data.usage?.completion_tokens,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const { messages, userId } = await request.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Messages are required' }, { status: 400 });
    }

    const formattedMessages: ChatMessageInput[] = messages.map((msg: ChatMessageInput) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: String(msg.content || ''),
    }));

    const orchestratorResult = await orchestrate(userId || null, formattedMessages);
    const promptContext = mapSafeContextToPromptContext(orchestratorResult.safeContext);
    let systemPrompt = generateSystemPrompt(promptContext);
    systemPrompt = `${systemPrompt}\n\n## Orchestrator Safe Context\n${buildSafeContextSection(orchestratorResult.safeContext)}`;
    if (orchestratorResult.productContext) {
      systemPrompt = `${systemPrompt}\n\n## Product Context\n${orchestratorResult.productContext}`;
    }

    const openRouterApiKey = getOpenRouterApiKey();
    if (!openRouterApiKey) {
      const lastUserMessage = formattedMessages[formattedMessages.length - 1];
      const demoResponse = getDemoResponse(lastUserMessage.content);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return NextResponse.json({ success: true, message: demoResponse, demo_mode: true });
    }

    const result = await callOpenRouter(openRouterApiKey, systemPrompt, formattedMessages);
    return NextResponse.json({
      success: true,
      message: result.message,
      usage: result.usage,
      meta: {
        agentId: orchestratorResult.agentId,
        intent: orchestratorResult.intent,
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get response from AI';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ messages: [] });

    return NextResponse.json({
      success: true,
      messages: [],
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    return NextResponse.json({ messages: [] });
  }
}
