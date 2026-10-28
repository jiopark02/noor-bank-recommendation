'use client';

import { LegalDocumentPage } from '@/components/legal/LegalDocumentView';
import { TERMS_OF_SERVICE } from '@/lib/legalDocuments';

export default function TermsPage() {
  return <LegalDocumentPage doc={TERMS_OF_SERVICE} />;
}
