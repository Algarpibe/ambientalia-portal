import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.db.test.ts'],
    globalSetup: ['./src/test-db/contenedor.ts'],
    // Un solo Postgres para toda la suite y un TRUNCATE por test: dos ficheros
    // corriendo a la vez se borrarian las filas el uno al otro.
    fileParallelism: false,
    // Y lo mismo DENTRO de un fichero. Los `it` de uno ya corren en secuencia
    // por defecto, pero basta un `it.concurrent` suelto para que el TRUNCATE del
    // `beforeEach` se cruce con el test de al lado: no da error, solo filas que
    // faltan. Esto lo prohibe de raiz.
    sequence: { concurrent: false },
    // Cubre los before*/after* de los tests, NO el arranque del contenedor: el
    // globalSetup se protege solo, con su propio `withStartupTimeout`.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
