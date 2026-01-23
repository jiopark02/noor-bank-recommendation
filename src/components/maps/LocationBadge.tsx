'use client';

import { CampusSide, getCampusSideLabel } from '@/lib/universityData';

interface LocationBadgeProps {
  side: CampusSide;
  walkingMinutes?: number;
  size?: 'sm' | 'md';
  className?: string;
}

export function LocationBadge({
  side,
  walkingMinutes,
  size = 'sm',
  className = '',
}: LocationBadgeProps) {
  const sideLabel = getCampusSideLabel(side);
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-1' : 'text-sm px-3 py-1.5';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-gray-100 text-gray-600 font-medium ${sizeClasses} ${className}`}
    >
      <LocationIcon className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
      <span>
        {sideLabel}
        {walkingMinutes !== undefined && ` · ${walkingMinutes} min`}
      </span>
    </span>
  );
}

function LocationIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

// Compact inline variant
interface LocationTagProps {
  side: CampusSide;
  className?: string;
}

export function LocationTag({ side, className = '' }: LocationTagProps) {
  const sideLabel = getCampusSideLabel(side);

  return (
    <span className={`text-gray-400 text-xs ${className}`}>
      {sideLabel}
    </span>
  );
}

// Branch count badge for bank cards
interface BranchCountBadgeProps {
  count: number;
  side?: CampusSide;
  className?: string;
}

export function BranchCountBadge({ count, side, className = '' }: BranchCountBadgeProps) {
  if (count === 0) return null;

  const text = side && side !== 'center'
    ? `${count} ${count === 1 ? 'branch' : 'branches'} on ${side} side`
    : `${count} ${count === 1 ? 'branch' : 'branches'} nearby`;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-gray-500 ${className}`}
    >
      <BranchIcon className="w-3.5 h-3.5" />
      <span>{text}</span>
    </span>
  );
}

function BranchIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
      />
    </svg>
  );
}
