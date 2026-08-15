'use client';

/*
 * DEMO ONLY — investor meeting preview.
 *
 * Every number below is hardcoded dummy data. This component makes no network
 * call of any kind: no Plaid request, no Supabase query, no HTTP call at all.
 * It holds no state and reads nothing from the browser, so it renders
 * identically for every viewer and cannot show real account data by accident.
 *
 * Nothing here is projected at runtime. The running balances in TRAJECTORY are
 * written out by hand, not derived from the charges, so they only look correct
 * as long as they agree with the constants in SafeToSpendDemoCard (the same
 * $1,284.50 starting balance and the same five upcoming charges). The two cards
 * deliberately do not share state: change one and the other must be corrected
 * by hand, or the meeting shows two stories that contradict each other.
 *
 * Temporary: this card exists for one investor meeting and is scheduled for
 * removal afterwards. Deleting src/components/demo/ and reverting the lines it
 * adds to src/app/dashboard/page.tsx removes it completely.
 */

import React from 'react';

// DEMO ONLY — invented running balances. Not a forecast, not Plaid data.
const TRAJECTORY = [
  { label: 'Today · Aug 16', balance: 1284.50 },
  { label: 'Spotify · Aug 19', balance: 1218.51 },
  { label: 'Phone · Aug 22', balance: 1119.51 },
  { label: 'Car insurance · Aug 26', balance: 902.51 },
  { label: 'Rent · Sep 1', balance: -55.49, alert: true },
  { label: 'Electric · Sep 3', balance: -186.49 },
  { label: 'Payday · Sep 4', balance: 575.51 },
];

function formatUsd(value: number): string {
  const amount = Math.abs(value).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  return value < 0 ? `−${amount}` : amount;
}

export function OverdraftForecastDemoCard() {
  return (
    <div className="noor-card p-6 mb-5">
      <p className="text-gray-500 text-sm mb-1">Heads up</p>

      {/* The headline sits a step below the Safe to spend figure on purpose:
          what this card has to land is the sentence, not the number. */}
      <p className="text-xl font-semibold text-black">
        Rent on Sep 1 will overdraft you by $55.49
      </p>

      <p className="text-gray-500 text-sm mt-2">
        Your paycheck lands Sep 4 — three days too late. Two overdrafts would
        cost $70 in fees.
      </p>

      <div className="mt-5 pt-5 border-t border-gray-100 space-y-1">
        {TRAJECTORY.map((point) => (
          <div
            key={point.label}
            className={`flex items-center justify-between text-sm -mx-2 px-2 py-1 ${
              point.alert ? 'bg-red-50 rounded font-medium' : ''
            }`}
          >
            <span className={point.alert ? 'text-red-800' : 'text-gray-500'}>
              {point.label}
            </span>
            {/* Only the alert row is emphasized. A later row can still be
                negative and is tinted, but Sep 1 is the moment that matters. */}
            <span
              className={
                point.alert
                  ? 'text-red-800'
                  : point.balance < 0
                  ? 'text-red-600'
                  : 'text-black'
              }
            >
              {formatUsd(point.balance)}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Projected using your average spending of $18/day
      </p>

      <div className="mt-5 pt-5 border-t border-gray-100">
        <p className="text-sm text-black">
          Skip this week&apos;s $40 emergency fund transfer and spend about
          $1/day less. That clears Sep 1.
        </p>
      </div>

      <p className="mt-5 text-center text-xs text-gray-400">
        Preview — sample data
      </p>
    </div>
  );
}
