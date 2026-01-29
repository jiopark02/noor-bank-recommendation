// Universities & Community Colleges Database
// Re-exports from comprehensive universities database + transfer agreements

// Import from comprehensive database
import {
  ALL_UNIVERSITIES,
  searchUniversities,
  getUniversityById,
  getCommunityColleges as getComprehensiveCCs,
  getUniversitiesOnly,
  getUniversitiesByState,
  University as ComprehensiveUniversity,
  InstitutionType,
  CampusType,
} from './universities';

// Re-export types
export type { InstitutionType, CampusType };

// Map to compatible format
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
  primary_color?: string;
  secondary_color?: string;
  logo_url?: string;
  mascot?: string;
}

// Convert comprehensive university to legacy format
function toUniversity(u: ComprehensiveUniversity): University {
  return {
    id: u.id,
    name: u.name,
    short_name: u.short_name,
    type: u.type,
    state: u.state,
    city: u.city,
    zip: u.zip_code,
    latitude: u.latitude,
    longitude: u.longitude,
    website: u.website,
    enrollment: u.enrollment || 0,
    is_public: u.is_public,
    has_international_students: (u.international_students || 0) > 0,
    international_student_count: u.international_students,
    primary_color: u.primary_color,
    secondary_color: u.secondary_color,
  };
}

// All institutions in legacy format
export const ALL_INSTITUTIONS: University[] = ALL_UNIVERSITIES.map(toUniversity);

// Export transfer agreements and deadlines
export interface TransferAgreement {
  cc_id: string;
  university_id: string;
  agreement_type: 'TAG' | 'TAA' | 'ADT' | 'MOU' | 'general';
  guaranteed_admission: boolean;
  gpa_requirement: number;
  units_required: number;
  majors_available: string[];
  deadline_fall: string;
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
    university_id: 'ucdavis',
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
    university_id: 'ucmerced',
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
    university_id: 'uc-berkeley',
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
    university_id: 'ucdavis',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.3,
    units_required: 60,
    majors_available: ['Computer Science', 'Economics', 'Psychology'],
    deadline_fall: '09-30',
  },
  // Foothill College
  {
    cc_id: 'foothill',
    university_id: 'uci',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.4,
    units_required: 60,
    majors_available: ['Computer Science', 'Business', 'Engineering'],
    deadline_fall: '09-30',
  },
  {
    cc_id: 'foothill',
    university_id: 'ucsd',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.5,
    units_required: 60,
    majors_available: ['Economics', 'Political Science'],
    deadline_fall: '09-30',
  },
  {
    cc_id: 'foothill',
    university_id: 'ucsb',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.2,
    units_required: 60,
    majors_available: ['Economics', 'Communications'],
    deadline_fall: '09-30',
  },
  // Orange Coast College
  {
    cc_id: 'orange-coast',
    university_id: 'uci',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.4,
    units_required: 60,
    majors_available: ['Business', 'Computer Science', 'Biology'],
    deadline_fall: '09-30',
  },
  // Irvine Valley College
  {
    cc_id: 'irvine-valley',
    university_id: 'uci',
    agreement_type: 'TAG',
    guaranteed_admission: true,
    gpa_requirement: 3.4,
    units_required: 60,
    majors_available: ['Business', 'Computer Science', 'Biology', 'Engineering'],
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
    university_id: 'uc-berkeley',
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
    university_id: 'ucdavis',
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

// Helper functions
export function getInstitutionById(id: string): University | undefined {
  const u = getUniversityById(id);
  return u ? toUniversity(u) : undefined;
}

export function getInstitutionsByState(state: string): University[] {
  return getUniversitiesByState(state).map(toUniversity);
}

export function getInstitutionsByType(type: InstitutionType): University[] {
  return ALL_INSTITUTIONS.filter(inst => inst.type === type);
}

export function getCommunityColleges(): University[] {
  return getComprehensiveCCs().map(toUniversity);
}

export function getUniversities(): University[] {
  return getUniversitiesOnly().map(toUniversity);
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

// Search function (uses comprehensive search)
export function searchInstitutions(query: string, limit: number = 20): University[] {
  return searchUniversities(query, { limit }).map(toUniversity);
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
