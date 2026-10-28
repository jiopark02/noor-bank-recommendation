'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import type { LegalDocument } from '@/lib/legalDocuments';

/**
 * The document text: "Last updated" line, then each section in order.
 * Rendered by legalDocumentsParity.test.ts, so it takes no hooks.
 */
export function LegalDocumentBody({ doc }: { doc: LegalDocument }) {
  return (
    <div className="text-[15px] leading-relaxed text-gray-600">
      <p className="mb-6">{doc.lastUpdated}</p>
      {doc.sections.map((section) => (
        <section key={section.heading} className="mb-6">
          <h2 className="text-base font-medium text-gray-900 mb-2">{section.heading}</h2>
          <p>{section.body}</p>
        </section>
      ))}
    </div>
  );
}

/** Standalone page: back button and title on top, no bottom navigation. */
export function LegalDocumentPage({ doc }: { doc: LegalDocument }) {
  const router = useRouter();
  const { t } = useLanguage();

  // Go back only when the previous page was this app. Arriving from another
  // site, a search result or a fresh tab, history.back() would leave the app,
  // so go to / instead; / sends a signed-in user on to /dashboard and anyone
  // else to /landing.
  const handleBack = () => {
    if (document.referrer.startsWith(window.location.origin)) {
      router.back();
    } else {
      router.push('/');
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 bg-white/95 border-b border-gray-100">
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3.5">
          <button
            type="button"
            onClick={handleBack}
            aria-label="Go back"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5"
          >
            <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-[17px] font-semibold text-black tracking-tight">{t(doc.titleKey)}</h1>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-8">
        <LegalDocumentBody doc={doc} />
      </main>
    </div>
  );
}
