module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: { ink: '#0b1220', 'ink-2': '#2d3a57', mute: '#5d6a88', line: '#e3e9f6', soft: '#eef3fd', brand: { DEFAULT: '#2563eb', 2: '#1d4ed8', 3: '#173fae', bg: '#e6eeff' } },
      fontFamily: { sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      borderRadius: { card: '24px' },
    },
  },
  plugins: [],
};
