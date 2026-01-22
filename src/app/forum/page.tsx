'use client';

import React, { useState } from 'react';
import { PageLayout, LoadingSpinner } from '@/components/layout';
import { useForum, Post } from '@/hooks/useForum';

const INTEREST_CATEGORIES = [
  { id: 'networking', label: 'Networking' },
  { id: 'finance', label: 'Finance' },
  { id: 'housing', label: 'Housing' },
  { id: 'career', label: 'Career' },
  { id: 'social', label: 'Social' },
  { id: 'academic', label: 'Academic' },
];

export default function ForumPage() {
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [showFeed, setShowFeed] = useState(false);

  const { posts, isLoading, error, refetch } = useForum({
    limit: 20,
    autoFetch: showFeed,
  });

  const toggleInterest = (id: string) => {
    setSelectedInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const canContinue = selectedInterests.length >= 3;

  const handleContinue = () => {
    if (canContinue) {
      setShowFeed(true);
    }
  };

  if (showFeed) {
    return (
      <PageLayout>
        <div className="flex items-center justify-between mb-8">
          <h1 className="page-title">Forum.</h1>
          <button
            onClick={() => setShowFeed(false)}
            className="text-sm text-gray-400 border-b border-gray-300 hover:border-black hover:text-black transition-all duration-300"
          >
            Edit interests
          </button>
        </div>

        {/* Category Pills */}
        <div className="flex gap-2.5 mb-8 overflow-x-auto pb-2 hide-scrollbar">
          <button className="px-4 py-2.5 rounded-full text-sm font-medium bg-black text-white flex-shrink-0">
            All
          </button>
          {selectedInterests.map((interest) => (
            <button
              key={interest}
              className="px-4 py-2.5 rounded-full text-sm font-medium bg-white text-black border-[1.5px] border-gray-200 hover:border-black transition-all duration-300 flex-shrink-0"
            >
              {INTEREST_CATEGORIES.find((c) => c.id === interest)?.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="noor-card p-8 text-center">
            <p className="text-gray-500 mb-5">Failed to load posts</p>
            <button onClick={refetch} className="text-black text-sm border-b border-gray-300 hover:border-black transition-colors duration-300">
              Try again
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div className="noor-card p-10 text-center">
            <p className="text-gray-500">No posts yet.</p>
            <p className="text-gray-400 text-sm mt-2">Be the first to start a conversation.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {/* Header */}
      <div className="text-center mb-12 pt-8 animate-fade-in">
        <h1 className="page-title">Your interests.</h1>
        <p className="page-subtitle mt-2">We'll curate your feed.</p>
      </div>

      <p className="text-gray-400 text-sm mb-5">Pick 3 or more.</p>

      {/* Interest Grid */}
      <div className="grid grid-cols-3 gap-3 mb-10">
        {INTEREST_CATEGORIES.map((category) => {
          const isSelected = selectedInterests.includes(category.id);
          return (
            <button
              key={category.id}
              onClick={() => toggleInterest(category.id)}
              className={`aspect-square rounded-2xl border-[1.5px] flex items-center justify-center font-medium transition-all duration-300 ${
                isSelected
                  ? 'border-black bg-black text-white'
                  : 'border-gray-200 bg-white text-black hover:border-gray-400'
              }`}
            >
              {category.label}
            </button>
          );
        })}
      </div>

      {/* Continue Button */}
      <button
        onClick={handleContinue}
        disabled={!canContinue}
        className={`btn-primary w-full ${!canContinue ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        Continue ({selectedInterests.length}/3)
      </button>
    </PageLayout>
  );
}

function PostCard({ post }: { post: Post }) {
  const authorName = post.users
    ? `${post.users.first_name} ${post.users.last_name || ''}`.trim()
    : 'Anonymous';

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <button className="w-full text-left noor-card p-6 transition-all duration-300 group">
      <div className="flex items-start gap-4">
        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
          {post.users?.profile_picture ? (
            <img
              src={post.users.profile_picture}
              alt={authorName}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <span className="text-gray-400 text-xs font-medium">
              {authorName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-black group-hover:opacity-70 transition-opacity duration-300">{post.title}</h3>
          {post.content && (
            <p className="text-gray-500 text-sm mt-2 line-clamp-2">{post.content}</p>
          )}
          <div className="flex items-center gap-3 mt-3 text-gray-400 text-xs">
            <span>{authorName}</span>
            <span>·</span>
            <span>{timeAgo(post.created_at)}</span>
            {post.comment_count > 0 && (
              <>
                <span>·</span>
                <span>{post.comment_count} replies</span>
              </>
            )}
          </div>
        </div>
      </div>
      {post.tags && post.tags.length > 0 && (
        <div className="flex gap-2 mt-4 ml-13">
          {post.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="badge text-xs">
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
