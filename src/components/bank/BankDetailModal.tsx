'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { BankRecommendation, MatchReason } from '@/hooks/useBankRecommendations';
import { MapView, getCampusSideColor, DirectionsButton } from '@/components/maps';
import type { MapMarker } from '@/components/maps';
import { getBranchesForBank, UNIVERSITY_LOCATIONS, BankBranch } from '@/lib/universityData';

// All markers use black for Noor branding
const NOOR_BLACK = '#000000';

interface BankDetailModalProps {
  recommendation: BankRecommendation;
  isOpen: boolean;
  onClose: () => void;
}

export function BankDetailModal({ recommendation, isOpen, onClose }: BankDetailModalProps) {
  const {
    bank,
    fitScore,
    isBestMatch,
    matchReasons,
    warnings,
    monthlyEstimatedCost,
    yearlyEstimatedCost,
    comparisonHighlights,
  } = recommendation;

  const [userUniversity, setUserUniversity] = useState<string>('Stanford');

  useEffect(() => {
    try {
      const profile = localStorage.getItem('noor_user_profile');
      if (profile) {
        const parsed = JSON.parse(profile);
        if (parsed.university) {
          setUserUniversity(parsed.university);
        }
      }
    } catch (e) {
      // Use default
    }
  }, []);

  // Get branches for this bank
  const branches = useMemo(() => {
    return getBranchesForBank(userUniversity, bank.bank_name);
  }, [userUniversity, bank.bank_name]);

  // Get university center for map
  const universityCenter = useMemo(() => {
    const uni = UNIVERSITY_LOCATIONS[userUniversity];
    if (uni) {
      return [uni.center.lat, uni.center.lng] as [number, number];
    }
    return [37.4275, -122.1697] as [number, number];
  }, [userUniversity]);

  // Create map markers with colors by campus side
  const branchMarkers: MapMarker[] = useMemo(() => {
    return branches.map((branch) => ({
      position: [branch.lat, branch.lng] as [number, number],
      label: branch.name,
      color: getCampusSideColor(branch.campusSide),
      popupContent: `
        <div style="min-width: 200px;">
          <strong style="font-size: 14px; display: block; margin-bottom: 4px;">${branch.name}</strong>
          <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">${branch.address}</p>
          <p style="font-size: 11px; color: #888; margin: 0 0 8px 0;">
            ${branch.campusSide.charAt(0).toUpperCase() + branch.campusSide.slice(1)} side of campus
          </p>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(branch.address)}"
             target="_blank" rel="noopener noreferrer"
             style="display: inline-block; padding: 6px 12px; background: #000; color: #fff; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 500;">
            Get Directions
          </a>
        </div>
      `,
    }));
  }, [branches]);

  if (!isOpen) return null;

  const handleApply = () => {
    if (bank.apply_link) {
      window.open(bank.apply_link, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-x-0 bottom-0 bg-white rounded-t-2xl max-h-[90vh] overflow-hidden animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Header */}
        <div className="px-6 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              {recommendation.categoryPick && (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold mb-2 ${
                  recommendation.categoryPick.category === 'best_overall' ? 'bg-black text-white' :
                  recommendation.categoryPick.category === 'best_low_fees' ? 'bg-green-600 text-white' :
                  recommendation.categoryPick.category === 'best_international' ? 'bg-blue-600 text-white' :
                  recommendation.categoryPick.category === 'best_branches' ? 'bg-purple-600 text-white' :
                  recommendation.categoryPick.category === 'best_online' ? 'bg-indigo-600 text-white' :
                  recommendation.categoryPick.category === 'best_student' ? 'bg-orange-500 text-white' :
                  recommendation.categoryPick.category === 'best_no_ssn' ? 'bg-teal-600 text-white' :
                  'bg-gray-600 text-white'
                }`}>
                  {recommendation.categoryPick.label}
                </span>
              )}
              <h2 className="text-xl font-semibold text-black">{bank.bank_name}</h2>
              <p className="text-gray-500 text-sm mt-0.5">
                {formatAccountType(bank.account_type)}
              </p>
              {recommendation.categoryPick?.reason && (
                <p className="text-gray-600 text-sm mt-1 italic">
                  {recommendation.categoryPick.reason}
                </p>
              )}
            </div>
            <div className={isBestMatch ? 'best-fit-badge' : 'fit-badge'}>
              {Math.round(fitScore)}% fit
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[60vh] px-6 py-5">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <StatCard
              label="Fees"
              value={comparisonHighlights.fees.value}
              isGood={comparisonHighlights.fees.isGood}
            />
            <StatCard
              label="Access"
              value={comparisonHighlights.accessibility.value}
              isGood={comparisonHighlights.accessibility.isGood}
            />
            <StatCard
              label="Features"
              value={comparisonHighlights.features.value}
              isGood={comparisonHighlights.features.isGood}
            />
            <StatCard
              label="Intl Transfers"
              value={comparisonHighlights.internationalTransfers.value}
              isGood={comparisonHighlights.internationalTransfers.isGood}
            />
          </div>

          {/* Estimated Costs */}
          {monthlyEstimatedCost > 0 && (
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 mb-6">
              <p className="text-orange-800 text-sm font-medium">Estimated Costs</p>
              <p className="text-orange-700 text-sm mt-1">
                ~${monthlyEstimatedCost.toFixed(0)}/month ({' '}
                ${yearlyEstimatedCost.toFixed(0)}/year) based on your usage
              </p>
            </div>
          )}

          {/* Why We Recommend - Match Reasons */}
          {matchReasons.length > 0 && (
            <div className="mb-6">
              <h3 className="font-medium text-black mb-3">Why this bank is great for you</h3>
              <div className="space-y-3">
                {matchReasons.map((reason, index) => (
                  <ReasonCard key={index} reason={reason} />
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="mb-6">
              <h3 className="font-medium text-black mb-3">Things to watch out for</h3>
              <div className="bg-orange-50 rounded-xl p-4 space-y-3">
                {warnings.map((warning, index) => (
                  <div key={index} className="flex gap-3">
                    <span className="text-lg flex-shrink-0">{warning.icon}</span>
                    <div>
                      <p className="font-medium text-orange-900 text-sm">{warning.title}</p>
                      <p className="text-orange-700 text-sm mt-0.5">{warning.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Requirements */}
          <div className="mb-6">
            <h3 className="font-medium text-black mb-3">Requirements</h3>
            <div className="space-y-2">
              <RequirementRow
                label="SSN Required"
                value={bank.can_open_without_ssn ? 'No' : 'Yes'}
                positive={bank.can_open_without_ssn}
              />
              <RequirementRow
                label="ITIN Accepted"
                value={bank.itin_accepted ? 'Yes' : 'No'}
                positive={bank.itin_accepted}
              />
              <RequirementRow
                label="In-Person Visit"
                value={bank.requires_in_person_for_no_ssn ? 'Required (for no SSN)' : 'Not required'}
                positive={!bank.requires_in_person_for_no_ssn}
              />
              <RequirementRow
                label="Min. Opening Deposit"
                value={bank.min_opening_deposit === 0 ? 'None' : `$${bank.min_opening_deposit}`}
                positive={bank.min_opening_deposit === 0}
              />
            </div>
          </div>

          {/* Branch Locations with Map */}
          {branches.length > 0 && (
            <div className="mb-6">
              <h3 className="font-medium text-black mb-3">
                Branch Locations ({branches.length} near {userUniversity})
              </h3>

              {/* Map */}
              <div className="mb-4">
                <MapView
                  center={universityCenter}
                  zoom={13}
                  markers={branchMarkers}
                  height="220px"
                  className="border border-gray-200"
                />
              </div>

              {/* Branch List */}
              <div className="space-y-3">
                {branches.map((branch) => (
                  <BranchListItem key={branch.id} branch={branch} />
                ))}
              </div>
            </div>
          )}

          {/* Features */}
          <div className="mb-6">
            <h3 className="font-medium text-black mb-3">Features</h3>
            <div className="flex flex-wrap gap-2">
              {bank.has_zelle && <FeatureTag label="Zelle" highlight />}
              {bank.has_mobile_deposit && <FeatureTag label="Mobile Deposit" />}
              {bank.is_online_only && <FeatureTag label="Online Only" />}
              {bank.has_student_account && <FeatureTag label="Student Account" />}
              {bank.intl_student_friendly && <FeatureTag label="Intl Student Friendly" highlight />}
              {bank.savings_apy > 0 && <FeatureTag label={`${bank.savings_apy}% APY`} />}
              {bank.atm_count > 0 && <FeatureTag label={`${(bank.atm_count / 1000).toFixed(0)}K+ ATMs`} />}
            </div>
          </div>

          {/* Fee Details */}
          <div className="mb-6">
            <h3 className="font-medium text-black mb-3">Fee Details</h3>
            <div className="space-y-2">
              <FeeRow
                label="Monthly Fee"
                value={bank.monthly_fee === 0 ? 'Free' : `$${bank.monthly_fee}`}
                note={bank.monthly_fee_waiver}
              />
              <FeeRow
                label="Outgoing Wire"
                value={bank.intl_wire_outgoing === 0 ? 'Free' : `$${bank.intl_wire_outgoing}`}
              />
              <FeeRow
                label="Incoming Wire"
                value={bank.intl_wire_incoming === 0 ? 'Free' : `$${bank.intl_wire_incoming}`}
              />
              <FeeRow
                label="Foreign Transaction"
                value={bank.foreign_transaction_fee === 0 ? 'None' : `${bank.foreign_transaction_fee}%`}
              />
            </div>
          </div>

          {/* Pros & Cons */}
          {(bank.pros?.length > 0 || bank.cons?.length > 0) && (
            <div className="mb-6 grid grid-cols-2 gap-4">
              {bank.pros?.length > 0 && (
                <div>
                  <h3 className="font-medium text-black mb-2">Pros</h3>
                  <ul className="space-y-1">
                    {bank.pros.slice(0, 4).map((pro, i) => (
                      <li key={i} className="text-sm text-gray-600 flex gap-2">
                        <span className="text-green-500 flex-shrink-0">+</span>
                        {pro}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {bank.cons?.length > 0 && (
                <div>
                  <h3 className="font-medium text-black mb-2">Cons</h3>
                  <ul className="space-y-1">
                    {bank.cons.slice(0, 4).map((con, i) => (
                      <li key={i} className="text-sm text-gray-600 flex gap-2">
                        <span className="text-red-500 flex-shrink-0">-</span>
                        {con}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-white">
          <button
            onClick={handleApply}
            className="w-full py-3.5 bg-black text-white rounded-xl font-medium hover:bg-gray-800 transition-colors"
          >
            Apply Now
          </button>
        </div>
      </div>
    </div>
  );
}

function formatAccountType(type: string): string {
  const typeMap: Record<string, string> = {
    checking: 'Checking Account',
    savings: 'Savings Account',
    student_account: 'Student Account',
    credit_card: 'Credit Card',
    secured_card: 'Secured Card',
  };
  return typeMap[type] || type.replace('_', ' ');
}

function StatCard({ label, value, isGood }: { label: string; value: string; isGood: boolean }) {
  return (
    <div className={`p-3 rounded-xl ${isGood ? 'bg-green-50' : 'bg-gray-50'}`}>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`font-semibold ${isGood ? 'text-green-700' : 'text-gray-700'}`}>{value}</p>
    </div>
  );
}

function ReasonCard({ reason }: { reason: MatchReason }) {
  const bgColor = reason.type === 'positive'
    ? 'bg-green-50 border-green-100'
    : reason.type === 'info'
    ? 'bg-blue-50 border-blue-100'
    : 'bg-orange-50 border-orange-100';

  const textColor = reason.type === 'positive'
    ? 'text-green-900'
    : reason.type === 'info'
    ? 'text-blue-900'
    : 'text-orange-900';

  const descColor = reason.type === 'positive'
    ? 'text-green-700'
    : reason.type === 'info'
    ? 'text-blue-700'
    : 'text-orange-700';

  return (
    <div className={`${bgColor} border rounded-xl p-3 flex gap-3`}>
      <span className="text-lg flex-shrink-0">{reason.icon}</span>
      <div>
        <p className={`font-medium text-sm ${textColor}`}>{reason.title}</p>
        <p className={`text-sm mt-0.5 ${descColor}`}>{reason.description}</p>
      </div>
    </div>
  );
}

function RequirementRow({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-gray-600 text-sm">{label}</span>
      <span className={`text-sm font-medium ${positive ? 'text-green-600' : 'text-gray-500'}`}>
        {positive && <span className="mr-1">&#10003;</span>}
        {value}
      </span>
    </div>
  );
}

function FeeRow({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-gray-600 text-sm">{label}</span>
        <span className={`text-sm font-medium ${value === 'Free' || value === 'None' ? 'text-green-600' : 'text-gray-700'}`}>
          {value}
        </span>
      </div>
      {note && (
        <p className="text-gray-400 text-xs mt-1">Waiver: {note}</p>
      )}
    </div>
  );
}

function FeatureTag({ label, highlight = false }: { label: string; highlight?: boolean }) {
  return (
    <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm ${
      highlight ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'
    }`}>
      {label}
    </span>
  );
}

function BranchListItem({ branch }: { branch: BankBranch }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
      <span className="w-2.5 h-2.5 rounded-full bg-black mt-1.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-black">{branch.name}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{branch.address}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-400 capitalize">{branch.campusSide} side</span>
          {branch.phone && (
            <>
              <span className="text-gray-300">·</span>
              <a href={`tel:${branch.phone}`} className="text-xs text-gray-400 hover:text-black">
                {branch.phone}
              </a>
            </>
          )}
        </div>
      </div>
      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(branch.address)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-xs font-medium text-black hover:opacity-70 transition-opacity"
      >
        Directions →
      </a>
    </div>
  );
}
