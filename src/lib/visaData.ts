// Visa Tracker Data - F-1 Visa, CPT/OPT, I-20 Management

export interface VisaInfo {
  user_id: string;
  visa_type: 'F-1' | 'J-1' | 'H-1B' | 'OPT' | 'CPT';
  visa_expiry_date: string;
  i20_expiry_date: string;
  opt_start_date: string | null;
  opt_end_date: string | null;
  cpt_start_date: string | null;
  cpt_end_date: string | null;
  stem_opt_extension: boolean;
  sevis_id: string;
  program_end_date: string;
  grace_period_end: string | null;
}

export interface I20Checklist {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  due_date: string | null;
  priority: 'high' | 'medium' | 'low';
}

export interface VisaReminder {
  id: string;
  type: 'visa_expiry' | 'i20_expiry' | 'opt_expiry' | 'grace_period' | 'travel';
  title: string;
  message: string;
  date: string;
  days_until: number;
  severity: 'urgent' | 'warning' | 'info';
}

export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  type: 'start' | 'end' | 'deadline' | 'milestone';
  status: 'completed' | 'current' | 'upcoming';
  description?: string;
}

// Storage keys
const STORAGE_KEY_VISA = 'noor_visa_info';
const STORAGE_KEY_CHECKLIST = 'noor_i20_checklist';

// Default visa info for demo
const DEFAULT_VISA_INFO: VisaInfo = {
  user_id: 'current_user',
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

// Default I-20 checklist
const DEFAULT_I20_CHECKLIST: I20Checklist[] = [
  {
    id: 'c1',
    title: 'Verify SEVIS record is active',
    description: 'Check with DSO that your SEVIS status shows "Active"',
    completed: true,
    due_date: null,
    priority: 'high',
  },
  {
    id: 'c2',
    title: 'Update address in SEVIS',
    description: 'Report any address change within 10 days',
    completed: true,
    due_date: null,
    priority: 'high',
  },
  {
    id: 'c3',
    title: 'Check I-20 program end date',
    description: 'Request extension if needed before expiry',
    completed: false,
    due_date: '2026-03-15',
    priority: 'high',
  },
  {
    id: 'c4',
    title: 'Maintain full course load',
    description: 'Enroll in minimum required credits each semester',
    completed: true,
    due_date: null,
    priority: 'high',
  },
  {
    id: 'c5',
    title: 'Get travel signature',
    description: 'Valid signature needed within 1 year for re-entry',
    completed: false,
    due_date: '2026-01-30',
    priority: 'medium',
  },
  {
    id: 'c6',
    title: 'Report employment authorization',
    description: 'Update DSO about any CPT/OPT changes',
    completed: true,
    due_date: null,
    priority: 'medium',
  },
];

// Get visa info
export function getVisaInfo(): VisaInfo {
  if (typeof window === 'undefined') return DEFAULT_VISA_INFO;
  try {
    const stored = localStorage.getItem(STORAGE_KEY_VISA);
    return stored ? JSON.parse(stored) : DEFAULT_VISA_INFO;
  } catch {
    return DEFAULT_VISA_INFO;
  }
}

// Save visa info
export function saveVisaInfo(info: Partial<VisaInfo>): VisaInfo {
  const current = getVisaInfo();
  const updated = { ...current, ...info };
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_VISA, JSON.stringify(updated));
  }
  return updated;
}

// Get I-20 checklist
export function getI20Checklist(): I20Checklist[] {
  if (typeof window === 'undefined') return DEFAULT_I20_CHECKLIST;
  try {
    const stored = localStorage.getItem(STORAGE_KEY_CHECKLIST);
    return stored ? JSON.parse(stored) : DEFAULT_I20_CHECKLIST;
  } catch {
    return DEFAULT_I20_CHECKLIST;
  }
}

// Update checklist item
export function updateChecklistItem(id: string, completed: boolean): I20Checklist[] {
  const checklist = getI20Checklist();
  const updated = checklist.map(item =>
    item.id === id ? { ...item, completed } : item
  );
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_CHECKLIST, JSON.stringify(updated));
  }
  return updated;
}

// Calculate days until date
export function daysUntil(dateString: string): number {
  const target = new Date(dateString);
  const now = new Date();
  const diffTime = target.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Get visa reminders based on dates
export function getVisaReminders(visaInfo: VisaInfo): VisaReminder[] {
  const reminders: VisaReminder[] = [];

  // I-20 expiry reminder
  const i20Days = daysUntil(visaInfo.i20_expiry_date);
  if (i20Days <= 90) {
    reminders.push({
      id: 'i20_expiry',
      type: 'i20_expiry',
      title: 'I-20 Expiring Soon',
      message: i20Days <= 30
        ? 'Urgent: Request I-20 extension immediately!'
        : 'Schedule appointment with DSO for I-20 extension',
      date: visaInfo.i20_expiry_date,
      days_until: i20Days,
      severity: i20Days <= 30 ? 'urgent' : 'warning',
    });
  }

  // Program end date reminder
  const programDays = daysUntil(visaInfo.program_end_date);
  if (programDays <= 120 && programDays > 0) {
    reminders.push({
      id: 'program_end',
      type: 'grace_period',
      title: 'Program Ending Soon',
      message: 'Plan for OPT application or departure',
      date: visaInfo.program_end_date,
      days_until: programDays,
      severity: programDays <= 60 ? 'warning' : 'info',
    });
  }

  // OPT expiry reminder
  if (visaInfo.opt_end_date) {
    const optDays = daysUntil(visaInfo.opt_end_date);
    if (optDays <= 90 && optDays > 0) {
      reminders.push({
        id: 'opt_expiry',
        type: 'opt_expiry',
        title: 'OPT Expiring',
        message: visaInfo.stem_opt_extension
          ? 'Apply for STEM OPT extension'
          : 'Prepare for H-1B or departure',
        date: visaInfo.opt_end_date,
        days_until: optDays,
        severity: optDays <= 30 ? 'urgent' : 'warning',
      });
    }
  }

  return reminders.sort((a, b) => a.days_until - b.days_until);
}

// Generate timeline events
export function getVisaTimeline(visaInfo: VisaInfo): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const now = new Date();

  // Program start (assumed past)
  events.push({
    id: 'program_start',
    title: 'Program Started',
    date: '2024-08-20',
    type: 'start',
    status: 'completed',
    description: 'Started graduate program',
  });

  // CPT if exists
  if (visaInfo.cpt_start_date) {
    const cptStartDate = new Date(visaInfo.cpt_start_date);
    events.push({
      id: 'cpt_start',
      title: 'CPT Start',
      date: visaInfo.cpt_start_date,
      type: 'milestone',
      status: cptStartDate <= now ? 'completed' : 'upcoming',
      description: 'Curricular Practical Training begins',
    });
  }

  if (visaInfo.cpt_end_date) {
    const cptEndDate = new Date(visaInfo.cpt_end_date);
    events.push({
      id: 'cpt_end',
      title: 'CPT End',
      date: visaInfo.cpt_end_date,
      type: 'deadline',
      status: cptEndDate <= now ? 'completed' : 'upcoming',
      description: 'Curricular Practical Training ends',
    });
  }

  // I-20 expiry
  events.push({
    id: 'i20_expiry',
    title: 'I-20 Expiry',
    date: visaInfo.i20_expiry_date,
    type: 'deadline',
    status: 'upcoming',
    description: 'I-20 document expires',
  });

  // Program end
  events.push({
    id: 'program_end',
    title: 'Program End Date',
    date: visaInfo.program_end_date,
    type: 'end',
    status: 'upcoming',
    description: 'Expected graduation',
  });

  // OPT if exists
  if (visaInfo.opt_start_date) {
    events.push({
      id: 'opt_start',
      title: 'OPT Start',
      date: visaInfo.opt_start_date,
      type: 'start',
      status: new Date(visaInfo.opt_start_date) <= now ? 'completed' : 'upcoming',
      description: 'Optional Practical Training begins',
    });
  }

  if (visaInfo.opt_end_date) {
    events.push({
      id: 'opt_end',
      title: 'OPT End',
      date: visaInfo.opt_end_date,
      type: 'deadline',
      status: 'upcoming',
      description: visaInfo.stem_opt_extension
        ? 'Standard OPT ends, STEM extension eligible'
        : 'OPT work authorization ends',
    });
  }

  // Visa expiry
  events.push({
    id: 'visa_expiry',
    title: 'Visa Stamp Expiry',
    date: visaInfo.visa_expiry_date,
    type: 'deadline',
    status: 'upcoming',
    description: 'F-1 visa stamp expires (renewal needed for travel)',
  });

  return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// Format date for display
export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// SEVIS status checklist
export interface SevisStatus {
  id: string;
  label: string;
  status: 'active' | 'warning' | 'inactive';
  description: string;
}

export function getSevisStatus(): SevisStatus[] {
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
}
