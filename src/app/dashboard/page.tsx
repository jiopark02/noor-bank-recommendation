'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BottomNav } from '@/components/layout';
import {
  getTransactions,
  addTransaction,
  deleteTransaction,
  getFinancialSummary,
  getSpendingByCategory,
  formatCurrency,
  CATEGORIES,
  Transaction,
  TransactionCategory,
  FinancialSummary,
} from '@/lib/financialData';

type TabType = 'overview' | 'transactions' | 'budget';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [spending, setSpending] = useState<{ category: TransactionCategory; amount: number; percentage: number }[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTransaction, setNewTransaction] = useState({
    amount: '',
    category: 'food' as TransactionCategory,
    description: '',
    type: 'expense' as 'expense' | 'income',
    date: new Date().toISOString().split('T')[0],
  });

  const loadData = () => {
    setTransactions(getTransactions());
    setSummary(getFinancialSummary());
    setSpending(getSpendingByCategory());
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddTransaction = () => {
    if (!newTransaction.amount || !newTransaction.description) return;

    addTransaction({
      amount: parseFloat(newTransaction.amount),
      category: newTransaction.category,
      description: newTransaction.description,
      type: newTransaction.type,
      date: newTransaction.date,
    });

    setShowAddModal(false);
    setNewTransaction({
      amount: '',
      category: 'food',
      description: '',
      type: 'expense',
      date: new Date().toISOString().split('T')[0],
    });
    loadData();
  };

  const handleDeleteTransaction = (id: string) => {
    deleteTransaction(id);
    loadData();
  };

  if (!summary) {
    return (
      <div className="min-h-screen bg-[#FAF9F7] flex items-center justify-center">
        <div className="animate-pulse text-[#6B6B6B]">Loading...</div>
      </div>
    );
  }

  const progressPercentage = Math.min(summary.percentage_used, 100);

  return (
    <div className="min-h-screen bg-[#FAF9F7] pb-24">
      {/* Header */}
      <div className="bg-white border-b border-[#E8E6E3]">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-light text-[#1A1A1A] tracking-tight">Dashboard</h1>
            <p className="text-sm text-[#6B6B6B] mt-1">January 2026</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="w-10 h-10 bg-[#1A1A1A] rounded-full flex items-center justify-center"
          >
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Budget Overview Card */}
      <div className="px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-[#E8E6E3]"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-[#6B6B6B]">Monthly Budget</span>
            <span className="text-sm font-medium text-[#1A1A1A]">{formatCurrency(summary.total_budget)}</span>
          </div>

          {/* Progress Bar */}
          <div className="relative h-3 bg-[#F5F4F2] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercentage}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className={`absolute left-0 top-0 h-full rounded-full ${
                progressPercentage > 90 ? 'bg-red-500' : progressPercentage > 70 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
            />
          </div>

          <div className="flex justify-between mt-3">
            <div>
              <p className="text-2xl font-light text-[#1A1A1A]">{formatCurrency(summary.total_spent)}</p>
              <p className="text-xs text-[#6B6B6B]">Spent</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-light text-[#1A1A1A]">{formatCurrency(summary.remaining)}</p>
              <p className="text-xs text-[#6B6B6B]">Remaining</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Tabs */}
      <div className="px-4">
        <div className="flex gap-2 bg-[#F5F4F2] rounded-xl p-1">
          {(['overview', 'transactions', 'budget'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-white text-[#1A1A1A] shadow-sm'
                  : 'text-[#6B6B6B]'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="px-4 py-4">
        {activeTab === 'overview' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            {/* Spending by Category */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
              <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Spending by Category</h3>
              <div className="space-y-3">
                {spending.map((item) => (
                  <div key={item.category} className="flex items-center gap-3">
                    <span className="text-lg">{CATEGORIES[item.category].icon}</span>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-[#1A1A1A]">{CATEGORIES[item.category].label}</span>
                        <span className="text-[#6B6B6B]">{formatCurrency(item.amount)}</span>
                      </div>
                      <div className="h-1.5 bg-[#F5F4F2] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${item.percentage}%`,
                            backgroundColor: CATEGORIES[item.category].color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-[#1A1A1A]">Recent Transactions</h3>
                <button
                  onClick={() => setActiveTab('transactions')}
                  className="text-xs text-[#6B6B6B]"
                >
                  See all
                </button>
              </div>
              <div className="space-y-2">
                {transactions.slice(0, 5).map((tx) => (
                  <div key={tx.id} className="flex items-center gap-3 py-2">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: `${CATEGORIES[tx.category].color}20` }}
                    >
                      <span>{CATEGORIES[tx.category].icon}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-[#1A1A1A]">{tx.description}</p>
                      <p className="text-xs text-[#6B6B6B]">
                        {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <span className={`text-sm font-medium ${tx.type === 'expense' ? 'text-red-500' : 'text-green-500'}`}>
                      {tx.type === 'expense' ? '-' : '+'}{formatCurrency(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'transactions' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E8E6E3] overflow-hidden">
              {transactions.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-[#6B6B6B]">No transactions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-[#E8E6E3]">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center gap-3 p-4">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: `${CATEGORIES[tx.category].color}20` }}
                      >
                        <span>{CATEGORIES[tx.category].icon}</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-[#1A1A1A]">{tx.description}</p>
                        <p className="text-xs text-[#6B6B6B]">
                          {CATEGORIES[tx.category].label} • {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-medium ${tx.type === 'expense' ? 'text-red-500' : 'text-green-500'}`}>
                          {tx.type === 'expense' ? '-' : '+'}{formatCurrency(tx.amount)}
                        </span>
                        <button
                          onClick={() => handleDeleteTransaction(tx.id)}
                          className="block text-xs text-[#9B9B9B] mt-1 hover:text-red-500"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'budget' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            {summary.by_category.map((budget) => {
              const percentage = budget.limit > 0 ? (budget.spent / budget.limit) * 100 : 0;
              const isOverBudget = percentage > 100;

              return (
                <div
                  key={budget.category}
                  className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: `${CATEGORIES[budget.category].color}20` }}
                    >
                      <span>{CATEGORIES[budget.category].icon}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#1A1A1A]">{CATEGORIES[budget.category].label}</p>
                      <p className="text-xs text-[#6B6B6B]">
                        {formatCurrency(budget.spent)} of {formatCurrency(budget.limit)}
                      </p>
                    </div>
                    {isOverBudget && (
                      <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full">
                        Over budget
                      </span>
                    )}
                  </div>
                  <div className="h-2 bg-[#F5F4F2] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(percentage, 100)}%`,
                        backgroundColor: isOverBudget ? '#ef4444' : CATEGORIES[budget.category].color,
                      }}
                    />
                  </div>
                  <p className="text-xs text-[#6B6B6B] mt-2 text-right">
                    {budget.limit > 0 ? `${Math.round(percentage)}% used` : 'No limit set'}
                  </p>
                </div>
              );
            })}
          </motion.div>
        )}
      </div>

      {/* Add Transaction Modal */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="fixed inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl p-6 z-50 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-medium text-[#1A1A1A]">Add Transaction</h2>
                <button onClick={() => setShowAddModal(false)} className="text-[#6B6B6B]">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Type Toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setNewTransaction({ ...newTransaction, type: 'expense' })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    newTransaction.type === 'expense'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-[#F5F4F2] text-[#6B6B6B]'
                  }`}
                >
                  Expense
                </button>
                <button
                  onClick={() => setNewTransaction({ ...newTransaction, type: 'income' })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    newTransaction.type === 'income'
                      ? 'bg-green-100 text-green-600'
                      : 'bg-[#F5F4F2] text-[#6B6B6B]'
                  }`}
                >
                  Income
                </button>
              </div>

              {/* Amount */}
              <div className="mb-4">
                <label className="text-sm text-[#6B6B6B] mb-1 block">Amount</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B6B6B]">$</span>
                  <input
                    type="number"
                    value={newTransaction.amount}
                    onChange={(e) => setNewTransaction({ ...newTransaction, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-3 rounded-xl border border-[#E8E6E3] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="text-sm text-[#6B6B6B] mb-1 block">Description</label>
                <input
                  type="text"
                  value={newTransaction.description}
                  onChange={(e) => setNewTransaction({ ...newTransaction, description: e.target.value })}
                  placeholder="What was this for?"
                  className="w-full px-4 py-3 rounded-xl border border-[#E8E6E3] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                />
              </div>

              {/* Category */}
              <div className="mb-4">
                <label className="text-sm text-[#6B6B6B] mb-2 block">Category</label>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(CATEGORIES).map(([key, cat]) => (
                    <button
                      key={key}
                      onClick={() => setNewTransaction({ ...newTransaction, category: key as TransactionCategory })}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        newTransaction.category === key
                          ? 'border-[#1A1A1A] bg-[#FAF9F7]'
                          : 'border-[#E8E6E3]'
                      }`}
                    >
                      <span className="text-lg block">{cat.icon}</span>
                      <span className="text-xs text-[#6B6B6B] mt-1 block">{cat.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Date */}
              <div className="mb-6">
                <label className="text-sm text-[#6B6B6B] mb-1 block">Date</label>
                <input
                  type="date"
                  value={newTransaction.date}
                  onChange={(e) => setNewTransaction({ ...newTransaction, date: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-[#E8E6E3] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                />
              </div>

              {/* Submit Button */}
              <button
                onClick={handleAddTransaction}
                disabled={!newTransaction.amount || !newTransaction.description}
                className="w-full py-4 bg-[#1A1A1A] text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Transaction
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}
