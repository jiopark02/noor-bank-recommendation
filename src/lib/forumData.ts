// Mock forum data for international students community

export interface ForumUser {
  id: string;
  first_name: string;
  last_name: string | null;
  profile_picture: string | null;
  university: string;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  upvotes: number;
  created_at: string;
  user: ForumUser;
  replies?: Comment[];
}

export interface Post {
  id: string;
  user_id: string;
  title: string;
  content: string | null;
  category: string;
  tags: string[];
  upvotes: number;
  downvotes: number;
  comment_count: number;
  is_pinned: boolean;
  created_at: string;
  user: ForumUser;
  comments: Comment[];
}

// Mock users
const MOCK_USERS: ForumUser[] = [
  { id: 'u1', first_name: 'Sarah', last_name: 'Chen', profile_picture: null, university: 'Stanford' },
  { id: 'u2', first_name: 'Raj', last_name: 'Patel', profile_picture: null, university: 'UC Berkeley' },
  { id: 'u3', first_name: 'Maria', last_name: 'Garcia', profile_picture: null, university: 'USC' },
  { id: 'u4', first_name: 'Yuki', last_name: 'Tanaka', profile_picture: null, university: 'UCLA' },
  { id: 'u5', first_name: 'Ahmed', last_name: 'Hassan', profile_picture: null, university: 'Columbia' },
  { id: 'u6', first_name: 'Ji-Young', last_name: 'Kim', profile_picture: null, university: 'NYU' },
  { id: 'u7', first_name: 'Lucas', last_name: 'Mueller', profile_picture: null, university: 'Cornell' },
  { id: 'u8', first_name: 'Priya', last_name: 'Sharma', profile_picture: null, university: 'Stanford' },
  { id: 'u9', first_name: 'Wei', last_name: 'Zhang', profile_picture: null, university: 'UIUC' },
  { id: 'u10', first_name: 'Anonymous', last_name: null, profile_picture: null, university: 'Unknown' },
];

// Helper to get random date within last 30 days
function randomDate(daysAgo: number = 30): string {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * daysAgo));
  date.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
  return date.toISOString();
}

// Mock posts with realistic international student content
export const MOCK_POSTS: Post[] = [
  {
    id: 'p1',
    user_id: 'u1',
    title: 'Best bank for F-1 students without SSN?',
    content: `Hey everyone! I just arrived in the US and need to open a bank account ASAP. I don't have an SSN yet (still waiting for my work authorization).

Which banks have you had the best experience with? I've heard Chase and Bank of America require in-person visits, but some online banks might be easier.

Would love to hear your recommendations!`,
    category: 'finance',
    tags: ['banking', 'f1-visa', 'no-ssn'],
    upvotes: 127,
    downvotes: 3,
    comment_count: 24,
    is_pinned: true,
    created_at: randomDate(2),
    user: MOCK_USERS[0],
    comments: [
      {
        id: 'c1',
        post_id: 'p1',
        user_id: 'u2',
        content: 'I used Chase and they were really helpful! Just bring your passport, I-20, and proof of address. Took about 30 minutes.',
        upvotes: 45,
        created_at: randomDate(1),
        user: MOCK_USERS[1],
      },
      {
        id: 'c2',
        post_id: 'p1',
        user_id: 'u5',
        content: 'Mercury Bank is great for online-only. No SSN needed and you can open it from anywhere. Their app is really clean too.',
        upvotes: 38,
        created_at: randomDate(1),
        user: MOCK_USERS[4],
      },
      {
        id: 'c3',
        post_id: 'p1',
        user_id: 'u8',
        content: `Personally went with Bank of America because they have branches everywhere. The process was smooth - just walked in with my documents and was done in an hour.

Pro tip: Ask for the student checking account, no monthly fees!`,
        upvotes: 29,
        created_at: randomDate(1),
        user: MOCK_USERS[7],
      },
    ],
  },
  {
    id: 'p2',
    user_id: 'u3',
    title: 'Housing scam warning - Be careful on Craigslist!',
    content: `PLEASE READ THIS before you look for housing!

I almost got scammed last week. Someone listed a beautiful apartment near campus for $800/month (way below market). They asked me to wire money before seeing the place because they were "out of the country."

Red flags to watch for:
1. Price too good to be true
2. Landlord can't meet in person
3. Asking for wire transfer or gift cards
4. Pressure to pay deposit immediately
5. Won't let you tour the property

Always use your university's housing portal or verified rental sites. Stay safe everyone!`,
    category: 'housing',
    tags: ['scam-alert', 'housing', 'safety'],
    upvotes: 342,
    downvotes: 2,
    comment_count: 56,
    is_pinned: true,
    created_at: randomDate(5),
    user: MOCK_USERS[2],
    comments: [
      {
        id: 'c4',
        post_id: 'p2',
        user_id: 'u6',
        content: 'Thank you for sharing! I almost fell for a similar scam. Always trust your gut - if it seems too good to be true, it probably is.',
        upvotes: 67,
        created_at: randomDate(4),
        user: MOCK_USERS[5],
      },
      {
        id: 'c5',
        post_id: 'p2',
        user_id: 'u4',
        content: 'Adding to this: NEVER pay anything without seeing the place in person and signing a proper lease agreement. Also verify the landlord owns the property through county records.',
        upvotes: 52,
        created_at: randomDate(4),
        user: MOCK_USERS[3],
      },
    ],
  },
  {
    id: 'p3',
    user_id: 'u4',
    title: 'CPT vs OPT - Can someone explain the difference?',
    content: `I'm confused about work authorization options. My advisor mentioned CPT and OPT but I'm not sure which one I should apply for.

Some questions:
- When can you use each one?
- Do they affect each other?
- Which one is better for internships?

Thanks in advance!`,
    category: 'academic',
    tags: ['cpt', 'opt', 'work-authorization', 'f1-visa'],
    upvotes: 89,
    downvotes: 1,
    comment_count: 31,
    is_pinned: false,
    created_at: randomDate(3),
    user: MOCK_USERS[3],
    comments: [
      {
        id: 'c6',
        post_id: 'p3',
        user_id: 'u7',
        content: `Here's a quick breakdown:

**CPT (Curricular Practical Training)**
- Use DURING your program
- Must be related to your major
- Requires course enrollment
- No limit if part-time (<20 hrs/week)
- Full-time CPT over 12 months = no OPT

**OPT (Optional Practical Training)**
- Use AFTER graduation (mostly)
- 12 months total (+ 24 month STEM extension)
- Apply 90 days before graduation

For internships, CPT is usually better since it's more flexible during school!`,
        upvotes: 124,
        created_at: randomDate(2),
        user: MOCK_USERS[6],
      },
    ],
  },
  {
    id: 'p4',
    user_id: 'u5',
    title: 'Looking for roommates near campus - Spring semester',
    content: `Hi all! I'm looking for 1-2 roommates for a 3BR apartment I found near North campus.

Details:
- Location: 5 min walk to engineering buildings
- Rent: $900/person (utilities included)
- Move-in: January 15th
- Lease: 6 months with option to extend
- Amenities: In-unit laundry, parking, gym

About me: 2nd year CS grad student, quiet, clean, usually in the lab. Looking for someone respectful of shared spaces.

DM me if interested!`,
    category: 'housing',
    tags: ['roommate', 'housing', 'spring-2026'],
    upvotes: 34,
    downvotes: 0,
    comment_count: 12,
    is_pinned: false,
    created_at: randomDate(1),
    user: MOCK_USERS[4],
    comments: [
      {
        id: 'c7',
        post_id: 'p4',
        user_id: 'u9',
        content: 'DMed you! This sounds perfect for what I\'m looking for.',
        upvotes: 3,
        created_at: randomDate(1),
        user: MOCK_USERS[8],
      },
    ],
  },
  {
    id: 'p5',
    user_id: 'u6',
    title: 'Free food on campus this week!',
    content: `Compiled a list of free food events happening this week:

**Monday**
- CS Department seminar (Pizza) - 12pm, Gates Hall

**Tuesday**
- International Student Welcome (Various cuisines) - 5pm, Student Center

**Wednesday**
- Career Fair (Snacks & drinks) - 10am-3pm, Main Gym

**Thursday**
- Graduate Student Social (Tacos!) - 6pm, GSA Lounge

**Friday**
- Research Poster Session (Sandwiches) - 2pm, Engineering Atrium

Save your meal plan swipes, folks! Will update if I find more.`,
    category: 'social',
    tags: ['free-food', 'campus-events', 'student-life'],
    upvotes: 523,
    downvotes: 5,
    comment_count: 89,
    is_pinned: false,
    created_at: randomDate(1),
    user: MOCK_USERS[5],
    comments: [
      {
        id: 'c8',
        post_id: 'p5',
        user_id: 'u1',
        content: 'You\'re doing god\'s work. Following this post!',
        upvotes: 156,
        created_at: randomDate(1),
        user: MOCK_USERS[0],
      },
      {
        id: 'c9',
        post_id: 'p5',
        user_id: 'u3',
        content: 'The career fair snacks are actually pretty good - they had fancy pastries last time!',
        upvotes: 45,
        created_at: randomDate(1),
        user: MOCK_USERS[2],
      },
    ],
  },
  {
    id: 'p6',
    user_id: 'u7',
    title: 'Tips for getting your first US credit card',
    content: `Just got approved for my first US credit card after 6 months! Sharing what worked for me:

**Step 1: Build credit history**
- Get a secured credit card first (Discover It Secured is great)
- Put small purchases on it
- ALWAYS pay full balance on time

**Step 2: After 6-12 months**
- Apply for student cards (Discover Student, Capital One Journey)
- Keep utilization under 30%
- Don't apply for too many at once

**Step 3: Pro tips**
- Some banks let you "graduate" from secured to unsecured
- Check if your bank offers credit builder loans
- Use Credit Karma to monitor your score (free!)

My score went from nothing to 720 in 8 months. Patience is key!`,
    category: 'finance',
    tags: ['credit-card', 'credit-score', 'financial-tips'],
    upvotes: 267,
    downvotes: 4,
    comment_count: 45,
    is_pinned: false,
    created_at: randomDate(7),
    user: MOCK_USERS[6],
    comments: [
      {
        id: 'c10',
        post_id: 'p6',
        user_id: 'u8',
        content: 'This is super helpful! I just applied for the Discover secured card. Fingers crossed!',
        upvotes: 23,
        created_at: randomDate(6),
        user: MOCK_USERS[7],
      },
    ],
  },
  {
    id: 'p7',
    user_id: 'u8',
    title: 'Study group for Machine Learning (CS 229)?',
    content: `Anyone taking CS 229 this quarter want to form a study group?

The problem sets are getting intense and I think we could all benefit from working together.

Planning to meet 2x per week in the library. Drop a comment if you're interested!`,
    category: 'academic',
    tags: ['study-group', 'machine-learning', 'cs229'],
    upvotes: 45,
    downvotes: 0,
    comment_count: 18,
    is_pinned: false,
    created_at: randomDate(4),
    user: MOCK_USERS[7],
    comments: [
      {
        id: 'c11',
        post_id: 'p7',
        user_id: 'u9',
        content: 'Count me in! The gradient descent problem set is killing me.',
        upvotes: 12,
        created_at: randomDate(3),
        user: MOCK_USERS[8],
      },
      {
        id: 'c12',
        post_id: 'p7',
        user_id: 'u1',
        content: 'I\'m down! When are you thinking of meeting?',
        upvotes: 8,
        created_at: randomDate(3),
        user: MOCK_USERS[0],
      },
    ],
  },
  {
    id: 'p8',
    user_id: 'u9',
    title: 'How to deal with homesickness?',
    content: `It's been 3 months since I came here and I'm really struggling with homesickness. The time difference makes it hard to call family, and I miss the food, the culture, everything...

How do you all cope? Any tips would be appreciated.`,
    category: 'social',
    tags: ['homesickness', 'mental-health', 'international-student'],
    upvotes: 198,
    downvotes: 0,
    comment_count: 67,
    is_pinned: false,
    created_at: randomDate(10),
    user: MOCK_USERS[8],
    comments: [
      {
        id: 'c13',
        post_id: 'p8',
        user_id: 'u3',
        content: `I totally understand how you feel. Here's what helped me:

1. Schedule regular video calls with family (even if it's at weird hours)
2. Find restaurants that serve food from home
3. Join cultural clubs on campus
4. Make friends who understand your background
5. Keep some comfort items from home in your room

It gets easier with time, I promise. The first semester is always the hardest. Hang in there!`,
        upvotes: 134,
        created_at: randomDate(9),
        user: MOCK_USERS[2],
      },
      {
        id: 'c14',
        post_id: 'p8',
        user_id: 'u5',
        content: 'Also don\'t hesitate to use campus counseling services - they\'re free and many counselors specialize in helping international students. You\'re not alone in this!',
        upvotes: 89,
        created_at: randomDate(9),
        user: MOCK_USERS[4],
      },
    ],
  },
  {
    id: 'p9',
    user_id: 'u2',
    title: 'Networking event for tech internships - This Saturday!',
    content: `Hey everyone! The International Students Association is hosting a networking event specifically for tech internships.

**Details:**
- Date: This Saturday, 2pm-5pm
- Location: Student Center, Room 200
- What to bring: Resume, business cards (if you have them)

We'll have recruiters from:
- Google
- Meta
- Microsoft
- Amazon
- Several startups

Pizza and drinks will be provided! RSVP in the comments.`,
    category: 'career',
    tags: ['networking', 'internship', 'tech-careers'],
    upvotes: 156,
    downvotes: 1,
    comment_count: 42,
    is_pinned: false,
    created_at: randomDate(2),
    user: MOCK_USERS[1],
    comments: [
      {
        id: 'c15',
        post_id: 'p9',
        user_id: 'u4',
        content: 'RSVP! This is exactly what I needed. Thanks for organizing!',
        upvotes: 15,
        created_at: randomDate(1),
        user: MOCK_USERS[3],
      },
      {
        id: 'c16',
        post_id: 'p9',
        user_id: 'u6',
        content: 'Will there be info about visa sponsorship from these companies?',
        upvotes: 28,
        created_at: randomDate(1),
        user: MOCK_USERS[5],
      },
    ],
  },
  {
    id: 'p10',
    user_id: 'u10',
    title: 'Is it worth getting a car as a student?',
    content: `I'm debating whether to buy a used car. The bus system is okay but not great.

For those who have cars:
- How much do you spend monthly (insurance, gas, parking)?
- Is it worth it?
- Any tips for buying used cars?

For those without:
- How do you get around?
- Do you regret not having a car?`,
    category: 'social',
    tags: ['car', 'transportation', 'student-life'],
    upvotes: 78,
    downvotes: 2,
    comment_count: 54,
    is_pinned: false,
    created_at: randomDate(14),
    user: MOCK_USERS[9],
    comments: [
      {
        id: 'c17',
        post_id: 'p10',
        user_id: 'u7',
        content: `I got a used Honda Civic for $8k. Monthly costs:
- Insurance: $120 (shop around!)
- Gas: $80-100
- Parking permit: $50

Total: ~$250/month

Worth it for me because I do groceries, go hiking, and visit friends in other cities. But if you live near campus and don't go out much, probably not necessary.`,
        upvotes: 45,
        created_at: randomDate(13),
        user: MOCK_USERS[6],
      },
    ],
  },
];

// Get all posts optionally filtered by category
export function getPosts(category?: string): Post[] {
  let posts = [...MOCK_POSTS];

  if (category && category !== 'all') {
    posts = posts.filter(p => p.category === category);
  }

  // Sort by pinned first, then by upvotes
  return posts.sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return b.upvotes - a.upvotes;
  });
}

// Get a single post by ID
export function getPostById(id: string): Post | undefined {
  return MOCK_POSTS.find(p => p.id === id);
}

// Get comments for a post
export function getCommentsForPost(postId: string): Comment[] {
  const post = MOCK_POSTS.find(p => p.id === postId);
  return post?.comments || [];
}

// Simulated local storage for user votes and posts
const STORAGE_KEY_VOTES = 'noor_forum_votes';
const STORAGE_KEY_POSTS = 'noor_forum_user_posts';

export function getUserVotes(): Record<string, 'up' | 'down'> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY_VOTES);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function saveUserVote(postId: string, vote: 'up' | 'down' | null): void {
  if (typeof window === 'undefined') return;
  try {
    const votes = getUserVotes();
    if (vote === null) {
      delete votes[postId];
    } else {
      votes[postId] = vote;
    }
    localStorage.setItem(STORAGE_KEY_VOTES, JSON.stringify(votes));
  } catch {
    // Ignore storage errors
  }
}

export function getUserPosts(): Post[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY_POSTS);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveUserPost(post: Omit<Post, 'id' | 'created_at' | 'user' | 'comments' | 'upvotes' | 'downvotes' | 'comment_count' | 'is_pinned'>): Post {
  const newPost: Post = {
    ...post,
    id: `user_${Date.now()}`,
    created_at: new Date().toISOString(),
    upvotes: 1,
    downvotes: 0,
    comment_count: 0,
    is_pinned: false,
    comments: [],
    user: {
      id: 'current_user',
      first_name: 'You',
      last_name: null,
      profile_picture: null,
      university: 'Your University',
    },
  };

  if (typeof window !== 'undefined') {
    try {
      const posts = getUserPosts();
      posts.unshift(newPost);
      localStorage.setItem(STORAGE_KEY_POSTS, JSON.stringify(posts));
    } catch {
      // Ignore storage errors
    }
  }

  return newPost;
}

// Categories
export const FORUM_CATEGORIES = [
  { id: 'all', label: 'All', icon: '🌐' },
  { id: 'finance', label: 'Finance', icon: '💰' },
  { id: 'housing', label: 'Housing', icon: '🏠' },
  { id: 'academic', label: 'Academic', icon: '📚' },
  { id: 'career', label: 'Career', icon: '💼' },
  { id: 'social', label: 'Social', icon: '🎉' },
];
