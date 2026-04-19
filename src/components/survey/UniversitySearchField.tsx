'use client';

import { useState } from 'react';
import { useUniversitySearch, type University } from '@/hooks/useUniversitySearch';

export type UniversitySearchInstitutionType =
  | 'university'
  | 'community_college'
  | 'all';

export interface UniversitySearchFieldProps {
  /** Country filter for `/api/universities` (US, UK, CA) */
  country: string;
  institutionType: UniversitySearchInstitutionType;
  /** Current institution id when chosen from list, or "other", or "" */
  selectedInstitutionId: string;
  /** Controlled search box value (same as survey `institutionSearch`) */
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSelect: (inst: University) => void;
  onCantFind: (typedSearch: string) => void;
  searchPlaceholder?: string;
  cantFindLabel?: string;
  noResultsLabel?: string;
}

/**
 * University / CC search + list — mirrors survey step 1 institution search (controlled query).
 */
export function UniversitySearchField({
  country,
  institutionType,
  selectedInstitutionId,
  searchQuery,
  onSearchQueryChange,
  onSelect,
  onCantFind,
  searchPlaceholder = 'Search by school name…',
  cantFindLabel = "Can't find my school",
  noResultsLabel = 'No schools found — use my text as school name',
}: UniversitySearchFieldProps) {
  const [showList, setShowList] = useState(false);

  const { universities, isLoading } = useUniversitySearch({
    country: country || 'US',
    type: institutionType,
    enabled: Boolean(country),
    searchQuery,
  });

  return (
    <div className="relative">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => {
          onSearchQueryChange(e.target.value);
          setShowList(true);
        }}
        onFocus={() => setShowList(true)}
        placeholder={searchPlaceholder}
        className="w-full px-3 py-2 mt-1 border border-gray-200 rounded-lg text-sm outline-none focus:border-black"
        autoComplete="off"
      />
      {showList && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {isLoading && (
            <div className="px-3 py-2 text-xs text-gray-500">Searching…</div>
          )}
          {!isLoading && universities.length > 0 && (
            <>
              {universities.map((inst) => (
                <button
                  key={inst.id}
                  type="button"
                  onClick={() => {
                    onSelect(inst);
                    setShowList(false);
                  }}
                  className={`w-full px-3 py-2.5 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 ${
                    selectedInstitutionId === inst.id ? 'bg-gray-50' : ''
                  }`}
                >
                  <p className="font-medium text-sm text-gray-900">{inst.short_name}</p>
                  <p className="text-xs text-gray-500">
                    {inst.name} · {inst.city}, {inst.state}
                  </p>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  onCantFind(searchQuery.trim());
                  setShowList(false);
                }}
                className="w-full px-3 py-2.5 text-left text-gray-500 text-sm hover:bg-gray-50"
              >
                {cantFindLabel}
              </button>
            </>
          )}
          {!isLoading && universities.length === 0 && searchQuery.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                onCantFind(searchQuery.trim());
                setShowList(false);
              }}
              className="w-full px-3 py-2.5 text-left text-gray-500 text-sm hover:bg-gray-50"
            >
              {noResultsLabel}
            </button>
          )}
        </div>
      )}
      {selectedInstitutionId && searchQuery.trim() && !showList && (
        <p className="text-xs text-emerald-600 mt-1">✓ {searchQuery.trim()}</p>
      )}
    </div>
  );
}
