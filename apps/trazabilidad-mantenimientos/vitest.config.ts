import { defineConfig } from 'vitest/config';

// Sólo lógica pura (lectura del Excel, agregados, texto del aviso): basta el
// entorno node, sin jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
