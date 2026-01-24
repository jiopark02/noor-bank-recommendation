// Deals Hub Data - Student Discounts and Local Deals

export interface Deal {
  id: string;
  title: string;
  description: string;
  discount_percent: number | null;
  discount_text: string;
  category: 'streaming' | 'software' | 'food' | 'transport' | 'shopping' | 'services' | 'local';
  brand: string;
  link: string | null;
  university_id: string | null; // null = available everywhere
  expires_at: string | null;
  is_verified: boolean;
  submitted_by: string | null;
  upvotes: number;
  created_at: string;
}

export interface DealCategory {
  id: string;
  label: string;
  icon: string;
}

// Deal categories
export const DEAL_CATEGORIES: DealCategory[] = [
  { id: 'all', label: 'All Deals', icon: '🎁' },
  { id: 'streaming', label: 'Streaming', icon: '📺' },
  { id: 'software', label: 'Software', icon: '💻' },
  { id: 'food', label: 'Food', icon: '🍕' },
  { id: 'transport', label: 'Transport', icon: '🚗' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️' },
  { id: 'services', label: 'Services', icon: '🔧' },
  { id: 'local', label: 'Local', icon: '📍' },
];

// Storage key
const STORAGE_KEY_DEALS = 'noor_user_deals';
const STORAGE_KEY_UPVOTES = 'noor_deal_upvotes';

// Mock deals data
export const MOCK_DEALS: Deal[] = [
  // Streaming
  {
    id: 'd1',
    title: 'Spotify Premium Student',
    description: 'Get Spotify Premium, Hulu, and SHOWTIME for one low price.',
    discount_percent: 50,
    discount_text: '$5.99/month (normally $11.99)',
    category: 'streaming',
    brand: 'Spotify',
    link: 'https://www.spotify.com/us/student/',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 342,
    created_at: '2025-09-01',
  },
  {
    id: 'd2',
    title: 'Apple Music Student',
    description: 'Stream over 100 million songs ad-free with Apple TV+ included.',
    discount_percent: 50,
    discount_text: '$5.99/month',
    category: 'streaming',
    brand: 'Apple',
    link: 'https://www.apple.com/apple-music/student/',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 287,
    created_at: '2025-09-01',
  },
  {
    id: 'd3',
    title: 'YouTube Premium Student',
    description: 'Ad-free videos, background play, and YouTube Music Premium.',
    discount_percent: 50,
    discount_text: '$7.99/month',
    category: 'streaming',
    brand: 'YouTube',
    link: 'https://www.youtube.com/premium/student',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 198,
    created_at: '2025-09-01',
  },

  // Software
  {
    id: 'd4',
    title: 'GitHub Student Developer Pack',
    description: 'Free access to developer tools, cloud credits, and learning resources.',
    discount_percent: 100,
    discount_text: 'FREE (worth $200k+)',
    category: 'software',
    brand: 'GitHub',
    link: 'https://education.github.com/pack',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 456,
    created_at: '2025-09-01',
  },
  {
    id: 'd5',
    title: 'Adobe Creative Cloud',
    description: 'All Adobe apps including Photoshop, Illustrator, Premiere Pro.',
    discount_percent: 60,
    discount_text: '$19.99/month',
    category: 'software',
    brand: 'Adobe',
    link: 'https://www.adobe.com/creativecloud/plans.html?plan=edu',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 234,
    created_at: '2025-09-01',
  },
  {
    id: 'd6',
    title: 'Notion Plus',
    description: 'Unlimited blocks and file uploads for students.',
    discount_percent: 100,
    discount_text: 'FREE',
    category: 'software',
    brand: 'Notion',
    link: 'https://www.notion.so/students',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 312,
    created_at: '2025-09-01',
  },
  {
    id: 'd7',
    title: 'Figma Education',
    description: 'Free professional plan for students and educators.',
    discount_percent: 100,
    discount_text: 'FREE',
    category: 'software',
    brand: 'Figma',
    link: 'https://www.figma.com/education/',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 278,
    created_at: '2025-09-01',
  },

  // Shopping
  {
    id: 'd8',
    title: 'Amazon Prime Student',
    description: '6-month free trial, then 50% off. Free shipping, Prime Video, more.',
    discount_percent: 50,
    discount_text: '$7.49/month after trial',
    category: 'shopping',
    brand: 'Amazon',
    link: 'https://www.amazon.com/amazonprime?planOptimizationId=WLPStudentMonthlyElig498',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 523,
    created_at: '2025-09-01',
  },
  {
    id: 'd9',
    title: 'Apple Education Pricing',
    description: 'Save on Mac, iPad, and accessories with education pricing.',
    discount_percent: null,
    discount_text: 'Up to $400 off',
    category: 'shopping',
    brand: 'Apple',
    link: 'https://www.apple.com/us-edu/store',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 412,
    created_at: '2025-09-01',
  },
  {
    id: 'd10',
    title: 'Samsung Education Discount',
    description: 'Exclusive student discounts on phones, laptops, tablets.',
    discount_percent: 30,
    discount_text: 'Up to 30% off',
    category: 'shopping',
    brand: 'Samsung',
    link: 'https://www.samsung.com/us/shop/discount-program/education/',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 189,
    created_at: '2025-09-01',
  },

  // Food
  {
    id: 'd11',
    title: 'Chipotle Student ID Discount',
    description: 'Show student ID for BOGO or free drink with entree.',
    discount_percent: null,
    discount_text: 'BOGO or free drink',
    category: 'food',
    brand: 'Chipotle',
    link: 'https://www.chipotle.com',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 167,
    created_at: '2025-09-01',
  },
  {
    id: 'd12',
    title: 'DoorDash DashPass Student',
    description: '$0 delivery fees and reduced service fees on eligible orders.',
    discount_percent: 50,
    discount_text: '$4.99/month',
    category: 'food',
    brand: 'DoorDash',
    link: 'https://www.doordash.com/dashpass/',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 234,
    created_at: '2025-09-01',
  },

  // Transport
  {
    id: 'd13',
    title: 'Amtrak Student Discount',
    description: '15% off most Amtrak fares with student advantage card.',
    discount_percent: 15,
    discount_text: '15% off fares',
    category: 'transport',
    brand: 'Amtrak',
    link: 'https://www.amtrak.com/student-discount',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 145,
    created_at: '2025-09-01',
  },
  {
    id: 'd14',
    title: 'Zipcar University',
    description: 'Discounted car sharing membership for students 18+.',
    discount_percent: null,
    discount_text: 'Reduced rates',
    category: 'transport',
    brand: 'Zipcar',
    link: 'https://www.zipcar.com/universities',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 98,
    created_at: '2025-09-01',
  },

  // Services
  {
    id: 'd15',
    title: 'The New York Times Digital',
    description: 'Unlimited digital access at discounted student rate.',
    discount_percent: 75,
    discount_text: '$1/week',
    category: 'services',
    brand: 'NYTimes',
    link: 'https://www.nytimes.com/subscription/education',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 134,
    created_at: '2025-09-01',
  },
  {
    id: 'd16',
    title: 'Headspace Student Plan',
    description: 'Meditation and mindfulness app at student pricing.',
    discount_percent: 85,
    discount_text: '$9.99/year',
    category: 'services',
    brand: 'Headspace',
    link: 'https://www.headspace.com/studentplan',
    university_id: null,
    expires_at: null,
    is_verified: true,
    submitted_by: null,
    upvotes: 178,
    created_at: '2025-09-01',
  },

  // Local deals (Stanford area example)
  {
    id: 'd17',
    title: 'Oren\'s Hummus - Stanford',
    description: '10% off with Stanford ID. Best hummus near campus!',
    discount_percent: 10,
    discount_text: '10% off',
    category: 'local',
    brand: 'Oren\'s Hummus',
    link: 'https://www.orenshummus.com',
    university_id: 'Stanford',
    expires_at: null,
    is_verified: true,
    submitted_by: 'u1',
    upvotes: 45,
    created_at: '2025-10-15',
  },
  {
    id: 'd18',
    title: 'University Cafe - Free Coffee',
    description: 'Free drip coffee refill with any purchase. Show student ID.',
    discount_percent: null,
    discount_text: 'Free refill',
    category: 'local',
    brand: 'University Cafe',
    link: null,
    university_id: 'Stanford',
    expires_at: null,
    is_verified: true,
    submitted_by: 'u3',
    upvotes: 67,
    created_at: '2025-11-01',
  },
];

// Get all deals
export function getDeals(category?: string, university?: string): Deal[] {
  let deals = [...MOCK_DEALS];

  // Add user-submitted deals
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_DEALS);
      if (stored) {
        const userDeals: Deal[] = JSON.parse(stored);
        deals = [...userDeals, ...deals];
      }
    } catch {
      // Ignore
    }
  }

  // Filter by category
  if (category && category !== 'all') {
    deals = deals.filter(d => d.category === category);
  }

  // Filter by university (show global + local)
  if (university) {
    deals = deals.filter(d => d.university_id === null || d.university_id === university);
  }

  // Sort by upvotes
  return deals.sort((a, b) => b.upvotes - a.upvotes);
}

// Submit a new deal
export function submitDeal(deal: Omit<Deal, 'id' | 'upvotes' | 'created_at' | 'is_verified'>): Deal {
  const newDeal: Deal = {
    ...deal,
    id: `deal_${Date.now()}`,
    upvotes: 1,
    created_at: new Date().toISOString().split('T')[0],
    is_verified: false,
  };

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_DEALS);
      const userDeals: Deal[] = stored ? JSON.parse(stored) : [];
      userDeals.unshift(newDeal);
      localStorage.setItem(STORAGE_KEY_DEALS, JSON.stringify(userDeals));
    } catch {
      // Ignore
    }
  }

  return newDeal;
}

// Upvote a deal
export function upvoteDeal(dealId: string): void {
  if (typeof window === 'undefined') return;

  try {
    // Check if already upvoted
    const stored = localStorage.getItem(STORAGE_KEY_UPVOTES);
    const upvotes: string[] = stored ? JSON.parse(stored) : [];

    if (upvotes.includes(dealId)) {
      // Remove upvote
      const updated = upvotes.filter(id => id !== dealId);
      localStorage.setItem(STORAGE_KEY_UPVOTES, JSON.stringify(updated));
    } else {
      // Add upvote
      upvotes.push(dealId);
      localStorage.setItem(STORAGE_KEY_UPVOTES, JSON.stringify(upvotes));
    }
  } catch {
    // Ignore
  }
}

// Check if user upvoted a deal
export function hasUpvoted(dealId: string): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const stored = localStorage.getItem(STORAGE_KEY_UPVOTES);
    const upvotes: string[] = stored ? JSON.parse(stored) : [];
    return upvotes.includes(dealId);
  } catch {
    return false;
  }
}

// Get upvoted deals
export function getUpvotedDeals(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY_UPVOTES);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}
