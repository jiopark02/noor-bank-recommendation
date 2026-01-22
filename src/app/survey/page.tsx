'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SurveyData {
  visa_status: string;
  university: string;
  arrival_date: string;
  has_ssn: boolean;
  has_itin: boolean;
  monthly_income: number;
  monthly_budget: number;
  international_transfers: string;
  avg_transfer_amount: number;
  needs_zelle: boolean;
  credit_goals: string;
  fee_sensitivity: string;
  digital_preference: string;
  campus_proximity: string;
}

const INITIAL_DATA: SurveyData = {
  visa_status: '',
  university: '',
  arrival_date: '',
  has_ssn: false,
  has_itin: false,
  monthly_income: 0,
  monthly_budget: 1500,
  international_transfers: 'monthly',
  avg_transfer_amount: 500,
  needs_zelle: false,
  credit_goals: '',
  fee_sensitivity: 'medium',
  digital_preference: 'both',
  campus_proximity: 'somewhat-important',
};

const UNIVERSITIES = [
  'UC Berkeley',
  'Stanford University',
  'UCLA',
  'USC',
  'NYU',
  'Columbia University',
  'MIT',
  'Harvard University',
  'University of Michigan',
  'Other',
];

export default function SurveyPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<SurveyData>(INITIAL_DATA);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalSteps = 4;

  const updateData = (field: keyof SurveyData, value: any) => {
    setData(prev => ({ ...prev, [field]: value }));
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
      const response = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        const result = await response.json();
        localStorage.setItem('noor_user_id', result.userId);
        router.push('/banking');
      } else {
        alert('Failed to save survey. Please try again.');
      }
    } catch (error) {
      console.error('Survey submission error:', error);
      alert('An error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const OptionButton = ({
    selected,
    onClick,
    children,
    description
  }: {
    selected: boolean;
    onClick: () => void;
    children: React.ReactNode;
    description?: string;
  }) => (
    <button
      onClick={onClick}
      className={`w-full p-5 rounded-2xl border-[1.5px] text-left transition-all duration-300 ${
        selected
          ? 'border-black bg-black text-white'
          : 'border-gray-200 hover:border-gray-400 bg-white'
      }`}
    >
      <span className={`font-medium ${selected ? 'text-white' : 'text-black'}`}>
        {children}
      </span>
      {description && (
        <p className={`text-sm mt-1.5 ${selected ? 'text-gray-300' : 'text-gray-500'}`}>
          {description}
        </p>
      )}
    </button>
  );

  const GridOption = ({
    selected,
    onClick,
    label
  }: {
    selected: boolean;
    onClick: () => void;
    label: string;
  }) => (
    <button
      onClick={onClick}
      className={`p-5 rounded-2xl border-[1.5px] text-center transition-all duration-300 ${
        selected
          ? 'border-black bg-black text-white'
          : 'border-gray-200 hover:border-gray-400 bg-white'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-white">
      {/* Minimal Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <div className="max-w-md mx-auto px-8 pt-20 pb-36">
        {/* Step Indicator */}
        <p className="text-gray-400 text-sm tracking-wide mb-4">
          {step} of {totalSteps}
        </p>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="animate-fade-in">
            <h1 className="page-title mb-3">Welcome to Noor.</h1>
            <p className="page-subtitle mb-12">Let's find the perfect bank for you.</p>

            <div className="space-y-10">
              <div>
                <label className="label">Visa status</label>
                <div className="grid grid-cols-2 gap-3">
                  {['F-1', 'J-1', 'H-1B', 'Other'].map((visa) => (
                    <GridOption
                      key={visa}
                      selected={data.visa_status === visa}
                      onClick={() => updateData('visa_status', visa)}
                      label={visa}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="label">University</label>
                <select
                  value={data.university}
                  onChange={(e) => updateData('university', e.target.value)}
                  className="select-field"
                >
                  <option value="">Select your university</option>
                  {UNIVERSITIES.map((uni) => (
                    <option key={uni} value={uni}>{uni}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Time in the US</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'new', label: 'Just arrived' },
                    { value: '6months', label: '< 6 months' },
                    { value: '1year', label: '6-12 months' },
                    { value: 'over1year', label: '> 1 year' },
                  ].map((option) => (
                    <GridOption
                      key={option.value}
                      selected={data.arrival_date === option.value}
                      onClick={() => updateData('arrival_date', option.value)}
                      label={option.label}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Your Situation */}
        {step === 2 && (
          <div className="animate-fade-in">
            <h1 className="page-title mb-3">Your situation.</h1>
            <p className="page-subtitle mb-12">This helps us find banks that work for you.</p>

            <div className="space-y-10">
              <div>
                <label className="label">Do you have an SSN?</label>
                <div className="grid grid-cols-2 gap-3">
                  <OptionButton
                    selected={data.has_ssn === true}
                    onClick={() => updateData('has_ssn', true)}
                    description="I have one"
                  >
                    Yes
                  </OptionButton>
                  <OptionButton
                    selected={data.has_ssn === false}
                    onClick={() => updateData('has_ssn', false)}
                    description="Not yet"
                  >
                    No
                  </OptionButton>
                </div>
              </div>

              {!data.has_ssn && (
                <div className="animate-fade-in">
                  <label className="label">Do you have an ITIN?</label>
                  <div className="grid grid-cols-2 gap-3">
                    <GridOption
                      selected={data.has_itin === true}
                      onClick={() => updateData('has_itin', true)}
                      label="Yes"
                    />
                    <GridOption
                      selected={data.has_itin === false}
                      onClick={() => updateData('has_itin', false)}
                      label="No"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="label">Expected monthly budget</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 500, label: '< $500' },
                    { value: 1000, label: '$500 - $1K' },
                    { value: 2000, label: '$1K - $2K' },
                    { value: 3000, label: '$2K+' },
                  ].map((option) => (
                    <GridOption
                      key={option.value}
                      selected={data.monthly_budget === option.value}
                      onClick={() => updateData('monthly_budget', option.value)}
                      label={option.label}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Your Needs */}
        {step === 3 && (
          <div className="animate-fade-in">
            <h1 className="page-title mb-3">Your needs.</h1>
            <p className="page-subtitle mb-12">What matters most to you?</p>

            <div className="space-y-10">
              <div>
                <label className="label">International transfers</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'never', label: 'Never' },
                    { value: 'rarely', label: 'Rarely' },
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'weekly', label: 'Weekly' },
                  ].map((option) => (
                    <GridOption
                      key={option.value}
                      selected={data.international_transfers === option.value}
                      onClick={() => updateData('international_transfers', option.value)}
                      label={option.label}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Do you need Zelle?</label>
                <p className="text-gray-400 text-sm mb-4 -mt-1">
                  Instant transfers to friends, pay rent, split bills.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <OptionButton
                    selected={data.needs_zelle === true}
                    onClick={() => updateData('needs_zelle', true)}
                  >
                    Yes, I need it
                  </OptionButton>
                  <OptionButton
                    selected={data.needs_zelle === false}
                    onClick={() => updateData('needs_zelle', false)}
                  >
                    Not important
                  </OptionButton>
                </div>
              </div>

              <div>
                <label className="label">Primary goal</label>
                <div className="space-y-3">
                  {[
                    { value: 'basic', label: 'Just need a bank account', desc: 'For everyday spending' },
                    { value: 'build-credit', label: 'Build credit history', desc: 'Want to get credit cards later' },
                    { value: 'save', label: 'Save money', desc: 'Looking for high APY savings' },
                  ].map((option) => (
                    <OptionButton
                      key={option.value}
                      selected={data.credit_goals === option.value}
                      onClick={() => updateData('credit_goals', option.value)}
                      description={option.desc}
                    >
                      {option.label}
                    </OptionButton>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Preferences */}
        {step === 4 && (
          <div className="animate-fade-in">
            <h1 className="page-title mb-3">Almost done.</h1>
            <p className="page-subtitle mb-12">A few final preferences.</p>

            <div className="space-y-10">
              <div>
                <label className="label">Fee sensitivity</label>
                <div className="space-y-3">
                  {[
                    { value: 'very-sensitive', label: 'Very sensitive', desc: 'I want $0 fees only' },
                    { value: 'medium', label: 'Somewhat', desc: 'Small fees are OK if worth it' },
                    { value: 'not-sensitive', label: 'Not sensitive', desc: 'Features matter more' },
                  ].map((option) => (
                    <OptionButton
                      key={option.value}
                      selected={data.fee_sensitivity === option.value}
                      onClick={() => updateData('fee_sensitivity', option.value)}
                      description={option.desc}
                    >
                      {option.label}
                    </OptionButton>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Banking preference</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'mobile-first', label: 'Mobile' },
                    { value: 'branch', label: 'Branch' },
                    { value: 'both', label: 'Both' },
                  ].map((option) => (
                    <GridOption
                      key={option.value}
                      selected={data.digital_preference === option.value}
                      onClick={() => updateData('digital_preference', option.value)}
                      label={option.label}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Branch proximity to campus</label>
                <div className="space-y-3">
                  {[
                    { value: 'very-important', label: 'Very important', desc: 'I want to visit in person' },
                    { value: 'somewhat-important', label: 'Nice to have', desc: 'But not required' },
                    { value: 'not-important', label: 'Not important', desc: 'I prefer online banking' },
                  ].map((option) => (
                    <OptionButton
                      key={option.value}
                      selected={data.campus_proximity === option.value}
                      onClick={() => updateData('campus_proximity', option.value)}
                      description={option.desc}
                    >
                      {option.label}
                    </OptionButton>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100">
        <div className="max-w-md mx-auto px-8 py-6 flex gap-4">
          {step > 1 && (
            <button
              onClick={handleBack}
              className="btn-secondary flex-shrink-0"
            >
              Back
            </button>
          )}
          {step < totalSteps ? (
            <button
              onClick={handleNext}
              className="btn-primary flex-1"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="btn-primary flex-1"
            >
              {isSubmitting ? 'Finding your banks...' : 'Get Recommendations'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
