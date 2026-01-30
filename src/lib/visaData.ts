// Country-Aware Visa Tracker Data
// Supports US (F-1/OPT/CPT), UK (Tier 4/BRP/CAS), Canada (Study Permit/PGWP)

import { Country } from './countryConfig';

// =============================================================================
// TYPES
// =============================================================================

// US Visa Types
export type USVisaType = 'F-1' | 'J-1' | 'H-1B' | 'OPT' | 'CPT';

// UK Visa Types
export type UKVisaType = 'Student' | 'Graduate' | 'Skilled Worker' | 'Youth Mobility';

// Canada Visa Types
export type CAVisaType = 'Study Permit' | 'PGWP' | 'Co-op Work Permit' | 'Work Permit';

export type VisaType = USVisaType | UKVisaType | CAVisaType;

// Base visa info interface
export interface BaseVisaInfo {
  user_id: string;
  country: Country;
  visa_type: VisaType;
  visa_expiry_date: string;
  program_end_date: string;
  grace_period_end: string | null;
}

// US-specific visa info
export interface USVisaInfo extends BaseVisaInfo {
  country: 'US';
  visa_type: USVisaType;
  i20_expiry_date: string;
  opt_start_date: string | null;
  opt_end_date: string | null;
  cpt_start_date: string | null;
  cpt_end_date: string | null;
  stem_opt_extension: boolean;
  sevis_id: string;
}

// UK-specific visa info
export interface UKVisaInfo extends BaseVisaInfo {
  country: 'UK';
  visa_type: UKVisaType;
  brp_expiry_date: string;
  cas_number: string;
  cas_used_date: string;
  share_code: string | null; // For right to work checks
  nhs_surcharge_paid: boolean;
  police_registration_required: boolean;
  police_registration_done: boolean;
  allowed_work_hours: number; // 20 during term, 40 during holidays
}

// Canada-specific visa info
export interface CAVisaInfo extends BaseVisaInfo {
  country: 'CA';
  visa_type: CAVisaType;
  study_permit_expiry: string;
  pgwp_start_date: string | null;
  pgwp_end_date: string | null;
  coop_permit_expiry: string | null;
  sin_number: string | null;
  dli_number: string; // Designated Learning Institution
  provincial_health_enrolled: boolean;
  biometrics_done: boolean;
}

export type VisaInfo = USVisaInfo | UKVisaInfo | CAVisaInfo;

// Checklist item
export interface VisaChecklist {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  due_date: string | null;
  priority: 'high' | 'medium' | 'low';
  country: Country;
}

// Reminder
export interface VisaReminder {
  id: string;
  type: string;
  title: string;
  message: string;
  date: string;
  days_until: number;
  severity: 'urgent' | 'warning' | 'info';
}

// Timeline event
export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  type: 'start' | 'end' | 'deadline' | 'milestone';
  status: 'completed' | 'current' | 'upcoming';
  description?: string;
}

// Status item
export interface StatusItem {
  id: string;
  label: string;
  status: 'active' | 'warning' | 'inactive';
  description: string;
}

// =============================================================================
// STORAGE
// =============================================================================

const STORAGE_KEY_VISA = 'noor_visa_info';
const STORAGE_KEY_CHECKLIST = 'noor_visa_checklist';
const STORAGE_KEY_COUNTRY = 'noor_selected_country';

// =============================================================================
// DEFAULT DATA - US
// =============================================================================

const DEFAULT_US_VISA_INFO: USVisaInfo = {
  user_id: 'current_user',
  country: 'US',
  visa_type: 'F-1',
  visa_expiry_date: '2027-05-15',
  i20_expiry_date: '2026-05-20',
  opt_start_date: null,
  opt_end_date: null,
  cpt_start_date: '2025-06-01',
  cpt_end_date: '2025-08-31',
  stem_opt_extension: false,
  sevis_id: 'N0012345678',
  program_end_date: '2026-05-15',
  grace_period_end: null,
};

const DEFAULT_US_CHECKLIST: VisaChecklist[] = [
  {
    id: 'us-c1',
    title: 'Verify SEVIS record is active',
    description: 'Check with DSO that your SEVIS status shows "Active"',
    completed: true,
    due_date: null,
    priority: 'high',
    country: 'US',
  },
  {
    id: 'us-c2',
    title: 'Update address in SEVIS',
    description: 'Report any address change within 10 days',
    completed: true,
    due_date: null,
    priority: 'high',
    country: 'US',
  },
  {
    id: 'us-c3',
    title: 'Check I-20 program end date',
    description: 'Request extension if needed before expiry',
    completed: false,
    due_date: '2026-03-15',
    priority: 'high',
    country: 'US',
  },
  {
    id: 'us-c4',
    title: 'Maintain full course load',
    description: 'Enroll in minimum required credits each semester',
    completed: true,
    due_date: null,
    priority: 'high',
    country: 'US',
  },
  {
    id: 'us-c5',
    title: 'Get travel signature',
    description: 'Valid signature needed within 1 year for re-entry',
    completed: false,
    due_date: '2026-01-30',
    priority: 'medium',
    country: 'US',
  },
  {
    id: 'us-c6',
    title: 'Report employment authorization',
    description: 'Update DSO about any CPT/OPT changes',
    completed: true,
    due_date: null,
    priority: 'medium',
    country: 'US',
  },
];

// =============================================================================
// DEFAULT DATA - UK
// =============================================================================

const DEFAULT_UK_VISA_INFO: UKVisaInfo = {
  user_id: 'current_user',
  country: 'UK',
  visa_type: 'Student',
  visa_expiry_date: '2027-01-15',
  brp_expiry_date: '2027-01-15',
  cas_number: 'E4G5H6I7J8K9L0M1N2O3',
  cas_used_date: '2024-08-01',
  share_code: null,
  nhs_surcharge_paid: true,
  police_registration_required: false,
  police_registration_done: false,
  allowed_work_hours: 20,
  program_end_date: '2026-06-30',
  grace_period_end: null,
};

const DEFAULT_UK_CHECKLIST: VisaChecklist[] = [
  {
    id: 'uk-c1',
    title: 'Collect BRP card',
    description: 'Pick up from Post Office within 10 days of arrival',
    completed: true,
    due_date: null,
    priority: 'high',
    country: 'UK',
  },
  {
    id: 'uk-c2',
    title: 'Register with GP (NHS)',
    description: 'Register at local GP surgery for healthcare access',
    completed: true,
    due_date: null,
    priority: 'high',
    country: 'UK',
  },
  {
    id: 'uk-c3',
    title: 'Apply for National Insurance Number',
    description: 'Required if you plan to work part-time',
    completed: false,
    due_date: '2025-03-01',
    priority: 'medium',
    country: 'UK',
  },
  {
    id: 'uk-c4',
    title: 'Maintain attendance requirements',
    description: 'Universities report attendance to UKVI',
    completed: true,
    due_date: null,
    priority: 'high',
    country: 'UK',
  },
  {
    id: 'uk-c5',
    title: 'Check work hour limits',
    description: '20 hours/week during term, full-time during holidays',
    completed: true,
    due_date: null,
    priority: 'high',
    country: 'UK',
  },
  {
    id: 'uk-c6',
    title: 'Plan Graduate Route visa',
    description: 'Apply before current visa expires if staying to work',
    completed: false,
    due_date: '2026-05-01',
    priority: 'medium',
    country: 'UK',
  },
  {
    id: 'uk-c7',
    title: 'Verify BRP expiry date',
    description: 'BRP must be valid for travel and work',
    completed: false,
    due_date: '2026-11-15',
    priority: 'high',
    country: 'UK',
  },
];

// =============================================================================
// DEFAULT DATA - CANADA
// =============================================================================

const DEFAULT_CA_VISA_INFO: CAVisaInfo = {
  user_id: 'current_user',
  country: 'CA',
  visa_type: 'Study Permit',
  visa_expiry_date: '2027-08-31',
  study_permit_expiry: '2026-08-31',
  pgwp_start_date: null,
  pgwp_end_date: null,
  coop_permit_expiry: null,
  sin_number: null,
  dli_number: 'O19359023456',
  provincial_health_enrolled: false,
  biometrics_done: true,
  program_end_date: '2026-05-15',
  grace_period_end: null,
};

const DEFAULT_CA_CHECKLIST: VisaChecklist[] = [
  {
    id: 'ca-c1',
    title: 'Apply for Social Insurance Number (SIN)',
    description: 'Required for any employment in Canada',
    completed: false,
    due_date: '2025-02-15',
    priority: 'high',
    country: 'CA',
  },
  {
    id: 'ca-c2',
    title: 'Enroll in provincial health insurance',
    description: 'MSP (BC), OHIP (ON), etc. - 3 month waiting period',
    completed: false,
    due_date: '2025-02-01',
    priority: 'high',
    country: 'CA',
  },
  {
    id: 'ca-c3',
    title: 'Verify Study Permit conditions',
    description: 'Check work hours and program requirements',
    completed: true,
    due_date: null,
    priority: 'high',
    country: 'CA',
  },
  {
    id: 'ca-c4',
    title: 'Maintain full-time enrollment',
    description: 'Required to keep study permit valid',
    completed: true,
    due_date: null,
    priority: 'high',
    country: 'CA',
  },
  {
    id: 'ca-c5',
    title: 'Apply for Co-op Work Permit',
    description: 'If program requires work placement',
    completed: false,
    due_date: '2025-04-01',
    priority: 'medium',
    country: 'CA',
  },
  {
    id: 'ca-c6',
    title: 'Plan PGWP application',
    description: 'Apply within 180 days of graduation',
    completed: false,
    due_date: '2026-04-15',
    priority: 'medium',
    country: 'CA',
  },
  {
    id: 'ca-c7',
    title: 'Check Study Permit expiry',
    description: 'Renew 30 days before expiry to maintain status',
    completed: false,
    due_date: '2026-07-31',
    priority: 'high',
    country: 'CA',
  },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getSelectedCountry(): Country {
  if (typeof window === 'undefined') return 'US';
  const stored = localStorage.getItem(STORAGE_KEY_COUNTRY);
  if (stored && ['US', 'UK', 'CA'].includes(stored)) {
    return stored as Country;
  }
  return 'US';
}

export function setSelectedCountry(country: Country): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_COUNTRY, country);
  }
}

// Calculate days until date
export function daysUntil(dateString: string): number {
  const target = new Date(dateString);
  const now = new Date();
  const diffTime = target.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Format date for display
export function formatDate(dateString: string, country: Country = 'US'): string {
  const locale = country === 'UK' ? 'en-GB' : country === 'CA' ? 'en-CA' : 'en-US';
  return new Date(dateString).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// =============================================================================
// GET VISA INFO
// =============================================================================

function getDefaultVisaInfo(country: Country): VisaInfo {
  switch (country) {
    case 'UK':
      return DEFAULT_UK_VISA_INFO;
    case 'CA':
      return DEFAULT_CA_VISA_INFO;
    default:
      return DEFAULT_US_VISA_INFO;
  }
}

export function getVisaInfo(country?: Country): VisaInfo {
  const effectiveCountry = country || getSelectedCountry();
  if (typeof window === 'undefined') return getDefaultVisaInfo(effectiveCountry);

  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_VISA}_${effectiveCountry}`);
    if (stored) {
      return JSON.parse(stored);
    }
    return getDefaultVisaInfo(effectiveCountry);
  } catch {
    return getDefaultVisaInfo(effectiveCountry);
  }
}

export function saveVisaInfo(info: Partial<VisaInfo>, country?: Country): VisaInfo {
  const effectiveCountry = country || getSelectedCountry();
  const current = getVisaInfo(effectiveCountry);
  const updated = { ...current, ...info } as VisaInfo;

  if (typeof window !== 'undefined') {
    localStorage.setItem(`${STORAGE_KEY_VISA}_${effectiveCountry}`, JSON.stringify(updated));
  }
  return updated;
}

// =============================================================================
// GET CHECKLIST
// =============================================================================

function getDefaultChecklist(country: Country): VisaChecklist[] {
  switch (country) {
    case 'UK':
      return DEFAULT_UK_CHECKLIST;
    case 'CA':
      return DEFAULT_CA_CHECKLIST;
    default:
      return DEFAULT_US_CHECKLIST;
  }
}

export function getVisaChecklist(country?: Country): VisaChecklist[] {
  const effectiveCountry = country || getSelectedCountry();
  if (typeof window === 'undefined') return getDefaultChecklist(effectiveCountry);

  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_CHECKLIST}_${effectiveCountry}`);
    if (stored) {
      return JSON.parse(stored);
    }
    return getDefaultChecklist(effectiveCountry);
  } catch {
    return getDefaultChecklist(effectiveCountry);
  }
}

// Legacy function name for compatibility
export function getI20Checklist(): VisaChecklist[] {
  return getVisaChecklist();
}

export function updateChecklistItem(id: string, completed: boolean, country?: Country): VisaChecklist[] {
  const effectiveCountry = country || getSelectedCountry();
  const checklist = getVisaChecklist(effectiveCountry);
  const updated = checklist.map(item =>
    item.id === id ? { ...item, completed } : item
  );

  if (typeof window !== 'undefined') {
    localStorage.setItem(`${STORAGE_KEY_CHECKLIST}_${effectiveCountry}`, JSON.stringify(updated));
  }
  return updated;
}

// =============================================================================
// GET REMINDERS
// =============================================================================

export function getVisaReminders(visaInfo?: VisaInfo): VisaReminder[] {
  const info = visaInfo || getVisaInfo();
  const reminders: VisaReminder[] = [];
  const country = info.country;

  if (country === 'US') {
    const usInfo = info as USVisaInfo;

    // I-20 expiry reminder
    const i20Days = daysUntil(usInfo.i20_expiry_date);
    if (i20Days <= 90 && i20Days > 0) {
      reminders.push({
        id: 'i20_expiry',
        type: 'i20_expiry',
        title: 'I-20 Expiring Soon',
        message: i20Days <= 30
          ? 'Urgent: Request I-20 extension immediately!'
          : 'Schedule appointment with DSO for I-20 extension',
        date: usInfo.i20_expiry_date,
        days_until: i20Days,
        severity: i20Days <= 30 ? 'urgent' : 'warning',
      });
    }

    // OPT expiry reminder
    if (usInfo.opt_end_date) {
      const optDays = daysUntil(usInfo.opt_end_date);
      if (optDays <= 90 && optDays > 0) {
        reminders.push({
          id: 'opt_expiry',
          type: 'opt_expiry',
          title: 'OPT Expiring',
          message: usInfo.stem_opt_extension
            ? 'Apply for STEM OPT extension'
            : 'Prepare for H-1B or departure',
          date: usInfo.opt_end_date,
          days_until: optDays,
          severity: optDays <= 30 ? 'urgent' : 'warning',
        });
      }
    }
  } else if (country === 'UK') {
    const ukInfo = info as UKVisaInfo;

    // BRP expiry reminder
    const brpDays = daysUntil(ukInfo.brp_expiry_date);
    if (brpDays <= 90 && brpDays > 0) {
      reminders.push({
        id: 'brp_expiry',
        type: 'brp_expiry',
        title: 'BRP Card Expiring Soon',
        message: brpDays <= 30
          ? 'Urgent: Apply for visa extension or Graduate Route!'
          : 'Plan your next visa or departure',
        date: ukInfo.brp_expiry_date,
        days_until: brpDays,
        severity: brpDays <= 30 ? 'urgent' : 'warning',
      });
    }

    // Visa expiry
    const visaDays = daysUntil(ukInfo.visa_expiry_date);
    if (visaDays <= 120 && visaDays > 0) {
      reminders.push({
        id: 'visa_expiry',
        type: 'visa_expiry',
        title: 'Student Visa Expiring',
        message: 'Apply for Graduate Route or prepare departure',
        date: ukInfo.visa_expiry_date,
        days_until: visaDays,
        severity: visaDays <= 60 ? 'warning' : 'info',
      });
    }
  } else if (country === 'CA') {
    const caInfo = info as CAVisaInfo;

    // Study Permit expiry
    const permitDays = daysUntil(caInfo.study_permit_expiry);
    if (permitDays <= 90 && permitDays > 0) {
      reminders.push({
        id: 'study_permit_expiry',
        type: 'study_permit_expiry',
        title: 'Study Permit Expiring',
        message: permitDays <= 30
          ? 'Urgent: Apply for permit extension now!'
          : 'Start your permit renewal application',
        date: caInfo.study_permit_expiry,
        days_until: permitDays,
        severity: permitDays <= 30 ? 'urgent' : 'warning',
      });
    }

    // PGWP expiry
    if (caInfo.pgwp_end_date) {
      const pgwpDays = daysUntil(caInfo.pgwp_end_date);
      if (pgwpDays <= 90 && pgwpDays > 0) {
        reminders.push({
          id: 'pgwp_expiry',
          type: 'pgwp_expiry',
          title: 'PGWP Expiring',
          message: 'Plan for PR application or departure',
          date: caInfo.pgwp_end_date,
          days_until: pgwpDays,
          severity: pgwpDays <= 30 ? 'urgent' : 'warning',
        });
      }
    }
  }

  // Program end date (all countries)
  const programDays = daysUntil(info.program_end_date);
  if (programDays <= 120 && programDays > 0) {
    reminders.push({
      id: 'program_end',
      type: 'program_end',
      title: 'Program Ending Soon',
      message: country === 'US' ? 'Plan for OPT application'
        : country === 'UK' ? 'Apply for Graduate Route'
        : 'Apply for PGWP within 180 days',
      date: info.program_end_date,
      days_until: programDays,
      severity: programDays <= 60 ? 'warning' : 'info',
    });
  }

  return reminders.sort((a, b) => a.days_until - b.days_until);
}

// =============================================================================
// GET TIMELINE
// =============================================================================

export function getVisaTimeline(visaInfo?: VisaInfo): TimelineEvent[] {
  const info = visaInfo || getVisaInfo();
  const events: TimelineEvent[] = [];
  const now = new Date();
  const country = info.country;

  // Program start (assumed past)
  events.push({
    id: 'program_start',
    title: 'Program Started',
    date: '2024-08-20',
    type: 'start',
    status: 'completed',
    description: 'Started academic program',
  });

  if (country === 'US') {
    const usInfo = info as USVisaInfo;

    // CPT events
    if (usInfo.cpt_start_date) {
      events.push({
        id: 'cpt_start',
        title: 'CPT Start',
        date: usInfo.cpt_start_date,
        type: 'milestone',
        status: new Date(usInfo.cpt_start_date) <= now ? 'completed' : 'upcoming',
        description: 'Curricular Practical Training begins',
      });
    }
    if (usInfo.cpt_end_date) {
      events.push({
        id: 'cpt_end',
        title: 'CPT End',
        date: usInfo.cpt_end_date,
        type: 'deadline',
        status: new Date(usInfo.cpt_end_date) <= now ? 'completed' : 'upcoming',
        description: 'Curricular Practical Training ends',
      });
    }

    // I-20 expiry
    events.push({
      id: 'i20_expiry',
      title: 'I-20 Expiry',
      date: usInfo.i20_expiry_date,
      type: 'deadline',
      status: 'upcoming',
      description: 'I-20 document expires',
    });

    // OPT events
    if (usInfo.opt_start_date) {
      events.push({
        id: 'opt_start',
        title: 'OPT Start',
        date: usInfo.opt_start_date,
        type: 'start',
        status: new Date(usInfo.opt_start_date) <= now ? 'completed' : 'upcoming',
        description: 'Optional Practical Training begins',
      });
    }
    if (usInfo.opt_end_date) {
      events.push({
        id: 'opt_end',
        title: 'OPT End',
        date: usInfo.opt_end_date,
        type: 'deadline',
        status: 'upcoming',
        description: usInfo.stem_opt_extension
          ? 'Standard OPT ends, STEM extension eligible'
          : 'OPT work authorization ends',
      });
    }
  } else if (country === 'UK') {
    const ukInfo = info as UKVisaInfo;

    // CAS used
    events.push({
      id: 'cas_used',
      title: 'CAS Used',
      date: ukInfo.cas_used_date,
      type: 'milestone',
      status: 'completed',
      description: 'Confirmation of Acceptance for Studies used',
    });

    // BRP expiry
    events.push({
      id: 'brp_expiry',
      title: 'BRP Expiry',
      date: ukInfo.brp_expiry_date,
      type: 'deadline',
      status: 'upcoming',
      description: 'Biometric Residence Permit expires',
    });
  } else if (country === 'CA') {
    const caInfo = info as CAVisaInfo;

    // Study Permit expiry
    events.push({
      id: 'study_permit_expiry',
      title: 'Study Permit Expiry',
      date: caInfo.study_permit_expiry,
      type: 'deadline',
      status: 'upcoming',
      description: 'Study permit must be renewed',
    });

    // Co-op permit
    if (caInfo.coop_permit_expiry) {
      events.push({
        id: 'coop_expiry',
        title: 'Co-op Permit Expiry',
        date: caInfo.coop_permit_expiry,
        type: 'deadline',
        status: 'upcoming',
        description: 'Co-op work permit expires',
      });
    }

    // PGWP events
    if (caInfo.pgwp_start_date) {
      events.push({
        id: 'pgwp_start',
        title: 'PGWP Start',
        date: caInfo.pgwp_start_date,
        type: 'start',
        status: new Date(caInfo.pgwp_start_date) <= now ? 'completed' : 'upcoming',
        description: 'Post-Graduation Work Permit begins',
      });
    }
    if (caInfo.pgwp_end_date) {
      events.push({
        id: 'pgwp_end',
        title: 'PGWP End',
        date: caInfo.pgwp_end_date,
        type: 'deadline',
        status: 'upcoming',
        description: 'Post-Graduation Work Permit expires',
      });
    }
  }

  // Program end (all countries)
  events.push({
    id: 'program_end',
    title: 'Program End Date',
    date: info.program_end_date,
    type: 'end',
    status: 'upcoming',
    description: 'Expected graduation',
  });

  // Visa expiry (all countries)
  events.push({
    id: 'visa_expiry',
    title: country === 'US' ? 'Visa Stamp Expiry' : country === 'UK' ? 'Student Visa Expiry' : 'Visa Expiry',
    date: info.visa_expiry_date,
    type: 'deadline',
    status: 'upcoming',
    description: country === 'US' ? 'F-1 visa stamp expires (renewal needed for travel)'
      : country === 'UK' ? 'Student visa expires'
      : 'Temporary resident visa expires',
  });

  return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// =============================================================================
// GET STATUS
// =============================================================================

export function getVisaStatus(country?: Country): StatusItem[] {
  const effectiveCountry = country || getSelectedCountry();

  if (effectiveCountry === 'US') {
    return [
      {
        id: 'record_status',
        label: 'SEVIS Record',
        status: 'active',
        description: 'Your SEVIS record is active',
      },
      {
        id: 'enrollment',
        label: 'Full-time Enrollment',
        status: 'active',
        description: 'Enrolled in 12+ credits',
      },
      {
        id: 'address',
        label: 'Address Updated',
        status: 'active',
        description: 'Current address on file',
      },
      {
        id: 'employment',
        label: 'Employment Auth',
        status: 'active',
        description: 'No unauthorized employment',
      },
    ];
  } else if (effectiveCountry === 'UK') {
    return [
      {
        id: 'brp_status',
        label: 'BRP Card',
        status: 'active',
        description: 'BRP collected and valid',
      },
      {
        id: 'cas_status',
        label: 'CAS Status',
        status: 'active',
        description: 'CAS used and enrolled',
      },
      {
        id: 'attendance',
        label: 'Attendance',
        status: 'active',
        description: 'Meeting attendance requirements',
      },
      {
        id: 'work_hours',
        label: 'Work Hours',
        status: 'active',
        description: 'Within 20hr/week limit',
      },
      {
        id: 'nhs_status',
        label: 'NHS Registered',
        status: 'active',
        description: 'Registered with GP',
      },
    ];
  } else {
    // Canada
    return [
      {
        id: 'permit_status',
        label: 'Study Permit',
        status: 'active',
        description: 'Study permit is valid',
      },
      {
        id: 'dli_status',
        label: 'DLI Enrollment',
        status: 'active',
        description: 'Enrolled at designated institution',
      },
      {
        id: 'enrollment',
        label: 'Full-time Status',
        status: 'active',
        description: 'Maintaining full course load',
      },
      {
        id: 'sin_status',
        label: 'SIN Number',
        status: 'warning',
        description: 'Apply for SIN for employment',
      },
      {
        id: 'health',
        label: 'Health Insurance',
        status: 'warning',
        description: 'Enroll in provincial health',
      },
    ];
  }
}

// Legacy function name for compatibility
export function getSevisStatus(): StatusItem[] {
  return getVisaStatus();
}

// =============================================================================
// COUNTRY-SPECIFIC LABELS
// =============================================================================

export interface VisaLabels {
  documentName: string; // I-20, BRP, Study Permit
  documentExpiry: string;
  visaName: string;
  trackingId: string; // SEVIS ID, CAS Number, DLI Number
  trackingIdLabel: string;
  workAuthName: string;
  workAuthDesc: string;
  gracePeriodInfo: string;
}

export function getVisaLabels(country?: Country): VisaLabels {
  const effectiveCountry = country || getSelectedCountry();

  if (effectiveCountry === 'UK') {
    return {
      documentName: 'BRP Card',
      documentExpiry: 'BRP Expires In',
      visaName: 'Student Visa (Tier 4)',
      trackingId: 'E4G5H6I7J8K9L0M1N2O3',
      trackingIdLabel: 'CAS Number',
      workAuthName: 'Work Authorization',
      workAuthDesc: '20 hours/week during term',
      gracePeriodInfo: 'Switch to Graduate Route within visa validity',
    };
  } else if (effectiveCountry === 'CA') {
    return {
      documentName: 'Study Permit',
      documentExpiry: 'Permit Expires In',
      visaName: 'Study Permit',
      trackingId: 'O19359023456',
      trackingIdLabel: 'DLI Number',
      workAuthName: 'Work Authorization',
      workAuthDesc: '20 hours/week during sessions',
      gracePeriodInfo: 'Apply for PGWP within 180 days of graduation',
    };
  } else {
    return {
      documentName: 'I-20',
      documentExpiry: 'I-20 Expires In',
      visaName: 'F-1 Student Visa',
      trackingId: 'N0012345678',
      trackingIdLabel: 'SEVIS ID',
      workAuthName: 'Work Authorization',
      workAuthDesc: 'CPT/OPT eligible',
      gracePeriodInfo: '60-day grace period after program end',
    };
  }
}
