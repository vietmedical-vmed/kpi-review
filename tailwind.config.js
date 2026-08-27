/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#e7f3ff',
          100: '#cfe4ff',
          200: '#a8c8ff',
          300: '#7aa7fb',
          400: '#4a90f2',
          500: '#1877f2',
          600: '#166fe5',
          700: '#0c5dc7',
        },
        slate: {
          50:'#f0f2f5',100:'#e4e6eb',200:'#dadde1',300:'#ccd0d5',
          400:'#8a8d91',500:'#65676b',600:'#4b4f56',700:'#3a3b3c',
          800:'#242526',900:'#18191a',
        },
      },
    },
  },
  plugins: [],
}
