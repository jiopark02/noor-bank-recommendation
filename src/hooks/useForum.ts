import { useState, useEffect, useCallback } from 'react';
import {
  getPosts,
  getPostById,
  getUserPosts,
  saveUserPost,
  getUserVotes,
  saveUserVote,
  Post,
  Comment,
  FORUM_CATEGORIES,
} from '@/lib/forumData';

export type { Post, Comment } from '@/lib/forumData';
export { FORUM_CATEGORIES } from '@/lib/forumData';

interface UseForumOptions {
  category?: string;
  autoFetch?: boolean;
}

interface UseForumReturn {
  posts: Post[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  createPost: (post: { title: string; content?: string; category: string; tags?: string[] }) => Post;
  getPost: (id: string) => Post | undefined;
  votePost: (postId: string, vote: 'up' | 'down') => void;
  userVotes: Record<string, 'up' | 'down'>;
  categories: typeof FORUM_CATEGORIES;
}

export function useForum({
  category = 'all',
  autoFetch = true,
}: UseForumOptions = {}): UseForumReturn {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userVotes, setUserVotes] = useState<Record<string, 'up' | 'down'>>({});

  const fetchPosts = useCallback(() => {
    setIsLoading(true);
    setError(null);

    try {
      // Get mock posts + user's own posts
      const mockPosts = getPosts(category);
      const userPosts = getUserPosts();

      // Filter user posts by category if needed
      const filteredUserPosts = category === 'all'
        ? userPosts
        : userPosts.filter(p => p.category === category);

      // Combine and sort
      const allPosts = [...filteredUserPosts, ...mockPosts];

      // Sort by pinned first, then by date (newest first for user posts)
      allPosts.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        // User posts (with user_ prefix) should appear at top
        if (a.id.startsWith('user_') && !b.id.startsWith('user_')) return -1;
        if (!a.id.startsWith('user_') && b.id.startsWith('user_')) return 1;
        return b.upvotes - a.upvotes;
      });

      setPosts(allPosts);
      setUserVotes(getUserVotes());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts');
      setPosts([]);
    } finally {
      setIsLoading(false);
    }
  }, [category]);

  useEffect(() => {
    if (autoFetch) {
      // Simulate network delay for realism
      const timer = setTimeout(fetchPosts, 300);
      return () => clearTimeout(timer);
    }
  }, [autoFetch, fetchPosts]);

  const createPost = useCallback((postData: { title: string; content?: string; category: string; tags?: string[] }): Post => {
    const newPost = saveUserPost({
      user_id: 'current_user',
      title: postData.title,
      content: postData.content || null,
      category: postData.category,
      tags: postData.tags || [],
    });

    // Add to local state immediately
    setPosts(prev => [newPost, ...prev]);

    return newPost;
  }, []);

  const getPost = useCallback((id: string): Post | undefined => {
    // Check user posts first
    const userPosts = getUserPosts();
    const userPost = userPosts.find(p => p.id === id);
    if (userPost) return userPost;

    // Then check mock posts
    return getPostById(id);
  }, []);

  const votePost = useCallback((postId: string, vote: 'up' | 'down') => {
    const currentVote = userVotes[postId];

    // Toggle vote if same, otherwise set new vote
    const newVote = currentVote === vote ? null : vote;
    saveUserVote(postId, newVote);

    // Update local state
    setUserVotes(prev => {
      const updated = { ...prev };
      if (newVote === null) {
        delete updated[postId];
      } else {
        updated[postId] = newVote;
      }
      return updated;
    });

    // Update post votes in local state
    setPosts(prev => prev.map(post => {
      if (post.id !== postId) return post;

      let upvoteDelta = 0;
      let downvoteDelta = 0;

      // Remove old vote
      if (currentVote === 'up') upvoteDelta--;
      if (currentVote === 'down') downvoteDelta--;

      // Add new vote
      if (newVote === 'up') upvoteDelta++;
      if (newVote === 'down') downvoteDelta++;

      return {
        ...post,
        upvotes: post.upvotes + upvoteDelta,
        downvotes: post.downvotes + downvoteDelta,
      };
    }));
  }, [userVotes]);

  return {
    posts,
    isLoading,
    error,
    refetch: fetchPosts,
    createPost,
    getPost,
    votePost,
    userVotes,
    categories: FORUM_CATEGORIES,
  };
}
