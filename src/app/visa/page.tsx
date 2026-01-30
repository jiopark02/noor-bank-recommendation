'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BottomNav } from '@/components/layout';
import {
  getVisaInfo,
  getVisaChecklist,
  updateChecklistItem,
  getVisaReminders,
  getVisaTimeline,
  getVisaStatus,
  getVisaLabels,
  getSelectedCountry,
  daysUntil,
  formatDate,
  VisaInfo,
  VisaChecklist,
  VisaReminder,
  TimelineEvent,
  StatusItem,
  USVisaInfo,
  UKVisaInfo,
  CAVisaInfo,
} from '@/lib/visaData';
import { Country } from '@/lib/countryConfig';

type TabType = 'overview' | 'timeline' | 'checklist';

export default function VisaPage() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [visaInfo, setVisaInfo] = useState<VisaInfo | null>(null);
  const [checklist, setChecklist] = useState<VisaChecklist[]>([]);
  const [reminders, setReminders] = useState<VisaReminder[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [statusItems, setStatusItems] = useState<StatusItem[]>([]);
  const [country, setCountry] = useState<Country>('US');

  useEffect(() => {
    const selectedCountry = getSelectedCountry();
    setCountry(selectedCountry);
    const info = getVisaInfo(selectedCountry);
    setVisaInfo(info);
    setChecklist(getVisaChecklist(selectedCountry));
    setReminders(getVisaReminders(info));
    setTimeline(getVisaTimeline(info));
    setStatusItems(getVisaStatus(selectedCountry));
  }, []);

  const handleChecklistToggle = (id: string, completed: boolean) => {
    const updated = updateChecklistItem(id, completed, country);
    setChecklist(updated);
  };

  if (!visaInfo) {
    return (
      <div className="min-h-screen bg-[#FAF9F7] flex items-center justify-center">
        <div className="animate-pulse text-[#6B6B6B]">Loading...</div>
      </div>
    );
  }

  const labels = getVisaLabels(country);

  // Get main document expiry days based on country
  const getMainDocumentDays = () => {
    if (country === 'US') {
      return daysUntil((visaInfo as USVisaInfo).i20_expiry_date);
    } else if (country === 'UK') {
      return daysUntil((visaInfo as UKVisaInfo).brp_expiry_date);
    } else {
      return daysUntil((visaInfo as CAVisaInfo).study_permit_expiry);
    }
  };

  const getMainDocumentDate = () => {
    if (country === 'US') {
      return (visaInfo as USVisaInfo).i20_expiry_date;
    } else if (country === 'UK') {
      return (visaInfo as UKVisaInfo).brp_expiry_date;
    } else {
      return (visaInfo as CAVisaInfo).study_permit_expiry;
    }
  };

  const mainDocDays = getMainDocumentDays();
  const visaDays = daysUntil(visaInfo.visa_expiry_date);
  const programDays = daysUntil(visaInfo.program_end_date);

  return (
    <div className="min-h-screen bg-[#FAF9F7] pb-24">
      {/* Header */}
      <div className="bg-white border-b border-[#E8E6E3]">
        <div className="px-6 py-4">
          <h1 className="text-2xl font-light text-[#1A1A1A] tracking-tight">Visa Tracker</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">{labels.visaName} & Documents</p>
        </div>
      </div>

      {/* Main Countdown Card */}
      <div className="px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-[#E8E6E3]"
        >
          <div className="text-center">
            <p className="text-sm text-[#6B6B6B] uppercase tracking-wider mb-2">{labels.documentExpiry}</p>
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-6xl font-light text-[#1A1A1A]">{mainDocDays}</span>
              <span className="text-xl text-[#6B6B6B]">days</span>
            </div>
            <p className="text-sm text-[#6B6B6B] mt-2">{formatDate(getMainDocumentDate(), country)}</p>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-[#E8E6E3]">
            <div className="text-center">
              <p className="text-2xl font-light text-[#1A1A1A]">{visaDays}</p>
              <p className="text-xs text-[#6B6B6B] mt-1">{country === 'UK' ? 'Visa Expiry' : 'Visa Stamp Days'}</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-light text-[#1A1A1A]">{programDays}</p>
              <p className="text-xs text-[#6B6B6B] mt-1">Program End Days</p>
            </div>
          </div>
        </motion.div>

        {/* Status Items (replaces SEVIS Status) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3] mt-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-[#1A1A1A]">
              {country === 'US' ? 'SEVIS Status' : country === 'UK' ? 'Visa Status' : 'Permit Status'}
            </h3>
            <span className="text-xs text-[#6B6B6B]">
              {labels.trackingIdLabel}: {labels.trackingId}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {statusItems.map((status) => (
              <div
                key={status.id}
                className="flex items-center gap-2 p-2 bg-[#FAF9F7] rounded-lg"
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    status.status === 'active'
                      ? 'bg-green-500'
                      : status.status === 'warning'
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                  }`}
                />
                <span className="text-xs text-[#1A1A1A]">{status.label}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Alerts */}
        {reminders.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-4 space-y-2"
          >
            {reminders.map((reminder) => (
              <div
                key={reminder.id}
                className={`p-4 rounded-xl border ${
                  reminder.severity === 'urgent'
                    ? 'bg-red-50 border-red-200'
                    : reminder.severity === 'warning'
                    ? 'bg-yellow-50 border-yellow-200'
                    : 'bg-blue-50 border-blue-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg">
                    {reminder.severity === 'urgent' ? '🚨' : reminder.severity === 'warning' ? '⚠️' : 'ℹ️'}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#1A1A1A]">{reminder.title}</p>
                    <p className="text-xs text-[#6B6B6B] mt-0.5">{reminder.message}</p>
                    <p className="text-xs text-[#6B6B6B] mt-1">
                      {reminder.days_until} days • {formatDate(reminder.date)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </div>

      {/* Tabs */}
      <div className="px-4">
        <div className="flex gap-2 bg-[#F5F4F2] rounded-xl p-1">
          {(['overview', 'timeline', 'checklist'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-white text-[#1A1A1A] shadow-sm'
                  : 'text-[#6B6B6B]'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="px-4 py-4">
        {activeTab === 'overview' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* Visa Details Card */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
              <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Visa Details</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-[#E8E6E3]">
                  <span className="text-sm text-[#6B6B6B]">Visa Type</span>
                  <span className="text-sm font-medium text-[#1A1A1A]">{visaInfo.visa_type}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#E8E6E3]">
                  <span className="text-sm text-[#6B6B6B]">Visa Expiry</span>
                  <span className="text-sm font-medium text-[#1A1A1A]">{formatDate(visaInfo.visa_expiry_date)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#E8E6E3]">
                  <span className="text-sm text-[#6B6B6B]">{labels.documentExpiry}</span>
                  <span className="text-sm font-medium text-[#1A1A1A]">{formatDate(getMainDocumentDate(), country)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#E8E6E3]">
                  <span className="text-sm text-[#6B6B6B]">Program End Date</span>
                  <span className="text-sm font-medium text-[#1A1A1A]">{formatDate(visaInfo.program_end_date)}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-[#6B6B6B]">{labels.trackingIdLabel}</span>
                  <span className="text-sm font-medium text-[#1A1A1A]">{labels.trackingId}</span>
                </div>
              </div>
            </div>

            {/* Work Authorization - Country Specific */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
              <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Work Authorization</h3>

              {country === 'US' && (
                <>
                  {(visaInfo as USVisaInfo).cpt_start_date && (
                    <div className="p-3 bg-[#FAF9F7] rounded-xl mb-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">💼</span>
                        <span className="text-sm font-medium text-[#1A1A1A]">CPT</span>
                        <span className="ml-auto text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                          {daysUntil((visaInfo as USVisaInfo).cpt_end_date!) > 0 ? 'Active' : 'Completed'}
                        </span>
                      </div>
                      <p className="text-xs text-[#6B6B6B]">
                        {formatDate((visaInfo as USVisaInfo).cpt_start_date!)} - {formatDate((visaInfo as USVisaInfo).cpt_end_date!)}
                      </p>
                    </div>
                  )}
                  {(visaInfo as USVisaInfo).opt_start_date ? (
                    <div className="p-3 bg-[#FAF9F7] rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">🎓</span>
                        <span className="text-sm font-medium text-[#1A1A1A]">OPT</span>
                        {(visaInfo as USVisaInfo).stem_opt_extension && (
                          <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                            STEM Eligible
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#6B6B6B]">
                        {formatDate((visaInfo as USVisaInfo).opt_start_date!)} - {formatDate((visaInfo as USVisaInfo).opt_end_date!)}
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 bg-[#FAF9F7] rounded-xl text-center">
                      <p className="text-sm text-[#6B6B6B]">OPT not yet applied</p>
                      <p className="text-xs text-[#9B9B9B] mt-1">Apply after program completion</p>
                    </div>
                  )}
                </>
              )}

              {country === 'UK' && (
                <>
                  <div className="p-3 bg-[#FAF9F7] rounded-xl mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">💼</span>
                      <span className="text-sm font-medium text-[#1A1A1A]">Term-time Work</span>
                      <span className="ml-auto text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                        {(visaInfo as UKVisaInfo).allowed_work_hours}hrs/week
                      </span>
                    </div>
                    <p className="text-xs text-[#6B6B6B]">
                      Work up to {(visaInfo as UKVisaInfo).allowed_work_hours} hours during term time
                    </p>
                  </div>
                  <div className="p-3 bg-[#FAF9F7] rounded-xl mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">🏖️</span>
                      <span className="text-sm font-medium text-[#1A1A1A]">Holiday Work</span>
                      <span className="ml-auto text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                        Full-time
                      </span>
                    </div>
                    <p className="text-xs text-[#6B6B6B]">
                      Full-time work allowed during official holidays
                    </p>
                  </div>
                  {(visaInfo as UKVisaInfo).nin_number ? (
                    <div className="p-3 bg-[#FAF9F7] rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">🆔</span>
                        <span className="text-sm font-medium text-[#1A1A1A]">National Insurance</span>
                        <span className="ml-auto text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                          Active
                        </span>
                      </div>
                      <p className="text-xs text-[#6B6B6B]">NIN: {(visaInfo as UKVisaInfo).nin_number}</p>
                    </div>
                  ) : (
                    <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-200">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">⚠️</span>
                        <span className="text-sm font-medium text-[#1A1A1A]">National Insurance</span>
                      </div>
                      <p className="text-xs text-[#6B6B6B]">Apply for NIN to start working</p>
                    </div>
                  )}
                </>
              )}

              {country === 'CA' && (
                <>
                  <div className="p-3 bg-[#FAF9F7] rounded-xl mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">📚</span>
                      <span className="text-sm font-medium text-[#1A1A1A]">On-Campus Work</span>
                      <span className="ml-auto text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                        Allowed
                      </span>
                    </div>
                    <p className="text-xs text-[#6B6B6B]">
                      Work on-campus without a separate work permit
                    </p>
                  </div>
                  <div className="p-3 bg-[#FAF9F7] rounded-xl mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">💼</span>
                      <span className="text-sm font-medium text-[#1A1A1A]">Off-Campus Work</span>
                      <span className="ml-auto text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                        20hrs/week
                      </span>
                    </div>
                    <p className="text-xs text-[#6B6B6B]">
                      Work up to 20 hours off-campus during sessions
                    </p>
                  </div>
                  {(visaInfo as CAVisaInfo).pgwp_start_date ? (
                    <div className="p-3 bg-[#FAF9F7] rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">🎓</span>
                        <span className="text-sm font-medium text-[#1A1A1A]">PGWP</span>
                        <span className="ml-auto text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                          Active
                        </span>
                      </div>
                      <p className="text-xs text-[#6B6B6B]">
                        Valid until {formatDate((visaInfo as CAVisaInfo).pgwp_end_date!)}
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 bg-[#FAF9F7] rounded-xl text-center">
                      <p className="text-sm text-[#6B6B6B]">PGWP not yet applied</p>
                      <p className="text-xs text-[#9B9B9B] mt-1">Apply after graduation</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'timeline' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
          >
            <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Visa Timeline</h3>
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-[#E8E6E3]" />

              <div className="space-y-4">
                {timeline.map((event, index) => (
                  <div key={event.id} className="relative flex gap-4">
                    {/* Timeline dot */}
                    <div
                      className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ${
                        event.status === 'completed'
                          ? 'bg-green-500'
                          : event.status === 'current'
                          ? 'bg-blue-500'
                          : 'bg-[#E8E6E3]'
                      }`}
                    >
                      {event.status === 'completed' ? (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : event.type === 'deadline' ? (
                        <span className="text-xs">⏰</span>
                      ) : event.type === 'start' ? (
                        <span className="text-xs">🚀</span>
                      ) : event.type === 'end' ? (
                        <span className="text-xs">🏁</span>
                      ) : (
                        <span className="text-xs">📍</span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-4">
                      <p className="text-sm font-medium text-[#1A1A1A]">{event.title}</p>
                      <p className="text-xs text-[#6B6B6B]">{formatDate(event.date)}</p>
                      {event.description && (
                        <p className="text-xs text-[#9B9B9B] mt-1">{event.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'checklist' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-[#1A1A1A]">
                {country === 'US' ? 'I-20 Compliance Checklist' : country === 'UK' ? 'BRP & Visa Compliance Checklist' : 'Study Permit Checklist'}
              </h3>
              <span className="text-xs text-[#6B6B6B]">
                {checklist.filter(c => c.completed).length}/{checklist.length} complete
              </span>
            </div>
            <div className="space-y-2">
              {checklist.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-xl border transition-all ${
                    item.completed
                      ? 'bg-[#FAF9F7] border-[#E8E6E3]'
                      : item.priority === 'high'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-white border-[#E8E6E3]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => handleChecklistToggle(item.id, !item.completed)}
                      className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        item.completed
                          ? 'bg-green-500 border-green-500'
                          : 'border-[#D4D4D4]'
                      }`}
                    >
                      {item.completed && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <div className="flex-1">
                      <p className={`text-sm ${item.completed ? 'text-[#9B9B9B] line-through' : 'text-[#1A1A1A]'}`}>
                        {item.title}
                      </p>
                      <p className="text-xs text-[#6B6B6B] mt-0.5">{item.description}</p>
                      {item.due_date && !item.completed && (
                        <p className="text-xs text-red-500 mt-1">Due: {formatDate(item.due_date)}</p>
                      )}
                    </div>
                    {!item.completed && item.priority === 'high' && (
                      <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full">
                        High
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
