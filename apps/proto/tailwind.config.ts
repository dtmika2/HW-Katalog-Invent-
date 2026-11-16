import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        alu: { DEFAULT: '#E7EBEE', dark: '#D3DAE0', line: '#C4CDD5' },
        ink: { DEFAULT: '#1C2632', soft: '#3A4756' },
        muted: '#5A6978',
        tape: { DEFAULT: '#1D5BD6', dark: '#1647A8', light: '#E3ECFC' },
        ok: { DEFAULT: '#1E7F46', light: '#E1F3E8' },
        warn: { DEFAULT: '#B87400', light: '#FFF1D6' },
        bad: { DEFAULT: '#BE3227', light: '#FBE5E2' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        cond: ['"IBM Plex Sans Condensed"', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
