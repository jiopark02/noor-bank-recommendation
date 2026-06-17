import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ClientLayout } from '@/components/layout/ClientLayout';

export const metadata: Metadata = {
  title: 'Noor - Your Money, Your Goal, Your Companions',
  description: 'Your money, your goals, your companions — simple, friendly financial guidance.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Noor',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <LanguageProvider>
          <ThemeProvider>
            <ClientLayout>
              {children}
            </ClientLayout>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
