'use client';

import React from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';

interface PageLayoutProps {
  children: React.ReactNode;
  userName?: string;
}

export function PageLayout({ children, userName }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-white">
      <Header userName={userName} />
      <main className="max-w-2xl mx-auto px-6 py-8">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  rightContent?: React.ReactNode;
}

export function PageHeader({ title, subtitle, rightContent }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {rightContent && <div className="flex items-center gap-3">{rightContent}</div>}
    </div>
  );
}

interface TabsProps {
  tabs: { id: string; label: string }[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-8 border-b border-gray-100 mb-6">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`pb-3 text-[15px] transition-all duration-300 border-b-[1.5px] -mb-px ${
            activeTab === tab.id
              ? 'text-black border-black font-medium'
              : 'text-gray-400 border-transparent hover:text-gray-600'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface FilterChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export function FilterChip({ label, active = false, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
        active
          ? 'bg-black text-white'
          : 'bg-white text-black border-[1.5px] border-gray-200 hover:border-black'
      }`}
    >
      {label}
    </button>
  );
}

interface FilterChipsProps {
  filters: { id: string; label: string }[];
  activeFilters: string[];
  onChange: (filterId: string) => void;
}

export function FilterChips({ filters, activeFilters, onChange }: FilterChipsProps) {
  return (
    <div className="flex gap-2.5 flex-wrap mb-6">
      {filters.map((filter) => (
        <FilterChip
          key={filter.id}
          label={filter.label}
          active={activeFilters.includes(filter.id)}
          onClick={() => onChange(filter.id)}
        />
      ))}
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-6 h-6 border-[1.5px] border-gray-200 border-t-black rounded-full animate-spin" />
      <p className="mt-5 text-gray-400 text-sm">Finding your matches...</p>
    </div>
  );
}

interface OutlineButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
}

export function OutlineButton({ children, onClick }: OutlineButtonProps) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2.5 border-[1.5px] border-gray-200 rounded-full text-sm font-medium transition-all duration-300 hover:border-black"
    >
      {children}
    </button>
  );
}
