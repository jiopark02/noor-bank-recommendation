// Social features data - Friends, Messages, User Profiles

export interface UserProfile {
  id: string;
  first_name: string;
  last_name: string | null;
  username: string;
  bio: string | null;
  university: string;
  major: string | null;
  year: string | null;
  profile_picture: string | null;
  created_at: string;
  is_online: boolean;
  last_seen: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read: boolean;
}

export interface Conversation {
  id: string;
  participants: string[];
  last_message: Message | null;
  created_at: string;
  updated_at: string;
}

export interface FriendRequest {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

// Current user (simulated logged-in user)
export const CURRENT_USER: UserProfile = {
  id: 'current_user',
  first_name: 'You',
  last_name: null,
  username: 'you',
  bio: 'International student navigating life in the US',
  university: 'Stanford',
  major: 'Computer Science',
  year: 'Graduate',
  profile_picture: null,
  created_at: new Date().toISOString(),
  is_online: true,
  last_seen: new Date().toISOString(),
};

// Mock users for the community
export const MOCK_USERS: UserProfile[] = [
  {
    id: 'u1',
    first_name: 'Sarah',
    last_name: 'Chen',
    username: 'sarahchen',
    bio: 'CS grad student | Love hiking and coffee | Here to help fellow intl students!',
    university: 'Stanford',
    major: 'Computer Science',
    year: 'PhD Year 2',
    profile_picture: null,
    created_at: '2025-08-15T10:00:00Z',
    is_online: true,
    last_seen: new Date().toISOString(),
  },
  {
    id: 'u2',
    first_name: 'Raj',
    last_name: 'Patel',
    username: 'rajpatel',
    bio: 'MBA candidate | Former software engineer | Ask me about tech interviews!',
    university: 'UC Berkeley',
    major: 'Business Administration',
    year: 'MBA Year 1',
    profile_picture: null,
    created_at: '2025-07-20T10:00:00Z',
    is_online: false,
    last_seen: '2026-01-23T14:30:00Z',
  },
  {
    id: 'u3',
    first_name: 'Maria',
    last_name: 'Garcia',
    username: 'mariagarcia',
    bio: 'Econ major from Mexico City | Always down to explore new restaurants',
    university: 'USC',
    major: 'Economics',
    year: 'Junior',
    profile_picture: null,
    created_at: '2025-09-01T10:00:00Z',
    is_online: true,
    last_seen: new Date().toISOString(),
  },
  {
    id: 'u4',
    first_name: 'Yuki',
    last_name: 'Tanaka',
    username: 'yukitanaka',
    bio: 'Design student from Tokyo | UI/UX enthusiast | Coffee addict',
    university: 'UCLA',
    major: 'Design Media Arts',
    year: 'Senior',
    profile_picture: null,
    created_at: '2025-06-10T10:00:00Z',
    is_online: false,
    last_seen: '2026-01-23T10:00:00Z',
  },
  {
    id: 'u5',
    first_name: 'Ahmed',
    last_name: 'Hassan',
    username: 'ahmedh',
    bio: 'EE PhD | Research in renewable energy | Soccer fan',
    university: 'Columbia',
    major: 'Electrical Engineering',
    year: 'PhD Year 3',
    profile_picture: null,
    created_at: '2025-05-01T10:00:00Z',
    is_online: true,
    last_seen: new Date().toISOString(),
  },
  {
    id: 'u6',
    first_name: 'Ji-Young',
    last_name: 'Kim',
    username: 'jiyoungkim',
    bio: 'Finance major | K-pop lover | Looking for study buddies',
    university: 'NYU',
    major: 'Finance',
    year: 'Sophomore',
    profile_picture: null,
    created_at: '2025-08-25T10:00:00Z',
    is_online: false,
    last_seen: '2026-01-22T20:00:00Z',
  },
  {
    id: 'u7',
    first_name: 'Lucas',
    last_name: 'Mueller',
    username: 'lucasm',
    bio: 'CS undergrad from Germany | Open source contributor | Board game enthusiast',
    university: 'Cornell',
    major: 'Computer Science',
    year: 'Senior',
    profile_picture: null,
    created_at: '2025-07-15T10:00:00Z',
    is_online: true,
    last_seen: new Date().toISOString(),
  },
  {
    id: 'u8',
    first_name: 'Priya',
    last_name: 'Sharma',
    username: 'priyasharma',
    bio: 'ML researcher | Dog mom | Always happy to chat about grad school life',
    university: 'Stanford',
    major: 'Computer Science',
    year: 'PhD Year 1',
    profile_picture: null,
    created_at: '2025-09-10T10:00:00Z',
    is_online: true,
    last_seen: new Date().toISOString(),
  },
];

// Mock conversations with messages
export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv1',
    participants: ['current_user', 'u1'],
    last_message: {
      id: 'm1_5',
      conversation_id: 'conv1',
      sender_id: 'u1',
      content: 'Let me know if you need any help with the visa stuff!',
      created_at: '2026-01-23T15:30:00Z',
      read: false,
    },
    created_at: '2026-01-20T10:00:00Z',
    updated_at: '2026-01-23T15:30:00Z',
  },
  {
    id: 'conv2',
    participants: ['current_user', 'u3'],
    last_message: {
      id: 'm2_3',
      conversation_id: 'conv2',
      sender_id: 'current_user',
      content: 'Thanks for the housing tips! Really helpful.',
      created_at: '2026-01-22T18:00:00Z',
      read: true,
    },
    created_at: '2026-01-19T14:00:00Z',
    updated_at: '2026-01-22T18:00:00Z',
  },
  {
    id: 'conv3',
    participants: ['current_user', 'u5'],
    last_message: {
      id: 'm3_2',
      conversation_id: 'conv3',
      sender_id: 'u5',
      content: 'Sure, I can share my experience with the OPT application process',
      created_at: '2026-01-21T12:00:00Z',
      read: true,
    },
    created_at: '2026-01-21T10:00:00Z',
    updated_at: '2026-01-21T12:00:00Z',
  },
];

// Mock messages for each conversation
export const MOCK_MESSAGES: Record<string, Message[]> = {
  conv1: [
    {
      id: 'm1_1',
      conversation_id: 'conv1',
      sender_id: 'current_user',
      content: 'Hi Sarah! I saw your post about banking. Which bank did you end up going with?',
      created_at: '2026-01-20T10:00:00Z',
      read: true,
    },
    {
      id: 'm1_2',
      conversation_id: 'conv1',
      sender_id: 'u1',
      content: 'Hey! I went with Chase in the end. Their student account has no fees and Zelle is super convenient.',
      created_at: '2026-01-20T10:15:00Z',
      read: true,
    },
    {
      id: 'm1_3',
      conversation_id: 'conv1',
      sender_id: 'current_user',
      content: 'That sounds great! Did you need SSN to open it?',
      created_at: '2026-01-20T10:20:00Z',
      read: true,
    },
    {
      id: 'm1_4',
      conversation_id: 'conv1',
      sender_id: 'u1',
      content: 'Nope! Just passport, I-20, and proof of address. They were really helpful at the branch near campus.',
      created_at: '2026-01-20T10:30:00Z',
      read: true,
    },
    {
      id: 'm1_5',
      conversation_id: 'conv1',
      sender_id: 'u1',
      content: 'Let me know if you need any help with the visa stuff!',
      created_at: '2026-01-23T15:30:00Z',
      read: false,
    },
  ],
  conv2: [
    {
      id: 'm2_1',
      conversation_id: 'conv2',
      sender_id: 'u3',
      content: 'Hey! Saw you were looking for housing tips. I had some bad experiences so happy to share what to watch out for.',
      created_at: '2026-01-19T14:00:00Z',
      read: true,
    },
    {
      id: 'm2_2',
      conversation_id: 'conv2',
      sender_id: 'current_user',
      content: 'That would be amazing! I\'m a bit worried about scams honestly.',
      created_at: '2026-01-19T14:30:00Z',
      read: true,
    },
    {
      id: 'm2_3',
      conversation_id: 'conv2',
      sender_id: 'current_user',
      content: 'Thanks for the housing tips! Really helpful.',
      created_at: '2026-01-22T18:00:00Z',
      read: true,
    },
  ],
  conv3: [
    {
      id: 'm3_1',
      conversation_id: 'conv3',
      sender_id: 'current_user',
      content: 'Hi Ahmed! I\'m starting to think about OPT. Do you have any advice?',
      created_at: '2026-01-21T10:00:00Z',
      read: true,
    },
    {
      id: 'm3_2',
      conversation_id: 'conv3',
      sender_id: 'u5',
      content: 'Sure, I can share my experience with the OPT application process',
      created_at: '2026-01-21T12:00:00Z',
      read: true,
    },
  ],
};

// Storage keys
const STORAGE_KEY_FRIENDS = 'noor_friends';
const STORAGE_KEY_FRIEND_REQUESTS = 'noor_friend_requests';
const STORAGE_KEY_CONVERSATIONS = 'noor_conversations';
const STORAGE_KEY_MESSAGES = 'noor_messages';

// Get user by ID
export function getUserById(id: string): UserProfile | undefined {
  if (id === 'current_user') return CURRENT_USER;
  return MOCK_USERS.find(u => u.id === id);
}

// Get all users (for discover/search)
export function getAllUsers(): UserProfile[] {
  return MOCK_USERS;
}

// Friends functionality
export function getFriends(): string[] {
  if (typeof window === 'undefined') return ['u1', 'u3', 'u5']; // Default friends
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FRIENDS);
    return stored ? JSON.parse(stored) : ['u1', 'u3', 'u5'];
  } catch {
    return ['u1', 'u3', 'u5'];
  }
}

export function addFriend(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const friends = getFriends();
    if (!friends.includes(userId)) {
      friends.push(userId);
      localStorage.setItem(STORAGE_KEY_FRIENDS, JSON.stringify(friends));
    }
  } catch {
    // Ignore
  }
}

export function removeFriend(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const friends = getFriends();
    const updated = friends.filter(id => id !== userId);
    localStorage.setItem(STORAGE_KEY_FRIENDS, JSON.stringify(updated));
  } catch {
    // Ignore
  }
}

export function isFriend(userId: string): boolean {
  return getFriends().includes(userId);
}

// Friend requests
export function getFriendRequests(): FriendRequest[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FRIEND_REQUESTS);
    return stored ? JSON.parse(stored) : [
      // Default pending requests
      {
        id: 'fr1',
        from_user_id: 'u7',
        to_user_id: 'current_user',
        status: 'pending',
        created_at: '2026-01-22T10:00:00Z',
      },
      {
        id: 'fr2',
        from_user_id: 'u8',
        to_user_id: 'current_user',
        status: 'pending',
        created_at: '2026-01-23T08:00:00Z',
      },
    ];
  } catch {
    return [];
  }
}

export function sendFriendRequest(toUserId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const requests = getFriendRequests();
    const newRequest: FriendRequest = {
      id: `fr_${Date.now()}`,
      from_user_id: 'current_user',
      to_user_id: toUserId,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    requests.push(newRequest);
    localStorage.setItem(STORAGE_KEY_FRIEND_REQUESTS, JSON.stringify(requests));
  } catch {
    // Ignore
  }
}

export function acceptFriendRequest(requestId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const requests = getFriendRequests();
    const request = requests.find(r => r.id === requestId);
    if (request) {
      request.status = 'accepted';
      localStorage.setItem(STORAGE_KEY_FRIEND_REQUESTS, JSON.stringify(requests));
      addFriend(request.from_user_id);
    }
  } catch {
    // Ignore
  }
}

export function declineFriendRequest(requestId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const requests = getFriendRequests();
    const updated = requests.filter(r => r.id !== requestId);
    localStorage.setItem(STORAGE_KEY_FRIEND_REQUESTS, JSON.stringify(updated));
  } catch {
    // Ignore
  }
}

// Conversations and messages
export function getConversations(): Conversation[] {
  if (typeof window === 'undefined') return MOCK_CONVERSATIONS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
    if (stored) {
      const userConvs = JSON.parse(stored) as Conversation[];
      // Merge with mock conversations
      const mockIds = MOCK_CONVERSATIONS.map(c => c.id);
      const newUserConvs = userConvs.filter(c => !mockIds.includes(c.id));
      return [...MOCK_CONVERSATIONS, ...newUserConvs].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    }
    return MOCK_CONVERSATIONS;
  } catch {
    return MOCK_CONVERSATIONS;
  }
}

export function getConversationById(id: string): Conversation | undefined {
  return getConversations().find(c => c.id === id);
}

export function getConversationWithUser(userId: string): Conversation | undefined {
  return getConversations().find(c =>
    c.participants.includes('current_user') && c.participants.includes(userId)
  );
}

export function getMessages(conversationId: string): Message[] {
  if (typeof window === 'undefined') return MOCK_MESSAGES[conversationId] || [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY_MESSAGES);
    if (stored) {
      const allMessages = JSON.parse(stored) as Record<string, Message[]>;
      return allMessages[conversationId] || MOCK_MESSAGES[conversationId] || [];
    }
    return MOCK_MESSAGES[conversationId] || [];
  } catch {
    return MOCK_MESSAGES[conversationId] || [];
  }
}

export function sendMessage(conversationId: string, content: string): Message {
  const newMessage: Message = {
    id: `msg_${Date.now()}`,
    conversation_id: conversationId,
    sender_id: 'current_user',
    content,
    created_at: new Date().toISOString(),
    read: true,
  };

  if (typeof window !== 'undefined') {
    try {
      // Update messages
      const storedMsgs = localStorage.getItem(STORAGE_KEY_MESSAGES);
      const allMessages: Record<string, Message[]> = storedMsgs
        ? JSON.parse(storedMsgs)
        : { ...MOCK_MESSAGES };

      if (!allMessages[conversationId]) {
        allMessages[conversationId] = MOCK_MESSAGES[conversationId] || [];
      }
      allMessages[conversationId].push(newMessage);
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(allMessages));

      // Update conversation
      const conversations = getConversations();
      const conv = conversations.find(c => c.id === conversationId);
      if (conv) {
        conv.last_message = newMessage;
        conv.updated_at = newMessage.created_at;
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(conversations));
      }
    } catch {
      // Ignore
    }
  }

  return newMessage;
}

export function createConversation(withUserId: string): Conversation {
  const existing = getConversationWithUser(withUserId);
  if (existing) return existing;

  const newConv: Conversation = {
    id: `conv_${Date.now()}`,
    participants: ['current_user', withUserId],
    last_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    try {
      const conversations = getConversations();
      conversations.unshift(newConv);
      localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(conversations));
    } catch {
      // Ignore
    }
  }

  return newConv;
}

export function markConversationAsRead(conversationId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const storedMsgs = localStorage.getItem(STORAGE_KEY_MESSAGES);
    const allMessages: Record<string, Message[]> = storedMsgs
      ? JSON.parse(storedMsgs)
      : { ...MOCK_MESSAGES };

    if (allMessages[conversationId]) {
      allMessages[conversationId] = allMessages[conversationId].map(m => ({
        ...m,
        read: true,
      }));
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(allMessages));
    }

    // Also update mock messages display
    if (MOCK_MESSAGES[conversationId]) {
      MOCK_MESSAGES[conversationId].forEach(m => m.read = true);
    }
  } catch {
    // Ignore
  }
}

export function getUnreadCount(): number {
  const conversations = getConversations();
  return conversations.filter(c =>
    c.last_message &&
    !c.last_message.read &&
    c.last_message.sender_id !== 'current_user'
  ).length;
}

// Helper to format time
export function formatMessageTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
