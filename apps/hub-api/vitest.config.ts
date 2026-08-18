import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // Los *.db.test.ts necesitan Docker y tienen su propio porton
    // (`npm run test:db`). Sacarlos de aqui es lo que mantiene este run en
    // segundos y sin infraestructura: el porton de siempre no debe poder
    // fallar porque un demonio este parado.
    exclude: [...configDefaults.exclude, '**/*.db.test.ts'],
  },
});
