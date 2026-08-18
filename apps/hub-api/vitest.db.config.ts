import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.db.test.ts'],
    globalSetup: ['./src/test-db/contenedor.ts'],
    // Un solo Postgres para toda la suite y un TRUNCATE por test: dos ficheros
    // corriendo a la vez se borrarian las filas el uno al otro.
    fileParallelism: false,
    // Cubre los before*/after* de los tests, NO el arranque del contenedor: el
    // globalSetup se protege solo, con su propio `withStartupTimeout`.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
