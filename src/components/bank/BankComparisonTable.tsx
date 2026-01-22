'use client';

import React from 'react';
import { BankRecommendation } from '@/hooks/useBankRecommendations';

interface BankComparisonTableProps {
  recommendations: BankRecommendation[];
  onSelectBank?: (recommendation: BankRecommendation) => void;
}

export function BankComparisonTable({ recommendations, onSelectBank }: BankComparisonTableProps) {
  // Show top 3 banks
  const topBanks = recommendations.slice(0, 3);

  if (topBanks.length < 2) {
    return null;
  }

  const comparisonRows: {
    label: string;
    getValue: (rec: BankRecommendation) => string;
    isGoodFn?: (rec: BankRecommendation) => boolean;
  }[] = [
    {
      label: 'Monthly Fee',
      getValue: (rec) => rec.bank.monthly_fee === 0 ? 'Free' : `$${rec.bank.monthly_fee}`,
      isGoodFn: (rec) => rec.bank.monthly_fee === 0,
    },
    {
      label: 'Min Balance',
      getValue: (rec) => rec.bank.min_balance === 0 ? 'None' : `$${rec.bank.min_balance}`,
      isGoodFn: (rec) => rec.bank.min_balance === 0,
    },
    {
      label: 'Wire Transfer',
      getValue: (rec) => rec.bank.intl_wire_outgoing === 0 ? 'Free' : `$${rec.bank.intl_wire_outgoing}`,
      isGoodFn: (rec) => rec.bank.intl_wire_outgoing <= 20,
    },
    {
      label: 'Foreign Fee',
      getValue: (rec) => rec.bank.foreign_transaction_fee === 0 ? 'None' : `${rec.bank.foreign_transaction_fee}%`,
      isGoodFn: (rec) => rec.bank.foreign_transaction_fee === 0,
    },
    {
      label: 'SSN Required',
      getValue: (rec) => rec.bank.can_open_without_ssn ? 'No' : 'Yes',
      isGoodFn: (rec) => rec.bank.can_open_without_ssn,
    },
    {
      label: 'Zelle',
      getValue: (rec) => rec.bank.has_zelle ? 'Yes' : 'No',
      isGoodFn: (rec) => rec.bank.has_zelle,
    },
    {
      label: 'Student Account',
      getValue: (rec) => rec.bank.has_student_account ? 'Yes' : 'No',
      isGoodFn: (rec) => rec.bank.has_student_account,
    },
    {
      label: 'Intl Student Friendly',
      getValue: (rec) => rec.bank.intl_student_friendly ? 'Yes' : 'No',
      isGoodFn: (rec) => rec.bank.intl_student_friendly,
    },
  ];

  return (
    <div className="noor-card p-4 overflow-x-auto">
      <h3 className="font-semibold text-black mb-4">Compare Top Banks</h3>

      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left py-2 pr-4 text-gray-500 font-normal"></th>
            {topBanks.map((rec) => (
              <th
                key={rec.bank.id}
                className="text-center px-2 py-2 min-w-[100px]"
              >
                <button
                  onClick={() => onSelectBank?.(rec)}
                  className="w-full hover:opacity-80 transition-opacity"
                >
                  {rec.categoryPick && (
                    <span className={`inline-block px-2 py-0.5 text-white text-xs rounded-full mb-1 ${
                      rec.categoryPick.category === 'best_overall' ? 'bg-black' :
                      rec.categoryPick.category === 'best_low_fees' ? 'bg-green-600' :
                      rec.categoryPick.category === 'best_international' ? 'bg-blue-600' :
                      rec.categoryPick.category === 'best_branches' ? 'bg-purple-600' :
                      rec.categoryPick.category === 'best_online' ? 'bg-indigo-600' :
                      rec.categoryPick.category === 'best_student' ? 'bg-orange-500' :
                      rec.categoryPick.category === 'best_no_ssn' ? 'bg-teal-600' :
                      'bg-gray-600'
                    }`}>
                      {rec.categoryPick.category === 'best_overall' ? 'Best' :
                       rec.categoryPick.category === 'best_low_fees' ? 'Low Fees' :
                       rec.categoryPick.category === 'best_international' ? 'Transfers' :
                       rec.categoryPick.category === 'best_branches' ? 'Branches' :
                       rec.categoryPick.category === 'best_online' ? 'Online' :
                       rec.categoryPick.category === 'best_student' ? 'Students' :
                       rec.categoryPick.category === 'best_no_ssn' ? 'No SSN' :
                       'Pick'}
                    </span>
                  )}
                  <p className="font-semibold text-black text-sm">
                    {rec.bank.bank_name}
                  </p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {rec.fitScore}% fit
                  </p>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {comparisonRows.map((row) => (
            <tr key={row.label}>
              <td className="py-3 pr-4 text-gray-500">{row.label}</td>
              {topBanks.map((rec) => {
                const value = row.getValue(rec);
                const isGood = row.isGoodFn?.(rec);
                return (
                  <td
                    key={rec.bank.id}
                    className={`text-center py-3 px-2 font-medium ${
                      isGood ? 'text-green-600' : 'text-gray-700'
                    }`}
                  >
                    {isGood && <span className="mr-1">&#10003;</span>}
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Action Row */}
      <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100">
        {topBanks.map((rec) => (
          <button
            key={rec.bank.id}
            onClick={() => onSelectBank?.(rec)}
            className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              rec.isBestMatch
                ? 'bg-black text-white hover:bg-gray-800'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            View Details
          </button>
        ))}
      </div>
    </div>
  );
}
