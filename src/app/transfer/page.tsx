'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BottomNav } from '@/components/layout';
import {
  getInstitutionById,
  getTransferAgreements,
  getTransferDeadlines,
  getTAGEligibleUniversities,
  calculateDaysUntilDeadline,
  getTransferGoals,
  saveTransferGoal,
  removeTransferGoal,
  TransferAgreement,
  TransferDeadline,
  TransferGoal,
  University,
} from '@/lib/universitiesData';

type TabType = 'goals' | 'deadlines' | 'requirements';

interface UserProfile {
  institutionId?: string;
  institutionType?: string;
  targetUniversities?: string[];
  targetMajor?: string;
  expectedTransferYear?: string;
}

export default function TransferPage() {
  const [activeTab, setActiveTab] = useState<TabType>('goals');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [transferGoals, setTransferGoals] = useState<TransferGoal[]>([]);
  const [currentCC, setCurrentCC] = useState<University | null>(null);

  useEffect(() => {
    // Load user profile
    const profile = localStorage.getItem('noor_user_profile');
    if (profile) {
      const parsed = JSON.parse(profile);
      setUserProfile(parsed);

      if (parsed.institutionId) {
        const cc = getInstitutionById(parsed.institutionId);
        setCurrentCC(cc || null);
      }
    }

    // Load transfer goals
    setTransferGoals(getTransferGoals());
  }, []);

  const tagUniversities = useMemo(() => {
    if (!currentCC) return [];
    return getTAGEligibleUniversities(currentCC.id);
  }, [currentCC]);

  const transferAgreements = useMemo(() => {
    if (!currentCC) return [];
    return getTransferAgreements(currentCC.id);
  }, [currentCC]);

  const upcomingDeadlines = useMemo(() => {
    const deadlines: { university: University; deadline: TransferDeadline; daysUntil: number }[] = [];

    // Get deadlines for target universities
    const targetIds = userProfile?.targetUniversities || [];
    targetIds.forEach(uniId => {
      const uni = getInstitutionById(uniId);
      if (!uni) return;

      const uniDeadlines = getTransferDeadlines(uniId);
      uniDeadlines.forEach(deadline => {
        const daysUntil = calculateDaysUntilDeadline(deadline.application_deadline);
        if (daysUntil > -30 && daysUntil < 365) {
          deadlines.push({ university: uni, deadline, daysUntil });
        }
      });
    });

    return deadlines.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [userProfile?.targetUniversities]);

  const handleAddGoal = (universityId: string) => {
    const goal: TransferGoal = {
      target_university_id: universityId,
      target_major: userProfile?.targetMajor || '',
      target_term: 'fall',
      target_year: 2026,
      current_gpa: 0,
      units_completed: 0,
    };
    saveTransferGoal(goal);
    setTransferGoals(getTransferGoals());
  };

  const handleRemoveGoal = (universityId: string) => {
    removeTransferGoal(universityId);
    setTransferGoals(getTransferGoals());
  };

  const isCC = userProfile?.institutionType === 'community_college';

  if (!isCC) {
    return (
      <div className="min-h-screen bg-[#FAF9F7] pb-24">
        <div className="px-6 py-4 bg-white border-b border-[#E8E6E3]">
          <h1 className="text-2xl font-light text-[#1A1A1A]">Transfer Center</h1>
        </div>
        <div className="px-4 py-12 text-center">
          <div className="text-4xl mb-4">🎓</div>
          <h2 className="text-lg font-medium text-[#1A1A1A] mb-2">For Community College Students</h2>
          <p className="text-sm text-[#6B6B6B]">
            This feature is designed to help community college students plan their transfer to a 4-year university.
          </p>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF9F7] pb-24">
      {/* Header */}
      <div className="bg-white border-b border-[#E8E6E3]">
        <div className="px-6 py-4">
          <h1 className="text-2xl font-light text-[#1A1A1A] tracking-tight">Transfer Center</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            {currentCC?.short_name} → 4-Year University
          </p>
        </div>
      </div>

      {/* Progress Card */}
      <div className="px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-[#E8E6E3]"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-[#6B6B6B]">Target Transfer</p>
              <p className="text-xl font-light text-[#1A1A1A]">
                {userProfile?.expectedTransferYear || 'Fall 2026'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-[#6B6B6B]">Target Schools</p>
              <p className="text-xl font-light text-[#1A1A1A]">
                {userProfile?.targetUniversities?.length || 0}
              </p>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[#E8E6E3]">
            <div className="text-center p-2 bg-[#FAF9F7] rounded-xl">
              <p className="text-lg font-light text-[#1A1A1A]">{tagUniversities.length}</p>
              <p className="text-xs text-[#6B6B6B]">TAG Eligible</p>
            </div>
            <div className="text-center p-2 bg-[#FAF9F7] rounded-xl">
              <p className="text-lg font-light text-[#1A1A1A]">{upcomingDeadlines.length}</p>
              <p className="text-xs text-[#6B6B6B]">Deadlines</p>
            </div>
            <div className="text-center p-2 bg-[#FAF9F7] rounded-xl">
              <p className="text-lg font-light text-[#1A1A1A]">{transferAgreements.length}</p>
              <p className="text-xs text-[#6B6B6B]">Agreements</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Tabs */}
      <div className="px-4">
        <div className="flex gap-2 bg-[#F5F4F2] rounded-xl p-1">
          {(['goals', 'deadlines', 'requirements'] as TabType[]).map((tab) => (
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
        {activeTab === 'goals' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            {/* Target Universities */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
              <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">Your Target Universities</h3>

              {userProfile?.targetUniversities && userProfile.targetUniversities.length > 0 ? (
                <div className="space-y-2">
                  {userProfile.targetUniversities.map(uniId => {
                    const uni = getInstitutionById(uniId);
                    if (!uni) return null;

                    const agreement = transferAgreements.find(a => a.university_id === uniId);
                    const isTAG = agreement?.agreement_type === 'TAG';

                    return (
                      <div key={uniId} className="p-3 bg-[#FAF9F7] rounded-xl">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-[#1A1A1A]">{uni.short_name}</p>
                              {isTAG && (
                                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                                  TAG ✓
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[#6B6B6B]">{uni.city}, {uni.state}</p>
                          </div>
                          {agreement && (
                            <div className="text-right">
                              <p className="text-xs text-[#6B6B6B]">Min GPA</p>
                              <p className="text-sm font-medium text-[#1A1A1A]">
                                {agreement.gpa_requirement.toFixed(1)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[#6B6B6B] text-center py-4">
                  No target universities selected yet
                </p>
              )}
            </div>

            {/* TAG Eligible Universities */}
            {tagUniversities.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-[#1A1A1A]">TAG-Eligible Schools</h3>
                  <span className="text-xs text-green-600">Guaranteed Admission</span>
                </div>
                <div className="space-y-2">
                  {tagUniversities.map(uni => {
                    const agreement = transferAgreements.find(a => a.university_id === uni.id);
                    const isTarget = userProfile?.targetUniversities?.includes(uni.id);

                    return (
                      <div
                        key={uni.id}
                        className={`p-3 rounded-xl border transition-all ${
                          isTarget ? 'border-green-300 bg-green-50' : 'border-[#E8E6E3]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-[#1A1A1A]">{uni.short_name}</p>
                            <p className="text-xs text-[#6B6B6B]">
                              GPA: {agreement?.gpa_requirement.toFixed(1)} • {agreement?.units_required} units
                            </p>
                          </div>
                          {isTarget ? (
                            <span className="text-xs text-green-600">✓ Added</span>
                          ) : (
                            <button
                              onClick={() => handleAddGoal(uni.id)}
                              className="text-xs px-3 py-1 bg-[#1A1A1A] text-white rounded-full"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'deadlines' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            {upcomingDeadlines.length > 0 ? (
              upcomingDeadlines.map(({ university, deadline, daysUntil }) => {
                const isUrgent = daysUntil <= 30;
                const isPast = daysUntil < 0;

                return (
                  <div
                    key={`${university.id}-${deadline.term}`}
                    className={`bg-white rounded-2xl p-4 shadow-sm border ${
                      isPast ? 'border-red-200 bg-red-50' :
                      isUrgent ? 'border-yellow-200 bg-yellow-50' :
                      'border-[#E8E6E3]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-[#1A1A1A]">{university.short_name}</p>
                        <p className="text-xs text-[#6B6B6B]">
                          {deadline.term.charAt(0).toUpperCase() + deadline.term.slice(1)} {deadline.year} Transfer
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-light ${
                          isPast ? 'text-red-500' :
                          isUrgent ? 'text-yellow-600' :
                          'text-[#1A1A1A]'
                        }`}>
                          {isPast ? 'Passed' : `${daysUntil}d`}
                        </p>
                        <p className="text-xs text-[#6B6B6B]">
                          {new Date(deadline.application_deadline).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>

                    {deadline.priority_deadline && (
                      <div className="mt-2 pt-2 border-t border-[#E8E6E3]">
                        <p className="text-xs text-[#6B6B6B]">
                          TAG Deadline: {new Date(deadline.priority_deadline).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8">
                <p className="text-[#6B6B6B]">No upcoming deadlines</p>
                <p className="text-sm text-[#9B9B9B] mt-1">Add target universities to see deadlines</p>
              </div>
            )}

            {/* General Deadlines Info */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
              <h3 className="text-sm font-medium text-[#1A1A1A] mb-3">Key Dates</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#6B6B6B]">TAG Application</span>
                  <span className="text-[#1A1A1A]">Sept 1-30</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6B6B6B]">UC Application</span>
                  <span className="text-[#1A1A1A]">Nov 1-30</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6B6B6B]">CSU Application</span>
                  <span className="text-[#1A1A1A]">Oct 1 - Dec 15</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'requirements' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            {/* General Requirements */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
              <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">General Transfer Requirements</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#FAF9F7] flex items-center justify-center text-xs">
                    1
                  </div>
                  <div>
                    <p className="text-sm text-[#1A1A1A]">Complete 60 transferable units</p>
                    <p className="text-xs text-[#6B6B6B]">UC/CSU transferable courses</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#FAF9F7] flex items-center justify-center text-xs">
                    2
                  </div>
                  <div>
                    <p className="text-sm text-[#1A1A1A]">Complete IGETC or Major Prep</p>
                    <p className="text-xs text-[#6B6B6B]">General education pattern</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#FAF9F7] flex items-center justify-center text-xs">
                    3
                  </div>
                  <div>
                    <p className="text-sm text-[#1A1A1A]">Maintain minimum GPA</p>
                    <p className="text-xs text-[#6B6B6B]">Varies by school (2.4 - 3.8)</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#FAF9F7] flex items-center justify-center text-xs">
                    4
                  </div>
                  <div>
                    <p className="text-sm text-[#1A1A1A]">Complete prerequisite courses</p>
                    <p className="text-xs text-[#6B6B6B]">Major-specific requirements</p>
                  </div>
                </div>
              </div>
            </div>

            {/* TAG Requirements */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
              <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">TAG Requirements</h3>
              <div className="space-y-2 text-sm">
                <p className="text-[#6B6B6B]">
                  Transfer Admission Guarantee (TAG) provides guaranteed admission to participating UC campuses.
                </p>
                <ul className="list-disc list-inside text-[#6B6B6B] space-y-1">
                  <li>Complete 30 UC-transferable units by fall</li>
                  <li>Meet campus-specific GPA requirements</li>
                  <li>Complete required courses by spring</li>
                  <li>Submit TAG application Sept 1-30</li>
                </ul>
              </div>
            </div>

            {/* School-Specific Requirements */}
            {transferAgreements.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E8E6E3]">
                <h3 className="text-sm font-medium text-[#1A1A1A] mb-4">School-Specific Requirements</h3>
                <div className="space-y-3">
                  {transferAgreements.slice(0, 5).map(agreement => {
                    const uni = getInstitutionById(agreement.university_id);
                    if (!uni) return null;

                    return (
                      <div key={agreement.university_id} className="p-3 bg-[#FAF9F7] rounded-xl">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-[#1A1A1A]">{uni.short_name}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            agreement.agreement_type === 'TAG'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {agreement.agreement_type}
                          </span>
                        </div>
                        <div className="flex gap-4 text-xs text-[#6B6B6B]">
                          <span>GPA: {agreement.gpa_requirement}</span>
                          <span>Units: {agreement.units_required}</span>
                        </div>
                        {agreement.majors_available.length > 0 && (
                          <p className="text-xs text-[#6B6B6B] mt-1">
                            Majors: {agreement.majors_available.slice(0, 3).join(', ')}
                            {agreement.majors_available.length > 3 && '...'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
