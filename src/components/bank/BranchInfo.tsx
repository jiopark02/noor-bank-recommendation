'use client';

import { useState, useEffect, useMemo } from 'react';
import { MapView, DirectionsLink } from '@/components/maps';
import {
  getBranchesForBank,
  getBranchCountBySide,
  CampusSide,
  BankBranch,
  UNIVERSITY_LOCATIONS,
} from '@/lib/universityData';

interface BranchInfoProps {
  bankName: string;
  university?: string;
  userCampusSide?: CampusSide;
  showMap?: boolean;
  compact?: boolean;
}

export function BranchInfo({
  bankName,
  university = 'Stanford',
  userCampusSide,
  showMap = true,
  compact = false,
}: BranchInfoProps) {
  const [expanded, setExpanded] = useState(false);

  const branches = useMemo(() => {
    return getBranchesForBank(university, bankName);
  }, [university, bankName]);

  const nearbyCount = useMemo(() => {
    if (!userCampusSide || userCampusSide === 'center') {
      return branches.length;
    }
    return getBranchCountBySide(university, bankName, userCampusSide);
  }, [university, bankName, userCampusSide]);

  const universityCenter = useMemo(() => {
    const uni = UNIVERSITY_LOCATIONS[university];
    if (uni) {
      return [uni.center.lat, uni.center.lng] as [number, number];
    }
    return [37.4275, -122.1697] as [number, number];
  }, [university]);

  const mapMarkers = useMemo(() => {
    return branches.map((branch) => ({
      position: [branch.lat, branch.lng] as [number, number],
      label: branch.name,
      popupContent: `<strong>${branch.bank}</strong><br/>${branch.name}<br/>${branch.address}`,
    }));
  }, [branches]);

  if (branches.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <BranchIcon className="w-3.5 h-3.5" />
        <span>
          {nearbyCount} {nearbyCount === 1 ? 'branch' : 'branches'}
          {userCampusSide && userCampusSide !== 'center' && ` on ${userCampusSide} side`}
        </span>
      </span>
    );
  }

  return (
    <div className="noor-card p-5">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
            <BranchIcon className="w-5 h-5 text-gray-600" />
          </div>
          <div className="text-left">
            <p className="font-medium text-black">{bankName} Branches</p>
            <p className="text-sm text-gray-500">
              {nearbyCount} {nearbyCount === 1 ? 'branch' : 'branches'}
              {userCampusSide && userCampusSide !== 'center' && ` near ${userCampusSide} side`}
            </p>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="mt-5 pt-5 border-t border-gray-100 animate-fade-in">
          {/* Map */}
          {showMap && mapMarkers.length > 0 && (
            <div className="mb-5">
              <MapView
                center={universityCenter}
                zoom={14}
                markers={mapMarkers}
                height="200px"
                className="border border-gray-200"
              />
            </div>
          )}

          {/* Branch List */}
          <div className="space-y-4">
            {branches.map((branch) => (
              <BranchItem key={branch.id} branch={branch} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BranchItem({ branch }: { branch: BankBranch }) {
  return (
    <div className="flex items-start justify-between gap-4">
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
      <DirectionsLink lat={branch.lat} lng={branch.lng} label={branch.address} className="shrink-0">
        <span className="text-xs text-black hover:opacity-70 transition-opacity">Directions</span>
      </DirectionsLink>
    </div>
  );
}

// Standalone branch count badge for bank cards
interface BranchCountBadgeProps {
  bankName: string;
  university?: string;
  className?: string;
}

export function BankBranchCount({ bankName, university = 'Stanford', className = '' }: BranchCountBadgeProps) {
  const count = useMemo(() => {
    const branches = getBranchesForBank(university, bankName);
    return branches.length;
  }, [university, bankName]);

  if (count === 0) {
    return null;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-gray-500 ${className}`}>
      <BranchIcon className="w-3.5 h-3.5" />
      <span>{count} {count === 1 ? 'branch' : 'branches'} nearby</span>
    </span>
  );
}

// Branch locator section for banking page
interface BranchLocatorProps {
  university?: string;
  userCampusSide?: CampusSide;
  recommendedBanks?: string[];
}

export function BranchLocator({
  university = 'Stanford',
  userCampusSide,
  recommendedBanks = [],
}: BranchLocatorProps) {
  const [userUni, setUserUni] = useState(university);

  useEffect(() => {
    try {
      const profile = localStorage.getItem('noor_user_profile');
      if (profile) {
        const parsed = JSON.parse(profile);
        if (parsed.university) {
          setUserUni(parsed.university);
        }
      }
    } catch (e) {
      // Use default
    }
  }, []);

  // Get unique banks from recommendations or default popular banks
  const banksToShow = recommendedBanks.length > 0
    ? recommendedBanks
    : ['Bank of America', 'Chase', 'Wells Fargo'];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-gray-700 mb-3">Branch Locations</h3>
      {banksToShow.map((bank) => (
        <BranchInfo
          key={bank}
          bankName={bank}
          university={userUni}
          userCampusSide={userCampusSide}
        />
      ))}
    </div>
  );
}

function BranchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
      />
    </svg>
  );
}
