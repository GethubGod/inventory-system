/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#FFF3F1',
          100: '#FFE0DB',
          200: '#FDC1B7',
          300: '#F79B8C',
          400: '#F06F59',
          500: '#E8503A',
          600: '#D64331',
          700: '#B93628',
          800: '#932C22',
          900: '#73231B',
        },
        background: '#F7F5F2',
        card: 'rgba(0, 0, 0, 0.02)',
      },
      borderRadius: {
        'card': '24px',
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
    },
  },
  plugins: [],
};
