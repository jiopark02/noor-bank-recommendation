import { useState, useEffect, useCallback } from 'react';
import {
  UserProfile,
  Conversation,
  Message,
  FriendRequest,
  CURRENT_USER,
  getUserById,
  getAllUsers,
  getFriends,
  addFriend,
  removeFriend,
  isFriend,
  getFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  getConversations,
  getConversationById,
  getConversationWithUser,
  getMessages,
  sendMessage,
  createConversation,
  markConversationAsRead,
  getUnreadCount,
} from '@/lib/socialData';

export type { UserProfile, Conversation, Message, FriendRequest } from '@/lib/socialData';
export { formatMessageTime, CURRENT_USER } from '@/lib/socialData';

interface UseSocialReturn {
  // Current user
  currentUser: UserProfile;

  // Users
  users: UserProfile[];
  getUserById: (id: string) => UserProfile | undefined;

  // Friends
  friends: UserProfile[];
  friendRequests: FriendRequest[];
  isFriend: (userId: string) => boolean;
  addFriend: (userId: string) => void;
  removeFriend: (userId: string) => void;
  sendFriendRequest: (userId: string) => void;
  acceptFriendRequest: (requestId: string) => void;
  declineFriendRequest: (requestId: string) => void;

  // Conversations & Messages
  conversations: Conversation[];
  unreadCount: number;
  getConversation: (id: string) => Conversation | undefined;
  getConversationWithUser: (userId: string) => Conversation | undefined;
  getMessages: (conversationId: string) => Message[];
  sendMessage: (conversationId: string, content: string) => Message;
  createConversation: (withUserId: string) => Conversation;
  markAsRead: (conversationId: string) => void;

  // Refresh
  refresh: () => void;
}

export function useSocial(): UseSocialReturn {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadData = useCallback(() => {
    const allUsers = getAllUsers();
    setUsers(allUsers);

    const friendIds = getFriends();
    setFriends(allUsers.filter(u => friendIds.includes(u.id)));

    setFriendRequests(getFriendRequests().filter(r => r.status === 'pending'));
    setConversations(getConversations());
    setUnreadCount(getUnreadCount());
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddFriend = useCallback((userId: string) => {
    addFriend(userId);
    loadData();
  }, [loadData]);

  const handleRemoveFriend = useCallback((userId: string) => {
    removeFriend(userId);
    loadData();
  }, [loadData]);

  const handleSendFriendRequest = useCallback((userId: string) => {
    sendFriendRequest(userId);
    loadData();
  }, [loadData]);

  const handleAcceptFriendRequest = useCallback((requestId: string) => {
    acceptFriendRequest(requestId);
    loadData();
  }, [loadData]);

  const handleDeclineFriendRequest = useCallback((requestId: string) => {
    declineFriendRequest(requestId);
    loadData();
  }, [loadData]);

  const handleSendMessage = useCallback((conversationId: string, content: string) => {
    const message = sendMessage(conversationId, content);
    loadData();
    return message;
  }, [loadData]);

  const handleCreateConversation = useCallback((withUserId: string) => {
    const conv = createConversation(withUserId);
    loadData();
    return conv;
  }, [loadData]);

  const handleMarkAsRead = useCallback((conversationId: string) => {
    markConversationAsRead(conversationId);
    loadData();
  }, [loadData]);

  return {
    currentUser: CURRENT_USER,
    users,
    getUserById,
    friends,
    friendRequests,
    isFriend,
    addFriend: handleAddFriend,
    removeFriend: handleRemoveFriend,
    sendFriendRequest: handleSendFriendRequest,
    acceptFriendRequest: handleAcceptFriendRequest,
    declineFriendRequest: handleDeclineFriendRequest,
    conversations,
    unreadCount,
    getConversation: getConversationById,
    getConversationWithUser,
    getMessages,
    sendMessage: handleSendMessage,
    createConversation: handleCreateConversation,
    markAsRead: handleMarkAsRead,
    refresh: loadData,
  };
}
