/**
 * Text of the Terms of Service and Privacy Policy shown on /terms and /privacy.
 *
 * The signup modals in src/app/survey/page.tsx carry their own hardcoded copy of
 * the same text. legalDocumentsParity.test.ts fails when the two drift apart, so
 * a wording change has to land in both places in the same commit.
 *
 * `titleKey` is the messages/en.json key the survey modal header uses; the
 * pages read their heading through the same key.
 */

export interface LegalSection {
  heading: string;
  body: string;
}

export interface LegalDocument {
  titleKey: string;
  lastUpdated: string;
  sections: LegalSection[];
}

export const TERMS_OF_SERVICE: LegalDocument = {
  titleKey: "survey.terms.title",
  lastUpdated: "Last updated: January 2026",
  sections: [
    {
      heading: "1. Acceptance of Terms",
      body:
        "By accessing and using Noor, you accept and agree to be bound by these " +
        "Terms of Service. If you do not agree to these terms, please do not use " +
        "our service.",
    },
    {
      heading: "2. Description of Service",
      body:
        "Noor provides financial guidance, banking recommendations, and tools. " +
        "Our recommendations are for informational purposes only and do not " +
        "constitute financial advice.",
    },
    {
      heading: "3. User Responsibilities",
      body:
        "You are responsible for maintaining the confidentiality of your account " +
        "and password. You agree to provide accurate information and to update " +
        "your information as necessary.",
    },
    {
      heading: "4. Privacy",
      body:
        "Your privacy is important to us. Please review our Privacy Policy to " +
        "understand how we collect, use, and protect your information.",
    },
    {
      heading: "5. Limitation of Liability",
      body:
        "Noor is not liable for any financial decisions made based on our " +
        "recommendations. Always consult with a qualified financial advisor for " +
        "personalized advice.",
    },
  ],
};

export const PRIVACY_POLICY: LegalDocument = {
  titleKey: "survey.privacy.title",
  lastUpdated: "Last updated: January 2026",
  sections: [
    {
      heading: "What We Collect",
      body:
        "We collect information you provide directly to us, including your name, " +
        "email address, university, visa status, and financial preferences.",
    },
    {
      heading: "How We Use Your Information",
      body:
        "We use your information to provide personalized banking recommendations, " +
        "send relevant updates and notifications, and improve our services.",
    },
    {
      heading: "Data Storage",
      body:
        "Your data is stored securely using industry-standard encryption. We never " +
        "sell your personal information to third parties.",
    },
    {
      heading: "Your Rights",
      body:
        "You have the right to access, correct, or delete your personal data at any " +
        "time. You can export your data or request account deletion from the " +
        "Settings page.",
    },
    {
      heading: "Contact Us",
      body:
        "If you have questions about this Privacy Policy, please contact us at " +
        "privacy@noor.financial.",
    },
  ],
};
