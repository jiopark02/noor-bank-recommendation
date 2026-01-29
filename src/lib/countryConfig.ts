/**
 * Country-Specific Configuration
 * Defines visa types, documents, health insurance, and banks for each country
 */

export type Country = 'US' | 'UK' | 'CA';

// =============================================================================
// VISA TYPES
// =============================================================================

export interface VisaType {
  id: string;
  code: string;
  name: string;
  fullName: string;
  description: string;
  duration: string;
  workAllowed: boolean;
  workRestrictions?: string;
  requirements: string[];
  documentsNeeded: string[];
  renewalInfo?: string;
  applicationLink?: string;
}

export const VISA_TYPES: Record<Country, VisaType[]> = {
  US: [
    {
      id: 'us-f1',
      code: 'F-1',
      name: 'F-1 Student Visa',
      fullName: 'F-1 Academic Student Visa',
      description: 'For full-time students at accredited universities, colleges, or language programs',
      duration: 'Duration of Status (D/S)',
      workAllowed: true,
      workRestrictions: 'On-campus only (20 hrs/week during school, 40 hrs during breaks). CPT/OPT for off-campus.',
      requirements: [
        'Acceptance to SEVP-certified school',
        'Proof of financial support',
        'Strong ties to home country',
        'Intent to return after studies',
      ],
      documentsNeeded: [
        'Valid passport',
        'I-20 from school',
        'SEVIS fee payment (I-901)',
        'DS-160 confirmation',
        'Financial documents',
        'Academic transcripts',
        'Standardized test scores',
      ],
      renewalInfo: 'Must maintain full-time status. Can transfer between schools.',
      applicationLink: 'https://travel.state.gov/content/travel/en/us-visas/study/student-visa.html',
    },
    {
      id: 'us-j1',
      code: 'J-1',
      name: 'J-1 Exchange Visitor',
      fullName: 'J-1 Exchange Visitor Visa',
      description: 'For exchange visitors in educational and cultural exchange programs',
      duration: 'Varies by program category',
      workAllowed: true,
      workRestrictions: 'Work authorization depends on program category',
      requirements: [
        'Sponsorship by designated program',
        'Sufficient English proficiency',
        'Proof of financial support',
      ],
      documentsNeeded: [
        'Valid passport',
        'DS-2019 form',
        'SEVIS fee payment',
        'DS-160 confirmation',
        'Sponsor letter',
      ],
      applicationLink: 'https://j1visa.state.gov/',
    },
    {
      id: 'us-opt',
      code: 'OPT',
      name: 'OPT',
      fullName: 'Optional Practical Training',
      description: 'Temporary employment for F-1 students in their field of study',
      duration: '12 months (24 additional months for STEM)',
      workAllowed: true,
      workRestrictions: 'Must be related to field of study',
      requirements: [
        'Valid F-1 status for at least 1 academic year',
        'Job related to major field of study',
        'EAD card required',
      ],
      documentsNeeded: [
        'I-765 form',
        'Updated I-20 with OPT recommendation',
        'Passport photos',
        'I-94 record',
      ],
    },
    {
      id: 'us-cpt',
      code: 'CPT',
      name: 'CPT',
      fullName: 'Curricular Practical Training',
      description: 'Work authorization for internships that are part of curriculum',
      duration: 'Based on program requirements',
      workAllowed: true,
      workRestrictions: 'Must be integral part of curriculum',
      requirements: [
        'Enrolled for at least 1 academic year',
        'Job offer related to major',
        'Academic credit or requirement',
      ],
      documentsNeeded: [
        'Updated I-20 with CPT authorization',
        'Job offer letter',
        'Academic advisor approval',
      ],
    },
  ],
  UK: [
    {
      id: 'uk-tier4',
      code: 'Tier 4',
      name: 'Student Visa (Tier 4)',
      fullName: 'UK Student Visa',
      description: 'For international students studying at a licensed UK institution',
      duration: 'Course length + 4 months (degree) or 2 months (other)',
      workAllowed: true,
      workRestrictions: '20 hours/week during term, full-time during holidays',
      requirements: [
        'CAS from licensed sponsor',
        'English language proficiency (IELTS/TOEFL)',
        'Proof of funds for tuition and living costs',
        'Tuberculosis test (if applicable)',
      ],
      documentsNeeded: [
        'Valid passport',
        'CAS (Confirmation of Acceptance for Studies)',
        'Financial evidence (28 days in bank)',
        'English language test results',
        'Academic qualifications',
        'ATAS certificate (if applicable)',
      ],
      renewalInfo: 'Can switch to Graduate route or Skilled Worker visa',
      applicationLink: 'https://www.gov.uk/student-visa',
    },
    {
      id: 'uk-graduate',
      code: 'Graduate',
      name: 'Graduate Route',
      fullName: 'UK Graduate Immigration Route',
      description: 'Post-study work visa for graduates of UK universities',
      duration: '2 years (Bachelor/Master), 3 years (PhD)',
      workAllowed: true,
      workRestrictions: 'No restrictions - work at any skill level',
      requirements: [
        'Completed eligible UK degree',
        'Valid Student visa at time of application',
        'Application within UK',
      ],
      documentsNeeded: [
        'Valid passport',
        'BRP card',
        'Confirmation from university',
      ],
      applicationLink: 'https://www.gov.uk/graduate-visa',
    },
    {
      id: 'uk-skilled-worker',
      code: 'Skilled Worker',
      name: 'Skilled Worker Visa',
      fullName: 'UK Skilled Worker Visa',
      description: 'For skilled workers with job offers from UK employers',
      duration: 'Up to 5 years, can lead to settlement',
      workAllowed: true,
      requirements: [
        'Job offer from licensed sponsor',
        'Certificate of Sponsorship',
        'Meet salary threshold',
        'English language requirement',
      ],
      documentsNeeded: [
        'Valid passport',
        'Certificate of Sponsorship',
        'Proof of English',
        'Financial evidence',
      ],
      applicationLink: 'https://www.gov.uk/skilled-worker-visa',
    },
  ],
  CA: [
    {
      id: 'ca-study-permit',
      code: 'Study Permit',
      name: 'Study Permit',
      fullName: 'Canadian Study Permit',
      description: 'Required document for international students studying in Canada',
      duration: 'Length of program + 90 days',
      workAllowed: true,
      workRestrictions: '20 hours/week during sessions, full-time during breaks',
      requirements: [
        'Letter of acceptance from DLI',
        'Proof of financial support',
        'Clean criminal record',
        'Medical exam (if required)',
      ],
      documentsNeeded: [
        'Valid passport',
        'Letter of acceptance',
        'Proof of funds (CAD $10,000/year + tuition)',
        'Letter of explanation',
        'Provincial attestation letter (if applicable)',
      ],
      renewalInfo: 'Can extend while enrolled. Apply for PGWP after graduation.',
      applicationLink: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html',
    },
    {
      id: 'ca-pgwp',
      code: 'PGWP',
      name: 'PGWP',
      fullName: 'Post-Graduation Work Permit',
      description: 'Open work permit for graduates of eligible Canadian institutions',
      duration: '8 months to 3 years (based on program length)',
      workAllowed: true,
      workRestrictions: 'Open work permit - work for any employer',
      requirements: [
        'Graduated from eligible DLI',
        'Valid study permit',
        'Apply within 180 days of graduation',
      ],
      documentsNeeded: [
        'Official transcript or graduation letter',
        'Valid passport',
        'Study permit',
      ],
      applicationLink: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/work/after-graduation/apply.html',
    },
    {
      id: 'ca-coop',
      code: 'Co-op Work Permit',
      name: 'Co-op Work Permit',
      fullName: 'Co-op/Internship Work Permit',
      description: 'Work permit for students in programs with mandatory work placements',
      duration: 'Length of work placement',
      workAllowed: true,
      workRestrictions: 'Must be integral part of academic program',
      requirements: [
        'Valid study permit',
        'Letter from school confirming co-op requirement',
        'Work placement must be part of curriculum',
      ],
      documentsNeeded: [
        'Valid study permit',
        'Letter from educational institution',
        'Co-op/internship offer',
      ],
    },
  ],
};

// =============================================================================
// REQUIRED DOCUMENTS / ID NUMBERS
// =============================================================================

export interface RequiredDocument {
  id: string;
  name: string;
  shortName: string;
  description: string;
  required: boolean;
  howToApply: string;
  applicationLink?: string;
  processingTime: string;
  benefits: string[];
  documentsNeeded: string[];
}

export const REQUIRED_DOCUMENTS: Record<Country, RequiredDocument[]> = {
  US: [
    {
      id: 'us-ssn',
      name: 'Social Security Number',
      shortName: 'SSN',
      description: 'Required for employment and building credit history in the US',
      required: false,
      howToApply: 'Apply at Social Security Administration office with work authorization',
      applicationLink: 'https://www.ssa.gov/number-card/request-number-first-time',
      processingTime: '2-4 weeks',
      benefits: [
        'Required for employment',
        'Build credit history',
        'Open more bank account types',
        'Apply for credit cards',
        'File tax returns',
      ],
      documentsNeeded: [
        'Passport',
        'I-94 record',
        'I-20 or DS-2019',
        'Employment authorization (I-766 EAD or CPT I-20)',
      ],
    },
    {
      id: 'us-itin',
      name: 'Individual Taxpayer Identification Number',
      shortName: 'ITIN',
      description: 'Tax processing number for those not eligible for SSN',
      required: false,
      howToApply: 'Apply with IRS Form W-7 when filing tax return',
      applicationLink: 'https://www.irs.gov/individuals/how-do-i-apply-for-an-itin',
      processingTime: '7-11 weeks',
      benefits: [
        'File US tax returns',
        'Claim tax treaty benefits',
        'Open certain bank accounts',
      ],
      documentsNeeded: [
        'Form W-7',
        'Valid passport (or certified copies)',
        'Tax return (Form 1040NR)',
      ],
    },
  ],
  UK: [
    {
      id: 'uk-brp',
      name: 'Biometric Residence Permit',
      shortName: 'BRP',
      description: 'Identity document proving right to stay, work, and study in the UK',
      required: true,
      howToApply: 'Collect from designated Post Office within 10 days of arrival',
      applicationLink: 'https://www.gov.uk/biometric-residence-permits',
      processingTime: 'Available upon arrival',
      benefits: [
        'Proves immigration status',
        'Required for employment',
        'Travel within/outside UK',
        'Access public services',
        'Open bank accounts',
      ],
      documentsNeeded: [
        'Decision letter from visa application',
        'Passport',
        'BRP collection letter',
      ],
    },
    {
      id: 'uk-nin',
      name: 'National Insurance Number',
      shortName: 'NIN',
      description: 'Required for employment and tracking tax contributions',
      required: false,
      howToApply: 'Apply online or call the NI application line',
      applicationLink: 'https://www.gov.uk/apply-national-insurance-number',
      processingTime: '4-8 weeks',
      benefits: [
        'Required for employment',
        'Track tax and NI contributions',
        'Claim benefits if eligible',
        'Build pension entitlement',
      ],
      documentsNeeded: [
        'Passport',
        'BRP card',
        'Proof of UK address',
        'Job offer or employment letter',
      ],
    },
    {
      id: 'uk-nhs',
      name: 'NHS Registration',
      shortName: 'NHS',
      description: 'Free healthcare through the National Health Service',
      required: true,
      howToApply: 'Register with a local GP surgery near your address',
      applicationLink: 'https://www.nhs.uk/nhs-services/gps/how-to-register-with-a-gp-surgery/',
      processingTime: 'Same day to 1 week',
      benefits: [
        'Free GP appointments',
        'Free hospital treatment',
        'Free prescriptions (in Scotland, Wales, NI)',
        'Discounted prescriptions (England - prepay certificate)',
        'Free mental health services',
      ],
      documentsNeeded: [
        'Passport',
        'BRP card',
        'Proof of address',
        'University enrollment letter',
      ],
    },
  ],
  CA: [
    {
      id: 'ca-sin',
      name: 'Social Insurance Number',
      shortName: 'SIN',
      description: 'Required for working in Canada and accessing government programs',
      required: true,
      howToApply: 'Apply at Service Canada office or online',
      applicationLink: 'https://www.canada.ca/en/employment-social-development/services/sin/apply.html',
      processingTime: 'Same day (in-person) or 3-4 weeks (online)',
      benefits: [
        'Required for employment',
        'File tax returns',
        'Access government benefits',
        'Open bank accounts',
        'Build credit history',
      ],
      documentsNeeded: [
        'Valid passport',
        'Study permit',
        'Proof of Canadian address',
      ],
    },
    {
      id: 'ca-health-provincial',
      name: 'Provincial Health Insurance',
      shortName: 'Health Card',
      description: 'Provincial health coverage (OHIP, MSP, etc.)',
      required: false,
      howToApply: 'Apply through provincial health authority after waiting period',
      processingTime: '3 months waiting period in most provinces',
      benefits: [
        'Free doctor visits',
        'Free hospital care',
        'Free medical tests',
        'Emergency services',
      ],
      documentsNeeded: [
        'Study permit',
        'Passport',
        'Proof of provincial residence',
        'University enrollment confirmation',
      ],
    },
  ],
};

// =============================================================================
// HEALTH INSURANCE
// =============================================================================

export interface HealthInsuranceOption {
  id: string;
  name: string;
  type: 'university' | 'government' | 'private';
  description: string;
  coverage: string[];
  monthlyEstimate: string;
  required: boolean;
  waitingPeriod?: string;
  link?: string;
}

export const HEALTH_INSURANCE: Record<Country, HealthInsuranceOption[]> = {
  US: [
    {
      id: 'us-university-ship',
      name: 'University Health Plan (SHIP)',
      type: 'university',
      description: 'Student Health Insurance Plan offered by most universities',
      coverage: [
        'Doctor visits',
        'Hospital stays',
        'Mental health services',
        'Prescriptions',
        'Emergency care',
      ],
      monthlyEstimate: '$150-400/month',
      required: true,
      link: 'Contact your university health center',
    },
    {
      id: 'us-private-intl',
      name: 'International Student Insurance',
      type: 'private',
      description: 'Private insurance plans designed for international students',
      coverage: [
        'Medical emergencies',
        'Doctor visits',
        'Prescriptions',
        'Emergency evacuation',
        'Repatriation',
      ],
      monthlyEstimate: '$50-150/month',
      required: false,
    },
  ],
  UK: [
    {
      id: 'uk-nhs',
      name: 'National Health Service (NHS)',
      type: 'government',
      description: 'Free healthcare for students paying Immigration Health Surcharge',
      coverage: [
        'GP visits',
        'Hospital treatment',
        'Emergency care',
        'Mental health services',
        'Maternity care',
      ],
      monthlyEstimate: 'Free (IHS paid with visa: £776/year)',
      required: true,
      waitingPeriod: 'None',
      link: 'https://www.nhs.uk/',
    },
    {
      id: 'uk-private-supplement',
      name: 'Private Health Insurance',
      type: 'private',
      description: 'Optional private coverage for faster access or additional services',
      coverage: [
        'Private hospital rooms',
        'Shorter waiting times',
        'Specialist consultations',
        'Dental and optical',
      ],
      monthlyEstimate: '£50-150/month',
      required: false,
    },
  ],
  CA: [
    {
      id: 'ca-provincial',
      name: 'Provincial Health Insurance',
      type: 'government',
      description: 'Government health coverage (OHIP, MSP, etc.) - varies by province',
      coverage: [
        'Doctor visits',
        'Hospital stays',
        'Medical tests',
        'Surgery',
        'Emergency care',
      ],
      monthlyEstimate: 'Free (after waiting period)',
      required: false,
      waitingPeriod: '3 months in most provinces',
    },
    {
      id: 'ca-university',
      name: 'University Health Plan (UHIP)',
      type: 'university',
      description: 'Mandatory health coverage during provincial waiting period',
      coverage: [
        'Medical emergencies',
        'Doctor visits',
        'Hospital stays',
        'Prescriptions',
        'Mental health',
      ],
      monthlyEstimate: '$50-100/month',
      required: true,
      waitingPeriod: 'Covers during 3-month provincial waiting period',
    },
  ],
};

// =============================================================================
// BANKS
// =============================================================================

export interface Bank {
  id: string;
  name: string;
  shortName?: string;
  type: 'traditional' | 'digital' | 'credit_union';
  logoUrl?: string;
  description: string;
  studentFriendly: boolean;
  noSsnRequired?: boolean; // US
  noSinRequired?: boolean; // CA
  internationalTransfers: boolean;
  monthlyFee: string;
  minimumDeposit: string;
  features: string[];
  requirements: string[];
  website: string;
  studentOffers?: string[];
}

export const BANKS: Record<Country, Bank[]> = {
  US: [
    {
      id: 'us-chase',
      name: 'Chase',
      type: 'traditional',
      description: 'Largest US bank with extensive branch and ATM network',
      studentFriendly: true,
      noSsnRequired: true,
      internationalTransfers: true,
      monthlyFee: '$0 (student account)',
      minimumDeposit: '$0',
      features: [
        'Chase Student Checking (no monthly fee until 24)',
        '16,000+ ATMs nationwide',
        'Zelle for instant transfers',
        'Mobile check deposit',
        'Credit card options for students',
      ],
      requirements: [
        'Passport',
        'I-20 or visa document',
        'University enrollment proof',
        'US address',
      ],
      website: 'https://www.chase.com/personal/checking/student-checking',
      studentOffers: ['$100 bonus for new student accounts', 'No monthly fee until age 24'],
    },
    {
      id: 'us-bofa',
      name: 'Bank of America',
      type: 'traditional',
      description: 'Major US bank with good international student services',
      studentFriendly: true,
      noSsnRequired: true,
      internationalTransfers: true,
      monthlyFee: '$0 (student account)',
      minimumDeposit: '$25',
      features: [
        'Advantage SafePass Student account',
        '16,000+ ATMs',
        'Zelle transfers',
        'Keep the Change savings program',
        'Student credit card options',
      ],
      requirements: [
        'Passport',
        'I-20 or visa document',
        'Student ID',
        'Proof of enrollment',
      ],
      website: 'https://www.bankofamerica.com/deposits/student-banking/',
      studentOffers: ['No monthly fee for students under 24'],
    },
    {
      id: 'us-wells-fargo',
      name: 'Wells Fargo',
      type: 'traditional',
      description: 'Nationwide bank with campus presence at many universities',
      studentFriendly: true,
      noSsnRequired: true,
      internationalTransfers: true,
      monthlyFee: '$0 (student account)',
      minimumDeposit: '$25',
      features: [
        'Clear Access Banking',
        'Campus Card integration at select schools',
        '13,000+ ATMs',
        'Zelle transfers',
        'Mobile banking',
      ],
      requirements: [
        'Valid passport',
        'Student visa documents',
        'Proof of enrollment',
      ],
      website: 'https://www.wellsfargo.com/checking/clear-access-banking/',
    },
    {
      id: 'us-discover',
      name: 'Discover Bank',
      type: 'digital',
      description: 'Online bank with excellent cashback rewards',
      studentFriendly: true,
      noSsnRequired: false,
      internationalTransfers: true,
      monthlyFee: '$0',
      minimumDeposit: '$0',
      features: [
        'No monthly fees',
        'No minimum balance',
        '1% cashback on debit purchases',
        '60,000+ fee-free ATMs',
        'Great credit cards for students',
      ],
      requirements: [
        'SSN required',
        'US address',
      ],
      website: 'https://www.discover.com/online-banking/checking/',
    },
  ],
  UK: [
    {
      id: 'uk-monzo',
      name: 'Monzo',
      type: 'digital',
      description: 'Popular digital bank with excellent app and no foreign fees',
      studentFriendly: true,
      internationalTransfers: true,
      monthlyFee: '£0',
      minimumDeposit: '£0',
      features: [
        'Instant spending notifications',
        'No foreign transaction fees',
        'Free withdrawals abroad (up to £200/month)',
        'Split bills with friends',
        'Savings pots with interest',
        'Easy international transfers via Wise',
      ],
      requirements: [
        'UK address',
        'Valid ID (passport/BRP)',
        'Smartphone for app',
      ],
      website: 'https://monzo.com/',
      studentOffers: ['Monzo Student account with interest on up to £4,000'],
    },
    {
      id: 'uk-revolut',
      name: 'Revolut',
      type: 'digital',
      description: 'Fintech bank with multi-currency support',
      studentFriendly: true,
      internationalTransfers: true,
      monthlyFee: '£0 (Standard)',
      minimumDeposit: '£0',
      features: [
        'Hold 30+ currencies',
        'Free international transfers',
        'Commission-free stock trading',
        'Cryptocurrency trading',
        'Virtual cards',
        'Budget analytics',
      ],
      requirements: [
        'Valid passport',
        'Proof of address',
        'Smartphone for app',
      ],
      website: 'https://www.revolut.com/',
    },
    {
      id: 'uk-barclays',
      name: 'Barclays',
      type: 'traditional',
      description: 'Major UK bank with good student accounts',
      studentFriendly: true,
      internationalTransfers: true,
      monthlyFee: '£0',
      minimumDeposit: '£0',
      features: [
        'Student Additions account',
        'Interest-free overdraft',
        'Barclays app with Pingit',
        'Wide branch network',
        'Railcard discount',
      ],
      requirements: [
        'BRP card',
        'UK address',
        'Proof of student status',
        'UCAS confirmation or enrollment letter',
      ],
      website: 'https://www.barclays.co.uk/current-accounts/student-account/',
      studentOffers: ['0% overdraft up to £1,500', 'Free 4-year Railcard'],
    },
    {
      id: 'uk-hsbc',
      name: 'HSBC',
      type: 'traditional',
      description: 'International bank with good services for international students',
      studentFriendly: true,
      internationalTransfers: true,
      monthlyFee: '£0',
      minimumDeposit: '£0',
      features: [
        'Student Bank Account',
        'Interest-free overdraft',
        'Global ATM network',
        'HSBC Global Money for transfers',
        'Linked accounts in home country',
      ],
      requirements: [
        'Valid passport',
        'BRP card',
        'UK address',
        'University confirmation letter',
      ],
      website: 'https://www.hsbc.co.uk/current-accounts/products/student/',
      studentOffers: ['Up to £1,000 interest-free overdraft'],
    },
    {
      id: 'uk-lloyds',
      name: 'Lloyds Bank',
      type: 'traditional',
      description: 'UK high street bank with student-focused accounts',
      studentFriendly: true,
      internationalTransfers: true,
      monthlyFee: '£0',
      minimumDeposit: '£0',
      features: [
        'Student Account',
        'Interest-free overdraft',
        'Mobile banking app',
        'Branch network across UK',
        'Linked savings account',
      ],
      requirements: [
        'BRP card',
        'Passport',
        'UK address',
        'UCAS or enrollment letter',
      ],
      website: 'https://www.lloydsbank.com/current-accounts/student-account.html',
      studentOffers: ['Up to £1,500 interest-free overdraft', '4-year Taste Card'],
    },
    {
      id: 'uk-natwest',
      name: 'NatWest',
      type: 'traditional',
      description: 'UK bank with excellent student benefits',
      studentFriendly: true,
      internationalTransfers: true,
      monthlyFee: '£0',
      minimumDeposit: '£0',
      features: [
        'Student Account',
        'Interest-free overdraft',
        'Free Tastecard',
        'NatWest mobile app',
        'Contactless payments',
      ],
      requirements: [
        'BRP card',
        'UK address',
        'University enrollment proof',
      ],
      website: 'https://www.natwest.com/current-accounts/student-account.html',
      studentOffers: ['Up to £2,000 interest-free overdraft', '4-year Tastecard'],
    },
  ],
  CA: [
    {
      id: 'ca-td',
      name: 'TD Canada Trust',
      type: 'traditional',
      description: 'Major Canadian bank with excellent student programs',
      studentFriendly: true,
      noSinRequired: true,
      internationalTransfers: true,
      monthlyFee: '$0 (student account)',
      minimumDeposit: '$0',
      features: [
        'TD Student Chequing Account',
        'No monthly fee for full-time students',
        'Unlimited transactions',
        'TD Global Transfer for international transfers',
        'Extended hours at many branches',
        'Student credit card options',
      ],
      requirements: [
        'Valid passport',
        'Study permit',
        'Canadian address',
        'Enrollment confirmation',
      ],
      website: 'https://www.td.com/ca/en/personal-banking/products/bank-accounts/chequing-accounts/student-chequing-account',
      studentOffers: ['No monthly fee for students', 'Free unlimited transactions'],
    },
    {
      id: 'ca-rbc',
      name: 'RBC Royal Bank',
      type: 'traditional',
      description: 'Canada\'s largest bank with strong international student support',
      studentFriendly: true,
      noSinRequired: true,
      internationalTransfers: true,
      monthlyFee: '$0 (student account)',
      minimumDeposit: '$0',
      features: [
        'RBC Advantage Banking for Students',
        'No monthly fee',
        'Unlimited debit transactions',
        'RBC Global Money Transfer',
        'Student line of credit',
        'MyAdvisor appointment booking',
      ],
      requirements: [
        'Valid passport',
        'Study permit',
        'Canadian address',
        'School enrollment letter',
      ],
      website: 'https://www.rbcroyalbank.com/student-solution/index.html',
      studentOffers: ['$0 monthly fee', 'Cash bonus for new accounts'],
    },
    {
      id: 'ca-scotiabank',
      name: 'Scotiabank',
      type: 'traditional',
      description: 'International bank with Scene+ rewards program',
      studentFriendly: true,
      noSinRequired: true,
      internationalTransfers: true,
      monthlyFee: '$0 (student account)',
      minimumDeposit: '$0',
      features: [
        'Student Banking Advantage Plan',
        'Scene+ rewards points',
        'Global ATM Alliance (free withdrawals)',
        'Scotiabank GlobalPlus account',
        'No-fee international transfers to select countries',
      ],
      requirements: [
        'Valid passport',
        'Study permit',
        'Canadian address',
        'Enrollment verification',
      ],
      website: 'https://www.scotiabank.com/ca/en/personal/bank-accounts/students.html',
      studentOffers: ['Scene+ points with purchases', 'Global ATM Alliance access'],
    },
    {
      id: 'ca-bmo',
      name: 'BMO Bank of Montreal',
      type: 'traditional',
      description: 'Established Canadian bank with student-focused services',
      studentFriendly: true,
      noSinRequired: true,
      internationalTransfers: true,
      monthlyFee: '$0 (student account)',
      minimumDeposit: '$0',
      features: [
        'BMO Student Account',
        'No monthly fee',
        'Unlimited transactions',
        'BMO Global Money Transfer',
        'Student Mastercard',
      ],
      requirements: [
        'Valid passport',
        'Study permit',
        'Proof of enrollment',
        'Canadian address',
      ],
      website: 'https://www.bmo.com/main/personal/bank-accounts/student-banking/',
      studentOffers: ['No monthly fee for students', 'SPC membership'],
    },
    {
      id: 'ca-cibc',
      name: 'CIBC',
      type: 'traditional',
      description: 'Canadian bank with good digital banking features',
      studentFriendly: true,
      noSinRequired: true,
      internationalTransfers: true,
      monthlyFee: '$0 (student account)',
      minimumDeposit: '$0',
      features: [
        'CIBC Smart Account for Students',
        'No monthly fee',
        'Unlimited everyday banking',
        'CIBC Global Money Transfer',
        'CIBC Aventura for students',
      ],
      requirements: [
        'Valid passport',
        'Study permit',
        'Enrollment verification',
        'Canadian address',
      ],
      website: 'https://www.cibc.com/en/personal-banking/bank-accounts/chequing-accounts/smart-for-students.html',
      studentOffers: ['Unlimited free transactions', 'No monthly fee'],
    },
    {
      id: 'ca-wise',
      name: 'Wise',
      type: 'digital',
      description: 'Best rates for international money transfers',
      studentFriendly: true,
      noSinRequired: true,
      internationalTransfers: true,
      monthlyFee: '$0',
      minimumDeposit: '$0',
      features: [
        'Hold 40+ currencies',
        'Best exchange rates',
        'Low-cost international transfers',
        'Multi-currency debit card',
        'Direct debits in CAD, USD, GBP, EUR',
      ],
      requirements: [
        'Valid ID (passport)',
        'Canadian address',
        'Email and phone number',
      ],
      website: 'https://wise.com/',
    },
  ],
};

// =============================================================================
// COUNTRY DISPLAY CONFIGURATION
// =============================================================================

export interface CountryDisplayConfig {
  name: string;
  flag: string;
  currency: string;
  currencySymbol: string;
  emergencyNumber: string;
  timezone: string;
  officialLanguages: string[];
  studentPopularCities: string[];
}

export const COUNTRY_DISPLAY: Record<Country, CountryDisplayConfig> = {
  US: {
    name: 'United States',
    flag: '🇺🇸',
    currency: 'USD',
    currencySymbol: '$',
    emergencyNumber: '911',
    timezone: 'Multiple (EST, CST, MST, PST)',
    officialLanguages: ['English'],
    studentPopularCities: ['New York', 'Los Angeles', 'Boston', 'San Francisco', 'Chicago'],
  },
  UK: {
    name: 'United Kingdom',
    flag: '🇬🇧',
    currency: 'GBP',
    currencySymbol: '£',
    emergencyNumber: '999',
    timezone: 'GMT/BST',
    officialLanguages: ['English'],
    studentPopularCities: ['London', 'Manchester', 'Edinburgh', 'Birmingham', 'Bristol'],
  },
  CA: {
    name: 'Canada',
    flag: '🇨🇦',
    currency: 'CAD',
    currencySymbol: '$',
    emergencyNumber: '911',
    timezone: 'Multiple (EST, CST, MST, PST)',
    officialLanguages: ['English', 'French'],
    studentPopularCities: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa'],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getVisaTypes(country: Country): VisaType[] {
  return VISA_TYPES[country] || [];
}

export function getRequiredDocuments(country: Country): RequiredDocument[] {
  return REQUIRED_DOCUMENTS[country] || [];
}

export function getHealthInsurance(country: Country): HealthInsuranceOption[] {
  return HEALTH_INSURANCE[country] || [];
}

export function getBanks(country: Country): Bank[] {
  return BANKS[country] || [];
}

export function getStudentFriendlyBanks(country: Country): Bank[] {
  return BANKS[country]?.filter(bank => bank.studentFriendly) || [];
}

export function getBanksNoIdRequired(country: Country): Bank[] {
  if (country === 'US') {
    return BANKS.US.filter(bank => bank.noSsnRequired);
  }
  if (country === 'CA') {
    return BANKS.CA.filter(bank => bank.noSinRequired);
  }
  return BANKS[country] || [];
}

export function getCountryDisplay(country: Country): CountryDisplayConfig {
  return COUNTRY_DISPLAY[country];
}

export function getAllCountries(): Country[] {
  return ['US', 'UK', 'CA'];
}
