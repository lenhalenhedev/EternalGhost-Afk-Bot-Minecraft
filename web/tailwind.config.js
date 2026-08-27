/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0F1115',
        surface: '#171A21',
        border: '#2B303B',
        'text-primary': '#F4F7FB',
        'text-secondary': '#A3ACBB',
        accent: '#60A5FA',
        'status-online': '#4ADE80',
        'status-offline': '#94A3B8',
        'status-error': '#F87171',
        'status-pending': '#FBBF24',
        'log-bg': '#0B0F14',
        'log-text': '#E5E7EB',
        'log-muted': '#94A3B8',
        'log-warn': '#FBBF24',
        'log-error': '#F87171',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { panel: '4px' },
      boxShadow: { panel: '0 1px 2px rgb(0 0 0 / 0.35)' },
    },
  },
  plugins: [],
};
