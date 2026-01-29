/**
 * Noor Database Types
 * Supabase Table Type Definitions
 */

export interface User {
  id: string;
  created_at: string;
  updated_at: string;
  email: string;
  first_name: string;
  last_name?: string;
  country_of_origin?: string;
  profile_picture?: string;
  university?: string;
  student_status?: string;
  year_in_program?: number;
  visa_type?: 'F1' | 'J1' | 'M1' | 'OPT' | 'CPT' | 'H1B' | 'other';
  major?: string;
  gpa?: number;
  student_level?: 'undergraduate' | 'graduate' | 'phd' | 'language_program' | 'other';
  arrival_date?: string;
  has_ssn: boolean;
  has_itin: boolean;
  has_us_address: boolean;
  has_us_credit_history: boolean;
  preferred_bank_type?: string;
  monthly_income: number;
  expected_monthly_spending: number;
  monthly_budget: number;
  primary_banking_needs?: string[];
  international_transfers?: string;
  international_transfer_frequency?: 'never' | 'rarely' | 'monthly' | 'weekly';
  avg_transfer_amount?: number;
  primary_goals?: string[];
  credit_goals?: string;
  campus_proximity?: string;
  fee_sensitivity?: 'low' | 'medium' | 'high';
  digital_preference?: string;
  prefers_online_banking: boolean;
  needs_nearby_branch: boolean;
  needs_zelle: boolean;
  risk_tolerance?: string;
  preferred_language: string;
  preferred_bedrooms?: number;
  preferred_max_rent?: number;
  preferred_max_distance_miles?: number;
  preferred_amenities?: string[];
  onboarding_completed: boolean;
  onboarding_step: number;
  campus_side?: 'north' | 'south' | 'east' | 'west' | 'center';
  onboarding_checklist_completed?: boolean;
  checklist_completed_at?: string;
}

export interface BankAccount {
  id: string;
  bank_name: string;
  account_type: string;
  monthly_fee: number;
  monthly_fee_waiver?: string;
  min_balance: number;
  min_opening_deposit: number;
  atm_network?: string;
  atm_count: number;
  branch_count: number;
  foreign_transaction_fee: number;
  intl_wire_outgoing: number;
  intl_wire_incoming: number;
  ssn_required_online: boolean;
  can_open_without_ssn: boolean;
  itin_accepted: boolean;
  requires_in_person_for_no_ssn: boolean;
  online_requirements?: string;
  in_person_requirements?: string;
  no_ssn_note?: string;
  required_docs?: Record<string, unknown>;
  has_zelle: boolean;
  has_mobile_deposit: boolean;
  has_overdraft_protection: boolean;
  savings_apy: number;
  available_states?: string[];
  is_nationwide: boolean;
  is_online_only: boolean;
  has_student_account: boolean;
  student_age_max: number;
  intl_student_friendly: boolean;
  intl_student_score: number;
  opening_difficulty: number;
  digital_experience_score: number;
  customer_service_score: number;
  supported_languages?: string[];
  pros?: string[];
  cons?: string[];
  important_notes?: string[];
  apply_link?: string;
  logo_url?: string;
  display_priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Apartment {
  id: string;
  name: string;
  address: string;
  university: string;
  bedrooms: string;
  bathrooms: string;
  price_min: number;
  price_max: number;
  shared_price_min?: number;
  shared_price_max?: number;
  sqft_min: number;
  sqft_max: number;
  walking_minutes: number;
  biking_minutes: number;
  transit_minutes: number;
  driving_minutes: number;
  amenities?: Record<string, unknown>;
  features?: Record<string, unknown>;
  images?: string[];
  lease_terms?: Record<string, unknown>;
  utilities?: Record<string, unknown>;
  rating: number;
  review_count: number;
  available_units: number;
  pet_policy: string;
  contact_phone?: string;
  contact_email?: string;
  contact_website?: string;
  latitude?: number;
  longitude?: number;
  campus_side?: 'north' | 'south' | 'east' | 'west' | 'center';
  furnished: boolean;
  gym: boolean;
  parking: boolean;
  woman_only: boolean;
  verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface Scholarship {
  id: string;
  name: string;
  provider: string;
  description?: string;
  amount_min?: number;
  amount_max?: number;
  deadline?: string;
  deadline_notes?: string;
  category?: string;
  type?: string;
  eligibility_f1: boolean;
  eligibility_j1: boolean;
  min_gpa?: number;
  requirements?: string[];
  benefits?: string[];
  application_tips?: string[];
  apply_link?: string;
  universities?: string[];
  is_nationwide: boolean;
  majors?: string[];
  student_level?: string[];
  created_at: string;
  updated_at: string;
}

export interface Recommendation {
  id: string;
  user_id: string;
  recommendation_type: 'bank' | 'apartment' | 'scholarship';
  bank_account_id?: string;
  apartment_id?: string;
  scholarship_id?: string;
  fit_score: number;
  score_breakdown?: Record<string, number>;
  reasons?: string[];
  warnings?: string[];
  is_viewed: boolean;
  is_saved: boolean;
  is_dismissed: boolean;
  user_rating?: number;
  user_feedback?: string;
  algorithm_version: string;
  created_at: string;
  updated_at: string;
}

export interface SavedBank {
  id: string;
  user_id: string;
  bank_account_id: string;
  notes?: string;
  created_at: string;
}

export interface SavedApartment {
  id: string;
  user_id: string;
  apartment_id: string;
  notes?: string;
  created_at: string;
}

export interface SavedScholarship {
  id: string;
  user_id: string;
  scholarship_id: string;
  notes?: string;
  application_status: 'not_started' | 'in_progress' | 'submitted' | 'accepted' | 'rejected';
  created_at: string;
}
