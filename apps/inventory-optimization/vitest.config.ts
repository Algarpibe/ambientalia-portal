import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tests de UI (ARQ-001 G): jsdom + React Testing Library. Las pruebas de
// funciones puras también corren aquí sin problema (no usan el DOM).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
