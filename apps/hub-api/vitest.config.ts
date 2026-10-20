import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // Los *.db.test.ts necesitan Docker y tienen su propio porton
    // (`npm run test:db`). Sacarlos de aqui es lo que mantiene este run en
    // segundos y sin infraestructura: el porton de siempre no debe poder
    // fallar porque un demonio este parado.
    exclude: [...configDefaults.exclude, '**/*.db.test.ts'],
    // TEST-713 — una veintena de ficheros importan el router en su `beforeAll`
    // (para fijar el entorno antes de que auth.ts lo lea). Solos tardan un par
    // de segundos, pero con la suite en paralelo los 10 s por defecto se
    // quedaron cortos más de una vez, y entonces el fichero cae ENTERO con sus
    // tests saltados y ninguno en rojo. Mismo margen que en vitest.db.config.ts.
    hookTimeout: 60_000,
  },
});
