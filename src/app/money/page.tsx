'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { PageLayout } from '@/components/layout';
import { ConnectBankCard } from '@/components/plaid';
import { PlaidAccount, PlaidTransaction, formatCurrency, CATEGORY_ICONS, CATEGORY_COLORS } from '@/lib/plaid';

// Storage keys
const STORAGE_KEY_CONNECTIONS = 'noor_plaid_connections';
const STORAGE_KEY_ACCOUNTS = 'noor_plaid_accounts';
const STORAGE_KEY_TRANSACTIONS = 'noor_plaid_transactions';

// Demo data for when Plaid is not configured
const DEMO_ACCOUNTS: PlaidAccount[] = [
  {
    id: 'demo_1',
    user_id: 'demo',
    account_id: 'checking_1',
    item_id: 'item_1',
    name: 'Chase Checking',
    official_name: 'Chase Total Checking',
    type: 'checking',
    subtype: 'checking',
    mask: '4567',
    current_balance: 3247.82,
    available_balance: 3147.82,
    credit_limit: null,
    iso_currency_code: 'USD',
    institution_id: 'ins_3',
    institution_name: 'Chase',
    last_updated: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo_2',
    user_id: 'demo',
    account_id: 'savings_1',
    item_id: 'item_1',
    name: 'Chase Savings',
    official_name: 'Chase Savings',
    type: 'savings',
    subtype: 'savings',
    mask: '8901',
    current_balance: 12500.00,
    available_balance: 12500.00,
    credit_limit: null,
    iso_currency_code: 'USD',
    institution_id: 'ins_3',
    institution_name: 'Chase',
    last_updated: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo_3',
    user_id: 'demo',
    account_id: 'credit_1',
    item_id: 'item_1',
    name: 'Discover it Card',
    official_name: 'Discover it Cash Back',
    type: 'credit',
    subtype: 'credit card',
    mask: '2345',
    current_balance: 847.23,
    available_balance: null,
    credit_limit: 3000,
    iso_currency_code: 'USD',
    institution_id: 'ins_128026',
    institution_name: 'Discover',
    last_updated: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
];

const DEMO_TRANSACTIONS: PlaidTransaction[] = [
  {
    id: 'txn_1',
    user_id: 'demo',
    account_id: 'checking_1',
    transaction_id: 'txn_1',
    amount: 12.99,
    iso_currency_code: 'USD',
    date: new Date().toISOString().split('T')[0],
    datetime: null,
    name: 'Netflix',
    merchant_name: 'Netflix',
    category: ['Service', 'Subscription'],
    category_id: null,
    pending: false,
    payment_channel: 'online',
    logo_url: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'txn_2',
    user_id: 'demo',
    account_id: 'checking_1',
    transaction_id: 'txn_2',
    amount: 45.67,
    iso_currency_code: 'USD',
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    datetime: null,
    name: 'Whole Foods Market',
    merchant_name: 'Whole Foods',
    category: ['Food and Drink', 'Groceries'],
    category_id: null,
    pending: false,
    payment_channel: 'in store',
    logo_url: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'txn_3',
    user_id: 'demo',
    account_id: 'checking_1',
    transaction_id: 'txn_3',
    amount: 9.99,
    iso_currency_code: 'USD',
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    datetime: null,
    name: 'Spotify',
    merchant_name: 'Spotify',
    category: ['Service', 'Subscription'],
    category_id: null,
    pending: false,
    payment_channel: 'online',
    logo_url: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'txn_4',
    user_id: 'demo',
    account_id: 'credit_1',
    transaction_id: 'txn_4',
    amount: 89.00,
    iso_currency_code: 'USD',
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    datetime: null,
    name: 'Amazon.com',
    merchant_name: 'Amazon',
    category: ['Shops', 'Online Marketplaces'],
    category_id: null,
    pending: false,
    payment_channel: 'online',
    logo_url: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'txn_5',
    user_id: 'demo',
    account_id: 'checking_1',
    transaction_id: 'txn_5',
    amount: 1200.00,
    iso_currency_code: 'USD',
    date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    datetime: null,
    name: 'Rent Payment',
    merchant_name: 'Apartment Complex',
    category: ['Payment', 'Rent'],
    category_id: null,
    pending: false,
    payment_channel: 'online',
    logo_url: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'txn_6',
    user_id: 'demo',
    account_id: 'checking_1',
    transaction_id: 'txn_6',
    amount: 35.00,
    iso_currency_code: 'USD',
    date: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    datetime: null,
    name: 'Uber',
    merchant_name: 'Uber',
    category: ['Travel', 'Taxi'],
    category_id: null,
    pending: false,
    payment_channel: 'online',
    logo_url: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'txn_7',
    user_id: 'demo',
    account_id: 'checking_1',
    transaction_id: 'txn_7',
    amount: -2500.00,
    iso_currency_code: 'USD',
    date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    datetime: null,
    name: 'Direct Deposit - University',
    merchant_name: 'University Payroll',
    category: ['Transfer', 'Payroll'],
    category_id: null,
    pending: false,
    payment_channel: 'online',
    logo_url: null,
    created_at: new Date().toISOString(),
  },
];

type TabId = 'overview' | 'accounts' | 'transactions' | 'subscriptions';

export default function MoneyPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [accounts, setAccounts] = useState<PlaidAccount[]>([]);
  const [transactions, setTransactions] = useState<PlaidTransaction[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isDemo, setIsDemo] = useState(true);

  useEffect(() => {
    const storedUserId = localStorage.getItem('noor_user_id');
    if (!storedUserId) {
      router.push('/welcome');
      return;
    }
    setUserId(storedUserId);

    // Check for existing connections
    const savedAccounts = localStorage.getItem(STORAGE_KEY_ACCOUNTS);
    const savedTransactions = localStorage.getItem(STORAGE_KEY_TRANSACTIONS);

    if (savedAccounts) {
      try {
        const parsed = JSON.parse(savedAccounts);
        setAccounts(parsed);
        setIsConnected(true);
        setIsDemo(false);
      } catch (e) {
        // Use demo data
        setAccounts(DEMO_ACCOUNTS);
        setTransactions(DEMO_TRANSACTIONS);
      }
    } else {
      // Use demo data
      setAccounts(DEMO_ACCOUNTS);
      setTransactions(DEMO_TRANSACTIONS);
    }

    if (savedTransactions) {
      try {
        setTransactions(JSON.parse(savedTransactions));
      } catch (e) {
        setTransactions(DEMO_TRANSACTIONS);
      }
    } else {
      setTransactions(DEMO_TRANSACTIONS);
    }

    setIsLoading(false);
  }, [router]);

  // Handle bank connection
  const handleBankConnected = async (data: {
    itemId: string;
    accessToken: string;
    institutionName: string;
    institutionId: string;
  }) => {
    try {
      // Fetch accounts
      const accountsRes = await fetch('/api/plaid/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: data.accessToken, userId }),
      });
      const accountsData = await accountsRes.json();

      if (accountsData.success) {
        setAccounts(accountsData.accounts);
        localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(accountsData.accounts));
      }

      // Fetch transactions
      const txnRes = await fetch('/api/plaid/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: data.accessToken, userId }),
      });
      const txnData = await txnRes.json();

      if (txnData.success) {
        setTransactions(txnData.transactions);
        localStorage.setItem(STORAGE_KEY_TRANSACTIONS, JSON.stringify(txnData.transactions));
      }

      // Save connection
      const connections = JSON.parse(localStorage.getItem(STORAGE_KEY_CONNECTIONS) || '[]');
      connections.push({
        itemId: data.itemId,
        accessToken: data.accessToken,
        institutionName: data.institutionName,
        institutionId: data.institutionId,
        connectedAt: new Date().toISOString(),
      });
      localStorage.setItem(STORAGE_KEY_CONNECTIONS, JSON.stringify(connections));

      setIsConnected(true);
      setIsDemo(false);
    } catch (err) {
      console.error('Error fetching account data:', err);
    }
  };

  // Calculate totals
  const totals = useMemo(() => {
    const checking = accounts
      .filter((a) => a.type === 'checking' || a.type === 'savings')
      .reduce((sum, a) => sum + a.current_balance, 0);

    const credit = accounts
      .filter((a) => a.type === 'credit')
      .reduce((sum, a) => sum + a.current_balance, 0);

    const creditLimit = accounts
      .filter((a) => a.type === 'credit')
      .reduce((sum, a) => sum + (a.credit_limit || 0), 0);

    const netWorth = checking - credit;

    return { checking, credit, creditLimit, netWorth };
  }, [accounts]);

  // Calculate spending by category
  const categorySpending = useMemo(() => {
    const categories: Record<string, number> = {};

    transactions
      .filter((t) => t.amount > 0)
      .forEach((t) => {
        const category = t.category[0] || 'Other';
        categories[category] = (categories[category] || 0) + t.amount;
      });

    return Object.entries(categories)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions]);

  // Detect subscriptions
  const subscriptions = useMemo(() => {
    const subs: { name: string; amount: number; date: string }[] = [];
    const subPatterns = [
      { pattern: /netflix/i, name: 'Netflix' },
      { pattern: /spotify/i, name: 'Spotify' },
      { pattern: /apple.*music/i, name: 'Apple Music' },
      { pattern: /amazon.*prime/i, name: 'Amazon Prime' },
      { pattern: /hulu/i, name: 'Hulu' },
      { pattern: /disney/i, name: 'Disney+' },
      { pattern: /gym|fitness/i, name: 'Gym' },
    ];

    transactions.forEach((t) => {
      const name = t.merchant_name || t.name;
      for (const sub of subPatterns) {
        if (sub.pattern.test(name)) {
          subs.push({ name: sub.name, amount: t.amount, date: t.date });
          break;
        }
      }
    });

    return subs;
  }, [transactions]);

  const totalSubscriptions = subscriptions.reduce((sum, s) => sum + s.amount, 0);

  // Monthly spending
  const monthlySpending = useMemo(() => {
    return transactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  // Monthly income
  const monthlyIncome = useMemo(() => {
    return transactions
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <motion.div
          className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
      </div>
    );
  }

  const TABS: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'subscriptions', label: 'Subscriptions' },
  ];

  return (
    <PageLayout>
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-black">Money</h1>
            <p className="text-gray-500 text-sm">All your finances in one place</p>
          </div>
          {isDemo && (
            <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
              Demo Mode
            </span>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-black text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {/* Net Worth Card */}
            <div className="noor-card p-6 mb-4 bg-gradient-to-br from-gray-900 to-black text-white">
              <p className="text-gray-400 text-sm mb-1">Net Worth</p>
              <p className="text-4xl font-semibold mb-4">
                {formatCurrency(totals.netWorth)}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-400 text-xs">Cash</p>
                  <p className="text-lg font-medium text-green-400">
                    {formatCurrency(totals.checking)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">Credit Used</p>
                  <p className="text-lg font-medium text-red-400">
                    -{formatCurrency(totals.credit)}
                  </p>
                </div>
              </div>
            </div>

            {/* Monthly Summary */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="noor-card p-4">
                <p className="text-gray-500 text-xs mb-1">Income</p>
                <p className="text-xl font-semibold text-green-600">
                  +{formatCurrency(monthlyIncome)}
                </p>
              </div>
              <div className="noor-card p-4">
                <p className="text-gray-500 text-xs mb-1">Spending</p>
                <p className="text-xl font-semibold text-red-600">
                  -{formatCurrency(monthlySpending)}
                </p>
              </div>
            </div>

            {/* Spending by Category */}
            <div className="noor-card p-5 mb-4">
              <h3 className="font-medium text-black mb-4">Spending by Category</h3>
              <div className="space-y-3">
                {categorySpending.slice(0, 5).map((cat) => (
                  <div key={cat.name} className="flex items-center gap-3">
                    <span className="text-xl w-8">
                      {CATEGORY_ICONS[cat.name] || '💰'}
                    </span>
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-sm text-black">{cat.name}</span>
                        <span className="text-sm font-medium text-black">
                          {formatCurrency(cat.amount)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[cat.name] || '#6B7280' }}
                          initial={{ width: 0 }}
                          animate={{ width: `${(cat.amount / monthlySpending) * 100}%` }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Subscriptions Summary */}
            <div className="noor-card p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-black">Monthly Subscriptions</h3>
                <span className="text-lg font-semibold text-black">
                  {formatCurrency(totalSubscriptions)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {subscriptions.map((sub, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700"
                  >
                    {sub.name} · ${sub.amount}
                  </span>
                ))}
              </div>
            </div>

            {/* Connect More Accounts */}
            {!isConnected && userId && (
              <ConnectBankCard userId={userId} onConnected={handleBankConnected} />
            )}
          </motion.div>
        )}

        {/* Accounts Tab */}
        {activeTab === 'accounts' && (
          <motion.div
            key="accounts"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="space-y-3">
              {accounts.map((account) => (
                <motion.div
                  key={account.id}
                  className="noor-card p-5"
                  whileHover={{ scale: 1.01 }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-black">{account.name}</p>
                      <p className="text-sm text-gray-500">
                        {account.institution_name} · ****{account.mask}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-xl font-semibold ${
                        account.type === 'credit' ? 'text-red-600' : 'text-black'
                      }`}>
                        {account.type === 'credit' ? '-' : ''}
                        {formatCurrency(account.current_balance)}
                      </p>
                      {account.type === 'credit' && account.credit_limit && (
                        <p className="text-xs text-gray-500">
                          of {formatCurrency(account.credit_limit)} limit
                        </p>
                      )}
                      {account.available_balance !== null && account.type !== 'credit' && (
                        <p className="text-xs text-gray-500">
                          {formatCurrency(account.available_balance)} available
                        </p>
                      )}
                    </div>
                  </div>
                  {account.type === 'credit' && account.credit_limit && (
                    <div className="mt-3">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${
                            (account.current_balance / account.credit_limit) > 0.7
                              ? 'bg-red-500'
                              : 'bg-green-500'
                          }`}
                          initial={{ width: 0 }}
                          animate={{
                            width: `${(account.current_balance / account.credit_limit) * 100}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {Math.round((account.current_balance / account.credit_limit) * 100)}% used
                      </p>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>

            {userId && (
              <div className="mt-6">
                <ConnectBankCard userId={userId} onConnected={handleBankConnected} />
              </div>
            )}
          </motion.div>
        )}

        {/* Transactions Tab */}
        {activeTab === 'transactions' && (
          <motion.div
            key="transactions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="space-y-2">
              {transactions.map((txn) => (
                <motion.div
                  key={txn.id}
                  className="noor-card px-4 py-3 flex items-center justify-between"
                  whileHover={{ scale: 1.01 }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">
                      {CATEGORY_ICONS[txn.category[0]] || '💰'}
                    </span>
                    <div>
                      <p className="font-medium text-black text-sm">
                        {txn.merchant_name || txn.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(txn.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                        {txn.pending && ' · Pending'}
                      </p>
                    </div>
                  </div>
                  <p className={`font-semibold ${
                    txn.amount < 0 ? 'text-green-600' : 'text-black'
                  }`}>
                    {txn.amount < 0 ? '+' : '-'}
                    {formatCurrency(Math.abs(txn.amount))}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Subscriptions Tab */}
        {activeTab === 'subscriptions' && (
          <motion.div
            key="subscriptions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {/* Total */}
            <div className="noor-card p-5 mb-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white">
              <p className="text-white/80 text-sm mb-1">Monthly Subscriptions</p>
              <p className="text-3xl font-semibold">{formatCurrency(totalSubscriptions)}/mo</p>
              <p className="text-white/70 text-sm mt-2">
                {formatCurrency(totalSubscriptions * 12)}/year
              </p>
            </div>

            {/* Subscription List */}
            <div className="space-y-2">
              {subscriptions.length > 0 ? (
                subscriptions.map((sub, i) => (
                  <motion.div
                    key={i}
                    className="noor-card p-4 flex items-center justify-between"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                        <span className="text-lg">📱</span>
                      </div>
                      <div>
                        <p className="font-medium text-black">{sub.name}</p>
                        <p className="text-xs text-gray-500">
                          Last charged {new Date(sub.date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <p className="font-semibold text-black">
                      {formatCurrency(sub.amount)}/mo
                    </p>
                  </motion.div>
                ))
              ) : (
                <div className="noor-card p-8 text-center">
                  <p className="text-gray-500">No subscriptions detected</p>
                  <p className="text-gray-400 text-sm mt-1">
                    Connect your accounts to detect subscriptions automatically
                  </p>
                </div>
              )}
            </div>

            {/* Tips */}
            <div className="noor-card p-4 mt-4 bg-blue-50">
              <p className="text-sm text-blue-800">
                💡 Tip: Cancel unused subscriptions to save money. Even $10/month is $120/year!
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageLayout>
  );
}
