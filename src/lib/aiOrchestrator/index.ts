import { getAgentForIntent } from './agents';
import { classifyIntent } from './classify';
import { fetchSafeContext } from './safeContext';
import type { ChatMessageInput, OrchestratorResult } from './types';

function getLastUserMessage(messages: ChatMessageInput[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

function buildProductContext(intent: OrchestratorResult['intent']): string | undefined {
  if (intent === 'banking') {
    return [
      'If banking products are discussed, prefer Noor-supported options and give a short comparison.',
      'Avoid inventing unsupported products or claims.',
    ].join(' ');
  }

  if (intent === 'affordability') {
    return [
      'Affordability intent: prioritize concrete numbers over generic budgeting advice.',
      'Use orchestrator safe context if available to estimate whether the purchase fits budget.',
      'When safe context values are estimates, clearly label them as estimates.',
      'If key numbers are missing, ask for only the minimum follow-up data needed (current balance and bills due before next income).',
      'Answer with: quick verdict, simple math, and one actionable next step.',
    ].join(' ');
  }

  return undefined;
}

export async function orchestrate(
  userId: string | null | undefined,
  messages: ChatMessageInput[]
): Promise<OrchestratorResult> {
  const lastUserMessage = getLastUserMessage(messages);
  const intent = classifyIntent(lastUserMessage);
  const agent = getAgentForIntent(intent);

  const safeContext =
    agent.dbAccess === 'minimal' && userId
      ? await fetchSafeContext(userId, agent.allowedFields)
      : {};

  return {
    agentId: agent.id,
    intent,
    safeContext,
    productContext: buildProductContext(intent),
  };
}

export type { ChatMessageInput, OrchestratorResult, SafeUserContext } from './types';
