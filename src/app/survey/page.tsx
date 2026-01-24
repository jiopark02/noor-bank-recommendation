'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ALL_INSTITUTIONS,
  getCommunityColleges,
  getUniversities,
  getTAGEligibleUniversities,
  getInstitutionById,
  University,
} from '@/lib/universitiesData';

interface SurveyData {
  // Step 1
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  staySignedIn: boolean;
  institutionId: string;
  institutionType: 'university' | 'community_college' | '';
  countryOfOrigin: string;
  // Step 2
  academicLevel: string;
  year: string;
  // Step 2.5 (for CC students)
  planningToTransfer: boolean | null;
  targetUniversities: string[];
  targetMajor: string;
  expectedTransferYear: string;
  // Step 3
  hasSSN: boolean | null;
  hasITIN: boolean | null;
  hasUSAddress: boolean | null;
  // Step 4
  monthlyIncome: number;
  monthlyExpenses: number;
  feePriority: string;
  // Step 5
  bankingNeeds: string[];
  bankingStyle: string;
  // Step 6
  transferFrequency: string;
  branchPreference: string;
  campusSide: string;
  // Step 7
  goals: string[];
  creditCardInterest: string;
}

const INITIAL_DATA: SurveyData = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
  staySignedIn: false,
  institutionId: '',
  institutionType: '',
  countryOfOrigin: '',
  academicLevel: '',
  year: '',
  planningToTransfer: null,
  targetUniversities: [],
  targetMajor: '',
  expectedTransferYear: '',
  hasSSN: null,
  hasITIN: null,
  hasUSAddress: null,
  monthlyIncome: 0,
  monthlyExpenses: 0,
  feePriority: '',
  bankingNeeds: [],
  bankingStyle: '',
  transferFrequency: '',
  branchPreference: '',
  campusSide: '',
  goals: [],
  creditCardInterest: '',
};

// Institution type options
const INSTITUTION_TYPES = [
  { id: 'university', label: '4-Year University' },
  { id: 'community_college', label: 'Community College' },
];

const COUNTRIES = [
  'Japan',
  'Korea',
  'China',
  'India',
  'Vietnam',
  'Canada',
  'Brazil',
  'Singapore',
  'Bangladesh',
  'Nigeria',
  'Other',
];

// Input Component - MUST be outside the main component to prevent re-renders
const Input = ({
  type = 'text',
  value,
  onChange,
  placeholder,
}: {
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
}) => (
  <input
    type={type}
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-black placeholder:text-gray-400"
  />
);

// Select Component
const Select = ({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-black bg-white appearance-none text-gray-700"
    style={{
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239CA3AF'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 12px center',
      backgroundSize: '20px',
      paddingRight: '44px',
    }}
  >
    <option value="" className="text-gray-400">{placeholder || 'Select...'}</option>
    {options.map(opt => (
      <option key={opt} value={opt}>{opt}</option>
    ))}
  </select>
);

// Option Button (wide)
const OptionButton = ({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`w-full px-5 py-3.5 rounded-xl border-2 font-medium text-left transition-all duration-300 ${
      selected
        ? 'border-black bg-black text-white'
        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
    }`}
  >
    {children}
  </button>
);

// Toggle Button (Yes/No)
const ToggleButtons = ({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) => (
  <div className="flex gap-3">
    <button
      onClick={() => onChange(true)}
      className={`flex-1 py-3.5 rounded-xl border-2 font-medium transition-all duration-300 ${
        value === true
          ? 'border-black bg-black text-white'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
      }`}
    >
      Yes
    </button>
    <button
      onClick={() => onChange(false)}
      className={`flex-1 py-3.5 rounded-xl border-2 font-medium transition-all duration-300 ${
        value === false
          ? 'border-black bg-black text-white'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
      }`}
    >
      No
    </button>
  </div>
);

// Multi-select Chip
const ChipButton = ({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`px-4 py-2.5 rounded-full border-[1.5px] text-sm font-medium transition-all duration-300 ${
      selected
        ? 'border-black bg-black text-white'
        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
    }`}
  >
    {children}
  </button>
);

// Feedback Text
const Feedback = ({ children }: { children: React.ReactNode }) => (
  <p className="text-emerald-600 text-sm mt-4 animate-fade-in">{children}</p>
);

// Money Input - handles leading zeros properly
const MoneyInput = ({
  value,
  onChange,
  placeholder = '0',
}: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
}) => {
  const [text, setText] = React.useState(() => (value > 0 ? String(value) : ''));

  // Sync when parent value changes
  React.useEffect(() => {
    setText(value > 0 ? String(value) : '');
  }, [value]);

  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        onKeyDown={e => {
          // Block "0" key when field is empty (prevents leading zeros)
          if (e.key === '0' && text === '') {
            e.preventDefault();
            return;
          }
          // Only allow digits and control keys
          if (!/^\d$/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
            e.preventDefault();
          }
        }}
        onChange={e => {
          // Get raw value and strip any non-digits and leading zeros
          const raw = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
          setText(raw);
          onChange(raw ? parseInt(raw, 10) : 0);
        }}
        className="w-full pl-8 pr-4 py-3.5 border border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-black"
      />
    </div>
  );
};

// Progress Dots
const ProgressDots = ({ step, totalSteps }: { step: number; totalSteps: number }) => (
  <div className="flex justify-center gap-2 mb-10">
    {Array.from({ length: totalSteps }).map((_, i) => (
      <div
        key={i}
        className={`h-2 rounded-full transition-all duration-300 ${
          i + 1 === step ? 'bg-black w-6' : i + 1 < step ? 'bg-black w-2' : 'bg-gray-200 w-2'
        }`}
      />
    ))}
  </div>
);

export default function SurveyPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<SurveyData>(INITIAL_DATA);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [institutionSearch, setInstitutionSearch] = useState('');
  const [showInstitutionList, setShowInstitutionList] = useState(false);

  // Total steps: 8 for CC students with transfer, 7 for others
  const isCC = data.institutionType === 'community_college';
  const showTransferStep = isCC && data.planningToTransfer === true;
  const totalSteps = showTransferStep ? 8 : 7;

  // Filter institutions based on search and type
  const filteredInstitutions = useMemo(() => {
    if (!data.institutionType) return [];
    const institutions = data.institutionType === 'community_college'
      ? getCommunityColleges()
      : getUniversities();

    if (!institutionSearch) return institutions.slice(0, 20);

    const search = institutionSearch.toLowerCase();
    return institutions
      .filter(inst =>
        inst.name.toLowerCase().includes(search) ||
        inst.short_name.toLowerCase().includes(search) ||
        inst.city.toLowerCase().includes(search)
      )
      .slice(0, 15);
  }, [data.institutionType, institutionSearch]);

  // Get TAG-eligible universities for CC students
  const tagUniversities = useMemo(() => {
    if (!data.institutionId || !isCC) return [];
    return getTAGEligibleUniversities(data.institutionId);
  }, [data.institutionId, isCC]);

  const updateField = <K extends keyof SurveyData>(field: K, value: SurveyData[K]) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  const toggleArrayField = (field: 'bankingNeeds' | 'goals' | 'targetUniversities', value: string) => {
    setData(prev => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter(v => v !== value)
        : [...prev[field], value],
    }));
  };

  const selectInstitution = (inst: University) => {
    updateField('institutionId', inst.id);
    setInstitutionSearch(inst.short_name);
    setShowInstitutionList(false);
  };

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const institution = data.institutionId ? getInstitutionById(data.institutionId) : null;

      const response = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: data.firstName,
          last_name: data.lastName,
          email: data.email,
          password: data.password,
          country_of_origin: data.countryOfOrigin,
          university: institution?.short_name || '',
          institution_id: data.institutionId,
          institution_type: data.institutionType,
          visa_status: 'F-1',
          has_ssn: data.hasSSN ?? false,
          has_itin: data.hasITIN ?? false,
          has_us_address: data.hasUSAddress ?? false,
          monthly_income: data.monthlyIncome,
          monthly_budget: data.monthlyExpenses,
          international_transfers: data.transferFrequency,
          branch_preference: data.branchPreference,
          banking_needs: data.bankingNeeds,
          banking_style: data.bankingStyle,
          campus_side: data.campusSide !== 'unknown' ? data.campusSide : null,
          goals: data.goals,
          credit_card_interest: data.creditCardInterest,
          needs_zelle: data.bankingNeeds.includes('Bill pay'),
          credit_goals: data.goals.includes('Credit history') ? 'build-credit' : 'basic',
          fee_sensitivity: data.feePriority === 'budget' ? 'very-sensitive' : data.feePriority === 'premium' ? 'not-sensitive' : 'medium',
          digital_preference: data.bankingStyle === 'Digital' ? 'mobile-first' : data.bankingStyle === 'Branches' ? 'branch' : 'both',
          campus_proximity: data.branchPreference === 'must' ? 'very-important' : data.branchPreference === 'preferred' ? 'somewhat-important' : 'not-important',
          // Transfer-related fields for CC students
          planning_to_transfer: data.planningToTransfer,
          target_universities: data.targetUniversities,
          target_major: data.targetMajor,
          expected_transfer_year: data.expectedTransferYear,
        }),
      });

      const result = await response.json();

      // Save user ID
      localStorage.setItem('noor_user_id', result.userId);

      // Save user profile locally as backup
      const userProfile = {
        id: result.userId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        institutionId: data.institutionId,
        institutionType: data.institutionType,
        university: institution?.short_name || '',
        countryOfOrigin: data.countryOfOrigin,
        hasSSN: data.hasSSN,
        hasITIN: data.hasITIN,
        hasUSAddress: data.hasUSAddress,
        monthlyIncome: data.monthlyIncome,
        monthlyExpenses: data.monthlyExpenses,
        bankingNeeds: data.bankingNeeds,
        bankingStyle: data.bankingStyle,
        transferFrequency: data.transferFrequency,
        branchPreference: data.branchPreference,
        campusSide: data.campusSide !== 'unknown' ? data.campusSide : null,
        goals: data.goals,
        creditCardInterest: data.creditCardInterest,
        // Transfer-related fields
        planningToTransfer: data.planningToTransfer,
        targetUniversities: data.targetUniversities,
        targetMajor: data.targetMajor,
        expectedTransferYear: data.expectedTransferYear,
      };
      localStorage.setItem('noor_user_profile', JSON.stringify(userProfile));

      router.push('/banking');
    } catch (error) {
      console.error('Survey submission error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="pt-8 pb-4 text-center">
        <span className="text-xs tracking-[0.3em] font-medium text-gray-400">NOOR</span>
      </header>

      <div className="max-w-md mx-auto px-6 pb-32">
        <ProgressDots step={step} totalSteps={totalSteps} />

        {/* Step 1: First, you. */}
        {step === 1 && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight mb-2">First, you.</h1>
            <p className="text-gray-500 mb-8">So we can build this around you.</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="First name"
                  value={data.firstName}
                  onChange={v => updateField('firstName', v)}
                />
                <Input
                  placeholder="Last name"
                  value={data.lastName}
                  onChange={v => updateField('lastName', v)}
                />
              </div>
              <Input
                type="email"
                placeholder="Email"
                value={data.email}
                onChange={v => updateField('email', v)}
              />
              <Input
                type="password"
                placeholder="Password"
                value={data.password}
                onChange={v => updateField('password', v)}
              />
              <Input
                type="password"
                placeholder="Confirm password"
                value={data.confirmPassword}
                onChange={v => updateField('confirmPassword', v)}
              />

              <label className="flex items-center gap-3 py-2 cursor-pointer">
                <div
                  onClick={() => updateField('staySignedIn', !data.staySignedIn)}
                  className={`w-5 h-5 rounded border-[1.5px] flex items-center justify-center transition-all duration-300 ${
                    data.staySignedIn ? 'bg-black border-black' : 'border-gray-300'
                  }`}
                >
                  {data.staySignedIn && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-gray-600">Stay signed in</span>
              </label>

              {/* Institution Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">School type</label>
                <div className="grid grid-cols-2 gap-3">
                  {INSTITUTION_TYPES.map(type => (
                    <button
                      key={type.id}
                      onClick={() => {
                        updateField('institutionType', type.id as 'university' | 'community_college');
                        updateField('institutionId', '');
                        setInstitutionSearch('');
                      }}
                      className={`py-3 rounded-xl border-2 font-medium text-sm transition-all duration-300 ${
                        data.institutionType === type.id
                          ? 'border-black bg-black text-white'
                          : 'border-gray-200 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Institution Search */}
              {data.institutionType && (
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {data.institutionType === 'community_college' ? 'Community College' : 'University'}
                  </label>
                  <input
                    type="text"
                    value={institutionSearch}
                    onChange={e => {
                      setInstitutionSearch(e.target.value);
                      setShowInstitutionList(true);
                    }}
                    onFocus={() => setShowInstitutionList(true)}
                    placeholder={`Search ${data.institutionType === 'community_college' ? 'community colleges' : 'universities'}...`}
                    className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-base outline-none transition-all duration-300 focus:border-black"
                  />
                  {showInstitutionList && filteredInstitutions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                      {filteredInstitutions.map(inst => (
                        <button
                          key={inst.id}
                          onClick={() => selectInstitution(inst)}
                          className={`w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0 ${
                            data.institutionId === inst.id ? 'bg-gray-50' : ''
                          }`}
                        >
                          <p className="font-medium text-sm text-gray-900">{inst.short_name}</p>
                          <p className="text-xs text-gray-500">{inst.name} · {inst.city}, {inst.state}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {data.institutionId && (
                    <p className="text-xs text-emerald-600 mt-1">
                      ✓ {getInstitutionById(data.institutionId)?.name}
                    </p>
                  )}
                </div>
              )}

              <Select
                placeholder="Country of Origin"
                value={data.countryOfOrigin}
                onChange={v => updateField('countryOfOrigin', v)}
                options={COUNTRIES}
              />
            </div>
          </div>
        )}

        {/* Step 2: Where you are. */}
        {step === 2 && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight mb-2">Where you are.</h1>
            <p className="text-gray-500 mb-8">Each stage has different needs. We'll match them.</p>

            <div className="space-y-6">
              <div className="space-y-2">
                {isCC ? (
                  // CC-specific options
                  ["Associate's", 'Certificate Program', 'ESL/Language', 'Undecided'].map(level => (
                    <OptionButton
                      key={level}
                      selected={data.academicLevel === level}
                      onClick={() => updateField('academicLevel', level)}
                    >
                      {level}
                    </OptionButton>
                  ))
                ) : (
                  // University options
                  ["Bachelor's", "Master's", 'PhD', 'Postdoc', 'Exchange/Visiting'].map(level => (
                    <OptionButton
                      key={level}
                      selected={data.academicLevel === level}
                      onClick={() => updateField('academicLevel', level)}
                    >
                      {level}
                    </OptionButton>
                  ))
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Year</label>
                <div className="flex gap-2">
                  {(isCC ? ['1', '2', '3+'] : ['1', '2', '3', '4', '5+']).map(year => (
                    <button
                      key={year}
                      onClick={() => updateField('year', year)}
                      className={`flex-1 py-3 rounded-xl border-2 font-medium transition-all duration-300 ${
                        data.year === year
                          ? 'border-black bg-black text-white'
                          : 'border-gray-200 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transfer question for CC students */}
              {isCC && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">Planning to transfer?</label>
                  <ToggleButtons
                    value={data.planningToTransfer}
                    onChange={v => updateField('planningToTransfer', v)}
                  />
                  {data.planningToTransfer === true && (
                    <Feedback>Great! We'll help you prepare for transfer.</Feedback>
                  )}
                </div>
              )}

              {data.academicLevel && data.year && (
                <Feedback>Got it. We'll tailor your options.</Feedback>
              )}
            </div>
          </div>
        )}

        {/* Step 2.5: Transfer Goals (CC students only) */}
        {step === 3 && isCC && data.planningToTransfer && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight mb-2">Your Transfer Goals.</h1>
            <p className="text-gray-500 mb-8">Let's plan your path to a 4-year university.</p>

            <div className="space-y-6">
              {/* TAG Eligible Universities */}
              {tagUniversities.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    TAG-Eligible Universities
                    <span className="text-xs text-emerald-600 ml-2">Guaranteed admission</span>
                  </label>
                  <div className="space-y-2">
                    {tagUniversities.map(uni => (
                      <button
                        key={uni.id}
                        onClick={() => toggleArrayField('targetUniversities', uni.id)}
                        className={`w-full p-3 rounded-xl border-2 text-left transition-all duration-300 ${
                          data.targetUniversities.includes(uni.id)
                            ? 'border-black bg-black text-white'
                            : 'border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        <p className="font-medium text-sm">{uni.short_name}</p>
                        <p className={`text-xs ${data.targetUniversities.includes(uni.id) ? 'text-gray-300' : 'text-gray-500'}`}>
                          {uni.name}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Other UC options */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Other Target Universities</label>
                <div className="flex flex-wrap gap-2">
                  {['ucla', 'ucb', 'usc', 'stanford'].map(uniId => {
                    const uni = getInstitutionById(uniId);
                    if (!uni || data.targetUniversities.includes(uniId)) return null;
                    return (
                      <ChipButton
                        key={uniId}
                        selected={data.targetUniversities.includes(uniId)}
                        onClick={() => toggleArrayField('targetUniversities', uniId)}
                      >
                        {uni.short_name}
                      </ChipButton>
                    );
                  })}
                </div>
              </div>

              {/* Target Major */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Target Major</label>
                <Input
                  placeholder="e.g., Computer Science, Business..."
                  value={data.targetMajor}
                  onChange={v => updateField('targetMajor', v)}
                />
              </div>

              {/* Expected Transfer Year */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Expected Transfer</label>
                <div className="flex gap-2">
                  {['Fall 2026', 'Spring 2027', 'Fall 2027', 'Later'].map(term => (
                    <button
                      key={term}
                      onClick={() => updateField('expectedTransferYear', term)}
                      className={`flex-1 py-3 rounded-xl border-2 font-medium text-sm transition-all duration-300 ${
                        data.expectedTransferYear === term
                          ? 'border-black bg-black text-white'
                          : 'border-gray-200 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>

              {data.targetUniversities.length > 0 && (
                <Feedback>
                  {data.targetUniversities.length} target{data.targetUniversities.length > 1 ? 's' : ''} selected. We'll track deadlines for you.
                </Feedback>
              )}
            </div>
          </div>
        )}

        {/* Step 3 or 4: What We're Working With. */}
        {((step === 3 && !showTransferStep) || (step === 4 && showTransferStep)) && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight mb-2">What We're Working With.</h1>
            <p className="text-gray-500 mb-8">We Tailor From Here</p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">SSN?</label>
                <ToggleButtons
                  value={data.hasSSN}
                  onChange={v => updateField('hasSSN', v)}
                />
                {data.hasSSN === false && (
                  <Feedback>No problem. We have options.</Feedback>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">ITIN?</label>
                <ToggleButtons
                  value={data.hasITIN}
                  onChange={v => updateField('hasITIN', v)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">US address?</label>
                <ToggleButtons
                  value={data.hasUSAddress}
                  onChange={v => updateField('hasUSAddress', v)}
                />
                {data.hasUSAddress === true && (
                  <Feedback>Good. More doors open.</Feedback>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 4 or 5: Your Finances. */}
        {((step === 4 && !showTransferStep) || (step === 5 && showTransferStep)) && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight mb-2">Your Finances.</h1>
            <p className="text-gray-500 mb-8">Walk Us Through</p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">What comes in</label>
                <MoneyInput
                  value={data.monthlyIncome}
                  onChange={v => updateField('monthlyIncome', v)}
                />
                <p className="text-gray-400 text-xs mt-1.5">Scholarships, family support, work-study</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">What goes out</label>
                <MoneyInput
                  value={data.monthlyExpenses}
                  onChange={v => updateField('monthlyExpenses', v)}
                />
                <p className="text-gray-400 text-xs mt-1.5">Rent, food, transportation, entertainment</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Your priority.</label>
                <div className="space-y-2">
                  {[
                    { id: 'budget', label: 'Every dollar counts.' },
                    { id: 'balance', label: 'Balance value and quality.' },
                    { id: 'premium', label: 'Pay for premium.' },
                  ].map(opt => (
                    <OptionButton
                      key={opt.id}
                      selected={data.feePriority === opt.id}
                      onClick={() => updateField('feePriority', opt.id)}
                    >
                      {opt.label}
                    </OptionButton>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 5 or 6: How you bank. */}
        {((step === 5 && !showTransferStep) || (step === 6 && showTransferStep)) && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight mb-2">How you bank.</h1>
            <p className="text-gray-500 mb-8">Select what matters.</p>

            <div className="space-y-6">
              <div className="flex flex-wrap gap-2">
                {[
                  'Everyday spending',
                  'Family transfers',
                  'Tuition',
                  'International wires',
                  'Campus ATM',
                  'Mobile deposit',
                  'Bill pay',
                  'Savings',
                ].map(need => (
                  <ChipButton
                    key={need}
                    selected={data.bankingNeeds.includes(need)}
                    onClick={() => toggleArrayField('bankingNeeds', need)}
                  >
                    {need}
                  </ChipButton>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Style.</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Branches', 'Digital', 'Either'].map(style => (
                    <button
                      key={style}
                      onClick={() => updateField('bankingStyle', style)}
                      className={`py-3.5 rounded-xl border-2 font-medium transition-all duration-300 ${
                        data.bankingStyle === style
                          ? 'border-black bg-black text-white'
                          : 'border-gray-200 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 6 or 7: Global. */}
        {((step === 6 && !showTransferStep) || (step === 7 && showTransferStep)) && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight mb-2">Global.</h1>
            <p className="text-gray-500 mb-8">How you move across borders.</p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Transfers abroad.</label>
                <div className="space-y-2">
                  {[
                    { id: 'never', label: 'Never' },
                    { id: 'few', label: 'A few times a year' },
                    { id: 'monthly', label: 'Monthly or more' },
                  ].map(opt => (
                    <OptionButton
                      key={opt.id}
                      selected={data.transferFrequency === opt.id}
                      onClick={() => updateField('transferFrequency', opt.id)}
                    >
                      {opt.label}
                    </OptionButton>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Branch nearby?</label>
                <div className="space-y-2">
                  {[
                    { id: 'must', label: 'Must have' },
                    { id: 'preferred', label: 'Preferred' },
                    { id: 'dont', label: "Don't need" },
                  ].map(opt => (
                    <OptionButton
                      key={opt.id}
                      selected={data.branchPreference === opt.id}
                      onClick={() => updateField('branchPreference', opt.id)}
                    >
                      {opt.label}
                    </OptionButton>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Side of campus?</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'north', label: 'North' },
                    { id: 'south', label: 'South' },
                    { id: 'east', label: 'East' },
                    { id: 'west', label: 'West' },
                    { id: 'center', label: 'Center' },
                    { id: 'unknown', label: 'Not sure' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => updateField('campusSide', opt.id)}
                      className={`py-3.5 rounded-xl border-2 font-medium transition-all duration-300 ${
                        data.campusSide === opt.id
                          ? 'border-black bg-black text-white'
                          : 'border-gray-200 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-gray-400 text-xs mt-2">Helps us find banks and housing nearby</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 7 or 8: Your goals. */}
        {((step === 7 && !showTransferStep) || (step === 8 && showTransferStep)) && (
          <div className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight mb-2">Your goals.</h1>
            <p className="text-gray-500 mb-8">What matters to you right now.</p>

            <div className="space-y-6">
              <div className="flex flex-wrap gap-2">
                {[
                  'Bank account',
                  'Credit history',
                  'Housing',
                  'Student loans',
                  'Campus jobs',
                  'Investing',
                  'Post-grad planning',
                ].map(goal => (
                  <ChipButton
                    key={goal}
                    selected={data.goals.includes(goal)}
                    onClick={() => toggleArrayField('goals', goal)}
                  >
                    {goal}
                  </ChipButton>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Credit cards.</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Start now', 'Later', 'Skip'].map(opt => (
                    <button
                      key={opt}
                      onClick={() => updateField('creditCardInterest', opt)}
                      className={`py-3.5 rounded-xl border-2 font-medium transition-all duration-300 ${
                        data.creditCardInterest === opt
                          ? 'border-black bg-black text-white'
                          : 'border-gray-200 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100">
        <div className="max-w-md mx-auto px-6 py-5 flex gap-3">
          {step > 1 && (
            <button
              onClick={handleBack}
              className="px-6 py-3.5 border-[1.5px] border-gray-300 rounded-xl font-medium transition-all duration-300 hover:border-black"
            >
              Back
            </button>
          )}
          {step < totalSteps ? (
            <button
              onClick={handleNext}
              className="flex-1 py-3.5 bg-black text-white rounded-xl font-medium transition-all duration-300 hover:bg-gray-800"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 py-3.5 bg-black text-white rounded-xl font-medium transition-all duration-300 hover:bg-gray-800 disabled:bg-gray-300"
            >
              {isSubmitting ? 'Processing...' : 'Complete Assessment'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
