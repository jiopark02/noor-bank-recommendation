'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BottomNav } from '@/components/layout';
import { useDeals, Deal } from '@/hooks/useDeals';

// Category definitions
const DEAL_CATEGORIES = [
  { id: 'all', label: 'All', icon: '🎁' },
  { id: 'food', label: 'Food & Drinks', icon: '🍔' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️' },
  { id: 'tech', label: 'Tech', icon: '💻' },
  { id: 'entertainment', label: 'Entertainment', icon: '🎬' },
  { id: 'transport', label: 'Transport', icon: '🚗' },
  { id: 'education', label: 'Education', icon: '📚' },
];

export default function DealsPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [upvotedDeals, setUpvotedDeals] = useState<Set<string>>(new Set());
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [newDeal, setNewDeal] = useState({
    title: '',
    description: '',
    discount_text: '',
    discount_percent: '',
    category: 'food',
    brand: '',
    link: '',
  });

  // Use the API hook
  const { deals, isLoading, refetch } = useDeals({
    category: selectedCategory,
  });

  // Load upvotes from localStorage
  useEffect(() => {
    const upvoted = new Set<string>();
    deals.forEach((deal) => {
      const key = `deal_upvoted_${deal.id}`;
      if (typeof window !== 'undefined' && localStorage.getItem(key)) {
        upvoted.add(deal.id);
      }
    });
    setUpvotedDeals(upvoted);
  }, [deals]);

  const handleUpvote = (dealId: string) => {
    const key = `deal_upvoted_${dealId}`;
    setUpvotedDeals((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(dealId)) {
        newSet.delete(dealId);
        if (typeof window !== 'undefined') localStorage.removeItem(key);
      } else {
        newSet.add(dealId);
        if (typeof window !== 'undefined') localStorage.setItem(key, 'true');
      }
      return newSet;
    });
  };

  const handleSubmitDeal = () => {
    if (!newDeal.title || !newDeal.description || !newDeal.brand) return;

    // TODO: Implement deal submission via API
    console.log('Submitting deal:', newDeal);

    setShowSubmitModal(false);
    setNewDeal({
      title: '',
      description: '',
      discount_text: '',
      discount_percent: '',
      category: 'food',
      brand: '',
      link: '',
    });
    refetch();
  };

  const getCategoryIcon = (categoryId: string) => {
    const cat = DEAL_CATEGORIES.find((c) => c.id === categoryId);
    return cat?.icon || '🎁';
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7] pb-24">
      {/* Header */}
      <div className="bg-white border-b border-[#E8E6E3]">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-light text-[#1A1A1A] tracking-tight">Deals Hub</h1>
            <p className="text-sm text-[#6B6B6B] mt-1">Student Discounts & Local Deals</p>
          </div>
          <button
            onClick={() => setShowSubmitModal(true)}
            className="px-4 py-2 bg-[#1A1A1A] text-white rounded-full text-sm font-medium"
          >
            Submit Deal
          </button>
        </div>

        {/* Categories */}
        <div className="px-4 pb-4 overflow-x-auto">
          <div className="flex gap-2">
            {DEAL_CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  selectedCategory === category.id
                    ? 'bg-[#1A1A1A] text-white'
                    : 'bg-[#F5F4F2] text-[#6B6B6B]'
                }`}
              >
                {category.icon} {category.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Deals Grid */}
      <div className="px-4 py-6">
        {deals.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#6B6B6B]">No deals found in this category</p>
          </div>
        ) : (
          <div className="space-y-3">
            {deals.map((deal, index) => (
              <motion.div
                key={deal.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
              >
                <div className="flex gap-4">
                  {/* Brand Icon */}
                  <div className="w-12 h-12 bg-[#F5F4F2] rounded-xl flex items-center justify-center text-2xl shrink-0">
                    {getCategoryIcon(deal.category)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-medium text-[#1A1A1A] line-clamp-1">{deal.title}</h3>
                        <p className="text-xs text-[#6B6B6B]">{deal.brand}</p>
                      </div>
                      {deal.discount_percent && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium shrink-0">
                          {deal.discount_percent}% off
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-[#6B6B6B] mt-2 line-clamp-2">{deal.description}</p>

                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-[#1A1A1A]">{deal.discount_text}</span>
                        {deal.university_id && (
                          <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                            Local
                          </span>
                        )}
                        {deal.is_verified && (
                          <span className="text-xs text-green-600">✓ Verified</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Upvote */}
                        <button
                          onClick={() => handleUpvote(deal.id)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-all ${
                            upvotedDeals.has(deal.id)
                              ? 'bg-orange-100 text-orange-600'
                              : 'bg-[#F5F4F2] text-[#6B6B6B]'
                          }`}
                        >
                          <svg
                            className={`w-3 h-3 ${upvotedDeals.has(deal.id) ? 'fill-orange-600' : ''}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 15l7-7 7 7"
                            />
                          </svg>
                          {(deal.upvotes || 0) + (upvotedDeals.has(deal.id) ? 1 : 0)}
                        </button>

                        {/* Get Deal */}
                        {deal.link && (
                          <a
                            href={deal.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1 bg-[#1A1A1A] text-white rounded-full text-xs font-medium"
                          >
                            Get Deal
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Submit Deal Modal */}
      <AnimatePresence>
        {showSubmitModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSubmitModal(false)}
              className="fixed inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl p-6 z-50 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-medium text-[#1A1A1A]">Submit a Deal</h2>
                <button onClick={() => setShowSubmitModal(false)} className="text-[#6B6B6B]">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Title */}
              <div className="mb-4">
                <label className="text-sm text-[#6B6B6B] mb-1 block">Deal Title *</label>
                <input
                  type="text"
                  value={newDeal.title}
                  onChange={(e) => setNewDeal({ ...newDeal, title: e.target.value })}
                  placeholder="e.g., Spotify Student Discount"
                  className="w-full px-4 py-3 rounded-xl border border-[#E8E6E3] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                />
              </div>

              {/* Brand */}
              <div className="mb-4">
                <label className="text-sm text-[#6B6B6B] mb-1 block">Brand/Store *</label>
                <input
                  type="text"
                  value={newDeal.brand}
                  onChange={(e) => setNewDeal({ ...newDeal, brand: e.target.value })}
                  placeholder="e.g., Spotify"
                  className="w-full px-4 py-3 rounded-xl border border-[#E8E6E3] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                />
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="text-sm text-[#6B6B6B] mb-1 block">Description *</label>
                <textarea
                  value={newDeal.description}
                  onChange={(e) => setNewDeal({ ...newDeal, description: e.target.value })}
                  placeholder="Describe the deal..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-[#E8E6E3] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A] resize-none"
                />
              </div>

              {/* Discount */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm text-[#6B6B6B] mb-1 block">Discount %</label>
                  <input
                    type="number"
                    value={newDeal.discount_percent}
                    onChange={(e) => setNewDeal({ ...newDeal, discount_percent: e.target.value })}
                    placeholder="50"
                    className="w-full px-4 py-3 rounded-xl border border-[#E8E6E3] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                  />
                </div>
                <div>
                  <label className="text-sm text-[#6B6B6B] mb-1 block">Discount Text</label>
                  <input
                    type="text"
                    value={newDeal.discount_text}
                    onChange={(e) => setNewDeal({ ...newDeal, discount_text: e.target.value })}
                    placeholder="$5.99/month"
                    className="w-full px-4 py-3 rounded-xl border border-[#E8E6E3] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                  />
                </div>
              </div>

              {/* Category */}
              <div className="mb-4">
                <label className="text-sm text-[#6B6B6B] mb-2 block">Category</label>
                <div className="grid grid-cols-4 gap-2">
                  {DEAL_CATEGORIES.filter((c) => c.id !== 'all').map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setNewDeal({ ...newDeal, category: cat.id as Deal['category'] })}
                      className={`p-2 rounded-xl border text-center transition-all ${
                        newDeal.category === cat.id
                          ? 'border-[#1A1A1A] bg-[#FAF9F7]'
                          : 'border-[#E8E6E3]'
                      }`}
                    >
                      <span className="text-lg block">{cat.icon}</span>
                      <span className="text-[10px] text-[#6B6B6B] mt-0.5 block">{cat.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Link */}
              <div className="mb-6">
                <label className="text-sm text-[#6B6B6B] mb-1 block">Link (optional)</label>
                <input
                  type="url"
                  value={newDeal.link}
                  onChange={(e) => setNewDeal({ ...newDeal, link: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-4 py-3 rounded-xl border border-[#E8E6E3] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                />
              </div>

              {/* Submit Button */}
              <button
                onClick={handleSubmitDeal}
                disabled={!newDeal.title || !newDeal.description || !newDeal.brand}
                className="w-full py-4 bg-[#1A1A1A] text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Deal
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}
