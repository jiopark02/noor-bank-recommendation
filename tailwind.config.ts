import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Global overrides: "black" is deep plum-ink and the gray ramp is
        // lavender-tinted, so legacy text-black / bg-gray-* classes across
        // every page inherit the pastel-glass design without edits.
        black: '#2B2740',
        gray: {
          50: '#F8F7FC',
          100: '#F0EEF8',
          200: '#E4E1F0',
          300: '#CFCBE2',
          400: '#A9A4C2',
          500: '#817C9C',
          600: '#5C5878',
          700: '#474360',
          800: '#353149',
          900: '#2B2740',
          950: '#1D1A2E',
        },
        // Noor Design System
        noor: {
          ink: '#2B2740',
          black: '#2B2740',
          white: '#FFFFFF',
          cream: '#F6F4FB',
          purple: {
            DEFAULT: '#6D64A8',
            deep: '#55497D',
          },
          orb: {
            pink: '#F6C6E4',
            lilac: '#CDB9F2',
            blue: '#B9D2F4',
            mint: '#D3F0DC',
            butter: '#F7EBC9',
          },
          gray: {
            50: '#F8F7FC',
            100: '#F0EEF8',
            200: '#E4E1F0',
            300: '#CFCBE2',
            400: '#A9A4C2',
            500: '#817C9C',
            600: '#5C5878',
          },
        },
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        'noor': '16px',
        'noor-lg': '24px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(109, 100, 168, 0.12)',
        'glass-lg': '0 16px 48px rgba(109, 100, 168, 0.18)',
      },
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [],
};

export default config;
