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
    // TEST-712 — hasta aquí nada medía la cobertura, así que nada impedía que
    // bajara. Se mide en `npm test` (el script pasa `--coverage`), NO aquí con
    // `enabled: true`: lanzar un solo fichero con `npx vitest run x.test.ts`
    // mientras se hace TDD cubriría una fracción del código y chocaría contra
    // los umbrales sin que nada estuviera mal.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-db/**'],
      // Resumen en el log del CI; el HTML solo hace falta en local
      // (`npm test -- --coverage.reporter=html`).
      reporter: ['text-summary'],
      // Umbrales SOLO en las rutas críticas (auth, usuarios, ausencias), unos
      // puntos por debajo de lo medido el 2026-10-22: son un trinquete, no una
      // meta. Si un cambio los rompe, lo que toca es cubrir lo nuevo, no
      // bajarlos. El resto del código se mide pero no bloquea.
      //
      // ARQ-612 — los trozos de `ausencias/service/` van DENTRO del de ausencias:
      // es el mismo código que antes vivía en service.ts, y un glob que solo
      // mirase los ficheros sueltos de ausencias/ lo dejaría fuera sin avisar.
      // Lo vigila `ausencias/service/barril.test.ts`, con este mismo emparejador.
      //
      // Fuera del umbral, a propósito, los repositorios SQL (`ausencias/repo.ts`
      // y sus trozos de `repo/`, `users/users.repository.ts`): son consultas
      // contra Postgres y los cubre `npm run test:db`, que corre en otro proceso
      // y no suma aquí. Medidos desde este run saldrían al 17 % y obligarían a
      // poner un umbral tan bajo que no vigilaría nada. `seed-from-env.ts`
      // tampoco: es el arranque de una base vacía, también probado contra
      // Postgres.
      //
      // Medido: auth L97,9 B93,2 F100 · ausencias L97,5 B90,1 F99,5 ·
      // users L87,2 B66,4 F96,2.
      thresholds: {
        'src/auth.ts': { lines: 95, branches: 90, functions: 100, statements: 95 },
        'src/ausencias/{!(repo).ts,service/*.ts}': { lines: 95, branches: 85, functions: 95, statements: 95 },
        'src/users/!(users.repository|seed-from-env).ts': {
          lines: 80,
          branches: 55,
          functions: 85,
          statements: 80,
        },
      },
    },
  },
});
