import type { Config } from 'tailwindcss';

/**
 * The palette is an engineering record office: ink on paper, a blueprint blue
 * for anything actionable, and three muted signal colours reserved for status.
 * Nothing decorative uses the signal colours — if it is red, it means something.
 */
export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#16222E',
          muted: '#5A6B7B',
          faint: '#8B99A6',
        },
        paper: '#FFFFFF',
        wash: '#EEF1F4',
        rule: '#D3DAE1',
        blueprint: {
          DEFAULT: '#1F5FA9',
          dark: '#17497F',
          wash: '#E7EEF7',
        },
        alert: { DEFAULT: '#A8322B', wash: '#F7ECEB' },
        warn: { DEFAULT: '#B3711A', wash: '#FBF2E4' },
        good: { DEFAULT: '#2E6B4F', wash: '#E9F1ED' },
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-plex-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // A modular scale at roughly 1.2, set explicitly so headings stay
        // related to body text rather than being picked ad hoc.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.6' }],
        lg: ['1.0625rem', { lineHeight: '1.5' }],
        xl: ['1.3125rem', { lineHeight: '1.35' }],
        '2xl': ['1.625rem', { lineHeight: '1.25' }],
        '3xl': ['2.125rem', { lineHeight: '1.15' }],
      },
      borderRadius: {
        // Restrained: 2px on controls, nothing on surfaces. Rounded cards are
        // the look this product is deliberately not.
        DEFAULT: '2px',
        sm: '2px',
        md: '3px',
      },
      boxShadow: {
        raised: '0 1px 2px rgba(22, 34, 46, 0.08), 0 4px 12px rgba(22, 34, 46, 0.06)',
        overlay: '0 8px 32px rgba(22, 34, 46, 0.18)',
      },
      maxWidth: {
        prose: '72ch',
        sheet: '1180px',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 140ms ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
