import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { generateSystemPrompt, UserContext } from '@/lib/noorAIPrompt';
import { createServerClient } from '@/lib/supabase';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Initialize Anthropic client only if API key exists
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new Anthropic({ apiKey });
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const anthropic = getAnthropicClient();

    if (!anthropic) {
      return NextResponse.json(
        { error: 'AI service is not configured. Please set ANTHROPIC_API_KEY.' },
        { status: 503 }
      );
    }

    const { messages, userContext, userId } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages are required' },
        { status: 400 }
      );
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

    // Save to chat history in Supabase (if userId provided)
    if (userId) {
      try {
        const supabase = createServerClient();

        // Save user message
        const lastUserMessage = messages[messages.length - 1];
        if (lastUserMessage.role === 'user') {
          await supabase.from('chat_history').insert({
            user_id: userId,
            role: 'user',
            message: lastUserMessage.content,
          });
        }

        // Save assistant response
        await supabase.from('chat_history').insert({
          user_id: userId,
          role: 'assistant',
          message: assistantMessage,
        });
      } catch (dbError) {
        console.error('Error saving chat history:', dbError);
        // Continue even if DB save fails
      }
    }

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
          { error: 'API key not configured' },
          { status: 500 }
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
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('chat_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('Error fetching chat history:', error);
      return NextResponse.json({ messages: [] });
    }

    return NextResponse.json({
      success: true,
      messages: data || [],
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    return NextResponse.json({ messages: [] });
  }
}
