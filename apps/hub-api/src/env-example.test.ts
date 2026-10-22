import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// INFRA-537 — el `.env.example` se quedó atrás en silencio: el código leía
// variables que el ejemplo no nombraba, y un despliegue nuevo arrancaba sin
// ellas sin que nadie supiera que existían. Este test hace que la próxima
// variable nueva no pueda entrar sin documentarse.
//
// Lo que NO cubre, a propósito:
//  - Solo va en un sentido (código → ejemplo). Una variable muerta en el
//    ejemplo no lo rompe: retirar una variable no debería obligar a tocar dos
//    sitios para que el CI pase.
//  - Detecta las lecturas por texto, no por AST. Las formas que conoce son
//    `process.env.X`, `process.env['X']`, el nombre literal dentro de una
//    lectura dinámica (`process.env[opts.env ?? 'X']`) y el `env: 'X'` que se
//    le pasa a `requireCronToken`. Cualquier OTRA forma (desestructurar,
//    guardar `process.env` en una variable) hace fallar el test en vez de
//    colarse sin ver: mejor un rojo que obligue a ampliar esto que un verde
//    falso.

const SRC = __dirname;
const EJEMPLO = join(__dirname, '..', '.env.example');

/**
 * Quita los comentarios de bloque y las líneas que son solo comentario: los
 * JSDoc ponen ejemplos de uso (`requireCronToken({ env: 'X_TOKEN', … })`) que
 * no son lecturas reales. Un `//` al final de una línea de código se deja: un
 * recorte ingenuo hasta fin de línea se comería lo que sigue a una URL.
 */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
}

/** Fuentes de la aplicación: todo `src/**` salvo los tests. */
function fuentes(): { ruta: string; texto: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((r) => r.endsWith('.ts') && !r.endsWith('.test.ts'))
    .map((r) => ({
      ruta: r.replace(/\\/g, '/'),
      texto: sinComentarios(readFileSync(join(SRC, r), 'utf8')),
    }));
}

const NOMBRE = '[A-Z][A-Z0-9_]*';

function variablesDelCodigo(): { usadas: Set<string>; formasDesconocidas: string[] } {
  const usadas = new Set<string>();
  const formasDesconocidas: string[] = [];
  const estatica = new RegExp(`process\\.env(?:\\.(${NOMBRE})|\\[\\s*['"](${NOMBRE})['"]\\s*\\])`, 'g');
  const dinamica = /process\.env\[(?!\s*['"][A-Z][A-Z0-9_]*['"]\s*\])([^\]]*)\]/g;
  const literal = new RegExp(`['"](${NOMBRE})['"]`, 'g');
  const cron = new RegExp(`requireCronToken\\(\\s*\\{[^}]*\\benv:\\s*['"](${NOMBRE})['"]`, 'g');

  for (const { ruta, texto } of fuentes()) {
    for (const m of texto.matchAll(estatica)) usadas.add(m[1] ?? m[2]);
    for (const m of texto.matchAll(dinamica)) {
      for (const l of m[1].matchAll(literal)) usadas.add(l[1]);
    }
    for (const m of texto.matchAll(cron)) usadas.add(m[1]);
    if (/process\.env(?![.[])/.test(texto)) formasDesconocidas.push(ruta);
  }
  return { usadas, formasDesconocidas };
}

/** Nombres que el ejemplo documenta, activos (`X=`) o comentados (`# X=`). */
function variablesDelEjemplo(): Set<string> {
  const texto = readFileSync(EJEMPLO, 'utf8');
  return new Set([...texto.matchAll(new RegExp(`^#?\\s*(${NOMBRE})=`, 'gm'))].map((m) => m[1]));
}

describe('.env.example documenta todas las variables que lee hub-api (INFRA-537)', () => {
  const { usadas, formasDesconocidas } = variablesDelCodigo();

  it('encuentra las lecturas (si esto falla, el detector se ha roto, no el ejemplo)', () => {
    // Ancla contra un verde falso: un detector que no viera nada pasaría el
    // test de abajo sin comprobar nada.
    expect(usadas).toContain('HUB_DB_URL');
    expect(usadas).toContain('WO_SALES_CRON_TOKEN'); // solo por la lectura dinámica
    expect(usadas).toContain('AUSENCIAS_CRON_TOKEN');
  });

  it('no lee el entorno de ninguna forma que el detector no entienda', () => {
    expect(formasDesconocidas).toEqual([]);
  });

  it('cada variable del código está en el ejemplo', () => {
    const documentadas = variablesDelEjemplo();
    const faltan = [...usadas].filter((v) => !documentadas.has(v)).sort();
    expect(faltan).toEqual([]);
  });
});
