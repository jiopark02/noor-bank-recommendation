'use client';

import React, { useState } from 'react';
import { PageLayout, LoadingSpinner } from '@/components/layout';
import { useForum, Post, Comment, FORUM_CATEGORIES } from '@/hooks/useForum';

export default function ForumPage() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { posts, isLoading, error, refetch, createPost, votePost, userVotes, categories } = useForum({
    category: selectedCategory,
  });

  return (
    <PageLayout>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">Forum.</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
        >
          + New Post
        </button>
      </div>

      {/* Category Pills */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 hide-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium flex-shrink-0 transition-all duration-200 ${
              selectedCategory === cat.id
                ? 'bg-black text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <span className="mr-1.5">{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Posts List */}
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="noor-card p-8 text-center">
          <p className="text-gray-500 mb-4">{error}</p>
          <button
            onClick={refetch}
            className="text-black text-sm font-medium hover:underline"
          >
            Try again
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="noor-card p-10 text-center">
          <p className="text-gray-500 text-lg mb-2">No posts yet</p>
          <p className="text-gray-400 text-sm mb-4">Be the first to start a conversation!</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-2.5 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
          >
            Create Post
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              userVote={userVotes[post.id]}
              onVote={(vote) => votePost(post.id, vote)}
              onClick={() => setSelectedPost(post)}
            />
          ))}
        </div>
      )}

      {/* Post Detail Modal */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          userVote={userVotes[selectedPost.id]}
          onVote={(vote) => votePost(selectedPost.id, vote)}
          onClose={() => setSelectedPost(null)}
        />
      )}

      {/* Create Post Modal */}
      {showCreateModal && (
        <CreatePostModal
          categories={categories.filter(c => c.id !== 'all')}
          onSubmit={(data) => {
            createPost(data);
            setShowCreateModal(false);
          }}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </PageLayout>
  );
}

// Post Card Component
interface PostCardProps {
  post: Post;
  userVote?: 'up' | 'down';
  onVote: (vote: 'up' | 'down') => void;
  onClick: () => void;
}

function PostCard({ post, userVote, onVote, onClick }: PostCardProps) {
  const netVotes = post.upvotes - post.downvotes;
  const authorName = post.user
    ? `${post.user.first_name} ${post.user.last_name || ''}`.trim()
    : 'Anonymous';

  return (
    <div className="noor-card p-4 hover:shadow-md transition-shadow">
      <div className="flex gap-3">
        {/* Vote Column */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <button
            onClick={(e) => { e.stopPropagation(); onVote('up'); }}
            className={`p-1 rounded transition-colors ${
              userVote === 'up' ? 'text-orange-500' : 'text-gray-400 hover:text-gray-600'
            }`}
            aria-label="Upvote"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 3a1 1 0 01.707.293l6 6a1 1 0 01-1.414 1.414L10 5.414 4.707 10.707a1 1 0 01-1.414-1.414l6-6A1 1 0 0110 3z" clipRule="evenodd" />
            </svg>
          </button>
          <span className={`text-sm font-semibold ${
            userVote === 'up' ? 'text-orange-500' : userVote === 'down' ? 'text-blue-500' : 'text-gray-700'
          }`}>
            {netVotes}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onVote('down'); }}
            className={`p-1 rounded transition-colors ${
              userVote === 'down' ? 'text-blue-500' : 'text-gray-400 hover:text-gray-600'
            }`}
            aria-label="Downvote"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 17a1 1 0 01-.707-.293l-6-6a1 1 0 011.414-1.414L10 14.586l5.293-5.293a1 1 0 011.414 1.414l-6 6A1 1 0 0110 17z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Content Column */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
          {/* Pinned Badge */}
          {post.is_pinned && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium mb-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              Pinned
            </span>
          )}

          {/* Title */}
          <h3 className="font-semibold text-black leading-snug mb-1 hover:text-gray-700 transition-colors">
            {post.title}
          </h3>

          {/* Content Preview */}
          {post.content && (
            <p className="text-gray-500 text-sm line-clamp-2 mb-2">
              {post.content}
            </p>
          )}

          {/* Meta Info */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <span className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-medium text-gray-500">
                {authorName.charAt(0).toUpperCase()}
              </span>
              {authorName}
            </span>
            <span>{timeAgo(post.created_at)}</span>
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {post.comment_count}
            </span>
            {post.category && (
              <span className="px-2 py-0.5 bg-gray-100 rounded-full capitalize">
                {post.category}
              </span>
            )}
          </div>

          {/* Tags */}
          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {post.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Post Detail Modal
interface PostDetailModalProps {
  post: Post;
  userVote?: 'up' | 'down';
  onVote: (vote: 'up' | 'down') => void;
  onClose: () => void;
}

function PostDetailModal({ post, userVote, onVote, onClose }: PostDetailModalProps) {
  const [newComment, setNewComment] = useState('');
  const netVotes = post.upvotes - post.downvotes;
  const authorName = post.user
    ? `${post.user.first_name} ${post.user.last_name || ''}`.trim()
    : 'Anonymous';

  const handleSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    // In a real app, this would call an API
    alert('Comment feature coming soon! Your comment: ' + newComment);
    setNewComment('');
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-x-0 bottom-0 top-12 bg-white rounded-t-2xl overflow-hidden animate-slide-up md:inset-x-auto md:inset-y-8 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl md:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <button
            onClick={onClose}
            className="p-2 -ml-2 text-gray-500 hover:text-black transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <span className="text-sm text-gray-500">{post.comment_count} comments</span>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-60px)] pb-20">
          <div className="p-4">
            {/* Post Header */}
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
              <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                {authorName.charAt(0).toUpperCase()}
              </span>
              <span className="font-medium text-gray-700">{authorName}</span>
              {post.user?.university && (
                <>
                  <span>·</span>
                  <span>{post.user.university}</span>
                </>
              )}
              <span>·</span>
              <span>{timeAgo(post.created_at)}</span>
            </div>

            {/* Title */}
            <h1 className="text-xl font-bold text-black mb-3">{post.title}</h1>

            {/* Tags */}
            {post.tags && post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {post.tags.map((tag) => (
                  <span key={tag} className="px-2.5 py-1 bg-blue-50 text-blue-600 text-xs rounded-full">
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Content */}
            {post.content && (
              <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap mb-4">
                {post.content}
              </div>
            )}

            {/* Vote Bar */}
            <div className="flex items-center gap-4 py-3 border-y border-gray-100 mb-6">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onVote('up')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full transition-colors ${
                    userVote === 'up'
                      ? 'bg-orange-100 text-orange-600'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 3a1 1 0 01.707.293l6 6a1 1 0 01-1.414 1.414L10 5.414 4.707 10.707a1 1 0 01-1.414-1.414l6-6A1 1 0 0110 3z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm font-medium">Upvote</span>
                </button>
                <span className={`text-sm font-semibold ${
                  userVote === 'up' ? 'text-orange-500' : userVote === 'down' ? 'text-blue-500' : 'text-gray-700'
                }`}>
                  {netVotes}
                </span>
                <button
                  onClick={() => onVote('down')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full transition-colors ${
                    userVote === 'down'
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 17a1 1 0 01-.707-.293l-6-6a1 1 0 011.414-1.414L10 14.586l5.293-5.293a1 1 0 011.414 1.414l-6 6A1 1 0 0110 17z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm font-medium">Downvote</span>
                </button>
              </div>
              <button className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                <span className="text-sm font-medium">Share</span>
              </button>
            </div>

            {/* Comments Section */}
            <h2 className="font-semibold text-black mb-4">
              Comments ({post.comments?.length || 0})
            </h2>

            {/* Comment Input */}
            <form onSubmit={handleSubmitComment} className="mb-6">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="w-full p-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-300"
                rows={3}
              />
              <div className="flex justify-end mt-2">
                <button
                  type="submit"
                  disabled={!newComment.trim()}
                  className="px-4 py-2 bg-black text-white text-sm font-medium rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
                >
                  Comment
                </button>
              </div>
            </form>

            {/* Comments List */}
            {post.comments && post.comments.length > 0 ? (
              <div className="space-y-4">
                {post.comments.map((comment) => (
                  <CommentCard key={comment.id} comment={comment} />
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm text-center py-8">
                No comments yet. Be the first to comment!
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Comment Card Component
function CommentCard({ comment }: { comment: Comment }) {
  const authorName = comment.user
    ? `${comment.user.first_name} ${comment.user.last_name || ''}`.trim()
    : 'Anonymous';

  return (
    <div className="flex gap-3">
      <span className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 flex-shrink-0">
        {authorName.charAt(0).toUpperCase()}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
          <span className="font-medium text-gray-700">{authorName}</span>
          <span>·</span>
          <span>{timeAgo(comment.created_at)}</span>
        </div>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.content}</p>
        <div className="flex items-center gap-3 mt-2">
          <button className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 3a1 1 0 01.707.293l6 6a1 1 0 01-1.414 1.414L10 5.414 4.707 10.707a1 1 0 01-1.414-1.414l6-6A1 1 0 0110 3z" clipRule="evenodd" />
            </svg>
            {comment.upvotes}
          </button>
          <button className="text-xs text-gray-400 hover:text-gray-600">Reply</button>
        </div>
      </div>
    </div>
  );
}

// Create Post Modal
interface CreatePostModalProps {
  categories: typeof FORUM_CATEGORIES;
  onSubmit: (data: { title: string; content?: string; category: string; tags?: string[] }) => void;
  onClose: () => void;
}

function CreatePostModal({ categories, onSubmit, onClose }: CreatePostModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !category) return;

    const tags = tagsInput
      .split(',')
      .map(t => t.trim().toLowerCase().replace(/^#/, ''))
      .filter(t => t.length > 0);

    onSubmit({
      title: title.trim(),
      content: content.trim() || undefined,
      category,
      tags: tags.length > 0 ? tags : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-x-4 top-20 bottom-20 bg-white rounded-2xl overflow-hidden animate-slide-up md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-lg">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <button
            onClick={onClose}
            className="p-2 -ml-2 text-gray-500 hover:text-black transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <h2 className="font-semibold text-black">Create Post</h2>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !category}
            className="px-4 py-1.5 bg-black text-white text-sm font-medium rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
          >
            Post
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto h-[calc(100%-60px)]">
          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category *
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    category === cat.id
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-300"
              maxLength={200}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{title.length}/200</p>
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Details (optional)
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Add more context to your post..."
              className="w-full p-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-300"
              rows={6}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tags (optional)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="banking, visa, tips (comma separated)"
              className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-gray-300"
            />
            <p className="text-xs text-gray-400 mt-1">Separate tags with commas</p>
          </div>
        </form>
      </div>
    </div>
  );
}

// Helper function
function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
