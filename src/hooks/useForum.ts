import { useState, useEffect, useCallback } from 'react';

export interface Post {
  id: string;
  user_id: string | null;
  title: string;
  content: string | null;
  category: string | null;
  tags: string[] | null;
  upvotes: number;
  comment_count: number;
  is_pinned: boolean;
  created_at: string;
  users?: {
    first_name: string;
    last_name: string | null;
    profile_picture: string | null;
  } | null;
}

interface UseForumOptions {
  limit?: number;
  category?: string | null;
  autoFetch?: boolean;
}

interface UseForumReturn {
  posts: Post[];
  isLoading: boolean;
  error: string | null;
  total: number;
  refetch: () => Promise<void>;
  createPost: (post: { title: string; content?: string; category?: string; tags?: string[] }) => Promise<void>;
}

export function useForum({
  limit = 20,
  category = null,
  autoFetch = true,
}: UseForumOptions = {}): UseForumReturn {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchPosts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      if (category) params.set('category', category);

      const response = await fetch(`/api/forum?${params}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch posts');
      }

      const data = await response.json();
      setPosts(data.data);
      setTotal(data.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setPosts([]);
    } finally {
      setIsLoading(false);
    }
  }, [limit, category]);

  useEffect(() => {
    if (autoFetch) {
      fetchPosts();
    }
  }, [autoFetch, fetchPosts]);

  const createPost = useCallback(async (post: { title: string; content?: string; category?: string; tags?: string[] }) => {
    try {
      const response = await fetch('/api/forum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(post),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create post');
      }

      await fetchPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  }, [fetchPosts]);

  return {
    posts,
    isLoading,
    error,
    total,
    refetch: fetchPosts,
    createPost,
  };
}
