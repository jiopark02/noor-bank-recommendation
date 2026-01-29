'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getCommunityColleges,
  getUniversities,
  getTAGEligibleUniversities,
  getInstitutionById,
  searchInstitutions,
  University,
} from '@/lib/universitiesData';
import {
  validatePassword,
  validateEmail,
  getPasswordStrengthColor,
  getPasswordStrengthLabel,
  createSession,
  acceptTerms,
} from '@/lib/validation';

interface SurveyData {
  // Step 1
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  staySignedIn: boolean;
  agreeToTerms: boolean;
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
  agreeToTerms: false,
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
  error,
  required,
}: {
  type?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  required?: boolean;
}) => (
  <div className="space-y-1">
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-4 py-3.5 border rounded-xl text-base outline-none transition-all duration-300 focus:border-black placeholder:text-gray-400 ${
          error ? 'border-red-300 bg-red-50' : 'border-gray-200'
        }`}
      />
      {required && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400 text-sm">*</span>
      )}
    </div>
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
);

// Password Input with show/hide toggle
const PasswordInput = ({
  value,
  onChange,
  placeholder,
  error,
  showStrength,
  strengthData,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  showStrength?: boolean;
  strengthData?: { strength: 'weak' | 'medium' | 'strong'; score: number; checks: Record<string, boolean> };
}) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full px-4 py-3.5 pr-12 border rounded-xl text-base outline-none transition-all duration-300 focus:border-black placeholder:text-gray-400 ${
            error ? 'border-red-300 bg-red-50' : 'border-gray-200'
          }`}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {showPassword ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {showStrength && strengthData && value.length > 0 && (
        <div className="space-y-2">
          {/* Strength bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: getPasswordStrengthColor(strengthData.strength) }}
                initial={{ width: 0 }}
                animate={{ width: `${strengthData.score}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <span
              className="text-xs font-medium"
              style={{ color: getPasswordStrengthColor(strengthData.strength) }}
            >
              {getPasswordStrengthLabel(strengthData.strength)}
            </span>
          </div>
          {/* Checklist */}
          <div className="grid grid-cols-2 gap-1 text-xs">
            {[
              { key: 'minLength', label: '8+ characters' },
              { key: 'hasUppercase', label: 'Uppercase (A-Z)' },
              { key: 'hasLowercase', label: 'Lowercase (a-z)' },
              { key: 'hasNumber', label: 'Number (0-9)' },
              { key: 'hasSpecial', label: 'Special (!@#$%)' },
            ].map(item => (
              <div
                key={item.key}
                className={`flex items-center gap-1 ${
                  strengthData.checks[item.key as keyof typeof strengthData.checks]
                    ? 'text-emerald-600'
                    : 'text-gray-400'
                }`}
              >
                {strengthData.checks[item.key as keyof typeof strengthData.checks] ? (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" strokeWidth={2} />
                  </svg>
                )}
                {item.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [institutionSearch, setInstitutionSearch] = useState('');
  const [showInstitutionList, setShowInstitutionList] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  // Validation states
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [isEduEmail, setIsEduEmail] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  // Password validation
  const passwordValidation = useMemo(() => {
    return validatePassword(data.password);
  }, [data.password]);

  // Email validation
  const emailValidation = useMemo(() => {
    return validateEmail(data.email);
  }, [data.email]);

  // Check if passwords match
  const passwordsMatch = data.password === data.confirmPassword && data.confirmPassword.length > 0;

  // Update email validation state
  useEffect(() => {
    if (data.email && touchedFields.has('email')) {
      const validation = validateEmail(data.email);
      if (!validation.isValid) {
        setErrors(prev => ({ ...prev, email: validation.error }));
      } else {
        setErrors(prev => ({ ...prev, email: null }));
        setEmailSuggestion(validation.suggestion);
        setIsEduEmail(validation.isEdu);
      }
    }
  }, [data.email, touchedFields]);

  // Mark field as touched
  const markTouched = (field: string) => {
    setTouchedFields(prev => new Set(prev).add(field));
  };

  // Total steps: 8 for CC students with transfer, 7 for others
  const isCC = data.institutionType === 'community_college';
  const showTransferStep = isCC && data.planningToTransfer === true;
  const totalSteps = showTransferStep ? 8 : 7;

  // Filter institutions based on search and type
  const filteredInstitutions = useMemo(() => {
    if (!data.institutionType) return [];

    // Use search function for better matching
    if (institutionSearch && institutionSearch.length >= 2) {
      const results = searchInstitutions(institutionSearch, 30);
      return results.filter(inst =>
        data.institutionType === 'community_college'
          ? inst.type === 'community_college'
          : inst.type === 'university'
      ).slice(0, 15);
    }

    // Default: show popular institutions by enrollment
    const institutions = data.institutionType === 'community_college'
      ? getCommunityColleges()
      : getUniversities();

    return institutions
      .sort((a, b) => (b.international_student_count || 0) - (a.international_student_count || 0))
      .slice(0, 20);
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
    setSubmitError(null);
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

      if (!result.success) {
        setSubmitError(result.message || 'Failed to create account. Please try again.');
        return;
      }

      // Save user ID and create session
      localStorage.setItem('noor_user_id', result.userId);
      createSession(data.staySignedIn);
      acceptTerms();

      // Save user profile locally (use profile from response if available, otherwise build from form data)
      const userProfile = result.profile ? {
        id: result.userId,
        ...result.profile,
        institutionType: data.institutionType,
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
        planningToTransfer: data.planningToTransfer,
        targetUniversities: data.targetUniversities,
        targetMajor: data.targetMajor,
        expectedTransferYear: data.expectedTransferYear,
      } : {
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
        planningToTransfer: data.planningToTransfer,
        targetUniversities: data.targetUniversities,
        targetMajor: data.targetMajor,
        expectedTransferYear: data.expectedTransferYear,
      };
      localStorage.setItem('noor_user_profile', JSON.stringify(userProfile));

      router.push('/banking');
    } catch (error) {
      console.error('Survey submission error:', error);
      setSubmitError('Something went wrong. Please try again.');
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
                  error={touchedFields.has('firstName') && !data.firstName ? 'Required' : null}
                  required
                />
                <Input
                  placeholder="Last name"
                  value={data.lastName}
                  onChange={v => updateField('lastName', v)}
                  error={touchedFields.has('lastName') && !data.lastName ? 'Required' : null}
                  required
                />
              </div>

              {/* Email with validation */}
              <div className="space-y-1">
                <Input
                  type="email"
                  placeholder="Email"
                  value={data.email}
                  onChange={v => {
                    updateField('email', v);
                    markTouched('email');
                  }}
                  error={touchedFields.has('email') ? errors.email : null}
                  required
                />
                {emailSuggestion && (
                  <button
                    onClick={() => {
                      const corrected = emailSuggestion.replace('Did you mean ', '').replace('?', '');
                      updateField('email', corrected);
                      setEmailSuggestion(null);
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {emailSuggestion}
                  </button>
                )}
                {isEduEmail && (
                  <div className="flex items-center gap-1 text-xs text-emerald-600">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    .edu email verified
                  </div>
                )}
              </div>

              {/* Password with strength indicator */}
              <PasswordInput
                placeholder="Password"
                value={data.password}
                onChange={v => {
                  updateField('password', v);
                  markTouched('password');
                }}
                showStrength={true}
                strengthData={passwordValidation}
              />

              {/* Confirm password with match indicator */}
              <div className="space-y-1">
                <PasswordInput
                  placeholder="Confirm password"
                  value={data.confirmPassword}
                  onChange={v => {
                    updateField('confirmPassword', v);
                    markTouched('confirmPassword');
                  }}
                />
                {touchedFields.has('confirmPassword') && data.confirmPassword && (
                  <div className={`flex items-center gap-1 text-xs ${passwordsMatch ? 'text-emerald-600' : 'text-red-500'}`}>
                    {passwordsMatch ? (
                      <>
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Passwords match
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        Passwords don't match
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Stay signed in */}
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
                <span className="text-sm text-gray-600">Keep me signed in for 30 days</span>
              </label>

              {/* Terms & Privacy */}
              <label className="flex items-start gap-3 py-2 cursor-pointer">
                <div
                  onClick={() => updateField('agreeToTerms', !data.agreeToTerms)}
                  className={`w-5 h-5 mt-0.5 rounded border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                    data.agreeToTerms ? 'bg-black border-black' : 'border-gray-300'
                  }`}
                >
                  {data.agreeToTerms && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-gray-600">
                  I agree to the{' '}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowTermsModal(true); }}
                    className="text-black underline hover:opacity-70"
                  >
                    Terms of Service
                  </button>
                  {' '}and{' '}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowPrivacyModal(true); }}
                    className="text-black underline hover:opacity-70"
                  >
                    Privacy Policy
                  </button>
                  <span className="text-red-400 ml-1">*</span>
                </span>
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
                  {showInstitutionList && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                      {filteredInstitutions.length > 0 ? (
                        <>
                          {filteredInstitutions.map(inst => (
                            <button
                              key={inst.id}
                              onClick={() => selectInstitution(inst)}
                              className={`w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 ${
                                data.institutionId === inst.id ? 'bg-gray-50' : ''
                              }`}
                            >
                              <p className="font-medium text-sm text-gray-900">{inst.short_name}</p>
                              <p className="text-xs text-gray-500">{inst.name} · {inst.city}, {inst.state}</p>
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              updateField('institutionId', 'other');
                              setShowInstitutionList(false);
                            }}
                            className="w-full px-4 py-3 text-left hover:bg-gray-50 text-gray-500 text-sm"
                          >
                            Can't find your school? Continue anyway
                          </button>
                        </>
                      ) : institutionSearch.length >= 2 ? (
                        <button
                          onClick={() => {
                            updateField('institutionId', 'other');
                            setShowInstitutionList(false);
                          }}
                          className="w-full px-4 py-3 text-left text-gray-500 text-sm"
                        >
                          No results found. Continue without selecting a school
                        </button>
                      ) : null}
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

      {/* Terms Modal */}
      <AnimatePresence>
        {showTermsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold">Terms of Service</h2>
                  <button onClick={() => setShowTermsModal(false)} className="text-gray-400 hover:text-gray-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                <div className="prose prose-sm text-gray-600">
                  <p className="mb-4">Last updated: January 2026</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">1. Acceptance of Terms</h3>
                  <p className="mb-4">By accessing and using Noor, you accept and agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our service.</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">2. Description of Service</h3>
                  <p className="mb-4">Noor provides financial guidance, banking recommendations, and tools specifically designed for international students in the United States. Our recommendations are for informational purposes only and do not constitute financial advice.</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">3. User Responsibilities</h3>
                  <p className="mb-4">You are responsible for maintaining the confidentiality of your account and password. You agree to provide accurate information and to update your information as necessary.</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">4. Privacy</h3>
                  <p className="mb-4">Your privacy is important to us. Please review our Privacy Policy to understand how we collect, use, and protect your information.</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">5. Limitation of Liability</h3>
                  <p className="mb-4">Noor is not liable for any financial decisions made based on our recommendations. Always consult with a qualified financial advisor for personalized advice.</p>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100">
                <button
                  onClick={() => setShowTermsModal(false)}
                  className="w-full py-3 bg-black text-white rounded-xl font-medium"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Privacy Modal */}
      <AnimatePresence>
        {showPrivacyModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold">Privacy Policy</h2>
                  <button onClick={() => setShowPrivacyModal(false)} className="text-gray-400 hover:text-gray-600">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                <div className="prose prose-sm text-gray-600">
                  <p className="mb-4">Last updated: January 2026</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">What We Collect</h3>
                  <p className="mb-4">We collect information you provide directly to us, including your name, email address, university, visa status, and financial preferences.</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">How We Use Your Information</h3>
                  <p className="mb-4">We use your information to provide personalized banking recommendations, send relevant updates and notifications, and improve our services.</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">Data Storage</h3>
                  <p className="mb-4">Your data is stored securely using industry-standard encryption. We never sell your personal information to third parties.</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">Your Rights</h3>
                  <p className="mb-4">You have the right to access, correct, or delete your personal data at any time. You can export your data or request account deletion from the Settings page.</p>
                  <h3 className="text-base font-medium text-gray-900 mb-2">Contact Us</h3>
                  <p className="mb-4">If you have questions about this Privacy Policy, please contact us at privacy@noorapp.com.</p>
                </div>
              </div>
              <div className="p-6 border-t border-gray-100">
                <button
                  onClick={() => setShowPrivacyModal(false)}
                  className="w-full py-3 bg-black text-white rounded-xl font-medium"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100">
        <div className="max-w-md mx-auto px-6 py-5">
          {/* Submit Error */}
          {submitError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"
            >
              <p className="text-red-600 text-sm text-center">{submitError}</p>
            </motion.div>
          )}
          <div className="flex gap-3">
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
              disabled={step === 1 && (!data.firstName || !data.lastName || !data.email || !passwordValidation.isValid || !passwordsMatch || !data.agreeToTerms || !data.institutionId || !data.countryOfOrigin)}
              className="flex-1 py-3.5 bg-black text-white rounded-xl font-medium transition-all duration-300 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 py-3.5 bg-black text-white rounded-xl font-medium transition-all duration-300 hover:bg-gray-800 disabled:bg-gray-300"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating account...
                </span>
              ) : 'Complete Assessment'}
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
