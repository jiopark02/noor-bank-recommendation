'use client';

import React, { useState, useEffect, useRef } from 'react';
import { PageLayout, LoadingSpinner } from '@/components/layout';
import { useForum, Post, Comment, FORUM_CATEGORIES } from '@/hooks/useForum';
import { useSocial, UserProfile, Conversation, Message, formatMessageTime, CURRENT_USER } from '@/hooks/useSocial';

type TabType = 'forum' | 'messages' | 'friends';

export default function ForumPage() {
  const [activeTab, setActiveTab] = useState<TabType>('forum');
  const social = useSocial();

  return (
    <PageLayout>
      {/* Header with Tabs */}
      <div className="mb-6">
        <h1 className="page-title mb-4">Community.</h1>

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          <TabButton
            active={activeTab === 'forum'}
            onClick={() => setActiveTab('forum')}
            label="Forum"
          />
          <TabButton
            active={activeTab === 'messages'}
            onClick={() => setActiveTab('messages')}
            label="Messages"
            badge={social.unreadCount > 0 ? social.unreadCount : undefined}
          />
          <TabButton
            active={activeTab === 'friends'}
            onClick={() => setActiveTab('friends')}
            label="Friends"
            badge={social.friendRequests.length > 0 ? social.friendRequests.length : undefined}
          />
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'forum' && <ForumTab />}
      {activeTab === 'messages' && <MessagesTab social={social} />}
      {activeTab === 'friends' && <FriendsTab social={social} />}
    </PageLayout>
  );
}

// Tab Button Component
function TabButton({ active, onClick, label, badge }: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all relative ${
        active
          ? 'bg-white text-black shadow-sm'
          : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

// ============ FORUM TAB ============
function ForumTab() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { posts, isLoading, error, refetch, createPost, votePost, userVotes, categories } = useForum({
    category: selectedCategory,
  });

  return (
    <>
      {/* Header Actions */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{posts.length} posts</p>
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

      {/* Posts */}
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorCard message={error} onRetry={refetch} />
      ) : posts.length === 0 ? (
        <EmptyState
          title="No posts yet"
          description="Be the first to start a conversation!"
          actionLabel="Create Post"
          onAction={() => setShowCreateModal(true)}
        />
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

      {/* Modals */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          userVote={userVotes[selectedPost.id]}
          onVote={(vote) => votePost(selectedPost.id, vote)}
          onClose={() => setSelectedPost(null)}
        />
      )}

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
    </>
  );
}

// ============ MESSAGES TAB ============
function MessagesTab({ social }: { social: ReturnType<typeof useSocial> }) {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);

  const handleSelectConversation = (conv: Conversation) => {
    setSelectedConversation(conv);
    social.markAsRead(conv.id);
  };

  if (selectedConversation) {
    return (
      <ChatView
        conversation={selectedConversation}
        social={social}
        onBack={() => setSelectedConversation(null)}
      />
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{social.conversations.length} conversations</p>
        <button
          onClick={() => setShowNewMessageModal(true)}
          className="px-4 py-2 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
        >
          + New Message
        </button>
      </div>

      {/* Conversations List */}
      {social.conversations.length === 0 ? (
        <EmptyState
          title="No messages yet"
          description="Start a conversation with someone!"
          actionLabel="New Message"
          onAction={() => setShowNewMessageModal(true)}
        />
      ) : (
        <div className="space-y-2">
          {social.conversations.map((conv) => {
            const otherUserId = conv.participants.find(p => p !== 'current_user')!;
            const otherUser = social.getUserById(otherUserId);
            const isUnread = conv.last_message && !conv.last_message.read && conv.last_message.sender_id !== 'current_user';

            return (
              <button
                key={conv.id}
                onClick={() => handleSelectConversation(conv)}
                className={`w-full flex items-center gap-3 p-4 rounded-2xl text-left transition-all ${
                  isUnread ? 'bg-blue-50 border border-blue-100' : 'bg-white border border-gray-100 hover:border-gray-200'
                }`}
              >
                {/* Avatar */}
                <div className="relative">
                  <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-medium">
                    {otherUser?.first_name.charAt(0).toUpperCase()}
                  </div>
                  {otherUser?.is_online && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`font-medium ${isUnread ? 'text-black' : 'text-gray-900'}`}>
                      {otherUser?.first_name} {otherUser?.last_name}
                    </span>
                    {conv.last_message && (
                      <span className="text-xs text-gray-400">
                        {formatMessageTime(conv.last_message.created_at)}
                      </span>
                    )}
                  </div>
                  {conv.last_message && (
                    <p className={`text-sm truncate ${isUnread ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                      {conv.last_message.sender_id === 'current_user' ? 'You: ' : ''}
                      {conv.last_message.content}
                    </p>
                  )}
                </div>

                {/* Unread indicator */}
                {isUnread && (
                  <div className="w-2.5 h-2.5 bg-blue-500 rounded-full flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* New Message Modal */}
      {showNewMessageModal && (
        <NewMessageModal
          users={social.users}
          friends={social.friends}
          onSelect={(user) => {
            const conv = social.createConversation(user.id);
            setSelectedConversation(conv);
            setShowNewMessageModal(false);
          }}
          onClose={() => setShowNewMessageModal(false)}
        />
      )}
    </>
  );
}

// Chat View Component
function ChatView({ conversation, social, onBack }: {
  conversation: Conversation;
  social: ReturnType<typeof useSocial>;
  onBack: () => void;
}) {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const otherUserId = conversation.participants.find(p => p !== 'current_user')!;
  const otherUser = social.getUserById(otherUserId);

  useEffect(() => {
    setMessages(social.getMessages(conversation.id));
  }, [conversation.id, social]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!message.trim()) return;
    const newMsg = social.sendMessage(conversation.id, message.trim());
    setMessages(prev => [...prev, newMsg]);
    setMessage('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-220px)]">
      {/* Chat Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100 mb-4">
        <button
          onClick={onBack}
          className="p-2 -ml-2 text-gray-500 hover:text-black transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-medium">
            {otherUser?.first_name.charAt(0).toUpperCase()}
          </div>
          {otherUser?.is_online && (
            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full" />
          )}
        </div>
        <div>
          <p className="font-medium text-black">
            {otherUser?.first_name} {otherUser?.last_name}
          </p>
          <p className="text-xs text-gray-400">
            {otherUser?.is_online ? 'Online' : `Last seen ${formatMessageTime(otherUser?.last_seen || '')}`}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.map((msg) => {
          const isMe = msg.sender_id === 'current_user';
          return (
            <div
              key={msg.id}
              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-4 py-2.5 rounded-2xl ${
                  isMe
                    ? 'bg-black text-white rounded-br-md'
                    : 'bg-gray-100 text-gray-800 rounded-bl-md'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                <p className={`text-[10px] mt-1 ${isMe ? 'text-gray-400' : 'text-gray-400'}`}>
                  {formatMessageTime(msg.created_at)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="flex items-end gap-2 pt-4 border-t border-gray-100">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
          className="flex-1 p-3 bg-gray-100 rounded-2xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-black/5"
          rows={1}
          style={{ minHeight: '44px', maxHeight: '120px' }}
        />
        <button
          onClick={handleSend}
          disabled={!message.trim()}
          className="p-3 bg-black text-white rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// New Message Modal
function NewMessageModal({ users, friends, onSelect, onClose }: {
  users: UserProfile[];
  friends: UserProfile[];
  onSelect: (user: UserProfile) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const filteredUsers = users.filter(u =>
    `${u.first_name} ${u.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  const friendIds = friends.map(f => f.id);
  const friendsList = filteredUsers.filter(u => friendIds.includes(u.id));
  const othersList = filteredUsers.filter(u => !friendIds.includes(u.id));

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="fixed inset-x-4 top-20 bottom-20 bg-white rounded-2xl overflow-hidden animate-slide-up md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-md">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <button onClick={onClose} className="p-2 -ml-2 text-gray-500 hover:text-black">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="font-semibold text-black">New Message</h2>
            <div className="w-9" />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people..."
            className="w-full p-3 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
          />
        </div>

        {/* Users List */}
        <div className="overflow-y-auto h-[calc(100%-120px)] p-4">
          {friendsList.length > 0 && (
            <>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-2">Friends</p>
              <div className="space-y-1 mb-4">
                {friendsList.map(user => (
                  <UserListItem key={user.id} user={user} onClick={() => onSelect(user)} />
                ))}
              </div>
            </>
          )}

          {othersList.length > 0 && (
            <>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-2">Others</p>
              <div className="space-y-1">
                {othersList.map(user => (
                  <UserListItem key={user.id} user={user} onClick={() => onSelect(user)} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ FRIENDS TAB ============
function FriendsTab({ social }: { social: ReturnType<typeof useSocial> }) {
  const [view, setView] = useState<'friends' | 'requests' | 'discover'>('friends');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  return (
    <>
      {/* Sub-tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setView('friends')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            view === 'friends' ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          My Friends ({social.friends.length})
        </button>
        <button
          onClick={() => setView('requests')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors relative ${
            view === 'requests' ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          Requests
          {social.friendRequests.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {social.friendRequests.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setView('discover')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            view === 'discover' ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          Discover
        </button>
      </div>

      {/* Friends List */}
      {view === 'friends' && (
        social.friends.length === 0 ? (
          <EmptyState
            title="No friends yet"
            description="Discover people and send friend requests!"
            actionLabel="Discover People"
            onAction={() => setView('discover')}
          />
        ) : (
          <div className="space-y-2">
            {social.friends.map(friend => (
              <FriendCard
                key={friend.id}
                user={friend}
                onClick={() => setSelectedUser(friend)}
                onMessage={() => {
                  const conv = social.createConversation(friend.id);
                  // Would navigate to messages - for now show alert
                }}
                isFriend
                onRemoveFriend={() => social.removeFriend(friend.id)}
              />
            ))}
          </div>
        )
      )}

      {/* Friend Requests */}
      {view === 'requests' && (
        social.friendRequests.length === 0 ? (
          <EmptyState
            title="No pending requests"
            description="When someone sends you a friend request, it will appear here."
          />
        ) : (
          <div className="space-y-2">
            {social.friendRequests.map(request => {
              const fromUser = social.getUserById(request.from_user_id);
              if (!fromUser) return null;

              return (
                <div
                  key={request.id}
                  className="flex items-center gap-3 p-4 bg-white border border-gray-100 rounded-2xl"
                >
                  <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-medium">
                    {fromUser.first_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-black">
                      {fromUser.first_name} {fromUser.last_name}
                    </p>
                    <p className="text-xs text-gray-400">@{fromUser.username}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => social.acceptFriendRequest(request.id)}
                      className="px-4 py-2 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-800"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => social.declineFriendRequest(request.id)}
                      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-full hover:bg-gray-200"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Discover */}
      {view === 'discover' && (
        <div className="space-y-2">
          {social.users.filter(u => !social.isFriend(u.id)).map(user => (
            <FriendCard
              key={user.id}
              user={user}
              onClick={() => setSelectedUser(user)}
              onAddFriend={() => social.addFriend(user.id)}
              isFriend={false}
            />
          ))}
        </div>
      )}

      {/* User Profile Modal */}
      {selectedUser && (
        <UserProfileModal
          user={selectedUser}
          isFriend={social.isFriend(selectedUser.id)}
          onAddFriend={() => social.addFriend(selectedUser.id)}
          onRemoveFriend={() => social.removeFriend(selectedUser.id)}
          onMessage={() => {
            social.createConversation(selectedUser.id);
          }}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </>
  );
}

// Friend Card Component
function FriendCard({ user, onClick, onMessage, onAddFriend, onRemoveFriend, isFriend }: {
  user: UserProfile;
  onClick: () => void;
  onMessage?: () => void;
  onAddFriend?: () => void;
  onRemoveFriend?: () => void;
  isFriend: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-4 bg-white border border-gray-100 rounded-2xl hover:border-gray-200 transition-all">
      <button onClick={onClick} className="flex items-center gap-3 flex-1 text-left">
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-medium">
            {user.first_name.charAt(0).toUpperCase()}
          </div>
          {user.is_online && (
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-black">{user.first_name} {user.last_name}</p>
          <p className="text-xs text-gray-400">@{user.username} · {user.university}</p>
        </div>
      </button>

      <div className="flex gap-2">
        {isFriend ? (
          <>
            {onMessage && (
              <button
                onClick={onMessage}
                className="p-2 text-gray-500 hover:text-black transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
            )}
            {onRemoveFriend && (
              <button
                onClick={onRemoveFriend}
                className="px-3 py-1.5 text-red-500 text-sm font-medium hover:bg-red-50 rounded-full transition-colors"
              >
                Remove
              </button>
            )}
          </>
        ) : (
          onAddFriend && (
            <button
              onClick={onAddFriend}
              className="px-4 py-1.5 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-800"
            >
              Add Friend
            </button>
          )
        )}
      </div>
    </div>
  );
}

// User Profile Modal
function UserProfileModal({ user, isFriend, onAddFriend, onRemoveFriend, onMessage, onClose }: {
  user: UserProfile;
  isFriend: boolean;
  onAddFriend: () => void;
  onRemoveFriend: () => void;
  onMessage: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="fixed inset-x-4 bottom-0 bg-white rounded-t-2xl overflow-hidden animate-slide-up max-h-[80vh]">
        {/* Header */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="p-6">
          {/* Profile Info */}
          <div className="flex items-center gap-4 mb-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-2xl font-medium text-gray-600">
                {user.first_name.charAt(0).toUpperCase()}
              </div>
              {user.is_online && (
                <div className="absolute bottom-1 right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-black">{user.first_name} {user.last_name}</h2>
              <p className="text-gray-500">@{user.username}</p>
              <p className="text-sm text-gray-400 mt-1">{user.university}</p>
            </div>
          </div>

          {/* Bio */}
          {user.bio && (
            <div className="mb-6">
              <p className="text-gray-600">{user.bio}</p>
            </div>
          )}

          {/* Details */}
          <div className="space-y-2 mb-6">
            {user.major && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                {user.major} · {user.year}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => {
                onMessage();
                onClose();
              }}
              className="flex-1 py-3 bg-black text-white font-medium rounded-xl hover:bg-gray-800 transition-colors"
            >
              Message
            </button>
            {isFriend ? (
              <button
                onClick={() => {
                  onRemoveFriend();
                  onClose();
                }}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-medium rounded-xl hover:bg-gray-200 transition-colors"
              >
                Remove Friend
              </button>
            ) : (
              <button
                onClick={() => {
                  onAddFriend();
                  onClose();
                }}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-medium rounded-xl hover:bg-gray-200 transition-colors"
              >
                Add Friend
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ SHARED COMPONENTS ============

function UserListItem({ user, onClick }: { user: UserProfile; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
    >
      <div className="relative">
        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-medium">
          {user.first_name.charAt(0).toUpperCase()}
        </div>
        {user.is_online && (
          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full" />
        )}
      </div>
      <div>
        <p className="font-medium text-black text-sm">{user.first_name} {user.last_name}</p>
        <p className="text-xs text-gray-400">@{user.username}</p>
      </div>
    </button>
  );
}

function EmptyState({ title, description, actionLabel, onAction }: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="noor-card p-10 text-center">
      <p className="text-gray-500 text-lg mb-2">{title}</p>
      <p className="text-gray-400 text-sm mb-4">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="px-6 py-2.5 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="noor-card p-8 text-center">
      <p className="text-gray-500 mb-4">{message}</p>
      <button
        onClick={onRetry}
        className="text-black text-sm font-medium hover:underline"
      >
        Try again
      </button>
    </div>
  );
}

// ============ POST COMPONENTS (from original) ============

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
        <div className="flex flex-col items-center gap-1 pt-1">
          <button
            onClick={(e) => { e.stopPropagation(); onVote('up'); }}
            className={`p-1 rounded transition-colors ${
              userVote === 'up' ? 'text-orange-500' : 'text-gray-400 hover:text-gray-600'
            }`}
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
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 17a1 1 0 01-.707-.293l-6-6a1 1 0 011.414-1.414L10 14.586l5.293-5.293a1 1 0 011.414 1.414l-6 6A1 1 0 0110 17z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
          {post.is_pinned && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium mb-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              Pinned
            </span>
          )}

          <h3 className="font-semibold text-black leading-snug mb-1 hover:text-gray-700 transition-colors">
            {post.title}
          </h3>

          {post.content && (
            <p className="text-gray-500 text-sm line-clamp-2 mb-2">{post.content}</p>
          )}

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
          </div>

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

function PostDetailModal({ post, userVote, onVote, onClose }: {
  post: Post;
  userVote?: 'up' | 'down';
  onVote: (vote: 'up' | 'down') => void;
  onClose: () => void;
}) {
  const [newComment, setNewComment] = useState('');
  const netVotes = post.upvotes - post.downvotes;
  const authorName = post.user
    ? `${post.user.first_name} ${post.user.last_name || ''}`.trim()
    : 'Anonymous';

  const handleSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    alert('Comment feature coming soon! Your comment: ' + newComment);
    setNewComment('');
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 top-12 bg-white rounded-t-2xl overflow-hidden animate-slide-up">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <button onClick={onClose} className="p-2 -ml-2 text-gray-500 hover:text-black">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <span className="text-sm text-gray-500">{post.comment_count} comments</span>
        </div>

        <div className="overflow-y-auto h-[calc(100%-60px)] pb-20">
          <div className="p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
              <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                {authorName.charAt(0).toUpperCase()}
              </span>
              <span className="font-medium text-gray-700">{authorName}</span>
              <span>·</span>
              <span>{timeAgo(post.created_at)}</span>
            </div>

            <h1 className="text-xl font-bold text-black mb-3">{post.title}</h1>

            {post.tags && post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {post.tags.map((tag) => (
                  <span key={tag} className="px-2.5 py-1 bg-blue-50 text-blue-600 text-xs rounded-full">
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {post.content && (
              <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap mb-4">
                {post.content}
              </div>
            )}

            <div className="flex items-center gap-4 py-3 border-y border-gray-100 mb-6">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onVote('up')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full transition-colors ${
                    userVote === 'up' ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                    userVote === 'down' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 17a1 1 0 01-.707-.293l-6-6a1 1 0 011.414-1.414L10 14.586l5.293-5.293a1 1 0 011.414 1.414l-6 6A1 1 0 0110 17z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm font-medium">Downvote</span>
                </button>
              </div>
            </div>

            <h2 className="font-semibold text-black mb-4">Comments ({post.comments?.length || 0})</h2>

            <form onSubmit={handleSubmitComment} className="mb-6">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="w-full p-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-black/5"
                rows={3}
              />
              <div className="flex justify-end mt-2">
                <button
                  type="submit"
                  disabled={!newComment.trim()}
                  className="px-4 py-2 bg-black text-white text-sm font-medium rounded-full disabled:opacity-40 hover:bg-gray-800"
                >
                  Comment
                </button>
              </div>
            </form>

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

function CreatePostModal({ categories, onSubmit, onClose }: {
  categories: typeof FORUM_CATEGORIES;
  onSubmit: (data: { title: string; content?: string; category: string; tags?: string[] }) => void;
  onClose: () => void;
}) {
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
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="fixed inset-x-4 top-20 bottom-20 bg-white rounded-2xl overflow-hidden animate-slide-up">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <button onClick={onClose} className="p-2 -ml-2 text-gray-500 hover:text-black">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <h2 className="font-semibold text-black">Create Post</h2>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !category}
            className="px-4 py-1.5 bg-black text-white text-sm font-medium rounded-full disabled:opacity-40 hover:bg-gray-800"
          >
            Post
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto h-[calc(100%-60px)]">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category *</label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    category === cat.id ? 'bg-black text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
              maxLength={200}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{title.length}/200</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Details (optional)</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Add more context to your post..."
              className="w-full p-3 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-black/5"
              rows={6}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tags (optional)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="banking, visa, tips (comma separated)"
              className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
            />
          </div>
        </form>
      </div>
    </div>
  );
}

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
