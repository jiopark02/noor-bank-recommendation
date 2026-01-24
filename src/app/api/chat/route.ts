import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { generateSystemPrompt, UserContext } from '@/lib/noorAIPrompt';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Initialize Anthropic client only if API key exists
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  return new Anthropic({ apiKey });
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Demo mode responses when no API key is configured
const DEMO_RESPONSES: Record<string, string> = {
  // Greetings
  '안녕': '안녕하세요! 저는 Noor AI예요 🙌 미국 유학 생활과 금융에 대한 질문이 있으시면 언제든 물어보세요!',
  'hello': '안녕하세요! I\'m Noor AI 🙌 I can help you with banking, visa questions, housing, and more for international students in the US!',
  'hi': '안녕하세요! I\'m Noor AI 🙌 How can I help you today?',

  // Banking
  'ssn 없이 계좌': `SSN 없이 계좌를 개설할 수 있는 은행들이 있어요! 🏦

**추천 은행:**
1. **Chase Bank** - 지점 방문 시 여권 + I-20로 개설 가능
2. **Bank of America** - 학교 근처 지점에서 개설 가능
3. **Wells Fargo** - 국제학생 친화적

**필요한 서류:**
- 여권
- I-20 또는 DS-2019
- 학교 입학허가서
- 미국 주소 증명 (기숙사 계약서 등)

Banking 탭에서 나에게 맞는 은행을 찾아보세요!`,

  'bank': `Here are the best banks for international students! 🏦

**Top Recommendations:**
1. **Chase Bank** - Can open with passport + I-20
2. **Bank of America** - International student friendly
3. **Wells Fargo** - No SSN required in-branch

Check out our Banking section for personalized recommendations!`,

  // Credit cards
  '크레딧 카드': `신용 기록 없이도 만들 수 있는 카드가 있어요! 💳

**Secured Credit Cards (보증금 필요):**
- Discover it Secured - 캐시백 매칭
- Capital One Secured - 낮은 보증금

**Student Cards:**
- Discover it Student - 학생 전용, 성적 보너스
- Journey Student Rewards - 첫 카드로 좋음

**SSN 없이 가능:**
- 일부 secured 카드는 ITIN으로 신청 가능

Funding 탭에서 자세히 알아보세요!`,

  // Visa
  '비자': `F-1 비자 관련 중요 정보입니다! 📋

**주의사항:**
- Full-time 등록 유지 필수 (학기당 12학점 이상)
- 캠퍼스 밖 취업은 CPT/OPT 필요
- 출국 시 I-20 서명 확인 (6개월 내)

**취업 옵션:**
- CPT: 인턴십/Co-op (학기 중)
- OPT: 졸업 후 12개월 (STEM은 +24개월)

Visa 탭에서 비자 상태를 관리하세요!`,

  // Housing
  '집': `미국에서 집 구하기 팁이에요! 🏠

**추천 순서:**
1. 학교 기숙사 - 첫 학기 추천
2. 학교 주변 아파트 - 2학기부터
3. 룸메이트 구하기 - 비용 절약

**체크리스트:**
- 렌트비 (월세의 1-2개월 보증금)
- 유틸리티 포함 여부
- 학교까지 거리
- 안전한 동네인지

Housing 탭에서 주변 아파트를 찾아보세요!`,

  // Default
  'default': `안녕하세요! 저는 Noor AI예요 🙌

제가 도와드릴 수 있는 것들:
- 🏦 **은행 계좌** 개설 방법
- 💳 **크레딧 카드** 추천
- 📋 **비자** 관련 정보
- 🏠 **주거** 찾기 팁
- 💰 **장학금** 정보

무엇이든 물어보세요!

---
*현재 데모 모드로 실행 중입니다. 더 정확한 답변을 위해 관리자에게 API 설정을 요청해주세요.*`,
};

function getDemoResponse(message: string): string {
  const lowerMessage = message.toLowerCase();

  // Check for keyword matches
  if (lowerMessage.includes('안녕') || lowerMessage === 'hi' || lowerMessage === 'hello') {
    return DEMO_RESPONSES['안녕'];
  }
  if (lowerMessage.includes('ssn') && (lowerMessage.includes('계좌') || lowerMessage.includes('bank') || lowerMessage.includes('없이'))) {
    return DEMO_RESPONSES['ssn 없이 계좌'];
  }
  if (lowerMessage.includes('bank') || lowerMessage.includes('은행') || lowerMessage.includes('계좌')) {
    return DEMO_RESPONSES['bank'];
  }
  if (lowerMessage.includes('credit') || lowerMessage.includes('크레딧') || lowerMessage.includes('카드') || lowerMessage.includes('신용')) {
    return DEMO_RESPONSES['크레딧 카드'];
  }
  if (lowerMessage.includes('visa') || lowerMessage.includes('비자') || lowerMessage.includes('f-1') || lowerMessage.includes('opt') || lowerMessage.includes('cpt')) {
    return DEMO_RESPONSES['비자'];
  }
  if (lowerMessage.includes('house') || lowerMessage.includes('housing') || lowerMessage.includes('집') || lowerMessage.includes('아파트') || lowerMessage.includes('rent') || lowerMessage.includes('렌트')) {
    return DEMO_RESPONSES['집'];
  }

  return DEMO_RESPONSES['default'];
}

export async function POST(request: NextRequest) {
  try {
    const { messages, userContext } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages are required' },
        { status: 400 }
      );
    }

    const anthropic = getAnthropicClient();

    // Demo mode - use fallback responses
    if (!anthropic) {
      const lastUserMessage = messages[messages.length - 1];
      const demoResponse = getDemoResponse(lastUserMessage.content);

      // Simulate a small delay for natural feel
      await new Promise(resolve => setTimeout(resolve, 500));

      return NextResponse.json({
        success: true,
        message: demoResponse,
        demo_mode: true,
      });
    }

    // Generate the system prompt with user context
    const systemPrompt = generateSystemPrompt(userContext || {});

    // Format messages for Claude API
    const formattedMessages = messages.map((msg: ChatMessage) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: systemPrompt,
      messages: formattedMessages,
    });

    // Extract the assistant's response
    const assistantMessage = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    return NextResponse.json({
      success: true,
      message: assistantMessage,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);

    // Handle specific Anthropic errors
    if (error instanceof Anthropic.APIError) {
      if (error.status === 401) {
        return NextResponse.json(
          { error: 'Invalid API key', demo_available: true },
          { status: 401 }
        );
      }
      if (error.status === 429) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please try again later.' },
          { status: 429 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Failed to get response from AI' },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch chat history
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ messages: [] });
    }

    // Return empty history for now (Supabase integration optional)
    return NextResponse.json({
      success: true,
      messages: [],
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    return NextResponse.json({ messages: [] });
  }
}
