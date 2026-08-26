import { JSDOM } from 'jsdom';

// Preparación común de la suite del portal. Vitest la carga antes de cada archivo
// de test (`test.setupFiles` en vite.config.ts).
//
// ── El problema ───────────────────────────────────────────────────────────────
// Node 22 introdujo un `localStorage` GLOBAL (experimental) que solo funciona si
// se arranca con `--localstorage-file`. Sin ese flag el global existe igual, pero
// vale `undefined`.
//
// Ahí está la colisión: el entorno jsdom de Vitest instala los globales del
// navegador sobre `globalThis`, pero NO pisa los que Node ya trae. Como Node 26 ya
// define `localStorage`, el de jsdom nunca llega a instalarse y `globalThis` se
// queda con el de Node, que es `undefined`. En ese entorno `globalThis === window`,
// así que `window.localStorage` tampoco sirve de escape: es el mismo `undefined`.
// Resultado: `localStorage.clear()` revienta con "Cannot read properties of
// undefined" aunque el test declare `// @vitest-environment jsdom` y el origen
// (`http://localhost:3000`) sea perfectamente válido.
//
// Por eso los mismos tests pasan en CI y fallan en una máquina moderna: `.nvmrc`
// fija Node 20, donde ese global todavía no existe, no hay colisión y el de jsdom
// se instala con normalidad.
//
// ── El arreglo ────────────────────────────────────────────────────────────────
// Se pide a jsdom un `Storage` de verdad y se pone en el global. Es el mismo
// almacén que habría instalado el entorno de no haber colisión —con su semántica
// real, no un doble escrito a mano—, y hace falta construir un JSDOM aparte porque
// el del entorno no queda accesible desde aquí.
//
// La guarda deja esto en nada bajo Node 20: allí `globalThis.localStorage` ya
// existe y no se toca. Así la suite queda verde en las DOS versiones y el arreglo
// no caduca cuando el proyecto suba de Node.
//
// jsdom exige un origen no opaco para dar `localStorage` (con el `about:blank` por
// defecto lanza SecurityError), de ahí la URL explícita.
//
// ── El primo silencioso ───────────────────────────────────────────────────────
// `sessionStorage` cae en la misma colisión, pero falla peor: en Node 26 el global
// NO es `undefined` sino un almacén propio en memoria, así que nada revienta —
// simplemente se escribe en un sitio distinto del que lee jsdom. Hoy no muerde
// porque su único consumidor (`lib/lazyConReintento.ts`) accede por
// `window.sessionStorage`. Si algún día alguien lo usa a pelo, esa es la
// explicación del test que «pasa pero no ve nada»: añádelo aquí abajo.

if (typeof window !== 'undefined' && !globalThis.localStorage) {
  globalThis.localStorage = new JSDOM('', { url: 'http://localhost:3000' }).window.localStorage;
}
