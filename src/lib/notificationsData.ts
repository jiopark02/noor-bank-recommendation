// Smart Notifications Data - Reminders and Alerts

export type ReminderType =
  | 'rent_due'
  | 'scholarship_deadline'
  | 'tuition_due'
  | 'visa_expiry'
  | 'i20_expiry'
  | 'opt_deadline'
  | 'custom';

export interface Reminder {
  id: string;
  user_id: string;
  type: ReminderType;
  title: string;
  description: string;
  due_date: string;
  is_notified: boolean;
  notify_days_before: number[];
  is_recurring: boolean;
  recurrence_interval?: 'monthly' | 'yearly';
  created_at: string;
}

export interface Notification {
  id: string;
  reminder_id: string;
  title: string;
  message: string;
  type: ReminderType;
  due_date: string;
  days_until: number;
  severity: 'urgent' | 'warning' | 'info';
  is_read: boolean;
  created_at: string;
}

// Storage keys
const STORAGE_KEY_REMINDERS = 'noor_reminders';
const STORAGE_KEY_NOTIFICATIONS = 'noor_notifications';

// Reminder type info
export const REMINDER_TYPES: Record<ReminderType, { label: string; icon: string; defaultDays: number[] }> = {
  rent_due: { label: 'Rent Due', icon: '🏠', defaultDays: [3, 1] },
  scholarship_deadline: { label: 'Scholarship Deadline', icon: '🎓', defaultDays: [7, 3, 1] },
  tuition_due: { label: 'Tuition Payment', icon: '💳', defaultDays: [14, 7, 3] },
  visa_expiry: { label: 'Visa Expiry', icon: '🛂', defaultDays: [90, 60, 30] },
  i20_expiry: { label: 'I-20 Expiry', icon: '📄', defaultDays: [90, 60, 30] },
  opt_deadline: { label: 'OPT Deadline', icon: '💼', defaultDays: [60, 30, 14] },
  custom: { label: 'Custom Reminder', icon: '📌', defaultDays: [3, 1] },
};

// Default reminders
const DEFAULT_REMINDERS: Reminder[] = [
  {
    id: 'r1',
    user_id: 'current_user',
    type: 'rent_due',
    title: 'Monthly Rent Due',
    description: 'Apartment rent payment',
    due_date: '2026-02-01',
    is_notified: false,
    notify_days_before: [3, 1],
    is_recurring: true,
    recurrence_interval: 'monthly',
    created_at: '2026-01-01',
  },
  {
    id: 'r2',
    user_id: 'current_user',
    type: 'scholarship_deadline',
    title: 'Stanford Graduate Fellowship',
    description: 'Application deadline for spring fellowship',
    due_date: '2026-02-15',
    is_notified: false,
    notify_days_before: [7, 3, 1],
    is_recurring: false,
    created_at: '2026-01-10',
  },
  {
    id: 'r3',
    user_id: 'current_user',
    type: 'tuition_due',
    title: 'Spring Tuition Payment',
    description: 'Spring quarter tuition due',
    due_date: '2026-03-01',
    is_notified: false,
    notify_days_before: [14, 7, 3],
    is_recurring: false,
    created_at: '2026-01-01',
  },
  {
    id: 'r4',
    user_id: 'current_user',
    type: 'visa_expiry',
    title: 'F-1 Visa Stamp Expiry',
    description: 'Visa stamp expires - needed for re-entry',
    due_date: '2027-05-15',
    is_notified: false,
    notify_days_before: [90, 60, 30],
    is_recurring: false,
    created_at: '2026-01-01',
  },
  {
    id: 'r5',
    user_id: 'current_user',
    type: 'i20_expiry',
    title: 'I-20 Expiration',
    description: 'I-20 document expiring - request extension',
    due_date: '2026-05-20',
    is_notified: false,
    notify_days_before: [90, 60, 30],
    is_recurring: false,
    created_at: '2026-01-01',
  },
];

// Get reminders
export function getReminders(): Reminder[] {
  if (typeof window === 'undefined') return DEFAULT_REMINDERS;

  try {
    const stored = localStorage.getItem(STORAGE_KEY_REMINDERS);
    return stored ? JSON.parse(stored) : DEFAULT_REMINDERS;
  } catch {
    return DEFAULT_REMINDERS;
  }
}

// Add reminder
export function addReminder(reminder: Omit<Reminder, 'id' | 'user_id' | 'is_notified' | 'created_at'>): Reminder {
  const newReminder: Reminder = {
    ...reminder,
    id: `reminder_${Date.now()}`,
    user_id: 'current_user',
    is_notified: false,
    created_at: new Date().toISOString(),
  };

  if (typeof window !== 'undefined') {
    const reminders = getReminders();
    reminders.push(newReminder);
    localStorage.setItem(STORAGE_KEY_REMINDERS, JSON.stringify(reminders));
  }

  return newReminder;
}

// Update reminder
export function updateReminder(id: string, updates: Partial<Reminder>): Reminder | null {
  const reminders = getReminders();
  const index = reminders.findIndex(r => r.id === id);

  if (index === -1) return null;

  reminders[index] = { ...reminders[index], ...updates };

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_REMINDERS, JSON.stringify(reminders));
  }

  return reminders[index];
}

// Delete reminder
export function deleteReminder(id: string): void {
  const reminders = getReminders();
  const updated = reminders.filter(r => r.id !== id);

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_REMINDERS, JSON.stringify(updated));
  }
}

// Calculate days until date
function daysUntil(dateString: string): number {
  const target = new Date(dateString);
  const now = new Date();
  const diffTime = target.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Generate notifications from reminders
export function generateNotifications(): Notification[] {
  const reminders = getReminders();
  const notifications: Notification[] = [];

  reminders.forEach(reminder => {
    const daysLeft = daysUntil(reminder.due_date);

    // Check if we should show notification
    reminder.notify_days_before.forEach(notifyDays => {
      if (daysLeft <= notifyDays && daysLeft > 0) {
        // Determine severity
        let severity: 'urgent' | 'warning' | 'info' = 'info';
        if (daysLeft <= 3) severity = 'urgent';
        else if (daysLeft <= 7) severity = 'warning';

        notifications.push({
          id: `notif_${reminder.id}_${notifyDays}`,
          reminder_id: reminder.id,
          title: reminder.title,
          message: daysLeft === 1
            ? `Due tomorrow!`
            : `Due in ${daysLeft} days`,
          type: reminder.type,
          due_date: reminder.due_date,
          days_until: daysLeft,
          severity,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
    });

    // Overdue notification
    if (daysLeft < 0 && daysLeft >= -7) {
      notifications.push({
        id: `notif_${reminder.id}_overdue`,
        reminder_id: reminder.id,
        title: reminder.title,
        message: `Overdue by ${Math.abs(daysLeft)} day${Math.abs(daysLeft) > 1 ? 's' : ''}!`,
        type: reminder.type,
        due_date: reminder.due_date,
        days_until: daysLeft,
        severity: 'urgent',
        is_read: false,
        created_at: new Date().toISOString(),
      });
    }
  });

  // Sort by urgency
  return notifications.sort((a, b) => {
    const severityOrder = { urgent: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity] || a.days_until - b.days_until;
  });
}

// Get read notifications
export function getReadNotifications(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY_NOTIFICATIONS);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Mark notification as read
export function markNotificationAsRead(notificationId: string): void {
  if (typeof window === 'undefined') return;

  const read = getReadNotifications();
  if (!read.includes(notificationId)) {
    read.push(notificationId);
    localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(read));
  }
}

// Get unread count
export function getUnreadNotificationCount(): number {
  const notifications = generateNotifications();
  const read = getReadNotifications();
  return notifications.filter(n => !read.includes(n.id)).length;
}

// Format date
export function formatReminderDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Get upcoming reminders (within 30 days)
export function getUpcomingReminders(): Reminder[] {
  const reminders = getReminders();
  return reminders
    .filter(r => {
      const days = daysUntil(r.due_date);
      return days >= 0 && days <= 30;
    })
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
}
