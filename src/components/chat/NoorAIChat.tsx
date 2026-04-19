"use client";

import React, { useState, useEffect } from "react";
import { ChatButton } from "./ChatButton";
import { ChatModal } from "./ChatModal";
import { UserContext } from "@/lib/noorAIPrompt";
import { supabase } from "@/lib/supabase-browser";

interface NoorAIChatProps {
  userId?: string;
  userContext?: UserContext;
}

export function NoorAIChat({
  userId: propUserId,
  userContext: propUserContext,
}: NoorAIChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(propUserId || null);
  const [userContext, setUserContext] = useState<UserContext>(
    propUserContext || {}
  );

  useEffect(() => {
    let isMounted = true;

    const buildContextFromSupabase = async (resolvedUserId: string) => {
      if (!supabase || !isMounted || propUserContext) {
        return;
      }

      try {
        const [{ data: userRow }, { data: surveyRow }] = await Promise.all([
          supabase
            .from("users")
            .select("first_name,last_name")
            .eq("id", resolvedUserId)
            .maybeSingle(),
          supabase
            .from("survey_responses")
            .select(
              "university,institution_type,has_ssn,has_us_credit_history,monthly_income,campus_side,expected_monthly_spending"
            )
            .eq("user_id", resolvedUserId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (!isMounted) return;

        if (userRow || surveyRow) {
          setUserContext({
            firstName: userRow?.first_name || undefined,
            lastName: userRow?.last_name || undefined,
            university: surveyRow?.university || undefined,
            institutionType: surveyRow?.institution_type || undefined,
            hasSSN: surveyRow?.has_ssn ?? undefined,
            hasCreditHistory: surveyRow?.has_us_credit_history ?? undefined,
            monthlyIncome: surveyRow?.monthly_income ?? undefined,
            campusSide: surveyRow?.campus_side || undefined,
            monthlySpending: surveyRow?.expected_monthly_spending ?? undefined,
          });
        }
      } catch (error) {
        console.error("Failed to load user context from Supabase:", error);
      }
    };

    const syncSession = async () => {
      if (propUserId || !supabase) {
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const resolvedUserId = session?.user?.id || null;
      if (!isMounted) return;

      setUserId(resolvedUserId);

      if (resolvedUserId) {
        await buildContextFromSupabase(resolvedUserId);
      }
    };

    void syncSession();

    const { data: authListener } = supabase?.auth.onAuthStateChange(
      async (_event, session) => {
        if (!isMounted || propUserId) return;

        const resolvedUserId = session?.user?.id || null;
        setUserId(resolvedUserId);

        if (!resolvedUserId) {
          if (!propUserContext) {
            setUserContext({});
          }
          return;
        }

        await buildContextFromSupabase(resolvedUserId);
      }
    ) || { data: { subscription: null } };

    return () => {
      isMounted = false;
      authListener.subscription?.unsubscribe();
    };
  }, [propUserId, propUserContext]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      <ChatButton isOpen={isOpen} onClick={handleToggle} />
      <ChatModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        userId={userId}
        userContext={userContext}
      />
    </>
  );
}
