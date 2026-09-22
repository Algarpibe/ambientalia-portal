import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tests de la app: jsdom + React Testing Library, como apps/inventory-optimization. No toca
// el build (ese usa vite.config.ts) ni entra en el portón de tipos del portal.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
