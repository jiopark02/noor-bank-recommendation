'use client';

import { LegalDocumentPage } from '@/components/legal/LegalDocumentView';
import { PRIVACY_POLICY } from '@/lib/legalDocuments';

export default function PrivacyPage() {
  return <LegalDocumentPage doc={PRIVACY_POLICY} />;
}
