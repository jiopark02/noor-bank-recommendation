// Universities & Community Colleges Database
// Includes 4-year universities, community colleges, and technical colleges

export type InstitutionType = 'university' | 'community_college' | 'technical_college';

export interface University {
  id: string;
  name: string;
  short_name: string;
  type: InstitutionType;
  state: string;
  city: string;
  zip: string;
  latitude: number;
  longitude: number;
  website: string;
  enrollment: number;
  is_public: boolean;
  has_international_students: boolean;
  international_student_count?: number;
  // Theme properties
  primary_color?: string;
  secondary_color?: string;
  logo_url?: string;
  mascot?: string;
}

export interface TransferAgreement {
  cc_id: string;
  university_id: string;
  agreement_type: 'TAG' | 'TAA' | 'ADT' | 'MOU' | 'general';
  guaranteed_admission: boolean;
  gpa_requirement: number;
  units_required: number;
  majors_available: string[];
  deadline_fall: string; // MM-DD format
  deadline_spring?: string;
  notes?: string;
}

export interface TransferDeadline {
  university_id: string;
  term: 'fall' | 'spring' | 'winter';
  year: number;
  application_open: string;
  application_deadline: string;
  priority_deadline?: string;
  decision_date?: string;
}

// Major California Community Colleges
export const CALIFORNIA_COMMUNITY_COLLEGES: University[] = [
  {
    id: 'de-anza',
    name: 'De Anza College',
    short_name: 'De Anza',
    type: 'community_college',
    state: 'CA',
    city: 'Cupertino',
    zip: '95014',
    latitude: 37.3189,
    longitude: -122.0449,
    website: 'https://www.deanza.edu',
    enrollment: 22000,
    is_public: true,
    has_international_students: true,
    international_student_count: 2500,
  },
  {
    id: 'foothill',
    name: 'Foothill College',
    short_name: 'Foothill',
    type: 'community_college',
    state: 'CA',
    city: 'Los Altos Hills',
    zip: '94022',
    latitude: 37.3614,
    longitude: -122.1278,
    website: 'https://www.foothill.edu',
    enrollment: 15000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1800,
  },
  {
    id: 'santa-monica',
    name: 'Santa Monica College',
    short_name: 'SMC',
    type: 'community_college',
    state: 'CA',
    city: 'Santa Monica',
    zip: '90405',
    latitude: 34.0152,
    longitude: -118.4696,
    website: 'https://www.smc.edu',
    enrollment: 30000,
    is_public: true,
    has_international_students: true,
    international_student_count: 3000,
  },
  {
    id: 'pasadena-cc',
    name: 'Pasadena City College',
    short_name: 'PCC',
    type: 'community_college',
    state: 'CA',
    city: 'Pasadena',
    zip: '91106',
    latitude: 34.1408,
    longitude: -118.1216,
    website: 'https://www.pasadena.edu',
    enrollment: 27000,
    is_public: true,
    has_international_students: true,
    international_student_count: 2200,
  },
  {
    id: 'diablo-valley',
    name: 'Diablo Valley College',
    short_name: 'DVC',
    type: 'community_college',
    state: 'CA',
    city: 'Pleasant Hill',
    zip: '94523',
    latitude: 37.9535,
    longitude: -122.0565,
    website: 'https://www.dvc.edu',
    enrollment: 20000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1500,
  },
  {
    id: 'orange-coast',
    name: 'Orange Coast College',
    short_name: 'OCC',
    type: 'community_college',
    state: 'CA',
    city: 'Costa Mesa',
    zip: '92626',
    latitude: 33.6698,
    longitude: -117.9125,
    website: 'https://www.orangecoastcollege.edu',
    enrollment: 22000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1200,
  },
  {
    id: 'irvine-valley',
    name: 'Irvine Valley College',
    short_name: 'IVC',
    type: 'community_college',
    state: 'CA',
    city: 'Irvine',
    zip: '92618',
    latitude: 33.6869,
    longitude: -117.8328,
    website: 'https://www.ivc.edu',
    enrollment: 15000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1000,
  },
  {
    id: 'city-college-sf',
    name: 'City College of San Francisco',
    short_name: 'CCSF',
    type: 'community_college',
    state: 'CA',
    city: 'San Francisco',
    zip: '94112',
    latitude: 37.7258,
    longitude: -122.4517,
    website: 'https://www.ccsf.edu',
    enrollment: 60000,
    is_public: true,
    has_international_students: true,
    international_student_count: 3500,
  },
  {
    id: 'mt-sac',
    name: 'Mt. San Antonio College',
    short_name: 'Mt. SAC',
    type: 'community_college',
    state: 'CA',
    city: 'Walnut',
    zip: '91789',
    latitude: 34.0475,
    longitude: -117.8447,
    website: 'https://www.mtsac.edu',
    enrollment: 30000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1800,
  },
  {
    id: 'el-camino',
    name: 'El Camino College',
    short_name: 'El Camino',
    type: 'community_college',
    state: 'CA',
    city: 'Torrance',
    zip: '90506',
    latitude: 33.8673,
    longitude: -118.3523,
    website: 'https://www.elcamino.edu',
    enrollment: 25000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1400,
  },
  {
    id: 'santa-barbara-cc',
    name: 'Santa Barbara City College',
    short_name: 'SBCC',
    type: 'community_college',
    state: 'CA',
    city: 'Santa Barbara',
    zip: '93109',
    latitude: 34.4063,
    longitude: -119.6961,
    website: 'https://www.sbcc.edu',
    enrollment: 16000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1200,
  },
  {
    id: 'glendale-cc',
    name: 'Glendale Community College',
    short_name: 'GCC',
    type: 'community_college',
    state: 'CA',
    city: 'Glendale',
    zip: '91208',
    latitude: 34.1507,
    longitude: -118.2595,
    website: 'https://www.glendale.edu',
    enrollment: 16000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1800,
  },
];

// Major Community Colleges in Other States
export const OTHER_COMMUNITY_COLLEGES: University[] = [
  // Texas
  {
    id: 'austin-cc',
    name: 'Austin Community College',
    short_name: 'ACC',
    type: 'community_college',
    state: 'TX',
    city: 'Austin',
    zip: '78752',
    latitude: 30.3322,
    longitude: -97.7031,
    website: 'https://www.austincc.edu',
    enrollment: 41000,
    is_public: true,
    has_international_students: true,
    international_student_count: 2000,
  },
  {
    id: 'houston-cc',
    name: 'Houston Community College',
    short_name: 'HCC',
    type: 'community_college',
    state: 'TX',
    city: 'Houston',
    zip: '77002',
    latitude: 29.7604,
    longitude: -95.3698,
    website: 'https://www.hccs.edu',
    enrollment: 55000,
    is_public: true,
    has_international_students: true,
    international_student_count: 3000,
  },
  // New York
  {
    id: 'bmcc',
    name: 'Borough of Manhattan Community College',
    short_name: 'BMCC',
    type: 'community_college',
    state: 'NY',
    city: 'New York',
    zip: '10007',
    latitude: 40.7186,
    longitude: -74.0120,
    website: 'https://www.bmcc.cuny.edu',
    enrollment: 27000,
    is_public: true,
    has_international_students: true,
    international_student_count: 2500,
  },
  {
    id: 'laguardia-cc',
    name: 'LaGuardia Community College',
    short_name: 'LaGuardia',
    type: 'community_college',
    state: 'NY',
    city: 'Long Island City',
    zip: '11101',
    latitude: 40.7440,
    longitude: -73.9357,
    website: 'https://www.laguardia.edu',
    enrollment: 20000,
    is_public: true,
    has_international_students: true,
    international_student_count: 2000,
  },
  // Washington
  {
    id: 'seattle-central',
    name: 'Seattle Central College',
    short_name: 'Seattle Central',
    type: 'community_college',
    state: 'WA',
    city: 'Seattle',
    zip: '98122',
    latitude: 47.6165,
    longitude: -122.3212,
    website: 'https://seattlecentral.edu',
    enrollment: 10000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1500,
  },
  {
    id: 'bellevue-college',
    name: 'Bellevue College',
    short_name: 'BC',
    type: 'community_college',
    state: 'WA',
    city: 'Bellevue',
    zip: '98007',
    latitude: 47.5851,
    longitude: -122.1487,
    website: 'https://www.bellevuecollege.edu',
    enrollment: 14000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1200,
  },
  // Illinois
  {
    id: 'harper-college',
    name: 'Harper College',
    short_name: 'Harper',
    type: 'community_college',
    state: 'IL',
    city: 'Palatine',
    zip: '60067',
    latitude: 42.0939,
    longitude: -88.0406,
    website: 'https://www.harpercollege.edu',
    enrollment: 14000,
    is_public: true,
    has_international_students: true,
    international_student_count: 800,
  },
  // Arizona
  {
    id: 'mesa-cc',
    name: 'Mesa Community College',
    short_name: 'MCC',
    type: 'community_college',
    state: 'AZ',
    city: 'Mesa',
    zip: '85202',
    latitude: 33.4152,
    longitude: -111.8315,
    website: 'https://www.mesacc.edu',
    enrollment: 20000,
    is_public: true,
    has_international_students: true,
    international_student_count: 1000,
  },
  // Florida
  {
    id: 'miami-dade',
    name: 'Miami Dade College',
    short_name: 'MDC',
    type: 'community_college',
    state: 'FL',
    city: 'Miami',
    zip: '33132',
    latitude: 25.7790,
    longitude: -80.1889,
    website: 'https://www.mdc.edu',
    enrollment: 120000,
    is_public: true,
    has_international_students: true,
    international_student_count: 6000,
  },
];

// Major 4-Year Universities (UC System, CSU, Private, etc.)
export const UNIVERSITIES: University[] = [
  // UC System
  {
    id: 'ucla',
    name: 'University of California, Los Angeles',
    short_name: 'UCLA',
    type: 'university',
    state: 'CA',
    city: 'Los Angeles',
    zip: '90095',
    latitude: 34.0689,
    longitude: -118.4452,
    website: 'https://www.ucla.edu',
    enrollment: 45000,
    is_public: true,
    has_international_students: true,
    international_student_count: 6500,
  },
  {
    id: 'ucb',
    name: 'University of California, Berkeley',
    short_name: 'UC Berkeley',
    type: 'university',
    state: 'CA',
    city: 'Berkeley',
    zip: '94720',
    latitude: 37.8719,
    longitude: -122.2585,
    website: 'https://www.berkeley.edu',
    enrollment: 45000,
    is_public: true,
    has_international_students: true,
    international_student_count: 7000,
  },
  {
    id: 'uci',
    name: 'University of California, Irvine',
    short_name: 'UC Irvine',
    type: 'university',
    state: 'CA',
    city: 'Irvine',
    zip: '92697',
    latitude: 33.6405,
    longitude: -117.8443,
    website: 'https://www.uci.edu',
    enrollment: 36000,
    is_public: true,
    has_international_students: true,
    international_student_count: 6000,
  },
  {
    id: 'ucsd',
    name: 'University of California, San Diego',
    short_name: 'UC San Diego',
    type: 'university',
    state: 'CA',
    city: 'La Jolla',
    zip: '92093',
    latitude: 32.8801,
    longitude: -117.2340,
    website: 'https://www.ucsd.edu',
    enrollment: 40000,
    is_public: true,
    has_international_students: true,
    international_student_count: 7500,
  },
  {
    id: 'ucsb',
    name: 'University of California, Santa Barbara',
    short_name: 'UCSB',
    type: 'university',
    state: 'CA',
    city: 'Santa Barbara',
    zip: '93106',
    latitude: 34.4140,
    longitude: -119.8489,
    website: 'https://www.ucsb.edu',
    enrollment: 26000,
    is_public: true,
    has_international_students: true,
    international_student_count: 3500,
  },
  {
    id: 'ucd',
    name: 'University of California, Davis',
    short_name: 'UC Davis',
    type: 'university',
    state: 'CA',
    city: 'Davis',
    zip: '95616',
    latitude: 38.5382,
    longitude: -121.7617,
    website: 'https://www.ucdavis.edu',
    enrollment: 40000,
    is_public: true,
    has_international_students: true,
    international_student_count: 5000,
  },
  {
    id: 'ucsc',
    name: 'University of California, Santa Cruz',
    short_name: 'UCSC',
    type: 'university',
    state: 'CA',
    city: 'Santa Cruz',
    zip: '95064',
    latitude: 36.9916,
    longitude: -122.0583,
    website: 'https://www.ucsc.edu',
    enrollment: 19000,
    is_public: true,
    has_international_students: true,
    international_student_count: 2000,
  },
  {
    id: 'ucr',
    name: 'University of California, Riverside',
    short_name: 'UCR',
    type: 'university',
    state: 'CA',
    city: 'Riverside',
    zip: '92521',
    latitude: 33.9737,
    longitude: -117.3280,
    website: 'https://www.ucr.edu',
    enrollment: 26000,
    is_public: true,
    has_international_students: true,
    international_student_count: 2500,
  },
  {
    id: 'ucm',
    name: 'University of California, Merced',
    short_name: 'UC Merced',
    type: 'university',
    state: 'CA',
    city: 'Merced',
    zip: '95343',
    latitude: 37.3660,
    longitude: -120.4239,
    website: 'https://www.ucmerced.edu',
    enrollment: 9000,
    is_public: true,
    has_international_students: true,
    international_student_count: 500,
  },
  // Private Universities
  {
    id: 'stanford',
    name: 'Stanford University',
    short_name: 'Stanford',
    type: 'university',
    state: 'CA',
    city: 'Stanford',
    zip: '94305',
    latitude: 37.4275,
    longitude: -122.1697,
    website: 'https://www.stanford.edu',
    enrollment: 17000,
    is_public: false,
    has_international_students: true,
    international_student_count: 3500,
  },
  {
    id: 'usc',
    name: 'University of Southern California',
    short_name: 'USC',
    type: 'university',
    state: 'CA',
    city: 'Los Angeles',
    zip: '90089',
    latitude: 34.0224,
    longitude: -118.2851,
    website: 'https://www.usc.edu',
    enrollment: 47000,
    is_public: false,
    has_international_students: true,
    international_student_count: 11000,
  },
  // Other Major Universities
  {
    id: 'nyu',
    name: 'New York University',
    short_name: 'NYU',
    type: 'university',
    state: 'NY',
    city: 'New York',
    zip: '10003',
    latitude: 40.7295,
    longitude: -73.9965,
    website: 'https://www.nyu.edu',
    enrollment: 52000,
    is_public: false,
    has_international_students: true,
    international_student_count: 12000,
  },
  {
    id: 'columbia',
    name: 'Columbia University',
    short_name: 'Columbia',
    type: 'university',
    state: 'NY',
    city: 'New York',
    zip: '10027',
    latitude: 40.8075,
    longitude: -73.9626,
    website: 'https://www.columbia.edu',
    enrollment: 33000,
    is_public: false,
    has_international_students: true,
    international_student_count: 8000,
  },
  {
    id: 'northeastern',
    name: 'Northeastern University',
    short_name: 'Northeastern',
    type: 'university',
    state: 'MA',
    city: 'Boston',
    zip: '02115',
    latitude: 42.3398,
    longitude: -71.0892,
    website: 'https://www.northeastern.edu',
    enrollment: 22000,
    is_public: false,
    has_international_students: true,
    international_student_count: 5500,
  },
  {
    id: 'bu',
    name: 'Boston University',
    short_name: 'BU',
    type: 'university',
    state: 'MA',
    city: 'Boston',
    zip: '02215',
    latitude: 42.3505,
    longitude: -71.1054,
    website: 'https://www.bu.edu',
    enrollment: 35000,
    is_public: false,
    has_international_students: true,
    international_student_count: 8000,
  },
  {
    id: 'cornell',
    name: 'Cornell University',
    short_name: 'Cornell',
    type: 'university',
    state: 'NY',
    city: 'Ithaca',
    zip: '14850',
    latitude: 42.4534,
    longitude: -76.4735,
    website: 'https://www.cornell.edu',
    enrollment: 25000,
    is_public: false,
    has_international_students: true,
    international_student_count: 5000,
  },
  {
    id: 'uiuc',
    name: 'University of Illinois Urbana-Champaign',
    short_name: 'UIUC',
    type: 'university',
    state: 'IL',
    city: 'Champaign',
    zip: '61820',
    latitude: 40.1020,
    longitude: -88.2272,
    website: 'https://www.illinois.edu',
    enrollment: 56000,
    is_public: true,
    has_international_students: true,
    international_student_count: 11000,
  },
  {
    id: 'umich',
    name: 'University of Michigan',
    short_name: 'Michigan',
    type: 'university',
    state: 'MI',
    city: 'Ann Arbor',
    zip: '48109',
    latitude: 42.2780,
    longitude: -83.7382,
    website: 'https://www.umich.edu',
    enrollment: 47000,
    is_public: true,
    has_international_students: true,
    international_student_count: 7500,
  },
  {
    id: 'uw',
    name: 'University of Washington',
    short_name: 'UW',
    type: 'university',
    state: 'WA',
    city: 'Seattle',
    zip: '98195',
    latitude: 47.6553,
    longitude: -122.3035,
    website: 'https://www.washington.edu',
    enrollment: 48000,
    is_public: true,
    has_international_students: true,
    international_student_count: 7000,
  },
  {
    id: 'ut-austin',
    name: 'University of Texas at Austin',
    short_name: 'UT Austin',
    type: 'university',
    state: 'TX',
    city: 'Austin',
    zip: '78712',
    latitude: 30.2849,
    longitude: -97.7341,
    website: 'https://www.utexas.edu',
    enrollment: 52000,
    is_public: true,
    has_international_students: true,
    international_student_count: 5500,
  },
];

// TAG (Transfer Admission Guarantee) - California only
export const TAG_AGREEMENTS: TransferAgreement[] = [
  // De Anza to UCs
  {
    cc_id: 'de-anza',
    university_id: 'uci',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.4,
    units_required: 60,
    majors_available: ['Computer Science', 'Business', 'Engineering', 'Biology', 'Psychology'],
    deadline_fall: '09-30',
    notes: 'Must complete IGETC or major prep',
  },
  {
    cc_id: 'de-anza',
    university_id: 'ucsd',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.5,
    units_required: 60,
    majors_available: ['Economics', 'Political Science', 'Communications', 'Sociology'],
    deadline_fall: '09-30',
  },
  {
    cc_id: 'de-anza',
    university_id: 'ucsb',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.2,
    units_required: 60,
    majors_available: ['Economics', 'Sociology', 'Communications', 'English', 'History'],
    deadline_fall: '09-30',
  },
  {
    cc_id: 'de-anza',
    university_id: 'ucd',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.3,
    units_required: 60,
    majors_available: ['Computer Science', 'Economics', 'Psychology', 'Communications'],
    deadline_fall: '09-30',
  },
  {
    cc_id: 'de-anza',
    university_id: 'ucsc',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.0,
    units_required: 60,
    majors_available: ['Computer Science', 'Psychology', 'Economics', 'Business'],
    deadline_fall: '09-30',
  },
  {
    cc_id: 'de-anza',
    university_id: 'ucr',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.0,
    units_required: 60,
    majors_available: ['Business', 'Computer Science', 'Engineering', 'Biology'],
    deadline_fall: '09-30',
  },
  {
    cc_id: 'de-anza',
    university_id: 'ucm',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 2.8,
    units_required: 60,
    majors_available: ['All majors'],
    deadline_fall: '09-30',
  },
  // Santa Monica College to UCs
  {
    cc_id: 'santa-monica',
    university_id: 'ucla',
    agreement_type: 'TAA',
    guaranteed_admission: false,
    gpa_requirement: 3.7,
    units_required: 60,
    majors_available: ['Economics', 'Political Science', 'Sociology', 'Communications'],
    deadline_fall: '11-30',
    notes: 'TAP (Transfer Alliance Program) - not guaranteed but priority consideration',
  },
  {
    cc_id: 'santa-monica',
    university_id: 'uci',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.4,
    units_required: 60,
    majors_available: ['Business', 'Computer Science', 'Psychology', 'Biology'],
    deadline_fall: '09-30',
  },
  {
    cc_id: 'santa-monica',
    university_id: 'ucsb',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.2,
    units_required: 60,
    majors_available: ['Economics', 'Communications', 'English', 'Sociology'],
    deadline_fall: '09-30',
  },
  // Pasadena City College
  {
    cc_id: 'pasadena-cc',
    university_id: 'uci',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.4,
    units_required: 60,
    majors_available: ['Engineering', 'Business', 'Biology', 'Computer Science'],
    deadline_fall: '09-30',
  },
  {
    cc_id: 'pasadena-cc',
    university_id: 'ucsb',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.2,
    units_required: 60,
    majors_available: ['Economics', 'Psychology', 'Communications'],
    deadline_fall: '09-30',
  },
  // Diablo Valley College
  {
    cc_id: 'diablo-valley',
    university_id: 'ucb',
    agreement_type: 'MOU',
    guaranteed_admission: false,
    gpa_requirement: 3.8,
    units_required: 60,
    majors_available: ['Letters and Sciences'],
    deadline_fall: '11-30',
    notes: 'Top feeder to UC Berkeley',
  },
  {
    cc_id: 'diablo-valley',
    university_id: 'ucd',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.3,
    units_required: 60,
    majors_available: ['Computer Science', 'Economics', 'Psychology'],
    deadline_fall: '09-30',
  },
];

// Transfer Deadlines for Fall 2026
export const TRANSFER_DEADLINES: TransferDeadline[] = [
  // UC System
  {
    university_id: 'ucla',
    term: 'fall',
    year: 2026,
    application_open: '2025-08-01',
    application_deadline: '2025-11-30',
    decision_date: '2026-04-15',
  },
  {
    university_id: 'ucb',
    term: 'fall',
    year: 2026,
    application_open: '2025-08-01',
    application_deadline: '2025-11-30',
    decision_date: '2026-04-15',
  },
  {
    university_id: 'uci',
    term: 'fall',
    year: 2026,
    application_open: '2025-08-01',
    application_deadline: '2025-11-30',
    decision_date: '2026-04-15',
  },
  {
    university_id: 'ucsd',
    term: 'fall',
    year: 2026,
    application_open: '2025-08-01',
    application_deadline: '2025-11-30',
    decision_date: '2026-04-15',
  },
  {
    university_id: 'ucsb',
    term: 'fall',
    year: 2026,
    application_open: '2025-08-01',
    application_deadline: '2025-11-30',
    decision_date: '2026-04-15',
  },
  {
    university_id: 'ucd',
    term: 'fall',
    year: 2026,
    application_open: '2025-08-01',
    application_deadline: '2025-11-30',
    decision_date: '2026-04-15',
  },
  // TAG Deadline
  {
    university_id: 'uci',
    term: 'fall',
    year: 2026,
    application_open: '2025-09-01',
    application_deadline: '2025-09-30',
    priority_deadline: '2025-09-30',
    decision_date: '2025-11-15',
  },
];

// Combine all institutions
export const ALL_INSTITUTIONS: University[] = [
  ...CALIFORNIA_COMMUNITY_COLLEGES,
  ...OTHER_COMMUNITY_COLLEGES,
  ...UNIVERSITIES,
];

// Helper functions
export function getInstitutionById(id: string): University | undefined {
  return ALL_INSTITUTIONS.find(inst => inst.id === id);
}

export function getInstitutionsByState(state: string): University[] {
  return ALL_INSTITUTIONS.filter(inst => inst.state === state);
}

export function getInstitutionsByType(type: InstitutionType): University[] {
  return ALL_INSTITUTIONS.filter(inst => inst.type === type);
}

export function getCommunityColleges(): University[] {
  return ALL_INSTITUTIONS.filter(inst => inst.type === 'community_college');
}

export function getUniversities(): University[] {
  return ALL_INSTITUTIONS.filter(inst => inst.type === 'university');
}

export function getTransferAgreements(ccId: string): TransferAgreement[] {
  return TAG_AGREEMENTS.filter(ta => ta.cc_id === ccId);
}

export function getTransferDeadlines(universityId: string): TransferDeadline[] {
  return TRANSFER_DEADLINES.filter(td => td.university_id === universityId);
}

export function getTAGEligibleUniversities(ccId: string): University[] {
  const agreements = TAG_AGREEMENTS.filter(
    ta => ta.cc_id === ccId && ta.agreement_type === 'TAG'
  );
  return agreements
    .map(ta => getInstitutionById(ta.university_id))
    .filter((u): u is University => u !== undefined);
}

export function calculateDaysUntilDeadline(deadline: string): number {
  const target = new Date(deadline);
  const now = new Date();
  const diffTime = target.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Storage
const STORAGE_KEY_TRANSFER_GOALS = 'noor_transfer_goals';

export interface TransferGoal {
  target_university_id: string;
  target_major: string;
  target_term: 'fall' | 'spring';
  target_year: number;
  current_gpa: number;
  units_completed: number;
}

export function getTransferGoals(): TransferGoal[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TRANSFER_GOALS);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveTransferGoal(goal: TransferGoal): void {
  if (typeof window === 'undefined') return;
  const goals = getTransferGoals();
  goals.push(goal);
  localStorage.setItem(STORAGE_KEY_TRANSFER_GOALS, JSON.stringify(goals));
}

export function removeTransferGoal(universityId: string): void {
  if (typeof window === 'undefined') return;
  const goals = getTransferGoals().filter(g => g.target_university_id !== universityId);
  localStorage.setItem(STORAGE_KEY_TRANSFER_GOALS, JSON.stringify(goals));
}
