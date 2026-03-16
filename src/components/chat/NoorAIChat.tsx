'use client';

import React, { useState, useEffect } from 'react';
import { ChatButton } from './ChatButton';
import { ChatModal } from './ChatModal';
import { UserContext } from '@/lib/noorAIPrompt';

interface NoorAIChatProps {
  // Can pass these props directly or it will read from localStorage
  userId?: string;
  userContext?: UserContext;
}

export function NoorAIChat({ userId: propUserId, userContext: propUserContext }: NoorAIChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(propUserId || null);
  const [userContext] = useState<UserContext>(propUserContext || {});

  // Load user data from localStorage if not provided as props
  useEffect(() => {
    if (!propUserId) {
      const storedUserId = localStorage.getItem('noor_user_id');
      if (storedUserId) {
        setUserId(storedUserId);
      }
    }

  }, [propUserId]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      <ChatButton
        isOpen={isOpen}
        onClick={handleToggle}
      />
      <ChatModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        userId={userId}
        userContext={userContext}
      />
    </>
  );
}
