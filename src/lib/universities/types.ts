// ============================================================================
// UNIVERSITY DATABASE TYPES
// ============================================================================

export type InstitutionType = 'university' | 'community_college' | 'technical_college';
export type CampusType = 'main' | 'branch' | 'satellite' | 'online' | 'regional';

export interface University {
  id: string;
  name: string;
  short_name: string;
  system_name?: string;
  city: string;
  state: string;
  zip_code: string;
  latitude: number;
  longitude: number;
  type: InstitutionType;
  campus_type: CampusType;
  enrollment?: number;
  international_students?: number;
  international_percentage?: number;
  is_public: boolean;
  primary_color: string;
  secondary_color: string;
  website: string;
  aliases?: string[];
}

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

export interface SearchResult {
  university: University;
  matchScore: number;
  matchedOn: string[];
}
