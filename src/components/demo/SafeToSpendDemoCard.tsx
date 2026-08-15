'use client';

/*
 * DEMO ONLY — investor meeting preview.
 *
 * Every number below is hardcoded dummy data. This component makes no network
 * call of any kind: no Plaid request, no Supabase query, no HTTP call at all.
 * It holds no state and reads nothing from the browser, so it renders
 * identically for every viewer and cannot show real account data by accident.
 *
 * Temporary: this card exists for one investor meeting and is scheduled for
 * removal afterwards. Deleting src/components/demo/ and reverting the two
 * lines it adds to src/app/dashboard/page.tsx removes it completely.
 */

import React from 'react';

// DEMO ONLY — invented account. Not a Plaid connection.
const DEMO_BANK = { name: 'Chase', mask: '4417', balance: 1284.50 };

// DEMO ONLY — invented upcoming charges. Not Plaid transactions.
const UPCOMING = [
  { id: 'rent', label: 'Rent', due: 'Sep 1', amount: 850 },
  { id: 'phone', label: 'Phone', due: 'Aug 22', amount: 45 },
  { id: 'spotify', label: 'Spotify', due: 'Aug 19', amount: 11.99 },
];

// DEMO ONLY — invented savings goal. Not a stored user goal.
const GOAL = { label: 'Emergency fund', weekly: 40 };

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

const upcomingTotal = UPCOMING.reduce((sum, bill) => sum + bill.amount, 0);

// 1284.50 - 906.99 - 40 = 337.51
const safe = DEMO_BANK.balance - upcomingTotal - GOAL.weekly;

export function SafeToSpendDemoCard() {
  return (
    <div className="noor-card p-6 mb-5">
      <p className="text-gray-500 text-sm mb-1">Safe to spend today</p>
      <p className="text-4xl font-semibold text-black">{formatUsd(safe)}</p>
      <p className="text-xs text-gray-400 mt-1">
        {DEMO_BANK.name} ••{DEMO_BANK.mask} · updated just now
      </p>

      {/* The breakdown stays expanded: showing how the number is reached is the
          point of this card, so the rows are never collapsed behind a toggle. */}
      <div className="mt-5 pt-5 border-t border-gray-100 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Balance</span>
          <span className="text-black">{formatUsd(DEMO_BANK.balance)}</span>
        </div>

        {UPCOMING.map((bill) => (
          <div
            key={bill.id}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-gray-500">
              {bill.label} · {bill.due}
            </span>
            {/* Deductions are gray, not red: these are the terms of a
                calculation, not a warning about overspending. */}
            <span className="text-gray-500">−{formatUsd(bill.amount)}</span>
          </div>
        ))}

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">{GOAL.label} · weekly</span>
          <span className="text-gray-500">−{formatUsd(GOAL.weekly)}</span>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <span className="text-sm font-medium text-black">Yours to spend</span>
          <span className="text-sm font-semibold text-black">
            {formatUsd(safe)}
          </span>
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-gray-400">
        Preview — sample data
      </p>
    </div>
  );
}
