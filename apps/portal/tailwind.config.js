/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../payment-reconciliation/src/**/*.{js,ts,jsx,tsx}",
    "../inventory-consolidation/src/**/*.{js,ts,jsx,tsx}",
    "../customer-profitability/src/**/*.{js,ts,jsx,tsx}",
    "../product-sales/src/**/*.{js,ts,jsx,tsx}",
    "../inventory-optimization/src/**/*.{js,ts,jsx,tsx}",
    "../laboratorios-ambientales/src/**/*.{js,ts,jsx,tsx}",
    // Cuarto punto de registro de una mini app, ademas de apps.ts, App.tsx y la
    // tarjeta: el portal genera aqui las clases de las sub-apps que importa. Sin
    // esta linea, la app compila y funciona pero se ve SIN ESTILOS.
    // (customer-valuation no esta porque trae su propio styles.css a mano.)
    "../WO-sales/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#007AFF',
          50: '#E5F2FF',
          100: '#CCE5FF',
          200: '#99CCFF',
          300: '#66B2FF',
          400: '#3399FF',
          500: '#007AFF',
          600: '#0062CC',
          700: '#004999',
          800: '#003166',
          900: '#001833',
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        'soft': '0 2px 15px rgba(0, 0, 0, 0.05)',
        'medium': '0 4px 20px rgba(0, 0, 0, 0.08)',
        'strong': '0 10px 40px rgba(0, 0, 0, 0.12)',
      }
    },
  },
  plugins: [],
}

