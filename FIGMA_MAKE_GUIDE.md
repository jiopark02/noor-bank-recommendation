# Noor App - Figma Make 구현 가이드

## 앱 개요
Noor는 미국 유학생을 위한 올인원 생활 도우미 앱입니다.
- 은행/신용카드 추천
- 주거 검색
- 장학금/펀딩
- 캠퍼스 잡
- 커뮤니티 포럼

---

# 1. 스타일 가이드 (Design Tokens)

## 색상 (Colors)
```
Primary Black: #000000
Primary White: #FFFFFF
Gray 50: #F9FAFB
Gray 100: #F5F5F5
Gray 200: #EEEEEE
Gray 300: #E0E0E0
Gray 400: #BDBDBD
Gray 500: #9E9E9E
Gray 600: #757575
```

## 폰트 (Typography)
```
Heading Font: Georgia (serif)
Body Font: Inter (sans-serif)

Page Title: Georgia, 36px, weight 400, line-height 1.15
Section Title: Georgia, 20px, weight 400
Body Text: Inter, 15px, weight 400
Small Text: Inter, 14px, weight 400
Caption: Inter, 13px, weight 400, color Gray 500
Label: Inter, 14px, weight 500
```

## 간격 (Spacing)
```
Page Padding: 24px horizontal
Section Gap: 48px vertical
Card Padding: 24px
Element Gap (small): 12px
Element Gap (medium): 16px
Element Gap (large): 24px
```

## Border Radius
```
Card: 16px
Button: 12px
Chip/Badge: 100px (pill)
Input: 12px
```

## 버튼 스타일

### Primary Button
```
Background: #000000
Text: #FFFFFF, 15px, weight 500
Padding: 16px 32px
Border Radius: 12px
Hover: Background #1a1a1a, translateY(-1px)
Disabled: Background #E0E0E0
```

### Secondary Button
```
Background: #FFFFFF
Text: #000000, 15px, weight 500
Border: 1.5px solid #E0E0E0
Padding: 16px 32px
Border Radius: 12px
Hover: Border color #000000
```

### Filter Chip
```
Inactive:
  Background: #FFFFFF
  Text: #000000, 14px, weight 500
  Border: 1.5px solid #EEEEEE
  Padding: 10px 20px
  Border Radius: 100px

Active:
  Background: #000000
  Text: #FFFFFF
  Border: none
```

## 카드 스타일
```
Background: #FFFFFF
Border: 1px solid #EEEEEE
Border Radius: 16px
Padding: 24px
Hover: Border color #BDBDBD
Transition: all 0.3s ease
```

## 애니메이션
```
Duration: 0.3s
Easing: ease
Fade In: opacity 0→1, translateY 12px→0
```

---

# 2. 페이지별 UI 구조

## 2.1 Survey (온보딩) - /survey

### 레이아웃
```
- Full screen, white background
- Max width: 448px, centered
- Padding: 32px horizontal, 80px top, 144px bottom

Components:
├── Progress Bar (fixed top)
│   └── Height: 2px, fill: black, background: gray-100
├── Step Indicator
│   └── Text: "{current} of {total}", gray-400, 14px
├── Page Title (Georgia, 36px)
├── Subtitle (gray-500, 16px)
├── Form Fields (space-y: 40px)
│   ├── Label (14px, weight 500)
│   └── Options Grid (2 columns, gap: 12px)
└── Bottom Navigation (fixed)
    ├── Back Button (secondary, if step > 1)
    └── Continue Button (primary, flex-1)
```

### Step 1: Basic Info
```
Title: "Welcome to Noor."
Subtitle: "Let's find the perfect bank for you."

Fields:
1. Visa status - Grid 2x2
   Options: F-1, J-1, H-1B, Other

2. University - Select dropdown
   Options: UC Berkeley, Stanford, UCLA, USC, NYU, Columbia, MIT, Harvard, U of Michigan, Other

3. Time in US - Grid 2x2
   Options: Just arrived, < 6 months, 6-12 months, > 1 year
```

### Step 2: Your Situation
```
Title: "Your situation."
Subtitle: "This helps us find banks that work for you."

Fields:
1. SSN - Grid 2 columns
   Options: Yes (with desc "I have one"), No (with desc "Not yet")

2. ITIN (conditional, show if SSN = No) - Grid 2 columns
   Options: Yes, No

3. Monthly budget - Grid 2x2
   Options: < $500, $500-$1K, $1K-$2K, $2K+
```

### Step 3: Your Needs
```
Title: "Your needs."
Subtitle: "What matters most to you?"

Fields:
1. International transfers - Grid 2x2
   Options: Never, Rarely, Monthly, Weekly

2. Zelle - Grid 2 columns
   Helper text: "Instant transfers to friends, pay rent, split bills."
   Options: Yes I need it, Not important

3. Primary goal - Stack vertical
   Options with descriptions:
   - Just need a bank account → For everyday spending
   - Build credit history → Want to get credit cards later
   - Save money → Looking for high APY savings
```

### Step 4: Preferences
```
Title: "Almost done."
Subtitle: "A few final preferences."

Fields:
1. Fee sensitivity - Stack vertical
   Options:
   - Very sensitive → I want $0 fees only
   - Somewhat → Small fees are OK if worth it
   - Not sensitive → Features matter more

2. Banking preference - Grid 3 columns
   Options: Mobile, Branch, Both

3. Branch proximity - Stack vertical
   Options:
   - Very important → I want to visit in person
   - Nice to have → But not required
   - Not important → I prefer online banking
```

---

## 2.2 Home - /

### 레이아웃
```
- PageLayout wrapper (Header + Content + BottomNav)
- Content max-width: 672px

Components:
├── Header (fixed top)
│   ├── Logo "NOOR" (tracking: 0.25em)
│   └── Icons: Search, Notification
├── Greeting Section
│   ├── Title: "{Morning/Afternoon/Evening}, {name}." (Georgia, 36px)
│   └── Subtitle: "We've prepared a few things."
├── Important Dates Section
│   ├── Section Title: "Important dates." (Georgia, 20px)
│   └── Horizontal Chips: "FAFSA · 15d", "Tax · 42d", "OPT · 90d"
├── Quick Links
│   └── Text links: "SSN Guide →", "ITIN Guide →"
├── Checklist Section
│   ├── Section Title: "Your first week."
│   └── Accordion Cards:
│       ├── Arrival (expandable)
│       ├── Documents (expandable)
│       ├── Banking (expandable)
│       └── Insurance (expandable)
└── Bottom Navigation (fixed)
```

### Checklist Item Structure
```
Card Header:
├── Title (font-medium)
├── Progress indicator (e.g., "2/5")
└── Chevron icon (rotate on expand)

Card Content (when expanded):
└── Checkbox items with labels
    ├── Unchecked: border-gray-300, white bg
    └── Checked: black bg, white checkmark, text strikethrough
```

---

## 2.3 Banking - /banking

### 레이아웃
```
Components:
├── PageHeader
│   ├── Title: "Banking."
│   └── Subtitle: "Matched to your situation."
├── Tabs: Banks | Cards | Guides
├── Filter Chips (based on active tab)
├── Section Title: "Best for you." / "Best first cards."
└── Content List
```

### Banks Tab
```
Filters: No SSN, Traditional, Edit
Content: BankRecommendationList component

Bank Card Structure:
├── Rank badge (1, 2, 3...)
├── Bank name + logo
├── Fit score badge (e.g., "92% fit")
├── Key features (chips)
├── Expandable details:
│   ├── Pros list (+ icon)
│   ├── Cons list (- icon)
│   └── Apply button
```

### Cards Tab
```
Filters: No SSN, No Credit History, No Annual Fee
Count: "{n} cards for F-1 students"

Credit Card Structure:
├── Card name + "No SSN" badge
├── Issuer name
├── Rewards rate
├── Annual fee / No FTF
├── F-1 specific notes (italic)
├── Expandable:
│   ├── Signup bonus
│   ├── Benefits list
│   ├── Drawbacks list
│   └── Apply Now button
```

### Guides Tab
```
Guide Card Structure:
├── Title (font-medium)
├── Description (gray-500)
└── "Read more →" link

Items:
- SSN Guide
- ITIN Guide
- Building Credit
- Bank Account Comparison
```

---

## 2.4 Housing - /housing

### 레이아웃
```
Components:
├── PageHeader
│   ├── Title: "Housing."
│   ├── Subtitle: "{n} near campus."
│   └── Right: Filters button, Price button
├── Amenity Filters (Grid 3 columns)
│   └── Gym, Furnished, Parking
└── Apartment Grid (2 columns, gap: 20px)
```

### Apartment Card Structure
```
├── Image (aspect ratio 4:3, rounded-2xl)
│   └── Hover: scale 1.05
├── Name (font-medium, 14px)
├── Price range: "$X,XXX-$X,XXX/mo"
└── Details: "Studio/1BR/2BR · X min walk"
```

---

## 2.5 Funding - /funding

### 레이아웃
```
Components:
├── PageHeader
│   ├── Title: "Funding."
│   └── Subtitle: "{n} opportunities matched to you."
└── Scholarship List (space-y: 16px)
```

### Scholarship Card Structure
```
├── Left side:
│   ├── Name (font-medium)
│   ├── Provider (gray-500, 14px)
│   └── Amount: "$X,XXX-$XX,XXX" or "Up to $XX,XXX"
└── Right side:
    ├── Deadline: "Mar 15" or "Rolling"
    └── Badge: "F-1 eligible"
```

---

## 2.6 Jobs - /jobs

### 레이아웃
```
Components:
├── PageHeader
│   ├── Title: "Jobs."
│   ├── Subtitle: "{n} positions. All F-1 eligible."
│   └── Right: Filters, Pay buttons
├── Tabs: Campus | Internships
├── Info Banner
│   └── "F-1: up to 20 hrs/week during classes. Unlimited during breaks."
├── Category Filters: Research, Tutoring, Admin
├── Section Title: "Available."
└── Job List
```

### Job Card Structure
```
├── Title (font-medium)
├── Department · Location
├── Bottom row:
│   ├── Pay: "$XX-$XX/hr" or "TBD"
│   └── Deadline: "Mar 15" or "Open"
```

---

## 2.7 Forum - /forum

### Phase 1: Interest Selection
```
Layout (centered):
├── Title: "Your interests." (centered, Georgia)
├── Subtitle: "We'll curate your feed."
├── Instruction: "Pick 3 or more."
├── Interest Grid (3 columns, square buttons)
│   └── Networking, Finance, Housing, Career, Social, Academic
└── Continue Button: "Continue (X/3)"
    └── Disabled until 3+ selected
```

### Phase 2: Feed View
```
Layout:
├── Header row:
│   ├── Title: "Forum."
│   └── "Edit interests" link
├── Category Pills (horizontal scroll)
│   └── All (active), + selected interests
└── Post List
```

### Post Card Structure
```
├── Avatar (36px circle, initials if no image)
├── Content:
│   ├── Title (font-medium)
│   ├── Content preview (2 lines max)
│   └── Meta: "Author · Xh ago · X replies"
└── Tags (badges)
```

---

# 3. Supabase 테이블 연결

## 3.1 Users 테이블
```sql
Table: users
Columns:
- id: uuid (PK)
- email: text
- first_name: text
- last_name: text
- visa_type: text (F-1, J-1, H-1B, Other)
- university: text
- has_ssn: boolean
- has_itin: boolean
- has_us_address: boolean
- monthly_income: numeric
- expected_monthly_spending: numeric
- international_transfer_frequency: text (never, rarely, monthly, weekly)
- avg_transfer_amount: numeric
- needs_zelle: boolean
- prefers_online_banking: boolean
- needs_nearby_branch: boolean
- onboarding_completed: boolean
- created_at: timestamptz
```

### Survey → Users 매핑
```
survey.visa_status → users.visa_type
survey.university → users.university
survey.has_ssn → users.has_ssn
survey.has_itin → users.has_itin
survey.monthly_budget * 0.8 → users.expected_monthly_spending
survey.international_transfers → users.international_transfer_frequency
survey.avg_transfer_amount → users.avg_transfer_amount
survey.needs_zelle → users.needs_zelle
survey.digital_preference === 'mobile-first' → users.prefers_online_banking
survey.campus_proximity === 'very-important' → users.needs_nearby_branch
```

## 3.2 Bank Accounts 테이블
```sql
Table: bank_accounts
Columns:
- id: text (PK, e.g., "chase_total_checking")
- bank_name: text
- account_name: text
- account_type: text (checking, savings)
- monthly_fee: numeric
- min_balance_no_fee: numeric
- min_opening_deposit: numeric
- apy: numeric
- atm_network: text
- zelle_support: boolean
- has_mobile_deposit: boolean
- accepts_itin: boolean
- requires_ssn: boolean
- intl_student_friendly: boolean
- intl_student_score: integer (0-100)
- opening_difficulty: integer (1-5)
- pros: text[]
- cons: text[]
- best_for: text[]
- apply_url: text
- logo_url: text
- is_active: boolean
```

### Bank Recommendation API
```
Endpoint: /api/recommendations/bank
Method: GET
Params: userId

Response:
{
  recommendations: [
    {
      bank: { ...bank_account_data },
      fitScore: 92,
      scoreBreakdown: {
        ssnMatch: 25,
        feeSensitivity: 20,
        zelleMatch: 15,
        digitalPreference: 20,
        intlStudentScore: 12
      },
      reasons: ["No SSN required", "Great mobile app"],
      warnings: ["$12 monthly fee"]
    }
  ]
}
```

## 3.3 Credit Cards 테이블
```sql
Table: credit_cards
Columns:
- id: uuid (PK)
- card_name: text
- issuer: text
- annual_fee: numeric
- rewards_rate: text
- signup_bonus: text
- foreign_transaction_fee: numeric
- ssn_required: boolean
- credit_history_required: boolean
- f1_friendly: boolean
- f1_notes: text
- benefits: text[]
- drawbacks: text[]
- apply_link: text
- is_active: boolean
```

### Credit Cards API
```
Endpoint: /api/credit-cards
Method: GET
Params: f1Only, noSsn, noFee

Query:
SELECT * FROM credit_cards
WHERE is_active = true
  AND (f1_friendly = true OR f1Only = false)
  AND (ssn_required = false OR noSsn = false)
ORDER BY annual_fee ASC
```

## 3.4 Apartments 테이블
```sql
Table: apartments
Columns:
- id: uuid (PK)
- name: text
- address: text
- price_min: numeric
- price_max: numeric
- bedrooms: text (Studio, 1BR, 2BR, etc.)
- walking_minutes: integer
- university: text
- has_gym: boolean
- is_furnished: boolean
- has_parking: boolean
- images: text[]
- amenities: text[]
- contact_url: text
- is_active: boolean
```

### Apartments API
```
Endpoint: /api/apartments
Params: limit, gym, furnished, parking

Query:
SELECT * FROM apartments
WHERE is_active = true
  AND (has_gym = true OR gym = false)
  AND (is_furnished = true OR furnished = false)
  AND (has_parking = true OR parking = false)
ORDER BY walking_minutes ASC
```

## 3.5 Scholarships 테이블
```sql
Table: scholarships
Columns:
- id: text (PK)
- name: text
- provider: text
- amount_min: numeric
- amount_max: numeric
- deadline: text
- eligibility_f1: boolean
- eligibility_criteria: text[]
- application_url: text
- is_active: boolean
```

### Scholarships API
```
Endpoint: /api/scholarships
Params: f1Only, limit

Query:
SELECT * FROM scholarships
WHERE is_active = true
  AND (eligibility_f1 = true OR f1Only = false)
ORDER BY deadline ASC
```

## 3.6 Jobs 테이블
```sql
Table: jobs
Columns:
- id: uuid (PK)
- title: text
- department: text
- location: text
- job_type: text (campus, internship)
- category: text (research, tutoring, admin)
- pay_min: numeric
- pay_max: numeric
- hours_per_week: integer
- deadline: date
- f1_eligible: boolean
- description: text
- apply_url: text
- is_active: boolean
```

### Jobs API
```
Endpoint: /api/jobs
Params: jobType, category, limit

Query:
SELECT * FROM jobs
WHERE is_active = true
  AND f1_eligible = true
  AND (job_type = jobType OR jobType IS NULL)
  AND (category = category OR category IS NULL)
ORDER BY deadline ASC NULLS LAST
```

## 3.7 Forum Posts 테이블
```sql
Table: forum_posts
Columns:
- id: uuid (PK)
- user_id: uuid (FK → users)
- title: text
- content: text
- category: text
- tags: text[]
- comment_count: integer
- like_count: integer
- created_at: timestamptz

Join with users for author info:
- users.first_name
- users.last_name
- users.profile_picture
```

### Forum API
```
Endpoint: /api/forum
Params: limit, category

Query:
SELECT
  p.*,
  u.first_name,
  u.last_name,
  u.profile_picture
FROM forum_posts p
LEFT JOIN users u ON p.user_id = u.id
ORDER BY p.created_at DESC
LIMIT limit
```

---

# 4. 페이지별 로직

## 4.1 Survey 로직
```javascript
// State
step: number (1-4)
data: SurveyData object

// Navigation
handleNext: if step < 4, step++
handleBack: if step > 1, step--
handleSubmit: POST /api/survey with data
  → Save userId to localStorage
  → Redirect to /banking

// Conditional display
Step 2: Show ITIN question only if has_ssn === false
```

## 4.2 Home 로직
```javascript
// Auth check
useEffect:
  if no userId in localStorage → redirect to /survey

// Greeting logic
getGreeting():
  hour < 12 → "Morning"
  hour < 18 → "Afternoon"
  else → "Evening"

// Checklist state
expandedSection: string | null (default: 'arrival')
completedItems: Set<string> (e.g., "arrival-0", "arrival-1")

toggleSection(id): expand/collapse
toggleItem(sectionId, index): add/remove from completedItems

// Progress calculation
getSectionProgress(sectionId, totalItems):
  count items in completedItems matching sectionId
```

## 4.3 Banking 로직
```javascript
// Tabs
activeTab: 'banks' | 'cards' | 'guides'

// Bank filters
bankFilters: string[] (default: ['no_ssn', 'traditional'])
toggleBankFilter(id): add/remove from array

// Card filters
cardFilters: string[] (default: [])
toggleCardFilter(id): add/remove from array

// Data fetching
Banks: GET /api/recommendations/bank?userId={userId}
Cards: GET /api/credit-cards?f1Only=true&noSsn={cardFilters.includes('no_ssn')}
```

## 4.4 Bank Recommendation Algorithm
```javascript
calculateFitScore(user, bank):
  score = 0

  // SSN Match (25 points)
  if (!user.has_ssn && !bank.requires_ssn) score += 25
  else if (user.has_ssn) score += 25
  else score += 5 // penalty

  // Fee Sensitivity (20 points)
  if (user.fee_sensitivity === 'very-sensitive' && bank.monthly_fee === 0) score += 20
  else if (user.fee_sensitivity === 'medium' && bank.monthly_fee <= 12) score += 15
  else if (user.fee_sensitivity === 'not-sensitive') score += 20

  // Zelle Match (15 points)
  if (user.needs_zelle && bank.zelle_support) score += 15
  else if (!user.needs_zelle) score += 15

  // Digital Preference (20 points)
  if (user.prefers_online_banking && bank.has_mobile_deposit) score += 20
  if (user.needs_nearby_branch && bank.has_branches) score += 10

  // International Student Score (20 points)
  score += bank.intl_student_score * 0.2

  return score (max 100)

// Sort by fitScore descending
// Return top 10
```

## 4.5 Housing 로직
```javascript
// Filters
selectedAmenities: string[] (default: [])
toggleAmenity(id): add/remove

// API params mapping
filters = {
  gym: selectedAmenities.includes('gym'),
  furnished: selectedAmenities.includes('furnished'),
  parking: selectedAmenities.includes('parking')
}

// Refetch on filter change
useEffect(() => refetch(), [selectedAmenities])
```

## 4.6 Jobs 로직
```javascript
// State
activeTab: 'campus' | 'internship'
activeFilters: string[] (categories)

// Filter logic
category = activeFilters.length === 1 ? activeFilters[0] : null

// Date formatting
formatDeadline(deadline):
  if null → "Open"
  else → format as "Mar 15"
```

## 4.7 Forum 로직
```javascript
// Phase state
showFeed: boolean (default: false)
selectedInterests: string[]

// Interest selection
toggleInterest(id): add/remove from array
canContinue = selectedInterests.length >= 3

handleContinue():
  if canContinue → showFeed = true

// Time ago formatting
timeAgo(date):
  diff = now - date
  if < 1 hour → "Just now"
  if < 24 hours → "{n}h ago"
  else → "{n}d ago"
```

---

# 5. 공통 컴포넌트

## Header
```
Height: 64px
Background: white/95 with backdrop-blur
Border: bottom 1px gray-100
Content:
  - Logo: "NOOR", tracking 0.25em, font-medium
  - Icons: Search, Notification (20x20, stroke 1.5)
```

## Bottom Navigation
```
Height: 80px + safe area
Background: white/95 with backdrop-blur
Border: top 1px gray-100
Items: Home, Banking, Housing, Jobs, Funding, Forum
  - Icon: 22x22, stroke 1.25 (inactive) / 1.75 (active)
  - Label: 10px, tracking wide
  - Active: text-black, Inactive: text-gray-400
```

## Loading Spinner
```
Size: 24x24
Border: 1.5px gray-200
Border-top: 1.5px black
Animation: spin
Text below: "Finding your matches..." (gray-400, 14px)
```

## Empty State
```
Card with padding 40px
Center aligned
Message: gray-500
Sub-message: gray-400, 14px
```

## Error State
```
Card with padding 32px
Center aligned
Message: gray-500
"Try again" link: black, underline on hover
```

---

# 6. 반응형 & 모바일

```
Max content width: 672px (centered)
Mobile padding: 24px horizontal
Safe area: bottom padding for iOS home indicator

All touch targets: minimum 44x44px
Cards: full width on mobile
Grid layouts: 2 columns on mobile (housing, interests)
Filter chips: horizontal scroll on overflow
```

---

# Quick Start for Figma Make

1. Create pages: Survey, Home, Banking, Housing, Funding, Jobs, Forum
2. Set up Supabase connection with tables above
3. Apply style guide (colors, fonts, spacing)
4. Build components: Header, BottomNav, Cards, Buttons, Chips
5. Implement page layouts with components
6. Add data bindings to Supabase
7. Implement filter/tab logic
8. Add navigation between pages
