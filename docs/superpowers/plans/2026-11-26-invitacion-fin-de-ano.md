# Invitación al almuerzo de fin de año 2026 — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos llevan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** una página del portal, `/celebracion-navidad-2026`, donde cada usuario activo hace cuatro cosas: confirma si va al almuerzo del 18 de diciembre, sube su foto al muro del equipo, brinda por sus compañeros votando sus cualidades y descarga su pase. El admin ve quién va, quién no y quién falta, y lo descarga en Excel.

**Arquitectura:**
- **hub-api** gana el módulo `src/celebracion/`:
  - `config.ts` es la única copia de los datos del evento.
  - `dominio.ts` reúne las reglas puras y el error tipado.
  - `service.ts` contiene los casos de uso, sobre el puerto `CelebracionStore` y con un reloj inyectado.
  - `repository.ts` tiene el SQL; `router.ts`, las rutas `/api/celebracion/*`.
  - La migración `081_celebracion.sql` crea dos tablas.
- **El portal** gana:
  - una página fuera del shell, en `src/pages/celebracion/`, envuelta en `RequireAuth` pero sin `AppGuard`;
  - un aviso en el Inicio.
- **La foto** se sube con el endpoint de avatar que ya existe.

**Tecnología:**
- hub-api: TypeScript, Express y PostgreSQL (`@algarpibe/zoho-sync`). Pruebas con Vitest 2: unitarias, supertest con JWT firmado y `*.db.test.ts` contra Postgres en Docker.
- Portal: React 19, Vite y Tailwind 3. Pruebas con Vitest 4, jsdom y Testing Library. Excel con SheetJS (`xlsx`).

**Diseño aprobado:** `docs/superpowers/specs/2026-11-26-invitacion-fin-de-ano-design.md`. Léelo entero antes de empezar.

**Plazo:** las confirmaciones cierran el **4 de diciembre de 2026**, así que esto debe estar en producción hacia el **28-29 de noviembre**. No añadas nada que no pida el plan.

---

## Convenciones de ejecución (obligatorias)

- **Raíz del repo:** `C:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07`. En Git Bash es `/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07`. Todos los comandos parten de ahí.
- **Rama:** `feat/invitacion-fin-de-ano`. Ya existe, sale de `main` y lleva el diseño (`fda077d`, `e14dde6`) y este plan. Se trabaja en ella y se mergea en `main` por tramos (ver «Tamaño y merges»). El usuario tiene autorización permanente para `git push origin main`. Empujar NO despliega: el despliegue lo hace el usuario a mano en EasyPanel.
- **Ficheros:** se crean y se cambian SOLO con las herramientas Write y Edit.
  - Nunca con `Set-Content`, `Out-File`, `sed`, `perl` ni redirecciones: PowerShell 5.1 destroza las tildes del fichero entero.
  - En disco están en CRLF (`core.autocrlf=true`) y Edit lo respeta.
  - Si un texto a sustituir no casa, lee ese tramo con Read y copia el texto de ahí.
- **Git:**
  - Siempre con la herramienta **Bash (Git Bash)**.
  - Conventional commits en español, **sin línea «Co-Authored-By» ni ninguna atribución**.
  - Rutas explícitas en `git add`. Nunca `git add -A` ni `git add .`, y nunca `git stash`.
  - No toques `.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/` ni `openspec/`: ya están modificados o sin seguimiento, y son del usuario.
- **Repo PÚBLICO:**
  - Datos ficticios siempre: «Ana Ruiz», «Bruno Díaz», «Carla Gómez», correos `@example.com` o `@celebracion.test`.
  - Ningún nombre real del equipo en el código ni en las pruebas.
  - Nunca leas `.env*` ni secretos.
- **TDD estricto:** prueba que falla, verla fallar, código mínimo, verla pasar, commit.
- **Pruebas de hub-api:**
  - Un fichero: `(cd apps/hub-api && npx vitest run src/celebracion/<fichero>)`.
  - La suite entera: `(cd apps/hub-api && npm test)`.
  - Las de BD (`*.db.test.ts`) necesitan Docker Desktop encendido (`docker desktop start`) y van con `(cd apps/hub-api && npx vitest run --config vitest.db.config.ts <fichero>)`.
  - **Nunca lances vitest desde la raíz del repo**: mete los `.db.test.ts` y salen unos 281 fallos falsos.
  - Docker se para con `docker desktop stop`, nunca con `wsl --shutdown`.
- **Pruebas del portal:**
  - Un fichero: `(cd apps/portal && npx vitest run src/pages/celebracion/<fichero>)`.
  - La suite: `(cd apps/portal && npm test)`.
  - El tipado y el bundle: `(cd apps/portal && npm run build)`. El portal no tiene script `typecheck`: `tsc -b` va dentro del build y revisa también los `*.test.ts(x)`, así que las pruebas tienen que tipar.
  - Lint: `(cd apps/portal && npm run lint)`. `react-hooks/set-state-in-effect` está como aviso, no como error.
  - Si el lint marca como **error** alguna regla de React 19 en el código de este plan (por ejemplo `react-hooks/purity` por leer la hora o un aleatorio al pintar), corrígelo moviendo esa lectura a un efecto o a un manejador. No desactives la regla.
  - Los ficheros de prueba con DOM empiezan con la línea `// @vitest-environment jsdom`.
- **Errores conocidos que no son de este trabajo:**
  - `npx tsc -p tsconfig.json --noEmit` en hub-api puede dar un error en `src/ausencias/service/barril.test.ts` (tipos de `micromatch`). No lo persigas.
  - Bajo carga, la prueba 4.4 de usuarios de hub-api puede caer por tiempo. Repítela sola antes de investigar.
- **Candados existentes que este plan toca:**
  - `apps/hub-api/src/ausencias/registrada-por.migracion.test.ts` exige que la 080 sea la ÚLTIMA migración. La Tarea 4 lo relaja a «la 080 va detrás de la 079», con el mismo patrón `[,\]]` que ya usa `users/terms.migracion.test.ts`, y la prueba nueva de la 081 pasa a exigir que la 081 sea la última. No se relaja ningún otro.
  - `password-reset.router.test.ts:244-250` falla si se monta algo entre el router de usuarios y el de restablecer. El router nuevo va detrás del de ausencias.

### Tamaño y merges

La regla del repo es menos de 800 líneas cambiadas por merge, sin contar los documentos de diseño y plan. Se mide con:

```bash
git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'
```

El cambio entero son unas 3.000 líneas, así que va en **seis merges desde la misma rama**:

| Merge | Tareas | Contenido | Líneas aprox. |
|---|---|---|---|
| A | 1-3 | hub-api: config, dominio y servicio | 700 |
| B | 4-7 | hub-api: migración, repositorio, router y montaje | 600 |
| C1 | 8-11 | portal: tipos, API y utilidades puras | 650 |
| C2 | 12-14 | portal: confirmación, página y ruta | 750 |
| D1 | 15-17 | portal: modal de cualidades y muro | 600 |
| D2 | 18-21 | portal: pase, panel admin con Excel y aviso del Inicio; despliegue | 700 |

- Cada merge funciona solo: lo de hub-api no se usa hasta que llega el portal, y la página no se enlaza desde ningún sitio hasta el D2.
- **Se despliega una vez, tras el D2**: hub-api primero y luego el portal.
- Si un merge pasa de 800 líneas por poco, sigue: la regla sirve para mantener la revisión acotada, no para partir una tarea a medias.

**Cómo se mergea (cada tarea «Merge»):**

1. Primero, en un comando aparte, la comprobación de privacidad:

   ```bash
   git diff main...HEAD -- . ':(exclude)docs/superpowers' | grep -nE "ambientalia\.com\.co|BEGIN (RSA|OPENSSH|PRIVATE)|JWT_SECRET=|HUB_DB_URL="
   ```

   Lo esperado es **ninguna línea** (grep sale con código 1). Si sale algo, para y pregunta al usuario. Nunca la encadenes con `&&` al merge: grep da 0 aunque encuentre resultados.

2. Después, comando a comando:

   ```bash
   git switch main
   git pull --ff-only origin main
   git merge --no-ff feat/invitacion-fin-de-ano -m "<mensaje de la tarea>"
   git push origin main
   git switch feat/invitacion-fin-de-ano
   ```

## Decisiones tomadas en el plan

El diseño no dice nada en estos puntos. El plan sigue la opción marcada.

| # | Silencio del diseño | Opción del plan |
|---|---|---|
| D1 | Qué pasa si `asiste` no es booleano. | 400 `asiste_invalido`, un código más en la lista. |
| D2 | `:userId` de `PUT /votos/:userId` que no es un UUID. | 400 `usuario_no_valido` antes de tocar la BD; sin esto, Postgres daría un 500 (`22P02`). |
| D3 | Orden de las comprobaciones al votar. | Cierre (409) → UUID → voto propio → cualidades → compañero activo. |
| D4 | Doble clic al guardar un brindis: dos transacciones de borrar e insertar a la vez pueden dejar más de 3 cualidades. | Candado consultivo por votante dentro de la transacción (`pg_advisory_xact_lock`). No necesita permisos. |
| D5 | Permisos de `portal_app` (DATA-332). | Confirmaciones: SELECT, INSERT y UPDATE, sin DELETE. Votos: SELECT, INSERT y DELETE, sin UPDATE. Mismo patrón GRANT/REVOKE que la 079. |
| D6 | Cómo sabe la página quién soy y si soy admin. | `GET /api/celebracion` devuelve `yo` y `esAdmin`. El rol es el de la BD, que `requireAuth` ya leyó, así que no depende del JWT cacheado. |
| D7 | Orden del muro y texto de mi tarjeta sin votos. | Mi tarjeta va **primera** (ahí está «Subir mi foto»), con «Aún nadie ha brindado por ti.». Con los votos cerrados, las tarjetas sin votos dicen «Sin brindis.». |
| D8 | Desmarcar todas las cualidades de un compañero. | Se permite: guarda 0 votos (retira el brindis) y el botón vuelve a «Enviar brindis». |
| D9 | Iniciales sin foto. | Sin partículas (de, del, la, las, los, y): primera letra de la 1.ª palabra y de la 2.ª, o de la 3.ª si hay 4 o más palabras («Yenny Marcela Noreña Vargas» → YN). |
| D10 | `xlsx` en el portal. | Se declara en `apps/portal/package.json`, con la misma URL de SheetJS que las demás apps. Hoy solo resuelve por estar elevado en la raíz. |
| D11 | Mensaje si no va. | Se permite (una despedida); el pase solo sale si va. |
| D12 | Tipografías. | Outfit y Inter por estilo en línea. Ya se cargan en `index.html`, pero el `body` del portal usa las del sistema. |
| D13 | Peso de la página. | Carga diferida (`lazyConReintento`), como «Mis equipos». |
| D14 | El panel admin no se entera de los cambios propios. | La página pasa `version` (sube en cada recarga) y el panel relee el resumen. |

## Mapa de ficheros

**hub-api (`apps/hub-api/src/`)**

| Fichero | Responsabilidad |
|---|---|
| `celebracion/config.ts` (nuevo) | Datos del evento, cualidades, preferencias y topes. Única copia. |
| `celebracion/dominio.ts` (nuevo) | `CelebracionError`, cierres, `parseConfirmacion`, `parseCualidades`, `esUuid`, `top3`. Puro. |
| `celebracion/service.ts` (nuevo) | Puerto `CelebracionStore` y `CelebracionService` (vista, mi estado, confirmar, votar, resumen). |
| `celebracion/test-fakes.ts` (nuevo) | `FakeStore` en memoria que imita el SQL. |
| `celebracion/repository.ts` (nuevo) | `CelebracionRepository`: el SQL. |
| `celebracion/router.ts` (nuevo) | `createCelebracionRouter`: rutas y traducción de errores. |
| `users/migrations/081_celebracion.sql` (nuevo) | Tablas, índice y permisos. |
| `db.ts` (cambia) | Añade la 081 a `MIGRATIONS`. |
| `index.ts` (cambia) | Monta el router. |
| `ausencias/registrada-por.migracion.test.ts` (cambia) | El candado de «la 080 es la última» pasa a «detrás de la 079». |
| pruebas nuevas | `celebracion/dominio.test.ts`, `service.test.ts`, `migracion.test.ts`, `repository.db.test.ts`, `router.test.ts`. |

**Portal (`apps/portal/src/`)**

| Fichero | Responsabilidad |
|---|---|
| `pages/celebracion/ruta.ts` | `RUTA_CELEBRACION`. |
| `pages/celebracion/tipos.ts` | Tipos de la API y `MENSAJE_MAX`. |
| `pages/celebracion/api.ts` | Llamadas, `ErrorApi`, `mensajeDeError`. |
| `pages/celebracion/fechas.ts` | Cuenta atrás y formatos de fecha (Bogotá). |
| `pages/celebracion/enlaces.ts` | Maps, Waze, Google Calendar, `.ics`. |
| `pages/celebracion/marca.ts` | Colores, degradados y tipografías. |
| `pages/celebracion/persona.ts` | Iniciales, primer nombre, color del avatar. |
| `pages/celebracion/estilos.ts` | Clases de botones y campos. |
| `pages/celebracion/confeti.ts` | Confeti con lienzo propio; respeta el movimiento reducido. |
| `pages/celebracion/descargar.ts` | Descargas (`.ics`, PNG). |
| `pages/celebracion/ui.tsx` | `Etiqueta`, `Titulo`, `Tarjeta`. |
| `pages/celebracion/fixtures.ts` | Datos ficticios para las pruebas. |
| `pages/celebracion/Confirmacion.tsx` | Formulario «Sí voy / No podré ir» y sus tres estados. |
| `pages/celebracion/Portada.tsx`, `CuentaAtras.tsx`, `TarjetasEvento.tsx` | Presentación. |
| `pages/celebracion/CelebracionNavidad.tsx` | La página: carga, estado y conexiones. |
| `pages/celebracion/ModalCualidades.tsx`, `MuroEquipo.tsx` | Brindis y muro. |
| `pages/celebracion/pase.ts`, `PaseDigital.tsx` | Pase en pantalla y en PNG. |
| `pages/celebracion/excel.ts`, `PanelAdmin.tsx` | Panel del admin y Excel. |
| `components/AvisoCelebracion.tsx` | Aviso del Inicio. |
| `App.tsx`, `pages/Dashboard.tsx`, `pages/Dashboard.test.tsx`, `package.json` (cambian) | Ruta, aviso, mock y `xlsx`. |

---

## MERGE A — hub-api: dominio y servicio

### Tarea 1: configuración y reglas puras

**Ficheros:**
- Crear: `apps/hub-api/src/celebracion/config.ts`
- Crear: `apps/hub-api/src/celebracion/dominio.ts`
- Prueba: `apps/hub-api/src/celebracion/dominio.test.ts`

- [ ] **Paso 1: escribe la prueba que falla** (`apps/hub-api/src/celebracion/dominio.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { CUALIDADES, EVENTO } from './config.js';
import {
  CelebracionError,
  confirmacionesAbiertas,
  esUuid,
  parseConfirmacion,
  parseCualidades,
  top3,
  votosAbiertos,
} from './dominio.js';

/** «400:codigo» si lanza un CelebracionError; así cada caso cabe en una línea. */
function resultado(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof CelebracionError ? `${e.status}:${e.code}` : 'otro error';
  }
  return 'sin error';
}

describe('configuración', () => {
  it('es la del diseño: el evento de 2026 y 18 cualidades distintas', () => {
    expect(EVENTO.id).toBe('fin-de-ano-2026');
    expect(CUALIDADES).toHaveLength(18);
    expect(new Set(CUALIDADES).size).toBe(18);
  });
});

describe('cierres', () => {
  it('las confirmaciones siguen abiertas hasta el último segundo del 4 de diciembre en Bogotá', () => {
    expect(confirmacionesAbiertas(new Date('2026-12-05T04:59:59Z'))).toBe(true);
    expect(confirmacionesAbiertas(new Date('2026-12-05T05:00:00Z'))).toBe(false);
  });

  it('los votos cierran al empezar el almuerzo', () => {
    expect(votosAbiertos(new Date('2026-12-18T17:29:59Z'))).toBe(true);
    expect(votosAbiertos(new Date('2026-12-18T17:30:00Z'))).toBe(false);
  });
});

describe('CelebracionError', () => {
  it('los cierres son 409 y lo demás 400', () => {
    expect(new CelebracionError('confirmaciones_cerradas').status).toBe(409);
    expect(new CelebracionError('votos_cerrados').status).toBe(409);
    expect(new CelebracionError('voto_propio').status).toBe(400);
  });
});

describe('parseConfirmacion', () => {
  it('si va, exige una preferencia de la lista', () => {
    expect(parseConfirmacion({ asiste: true, preferencia: 'vegetariano' })).toEqual({
      asiste: true,
      preferencia: 'vegetariano',
      mensaje: null,
    });
    expect(resultado(() => parseConfirmacion({ asiste: true }))).toBe('400:preferencia_invalida');
    expect(resultado(() => parseConfirmacion({ asiste: true, preferencia: 'carne' }))).toBe('400:preferencia_invalida');
  });

  it('si no va, no admite preferencia', () => {
    expect(parseConfirmacion({ asiste: false })).toEqual({ asiste: false, preferencia: null, mensaje: null });
    expect(parseConfirmacion({ asiste: false, preferencia: null })).toEqual({ asiste: false, preferencia: null, mensaje: null });
    expect(resultado(() => parseConfirmacion({ asiste: false, preferencia: 'general' }))).toBe('400:preferencia_invalida');
  });

  it('asiste tiene que ser booleano', () => {
    expect(resultado(() => parseConfirmacion({ asiste: 'si', preferencia: 'general' }))).toBe('400:asiste_invalido');
    expect(resultado(() => parseConfirmacion(null))).toBe('400:asiste_invalido');
  });

  it('el mensaje es opcional, se recorta y tiene tope de 200', () => {
    expect(parseConfirmacion({ asiste: false, mensaje: '  ¡Feliz año! 🎉  ' }).mensaje).toBe('¡Feliz año! 🎉');
    expect(parseConfirmacion({ asiste: false, mensaje: '   ' }).mensaje).toBeNull();
    expect(parseConfirmacion({ asiste: false, mensaje: 'a'.repeat(200) }).mensaje).toHaveLength(200);
    expect(resultado(() => parseConfirmacion({ asiste: false, mensaje: 'a'.repeat(201) }))).toBe('400:mensaje_invalido');
    expect(resultado(() => parseConfirmacion({ asiste: false, mensaje: 42 }))).toBe('400:mensaje_invalido');
  });

  it('rechaza caracteres de control y separadores de línea dentro del mensaje', () => {
    for (const raro of ['a\nb', 'a\tb', 'a\u0085b', 'a\u2028b']) {
      expect(resultado(() => parseConfirmacion({ asiste: false, mensaje: raro }))).toBe('400:mensaje_invalido');
    }
  });
});

describe('parseCualidades', () => {
  it('acepta de 0 a 3 cualidades de la lista, sin repetir', () => {
    expect(parseCualidades({ cualidades: [] })).toEqual([]);
    expect(parseCualidades({ cualidades: ['Empatía', 'Liderazgo', 'Compromiso'] })).toEqual(['Empatía', 'Liderazgo', 'Compromiso']);
  });

  it('más de 3 es demasiadas_cualidades', () => {
    expect(
      resultado(() => parseCualidades({ cualidades: ['Empatía', 'Liderazgo', 'Compromiso', 'Creatividad'] })),
    ).toBe('400:demasiadas_cualidades');
  });

  it('una desconocida, repetida, que no es texto o sin lista es cualidad_invalida', () => {
    const cuerpos: unknown[] = [
      { cualidades: ['Puntualidad'] },
      { cualidades: ['Empatía', 'Empatía'] },
      { cualidades: [1] },
      { cualidades: 'Empatía' },
      {},
      null,
    ];
    for (const cuerpo of cuerpos) expect(resultado(() => parseCualidades(cuerpo))).toBe('400:cualidad_invalida');
  });
});

describe('esUuid', () => {
  it('distingue un UUID de cualquier otra cosa', () => {
    expect(esUuid('00000000-0000-4000-8000-00000000000a')).toBe(true);
    expect(esUuid('00000000-0000-4000-8000-00000000000A')).toBe(true);
    expect(esUuid('no-es-un-uuid')).toBe(false);
    expect(esUuid(42)).toBe(false);
  });
});

describe('top3', () => {
  it('ordena por votos y desempata por el orden de la lista', () => {
    expect(
      top3([
        { cualidad: 'Compromiso', votos: 2 },
        { cualidad: 'Empatía', votos: 2 },
        { cualidad: 'Liderazgo', votos: 5 },
        { cualidad: 'Creatividad', votos: 1 },
      ]),
    ).toEqual([
      { cualidad: 'Liderazgo', votos: 5 },
      { cualidad: 'Empatía', votos: 2 },
      { cualidad: 'Compromiso', votos: 2 },
    ]);
  });

  it('ignora las cualidades que ya no están en la lista', () => {
    expect(top3([{ cualidad: 'Puntualidad', votos: 9 }])).toEqual([]);
  });
});
```

- [ ] **Paso 2: comprueba que falla**

Run: `(cd apps/hub-api && npx vitest run src/celebracion/dominio.test.ts)`
Esperado: FALLA porque no existen `./config.js` ni `./dominio.js`.

- [ ] **Paso 3: escribe `config.ts`** (`apps/hub-api/src/celebracion/config.ts`)

```ts
// Configuración del almuerzo de fin de año 2026 (diseño:
// docs/superpowers/specs/2026-11-26-invitacion-fin-de-ano-design.md). Es la ÚNICA
// copia: el portal la recibe por GET /api/celebracion y el servicio la usa para
// hacer cumplir los cierres. Para otro evento se cambia este archivo y su `id`.

export const EVENTO = {
  id: 'fin-de-ano-2026',
  titulo: 'Almuerzo de fin de año 2026',
  inicio: '2026-12-18T12:30:00-05:00',
  fin: '2026-12-18T16:00:00-05:00',
  lugar: 'Restaurante Anfitriona',
  direccion: 'Cl. 83 Bis #24-09, Bogotá D.C.',
  vestimenta: 'Smart casual',
  /** Último instante en que se puede confirmar o cambiar la respuesta. */
  cierreConfirmaciones: '2026-12-04T23:59:59-05:00',
} as const;

/** Lista fija de cualidades que se pueden votar. Su orden desempata el top 3. */
export const CUALIDADES: readonly string[] = [
  'Liderazgo',
  'Empatía',
  'Compromiso',
  'Creatividad',
  'Trabajo en equipo',
  'Proactividad',
  'Alegría contagiosa',
  'Organización',
  'Precisión técnica',
  'Confiabilidad',
  'Generosidad',
  'Perseverancia',
  'Actitud resolutiva',
  'Atención al detalle',
  'Compañerismo',
  'Calidez humana',
  'Visión estratégica',
  'Espíritu positivo',
];

export interface Preferencia {
  codigo: string;
  texto: string;
}

export const PREFERENCIAS: readonly Preferencia[] = [
  { codigo: 'general', texto: 'Menú general (sin restricciones)' },
  { codigo: 'vegetariano', texto: 'Opción vegetariana' },
  { codigo: 'sin_gluten', texto: 'Sin gluten' },
  { codigo: 'sin_mariscos', texto: 'Sin mariscos ni pescados' },
];

/** Cualidades que cada persona puede votar a cada compañero. */
export const MAX_CUALIDADES = 3;

/** Largo máximo del mensaje de la confirmación (la BD tiene el mismo CHECK). */
export const MENSAJE_MAX = 200;
```

- [ ] **Paso 4: escribe `dominio.ts`** (`apps/hub-api/src/celebracion/dominio.ts`)

```ts
import { CUALIDADES, EVENTO, MAX_CUALIDADES, MENSAJE_MAX, PREFERENCIAS } from './config.js';

// Reglas puras de la invitación: los cierres, la validación de lo que manda el
// portal y el top 3 de cualidades. Nada de BD ni de reloj: la hora llega como
// argumento.

export type CodigoError =
  | 'confirmaciones_cerradas'
  | 'votos_cerrados'
  | 'asiste_invalido'
  | 'preferencia_invalida'
  | 'mensaje_invalido'
  | 'cualidad_invalida'
  | 'demasiadas_cualidades'
  | 'voto_propio'
  | 'usuario_no_valido';

const CIERRES: ReadonlySet<CodigoError> = new Set<CodigoError>(['confirmaciones_cerradas', 'votos_cerrados']);

/** Error de negocio: el router lo traduce a 409 (cierres) o 400 (lo demás), nunca a 401. */
export class CelebracionError extends Error {
  readonly status: 400 | 409;

  constructor(readonly code: CodigoError) {
    super(code);
    this.name = 'CelebracionError';
    this.status = CIERRES.has(code) ? 409 : 400;
  }
}

export interface DatosConfirmacion {
  asiste: boolean;
  preferencia: string | null;
  mensaje: string | null;
}

export interface CualidadVotada {
  cualidad: string;
  votos: number;
}

export function confirmacionesAbiertas(ahora: Date): boolean {
  return ahora.getTime() <= new Date(EVENTO.cierreConfirmaciones).getTime();
}

export function votosAbiertos(ahora: Date): boolean {
  return ahora.getTime() < new Date(EVENTO.inicio).getTime();
}

const CODIGOS_PREFERENCIA = new Set(PREFERENCIAS.map((p) => p.codigo));

/** Valida el cuerpo de PUT /celebracion/confirmacion. */
export function parseConfirmacion(body: unknown): DatosConfirmacion {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.asiste !== 'boolean') throw new CelebracionError('asiste_invalido');
  const preferencia = b.preferencia ?? null;
  if (b.asiste) {
    if (typeof preferencia !== 'string' || !CODIGOS_PREFERENCIA.has(preferencia)) {
      throw new CelebracionError('preferencia_invalida');
    }
    return { asiste: true, preferencia, mensaje: parseMensaje(b.mensaje) };
  }
  if (preferencia !== null) throw new CelebracionError('preferencia_invalida');
  return { asiste: false, preferencia: null, mensaje: parseMensaje(b.mensaje) };
}

/** Controles C0, DEL, C1 y los separadores de línea y de párrafo de Unicode. */
function tieneControl(texto: string): boolean {
  for (const caracter of texto) {
    const c = caracter.codePointAt(0) ?? 0;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

function parseMensaje(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new CelebracionError('mensaje_invalido');
  const limpio = valor.trim();
  if (limpio === '') return null;
  if (limpio.length > MENSAJE_MAX || tieneControl(limpio)) throw new CelebracionError('mensaje_invalido');
  return limpio;
}

const SET_CUALIDADES = new Set(CUALIDADES);

/** Valida el cuerpo de PUT /celebracion/votos/:userId: de 0 a 3 cualidades de la lista, sin repetir. */
export function parseCualidades(body: unknown): string[] {
  const lista = ((body ?? {}) as Record<string, unknown>).cualidades;
  if (!Array.isArray(lista)) throw new CelebracionError('cualidad_invalida');
  if (lista.length > MAX_CUALIDADES) throw new CelebracionError('demasiadas_cualidades');
  const vistas = new Set<string>();
  for (const c of lista) {
    if (typeof c !== 'string' || !SET_CUALIDADES.has(c) || vistas.has(c)) throw new CelebracionError('cualidad_invalida');
    vistas.add(c);
  }
  return [...vistas];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID.test(valor);
}

const ORDEN = new Map(CUALIDADES.map((c, i) => [c, i] as const));

/** Las 3 cualidades más votadas; empata el orden de la lista. Las que ya no están en la lista no salen. */
export function top3(conteos: readonly CualidadVotada[]): CualidadVotada[] {
  return conteos
    .filter((c) => c.votos > 0 && ORDEN.has(c.cualidad))
    .sort((a, b) => b.votos - a.votos || (ORDEN.get(a.cualidad) ?? 0) - (ORDEN.get(b.cualidad) ?? 0))
    .slice(0, MAX_CUALIDADES);
}
```

- [ ] **Paso 5: comprueba que pasa**

Run: `(cd apps/hub-api && npx vitest run src/celebracion/dominio.test.ts)`
Esperado: PASA (14 pruebas).

- [ ] **Paso 6: commit**

```bash
git add apps/hub-api/src/celebracion/config.ts apps/hub-api/src/celebracion/dominio.ts apps/hub-api/src/celebracion/dominio.test.ts
git commit -m "feat(hub-api): reglas de la invitación de fin de año"
```

### Tarea 2: el servicio y su store en memoria

**Ficheros:**
- Crear: `apps/hub-api/src/celebracion/service.ts`
- Crear: `apps/hub-api/src/celebracion/test-fakes.ts`
- Prueba: `apps/hub-api/src/celebracion/service.test.ts`

- [ ] **Paso 1: escribe el store en memoria** (`apps/hub-api/src/celebracion/test-fakes.ts`)

Es el doble de pruebas del puerto, no código de producción. Imita el SQL de `CelebracionRepository`: solo cuentan los votantes activos, y la confirmación es una por persona y evento. `repository.db.test.ts` (Tarea 5) vigila que el SQL haga lo mismo.

```ts
import type { DatosConfirmacion } from './dominio.js';
import type { CelebracionStore, Confirmacion, ConteoVotos, Miembro, VotoPropio } from './service.js';

export interface FakeUsuario extends Miembro {
  activo: boolean;
}

interface FakeVoto {
  evento: string;
  votanteId: string;
  votadoId: string;
  cualidad: string;
  creadoEn: Date;
}

interface FakeConfirmacion extends Confirmacion {
  evento: string;
}

/** Store en memoria con la misma semántica que el SQL de CelebracionRepository. */
export class FakeStore implements CelebracionStore {
  usuarios: FakeUsuario[] = [];
  confirmaciones: FakeConfirmacion[] = [];
  votos: FakeVoto[] = [];

  addUsuario(userId: string, nombre: string, opciones: { activo?: boolean; avatar?: string | null } = {}): void {
    this.usuarios.push({ userId, nombre, avatar: opciones.avatar ?? null, activo: opciones.activo ?? true });
  }

  private activo(userId: string): boolean {
    return this.usuarios.some((u) => u.userId === userId && u.activo);
  }

  async listarEquipo(): Promise<Miembro[]> {
    return this.usuarios
      .filter((u) => u.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((u) => ({ userId: u.userId, nombre: u.nombre, avatar: u.avatar }));
  }

  async esUsuarioActivo(userId: string): Promise<boolean> {
    return this.activo(userId);
  }

  async contarVotos(evento: string): Promise<ConteoVotos[]> {
    const mapa = new Map<string, ConteoVotos>();
    for (const v of this.votos) {
      if (v.evento !== evento || !this.activo(v.votanteId)) continue;
      const clave = `${v.votadoId}|${v.cualidad}`;
      const actual = mapa.get(clave) ?? { votadoId: v.votadoId, cualidad: v.cualidad, votos: 0 };
      actual.votos += 1;
      mapa.set(clave, actual);
    }
    return [...mapa.values()];
  }

  async votosDe(evento: string, votanteId: string): Promise<VotoPropio[]> {
    return this.votos
      .filter((v) => v.evento === evento && v.votanteId === votanteId)
      .map((v) => ({ votadoId: v.votadoId, cualidad: v.cualidad }));
  }

  async confirmacionDe(evento: string, userId: string): Promise<Confirmacion | null> {
    const c = this.confirmaciones.find((x) => x.evento === evento && x.userId === userId);
    return c ? sinEvento(c) : null;
  }

  async listarConfirmaciones(evento: string): Promise<Confirmacion[]> {
    return this.confirmaciones.filter((c) => c.evento === evento).map(sinEvento);
  }

  async guardarConfirmacion(evento: string, userId: string, datos: DatosConfirmacion, ahora: Date): Promise<void> {
    this.confirmaciones = this.confirmaciones.filter((c) => !(c.evento === evento && c.userId === userId));
    this.confirmaciones.push({ evento, userId, ...datos, actualizadoEn: ahora });
  }

  async reemplazarVotos(
    evento: string,
    votanteId: string,
    votadoId: string,
    cualidades: string[],
    ahora: Date,
  ): Promise<void> {
    // El CHECK de la BD (celebracion_votos_no_propio).
    if (votanteId === votadoId) throw new Error('check violation: celebracion_votos_no_propio');
    this.votos = this.votos.filter(
      (v) => !(v.evento === evento && v.votanteId === votanteId && v.votadoId === votadoId),
    );
    for (const cualidad of cualidades) this.votos.push({ evento, votanteId, votadoId, cualidad, creadoEn: ahora });
  }
}

function sinEvento(c: FakeConfirmacion): Confirmacion {
  return {
    userId: c.userId,
    asiste: c.asiste,
    preferencia: c.preferencia,
    mensaje: c.mensaje,
    actualizadoEn: c.actualizadoEn,
  };
}
```

- [ ] **Paso 2: escribe la prueba que falla** (`apps/hub-api/src/celebracion/service.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { CUALIDADES, EVENTO, PREFERENCIAS } from './config.js';
import { CelebracionService } from './service.js';
import { FakeStore } from './test-fakes.js';

const ANA = '00000000-0000-4000-8000-00000000000a';
const BRUNO = '00000000-0000-4000-8000-00000000000b';
const CARLA = '00000000-0000-4000-8000-00000000000c';
const DIANA = '00000000-0000-4000-8000-00000000000d'; // inactiva

const ANTES_DEL_CORTE = new Date('2026-12-01T15:00:00Z');
const TRAS_EL_CORTE = new Date('2026-12-10T15:00:00Z'); // confirmaciones cerradas, votos abiertos
const TRAS_EL_EVENTO = new Date('2026-12-18T18:00:00Z');

function montar(ahora = ANTES_DEL_CORTE) {
  const store = new FakeStore();
  store.addUsuario(ANA, 'Ana Ruiz');
  store.addUsuario(BRUNO, 'Bruno Díaz', { avatar: 'data:image/jpeg;base64,AAAA' });
  store.addUsuario(CARLA, 'Carla Gómez');
  store.addUsuario(DIANA, 'Diana Prieto', { activo: false });
  const reloj = { ahora };
  const service = new CelebracionService({ store, now: () => reloj.ahora });
  return { store, service, reloj };
}

describe('vista', () => {
  it('devuelve el evento con sus cierres, listas y topes, y quién soy', async () => {
    const { service } = montar();
    const vista = await service.vista({ userId: ANA, esAdmin: true });
    expect(vista.evento).toMatchObject({
      id: EVENTO.id,
      inicio: EVENTO.inicio,
      confirmacionesAbiertas: true,
      votosAbiertos: true,
      maxCualidades: 3,
    });
    expect(vista.evento.cualidades).toEqual(CUALIDADES);
    expect(vista.evento.preferencias).toEqual(PREFERENCIAS);
    expect(vista.yo).toBe(ANA);
    expect(vista.esAdmin).toBe(true);
  });

  it('el equipo son los usuarios activos por nombre, con su avatar', async () => {
    const { service } = montar();
    const { equipo } = await service.vista({ userId: ANA, esAdmin: false });
    expect(equipo.map((m) => m.nombre)).toEqual(['Ana Ruiz', 'Bruno Díaz', 'Carla Gómez']);
    expect(equipo[1].avatar).toBe('data:image/jpeg;base64,AAAA');
  });

  it('cada tarjeta trae su top 3 con número, sin contar votos de cuentas inactivas', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Empatía', 'Liderazgo'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, DIANA, BRUNO, ['Compromiso', 'Creatividad', 'Generosidad'], ANTES_DEL_CORTE);
    const { equipo } = await service.vista({ userId: ANA, esAdmin: false });
    expect(equipo.find((m) => m.userId === BRUNO)?.cualidades).toEqual([
      { cualidad: 'Empatía', votos: 2 },
      { cualidad: 'Liderazgo', votos: 1 },
    ]);
    expect(equipo.find((m) => m.userId === CARLA)?.cualidades).toEqual([]);
  });

  it('trae mis votos por compañero y mi respuesta', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Liderazgo'], ANTES_DEL_CORTE);
    await service.confirmar(ANA, { asiste: true, preferencia: 'vegetariano', mensaje: '¡Allá estaré!' });
    const vista = await service.vista({ userId: ANA, esAdmin: false });
    expect(vista.misVotos).toEqual({ [BRUNO]: ['Empatía'] });
    expect(vista.miRespuesta).toEqual({
      asiste: true,
      preferencia: 'vegetariano',
      mensaje: '¡Allá estaré!',
      actualizadoEn: ANTES_DEL_CORTE,
    });
  });

  it('sin respuesta, miRespuesta es null', async () => {
    const { service } = montar();
    expect((await service.vista({ userId: CARLA, esAdmin: false })).miRespuesta).toBeNull();
  });
});

describe('miEstado', () => {
  it('dice si he respondido y si las confirmaciones siguen abiertas', async () => {
    const { service, reloj } = montar();
    expect(await service.miEstado(ANA)).toEqual({ respondido: false, confirmacionesAbiertas: true });
    await service.confirmar(ANA, { asiste: false });
    expect(await service.miEstado(ANA)).toEqual({ respondido: true, confirmacionesAbiertas: true });
    reloj.ahora = TRAS_EL_CORTE;
    expect(await service.miEstado(CARLA)).toEqual({ respondido: false, confirmacionesAbiertas: false });
  });
});

describe('confirmar', () => {
  it('guarda y luego reemplaza mi respuesta', async () => {
    const { store, service } = montar();
    await service.confirmar(ANA, { asiste: true, preferencia: 'general' });
    await service.confirmar(ANA, { asiste: false, mensaje: 'Me surgió un viaje' });
    expect(store.confirmaciones).toHaveLength(1);
    expect(await store.confirmacionDe(EVENTO.id, ANA)).toMatchObject({
      asiste: false,
      preferencia: null,
      mensaje: 'Me surgió un viaje',
    });
  });

  it('después del corte es 409 confirmaciones_cerradas y no guarda nada', async () => {
    const { store, service } = montar(TRAS_EL_CORTE);
    await expect(service.confirmar(ANA, { asiste: false })).rejects.toMatchObject({
      code: 'confirmaciones_cerradas',
      status: 409,
    });
    expect(store.confirmaciones).toHaveLength(0);
  });

  it('un cuerpo inválido no guarda nada', async () => {
    const { store, service } = montar();
    await expect(service.confirmar(ANA, { asiste: true, preferencia: 'carne' })).rejects.toMatchObject({
      code: 'preferencia_invalida',
    });
    expect(store.confirmaciones).toHaveLength(0);
  });
});

describe('votar', () => {
  it('reemplaza mis votos a ese compañero, también por una lista vacía', async () => {
    const { store, service } = montar();
    await service.votar(ANA, BRUNO, { cualidades: ['Empatía', 'Liderazgo', 'Compromiso'] });
    await service.votar(ANA, BRUNO, { cualidades: ['Creatividad'] });
    expect(await store.votosDe(EVENTO.id, ANA)).toEqual([{ votadoId: BRUNO, cualidad: 'Creatividad' }]);
    await service.votar(ANA, BRUNO, { cualidades: [] });
    expect(await store.votosDe(EVENTO.id, ANA)).toEqual([]);
  });

  it('acepta el UUID en mayúsculas y lo guarda en minúsculas', async () => {
    const { store, service } = montar();
    await service.votar(ANA, BRUNO.toUpperCase(), { cualidades: ['Empatía'] });
    expect(await store.votosDe(EVENTO.id, ANA)).toEqual([{ votadoId: BRUNO, cualidad: 'Empatía' }]);
  });

  it('tras el corte de confirmaciones todavía se puede votar', async () => {
    const { service } = montar(TRAS_EL_CORTE);
    await expect(service.votar(ANA, BRUNO, { cualidades: ['Empatía'] })).resolves.toBeUndefined();
  });

  it('rechaza cada caso con su código y sin guardar', async () => {
    const { store, service } = montar();
    await expect(service.votar(ANA, ANA, { cualidades: ['Empatía'] })).rejects.toMatchObject({ code: 'voto_propio' });
    await expect(service.votar(ANA, 'no-es-uuid', { cualidades: ['Empatía'] })).rejects.toMatchObject({
      code: 'usuario_no_valido',
    });
    await expect(service.votar(ANA, DIANA, { cualidades: ['Empatía'] })).rejects.toMatchObject({
      code: 'usuario_no_valido',
    });
    await expect(
      service.votar(ANA, '00000000-0000-4000-8000-0000000000ff', { cualidades: ['Empatía'] }),
    ).rejects.toMatchObject({ code: 'usuario_no_valido' });
    await expect(
      service.votar(ANA, BRUNO, { cualidades: ['Empatía', 'Liderazgo', 'Compromiso', 'Creatividad'] }),
    ).rejects.toMatchObject({ code: 'demasiadas_cualidades' });
    await expect(service.votar(ANA, BRUNO, { cualidades: ['Puntualidad'] })).rejects.toMatchObject({
      code: 'cualidad_invalida',
    });
    expect(store.votos).toHaveLength(0);
  });

  it('después del inicio del evento es 409 votos_cerrados', async () => {
    const { service } = montar(TRAS_EL_EVENTO);
    await expect(service.votar(ANA, BRUNO, { cualidades: ['Empatía'] })).rejects.toMatchObject({
      code: 'votos_cerrados',
      status: 409,
    });
  });
});

describe('resumen', () => {
  it('cuenta van, no van y sin responder entre los activos, con los menús de quienes van', async () => {
    const { store, service } = montar();
    await service.confirmar(ANA, { asiste: true, preferencia: 'vegetariano', mensaje: '¡Allá estaré!' });
    await service.confirmar(BRUNO, { asiste: false });
    // Diana está inactiva: su respuesta no cuenta.
    await store.guardarConfirmacion(EVENTO.id, DIANA, { asiste: true, preferencia: 'general', mensaje: null }, ANTES_DEL_CORTE);

    const resumen = await service.resumen();
    expect(resumen.totales).toEqual({ van: 1, noVan: 1, sinResponder: 1 });
    expect(resumen.porPreferencia).toEqual([
      { codigo: 'general', texto: 'Menú general (sin restricciones)', total: 0 },
      { codigo: 'vegetariano', texto: 'Opción vegetariana', total: 1 },
      { codigo: 'sin_gluten', texto: 'Sin gluten', total: 0 },
      { codigo: 'sin_mariscos', texto: 'Sin mariscos ni pescados', total: 0 },
    ]);
    expect(resumen.filas).toEqual([
      {
        userId: ANA,
        nombre: 'Ana Ruiz',
        estado: 'va',
        preferencia: 'vegetariano',
        mensaje: '¡Allá estaré!',
        actualizadoEn: ANTES_DEL_CORTE,
      },
      { userId: BRUNO, nombre: 'Bruno Díaz', estado: 'no_va', preferencia: null, mensaje: null, actualizadoEn: ANTES_DEL_CORTE },
      { userId: CARLA, nombre: 'Carla Gómez', estado: 'sin_responder', preferencia: null, mensaje: null, actualizadoEn: null },
    ]);
  });
});
```

- [ ] **Paso 3: comprueba que falla**

Run: `(cd apps/hub-api && npx vitest run src/celebracion/service.test.ts)`
Esperado: FALLA porque no existe `./service.js`.

- [ ] **Paso 4: escribe `service.ts`** (`apps/hub-api/src/celebracion/service.ts`)

```ts
import { CUALIDADES, EVENTO, MAX_CUALIDADES, PREFERENCIAS, type Preferencia } from './config.js';
import {
  CelebracionError,
  confirmacionesAbiertas,
  esUuid,
  parseConfirmacion,
  parseCualidades,
  top3,
  votosAbiertos,
  type CualidadVotada,
  type DatosConfirmacion,
} from './dominio.js';

export interface Miembro {
  userId: string;
  nombre: string;
  avatar: string | null;
}

export interface Confirmacion extends DatosConfirmacion {
  userId: string;
  actualizadoEn: Date;
}

export interface ConteoVotos {
  votadoId: string;
  cualidad: string;
  votos: number;
}

export interface VotoPropio {
  votadoId: string;
  cualidad: string;
}

/** Puerto del repositorio: lo implementan CelebracionRepository (SQL) y, en los tests, FakeStore. */
export interface CelebracionStore {
  /** Usuarios activos, ordenados por nombre. */
  listarEquipo(): Promise<Miembro[]>;
  esUsuarioActivo(userId: string): Promise<boolean>;
  /** Votos del evento por votado y cualidad. Solo cuentan los votantes activos. */
  contarVotos(evento: string): Promise<ConteoVotos[]>;
  votosDe(evento: string, votanteId: string): Promise<VotoPropio[]>;
  confirmacionDe(evento: string, userId: string): Promise<Confirmacion | null>;
  /** Todas las del evento, también las de cuentas inactivas (el servicio las filtra). */
  listarConfirmaciones(evento: string): Promise<Confirmacion[]>;
  /** Crea o reemplaza la respuesta de la persona. */
  guardarConfirmacion(evento: string, userId: string, datos: DatosConfirmacion, ahora: Date): Promise<void>;
  /** En una transacción: borra los votos de votante a votado y guarda los nuevos. */
  reemplazarVotos(evento: string, votanteId: string, votadoId: string, cualidades: string[], ahora: Date): Promise<void>;
}

export interface Sesion {
  userId: string;
  esAdmin: boolean;
}

export interface MiembroVista extends Miembro {
  cualidades: CualidadVotada[];
}

export interface Vista {
  evento: typeof EVENTO & {
    confirmacionesAbiertas: boolean;
    votosAbiertos: boolean;
    cualidades: readonly string[];
    preferencias: readonly Preferencia[];
    maxCualidades: number;
  };
  yo: string;
  esAdmin: boolean;
  equipo: MiembroVista[];
  miRespuesta: Omit<Confirmacion, 'userId'> | null;
  misVotos: Record<string, string[]>;
}

export interface MiEstado {
  respondido: boolean;
  confirmacionesAbiertas: boolean;
}

export type EstadoRespuesta = 'va' | 'no_va' | 'sin_responder';

export interface FilaResumen {
  userId: string;
  nombre: string;
  estado: EstadoRespuesta;
  preferencia: string | null;
  mensaje: string | null;
  actualizadoEn: Date | null;
}

export interface Resumen {
  totales: { van: number; noVan: number; sinResponder: number };
  porPreferencia: { codigo: string; texto: string; total: number }[];
  filas: FilaResumen[];
}

export interface CelebracionDeps {
  store: CelebracionStore;
  now: () => Date;
}

/** Casos de uso de la invitación. El reloj se inyecta: los cierres se prueban sin esperar a diciembre. */
export class CelebracionService {
  private readonly store: CelebracionStore;
  private readonly now: () => Date;

  constructor(deps: CelebracionDeps) {
    this.store = deps.store;
    this.now = deps.now;
  }

  async vista(sesion: Sesion): Promise<Vista> {
    const ahora = this.now();
    const [equipo, conteos, mios, confirmacion] = await Promise.all([
      this.store.listarEquipo(),
      this.store.contarVotos(EVENTO.id),
      this.store.votosDe(EVENTO.id, sesion.userId),
      this.store.confirmacionDe(EVENTO.id, sesion.userId),
    ]);

    const porVotado = new Map<string, CualidadVotada[]>();
    for (const c of conteos) {
      const lista = porVotado.get(c.votadoId) ?? [];
      lista.push({ cualidad: c.cualidad, votos: c.votos });
      porVotado.set(c.votadoId, lista);
    }

    const misVotos: Record<string, string[]> = {};
    for (const v of mios) {
      const lista = misVotos[v.votadoId] ?? [];
      lista.push(v.cualidad);
      misVotos[v.votadoId] = lista;
    }

    return {
      evento: {
        ...EVENTO,
        confirmacionesAbiertas: confirmacionesAbiertas(ahora),
        votosAbiertos: votosAbiertos(ahora),
        cualidades: CUALIDADES,
        preferencias: PREFERENCIAS,
        maxCualidades: MAX_CUALIDADES,
      },
      yo: sesion.userId,
      esAdmin: sesion.esAdmin,
      equipo: equipo.map((m) => ({ ...m, cualidades: top3(porVotado.get(m.userId) ?? []) })),
      miRespuesta: confirmacion
        ? {
            asiste: confirmacion.asiste,
            preferencia: confirmacion.preferencia,
            mensaje: confirmacion.mensaje,
            actualizadoEn: confirmacion.actualizadoEn,
          }
        : null,
      misVotos,
    };
  }

  async miEstado(userId: string): Promise<MiEstado> {
    const confirmacion = await this.store.confirmacionDe(EVENTO.id, userId);
    return { respondido: confirmacion !== null, confirmacionesAbiertas: confirmacionesAbiertas(this.now()) };
  }

  async confirmar(userId: string, body: unknown): Promise<void> {
    const ahora = this.now();
    if (!confirmacionesAbiertas(ahora)) throw new CelebracionError('confirmaciones_cerradas');
    await this.store.guardarConfirmacion(EVENTO.id, userId, parseConfirmacion(body), ahora);
  }

  /** Orden de las comprobaciones (decisión D3): cierre, UUID, voto propio, cualidades, compañero activo. */
  async votar(votanteId: string, votadoId: unknown, body: unknown): Promise<void> {
    const ahora = this.now();
    if (!votosAbiertos(ahora)) throw new CelebracionError('votos_cerrados');
    if (!esUuid(votadoId)) throw new CelebracionError('usuario_no_valido');
    const votado = votadoId.toLowerCase();
    if (votado === votanteId.toLowerCase()) throw new CelebracionError('voto_propio');
    const cualidades = parseCualidades(body);
    if (!(await this.store.esUsuarioActivo(votado))) throw new CelebracionError('usuario_no_valido');
    await this.store.reemplazarVotos(EVENTO.id, votanteId, votado, cualidades, ahora);
  }

  async resumen(): Promise<Resumen> {
    const [equipo, confirmaciones] = await Promise.all([
      this.store.listarEquipo(),
      this.store.listarConfirmaciones(EVENTO.id),
    ]);
    const porUsuario = new Map(confirmaciones.map((c) => [c.userId, c] as const));
    const filas = equipo.map((m): FilaResumen => {
      const c = porUsuario.get(m.userId);
      if (!c) {
        return { userId: m.userId, nombre: m.nombre, estado: 'sin_responder', preferencia: null, mensaje: null, actualizadoEn: null };
      }
      return {
        userId: m.userId,
        nombre: m.nombre,
        estado: c.asiste ? 'va' : 'no_va',
        preferencia: c.preferencia,
        mensaje: c.mensaje,
        actualizadoEn: c.actualizadoEn,
      };
    });
    const cuantos = (estado: EstadoRespuesta) => filas.filter((f) => f.estado === estado).length;
    return {
      totales: { van: cuantos('va'), noVan: cuantos('no_va'), sinResponder: cuantos('sin_responder') },
      porPreferencia: PREFERENCIAS.map((p) => ({
        codigo: p.codigo,
        texto: p.texto,
        total: filas.filter((f) => f.estado === 'va' && f.preferencia === p.codigo).length,
      })),
      filas,
    };
  }
}
```

- [ ] **Paso 5: comprueba que pasa**

Run: `(cd apps/hub-api && npx vitest run src/celebracion/service.test.ts src/celebracion/dominio.test.ts)`
Esperado: PASA todo.

- [ ] **Paso 6: commit**

```bash
git add apps/hub-api/src/celebracion/service.ts apps/hub-api/src/celebracion/test-fakes.ts apps/hub-api/src/celebracion/service.test.ts
git commit -m "feat(hub-api): servicio de la invitación de fin de año"
```

### Tarea 3: Merge A

- [ ] **Paso 1:** la suite de hub-api: `(cd apps/hub-api && npm test)`. Esperado: todo verde, salvo los errores conocidos de las convenciones.
- [ ] **Paso 2:** el build: `(cd apps/hub-api && npm run build)`. Esperado: sin errores.
- [ ] **Paso 3:** el tamaño: `git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'`. Esperado: unas 700 líneas.
- [ ] **Paso 4:** la comprobación de privacidad, en un comando aparte (ver «Cómo se mergea»). Esperado: ninguna línea.
- [ ] **Paso 5:** el merge, con el mensaje `merge: invitación de fin de año, reglas y servicio en hub-api` (ver «Cómo se mergea»).

---

## MERGE B — hub-api: BD, rutas y montaje

### Tarea 4: migración 081

**Ficheros:**
- Crear: `apps/hub-api/src/users/migrations/081_celebracion.sql`
- Cambiar: `apps/hub-api/src/db.ts` (lista `MIGRATIONS`)
- Cambiar: `apps/hub-api/src/ausencias/registrada-por.migracion.test.ts:15-16`
- Prueba: `apps/hub-api/src/celebracion/migracion.test.ts`

- [ ] **Paso 1: escribe la prueba que falla** (`apps/hub-api/src/celebracion/migracion.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
// Sin comentarios: lo que se comprueba es el SQL que se ejecuta.
const sql = () => leer('../users/migrations/081_celebracion.sql').replace(/--.*$/gm, '');

describe('migración 081 (invitación de fin de año)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 080, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'080_ausencias_registrada_por\.sql',\s*'081_celebracion\.sql'\];/);
  });

  it('es idempotente y no toca datos: solo CREATE ... IF NOT EXISTS', () => {
    const texto = sql();
    expect(texto).toMatch(/CREATE TABLE IF NOT EXISTS portal\.celebracion_confirmaciones/);
    expect(texto).toMatch(/CREATE TABLE IF NOT EXISTS portal\.celebracion_votos/);
    expect(texto).toMatch(/CREATE INDEX IF NOT EXISTS idx_celebracion_votos_votado/);
    expect(texto).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+portal\.|\bDELETE\s+FROM\b/i);
  });

  it('la BD impide votarse a uno mismo y que quien no va tenga preferencia', () => {
    const texto = sql();
    expect(texto).toMatch(/CONSTRAINT celebracion_votos_no_propio CHECK \(votante_id <> votado_id\)/);
    expect(texto).toMatch(/CHECK \(asiste OR preferencia IS NULL\)/);
  });

  it('el rol de las peticiones no borra confirmaciones ni edita votos (DATA-332)', () => {
    const texto = sql();
    expect(texto).toMatch(/REVOKE DELETE, TRUNCATE ON portal\.celebracion_confirmaciones FROM portal_app/);
    expect(texto).toMatch(/REVOKE UPDATE, TRUNCATE ON portal\.celebracion_votos FROM portal_app/);
  });
});
```

- [ ] **Paso 2: comprueba que falla**

Run: `(cd apps/hub-api && npx vitest run src/celebracion/migracion.test.ts)`
Esperado: FALLA (`ENOENT` del `.sql` y la 081 no está en `MIGRATIONS`).

- [ ] **Paso 3: escribe la migración** (`apps/hub-api/src/users/migrations/081_celebracion.sql`)

```sql
-- Migration 081: invitación al almuerzo de fin de año (spec
-- docs/superpowers/specs/2026-11-26-invitacion-fin-de-ano-design.md).
--
--   · celebracion_confirmaciones: una respuesta por persona y evento (sí/no, menú,
--     mensaje). hub-api la crea o la reemplaza con ON CONFLICT (evento, user_id).
--   · celebracion_votos: las cualidades que cada persona vota a cada compañero
--     (hasta 3, tope que pone el servicio porque la lista vive en su config).
--     Anónimo para los compañeros: la página nunca dice quién votó; la fila guarda
--     el votante solo para que nadie vote dos veces.
--   · ON DELETE CASCADE, como user_apps y terms_acceptances: borrar la cuenta
--     borra sus respuestas y sus votos (los dados y los recibidos).
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque. No siembra nada.

CREATE TABLE IF NOT EXISTS portal.celebracion_confirmaciones (
  evento          TEXT        NOT NULL,
  user_id         UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  asiste          BOOLEAN     NOT NULL,
  preferencia     TEXT        NULL,
  mensaje         TEXT        NULL CHECK (mensaje IS NULL OR char_length(mensaje) <= 200),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (evento, user_id),
  CHECK (asiste OR preferencia IS NULL)
);

CREATE TABLE IF NOT EXISTS portal.celebracion_votos (
  evento      TEXT        NOT NULL,
  votante_id  UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  votado_id   UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  cualidad    TEXT        NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (evento, votante_id, votado_id, cualidad),
  CONSTRAINT celebracion_votos_no_propio CHECK (votante_id <> votado_id)
);

-- El muro cuenta los votos de cada votado.
CREATE INDEX IF NOT EXISTS idx_celebracion_votos_votado ON portal.celebracion_votos (evento, votado_id);

-- DATA-332: la 068 re-concede SELECT, INSERT, UPDATE y DELETE sobre TODAS las
-- tablas del esquema en cada arranque y corre ANTES que esta; de ahí el GRANT y
-- luego el REVOKE (mismo patrón que la 079). Las respuestas se crean y se
-- reemplazan, nunca se borran; los votos se borran y se vuelven a insertar,
-- nunca se editan. No hay secuencias: las claves son compuestas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE ON portal.celebracion_confirmaciones TO portal_app;
    REVOKE DELETE, TRUNCATE ON portal.celebracion_confirmaciones FROM portal_app;
    GRANT SELECT, INSERT, DELETE ON portal.celebracion_votos TO portal_app;
    REVOKE UPDATE, TRUNCATE ON portal.celebracion_votos FROM portal_app;
  END IF;
END $$;
```

- [ ] **Paso 4: apunta la 081 en `db.ts`**

En `apps/hub-api/src/db.ts`, dentro de la línea de `const MIGRATIONS = [...]`, sustituye:

```ts
'080_ausencias_registrada_por.sql'];
```

por:

```ts
'080_ausencias_registrada_por.sql', '081_celebracion.sql'];
```

- [ ] **Paso 5: relaja el candado de la 080**

En `apps/hub-api/src/ausencias/registrada-por.migracion.test.ts`, sustituye:

```ts
  it('está apuntada en MIGRATIONS, detrás de la 079, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'079_terms_acceptances\.sql',\s*'080_ausencias_registrada_por\.sql'\];/);
```

por:

```ts
  it('está apuntada en MIGRATIONS, detrás de la 079', () => {
    expect(leer('../db.ts')).toMatch(/'079_terms_acceptances\.sql',\s*'080_ausencias_registrada_por\.sql'[,\]]/);
```

(Si la indentación o las comillas no casan, lee las líneas 14-17 con Read y conserva todo menos el título y el final de la expresión.)

- [ ] **Paso 6: comprueba que pasan las dos**

Run: `(cd apps/hub-api && npx vitest run src/celebracion/migracion.test.ts src/ausencias/registrada-por.migracion.test.ts)`
Esperado: PASA.

- [ ] **Paso 7: commit**

```bash
git add apps/hub-api/src/users/migrations/081_celebracion.sql apps/hub-api/src/db.ts apps/hub-api/src/celebracion/migracion.test.ts apps/hub-api/src/ausencias/registrada-por.migracion.test.ts
git commit -m "feat(hub-api): migración 081 con las tablas de la invitación"
```

### Tarea 5: repositorio SQL

**Ficheros:**
- Crear: `apps/hub-api/src/celebracion/repository.ts`
- Prueba: `apps/hub-api/src/celebracion/repository.db.test.ts`

- [ ] **Paso 1: enciende Docker** si no lo está: `docker desktop start`. Espera a que `docker info` responda.

- [ ] **Paso 2: escribe la prueba que falla** (`apps/hub-api/src/celebracion/repository.db.test.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { CelebracionRepository } from './repository.js';

// Repositorio contra Postgres de verdad (testcontainers, con todas las
// migraciones aplicadas). Vigila que el SQL haga lo mismo que FakeStore.

const DOMINIO = '@celebracion.test';
const EVENTO = 'evento-de-prueba';
const AHORA = new Date('2026-12-01T15:00:00Z');

let db: Pool;
let repo: CelebracionRepository;

beforeAll(() => {
  db = poolDePrueba();
  repo = new CelebracionRepository(db);
});

afterAll(async () => {
  await db.query('DELETE FROM portal.users WHERE email LIKE $1', ['%' + DOMINIO]);
  await db?.end();
});

beforeEach(async () => {
  // ON DELETE CASCADE se lleva sus respuestas y sus votos.
  await db.query('DELETE FROM portal.users WHERE email LIKE $1', ['%' + DOMINIO]);
});

async function usuario(nombre: string, status = 'active', avatar: string | null = null): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status, avatar)
     VALUES ($1, $2, 'x', 'reader', $3, $4) RETURNING id`,
    [nombre, nombre.toLowerCase().replace(/\s+/g, '.') + DOMINIO, status, avatar],
  );
  return (rows[0] as { id: string }).id;
}

describe('CelebracionRepository', () => {
  it('listarEquipo trae los activos con su avatar y deja fuera a los inactivos', async () => {
    const ana = await usuario('Ana Ruiz', 'active', 'data:image/jpeg;base64,AAAA');
    const diana = await usuario('Diana Prieto', 'inactive');
    const equipo = await repo.listarEquipo();
    expect(equipo).toContainEqual({ userId: ana, nombre: 'Ana Ruiz', avatar: 'data:image/jpeg;base64,AAAA' });
    expect(equipo.some((m) => m.userId === diana)).toBe(false);
    expect(await repo.esUsuarioActivo(ana)).toBe(true);
    expect(await repo.esUsuarioActivo(diana)).toBe(false);
  });

  it('guardarConfirmacion crea y luego reemplaza la respuesta', async () => {
    const ana = await usuario('Ana Ruiz');
    await repo.guardarConfirmacion(EVENTO, ana, { asiste: true, preferencia: 'general', mensaje: 'Hola' }, AHORA);
    const despues = new Date('2026-12-02T15:00:00Z');
    await repo.guardarConfirmacion(EVENTO, ana, { asiste: false, preferencia: null, mensaje: null }, despues);
    expect(await repo.confirmacionDe(EVENTO, ana)).toEqual({
      userId: ana,
      asiste: false,
      preferencia: null,
      mensaje: null,
      actualizadoEn: despues,
    });
    expect(await repo.listarConfirmaciones(EVENTO)).toHaveLength(1);
    expect(await repo.confirmacionDe('otro-evento', ana)).toBeNull();
  });

  it('la BD rechaza preferencia sin asistir y mensajes de más de 200', async () => {
    const ana = await usuario('Ana Ruiz');
    await expect(
      db.query(
        `INSERT INTO portal.celebracion_confirmaciones (evento, user_id, asiste, preferencia) VALUES ($1, $2, false, 'general')`,
        [EVENTO, ana],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query(`INSERT INTO portal.celebracion_confirmaciones (evento, user_id, asiste, mensaje) VALUES ($1, $2, false, $3)`, [
        EVENTO,
        ana,
        'a'.repeat(201),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('reemplazarVotos sustituye los votos de votante a votado y contarVotos los agrupa', async () => {
    const ana = await usuario('Ana Ruiz');
    const bruno = await usuario('Bruno Díaz');
    const carla = await usuario('Carla Gómez');
    await repo.reemplazarVotos(EVENTO, ana, bruno, ['Empatía', 'Liderazgo', 'Compromiso'], AHORA);
    await repo.reemplazarVotos(EVENTO, ana, bruno, ['Empatía'], AHORA);
    await repo.reemplazarVotos(EVENTO, carla, bruno, ['Empatía', 'Creatividad'], AHORA);
    expect(await repo.votosDe(EVENTO, ana)).toEqual([{ votadoId: bruno, cualidad: 'Empatía' }]);
    const conteos = (await repo.contarVotos(EVENTO)).filter((c) => c.votadoId === bruno);
    expect(conteos.sort((a, b) => a.cualidad.localeCompare(b.cualidad))).toEqual([
      { votadoId: bruno, cualidad: 'Creatividad', votos: 1 },
      { votadoId: bruno, cualidad: 'Empatía', votos: 2 },
    ]);
    await repo.reemplazarVotos(EVENTO, ana, bruno, [], AHORA);
    expect(await repo.votosDe(EVENTO, ana)).toEqual([]);
  });

  it('contarVotos no cuenta los votos de cuentas inactivas', async () => {
    const bruno = await usuario('Bruno Díaz');
    const diana = await usuario('Diana Prieto');
    await repo.reemplazarVotos(EVENTO, diana, bruno, ['Empatía'], AHORA);
    await db.query(`UPDATE portal.users SET status = 'inactive' WHERE id = $1`, [diana]);
    expect((await repo.contarVotos(EVENTO)).filter((c) => c.votadoId === bruno)).toEqual([]);
  });

  it('la BD impide votarse a uno mismo', async () => {
    const ana = await usuario('Ana Ruiz');
    await expect(repo.reemplazarVotos(EVENTO, ana, ana, ['Empatía'], AHORA)).rejects.toMatchObject({ code: '23514' });
  });

  it('borrar la cuenta borra sus respuestas y sus votos', async () => {
    const ana = await usuario('Ana Ruiz');
    const bruno = await usuario('Bruno Díaz');
    await repo.guardarConfirmacion(EVENTO, ana, { asiste: false, preferencia: null, mensaje: null }, AHORA);
    await repo.reemplazarVotos(EVENTO, ana, bruno, ['Empatía'], AHORA);
    await db.query('DELETE FROM portal.users WHERE id = $1', [ana]);
    expect(await repo.confirmacionDe(EVENTO, ana)).toBeNull();
    expect((await repo.contarVotos(EVENTO)).filter((c) => c.votadoId === bruno)).toEqual([]);
  });

  it('portal_app no borra confirmaciones ni edita votos', async () => {
    const { rows } = await db.query(
      `SELECT has_table_privilege('portal_app', 'portal.celebracion_confirmaciones', 'DELETE') AS borra,
              has_table_privilege('portal_app', 'portal.celebracion_confirmaciones', 'UPDATE') AS reemplaza,
              has_table_privilege('portal_app', 'portal.celebracion_votos', 'UPDATE') AS edita,
              has_table_privilege('portal_app', 'portal.celebracion_votos', 'DELETE') AS retira`,
    );
    expect(rows[0]).toEqual({ borra: false, reemplaza: true, edita: false, retira: true });
  });
});
```

- [ ] **Paso 3: comprueba que falla**

Run: `(cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/celebracion/repository.db.test.ts)`
Esperado: FALLA porque no existe `./repository.js`.

- [ ] **Paso 4: escribe `repository.ts`** (`apps/hub-api/src/celebracion/repository.ts`)

```ts
import type { Pool } from '@algarpibe/zoho-sync';
import type { DatosConfirmacion } from './dominio.js';
import type { CelebracionStore, Confirmacion, ConteoVotos, Miembro, VotoPropio } from './service.js';

// El tipo del cliente transaccional se deriva del Pool, como en
// users.repository.ts (los @types de 'pg' no están en este paquete).
type PoolClient = Awaited<ReturnType<Pool['connect']>>;

interface FilaConfirmacion {
  user_id: string;
  asiste: boolean;
  preferencia: string | null;
  mensaje: string | null;
  actualizado_en: Date | string;
}

function aConfirmacion(r: FilaConfirmacion): Confirmacion {
  return {
    userId: r.user_id,
    asiste: r.asiste,
    preferencia: r.preferencia,
    mensaje: r.mensaje,
    actualizadoEn: new Date(r.actualizado_en),
  };
}

const COLUMNAS_CONFIRMACION = 'user_id, asiste, preferencia, mensaje, actualizado_en';

/** SQL de la invitación. Parámetros posicionales siempre; la hora llega del servicio. */
export class CelebracionRepository implements CelebracionStore {
  constructor(private readonly pool: Pool) {}

  async listarEquipo(): Promise<Miembro[]> {
    const { rows } = await this.pool.query(
      `SELECT id, full_name, avatar FROM portal.users WHERE status = 'active' ORDER BY full_name, id`,
    );
    return (rows as { id: string; full_name: string; avatar: string | null }[]).map((r) => ({
      userId: r.id,
      nombre: r.full_name,
      avatar: r.avatar,
    }));
  }

  async esUsuarioActivo(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM portal.users WHERE id = $1 AND status = 'active'`, [userId]);
    return rows.length > 0;
  }

  async contarVotos(evento: string): Promise<ConteoVotos[]> {
    const { rows } = await this.pool.query(
      `SELECT v.votado_id, v.cualidad, count(*)::int AS votos
         FROM portal.celebracion_votos v
         JOIN portal.users u ON u.id = v.votante_id AND u.status = 'active'
        WHERE v.evento = $1
        GROUP BY v.votado_id, v.cualidad`,
      [evento],
    );
    return (rows as { votado_id: string; cualidad: string; votos: number }[]).map((r) => ({
      votadoId: r.votado_id,
      cualidad: r.cualidad,
      votos: r.votos,
    }));
  }

  async votosDe(evento: string, votanteId: string): Promise<VotoPropio[]> {
    const { rows } = await this.pool.query(
      `SELECT votado_id, cualidad FROM portal.celebracion_votos
        WHERE evento = $1 AND votante_id = $2
        ORDER BY votado_id, creado_en, cualidad`,
      [evento, votanteId],
    );
    return (rows as { votado_id: string; cualidad: string }[]).map((r) => ({ votadoId: r.votado_id, cualidad: r.cualidad }));
  }

  async confirmacionDe(evento: string, userId: string): Promise<Confirmacion | null> {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNAS_CONFIRMACION} FROM portal.celebracion_confirmaciones WHERE evento = $1 AND user_id = $2`,
      [evento, userId],
    );
    const fila = rows[0] as FilaConfirmacion | undefined;
    return fila ? aConfirmacion(fila) : null;
  }

  async listarConfirmaciones(evento: string): Promise<Confirmacion[]> {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNAS_CONFIRMACION} FROM portal.celebracion_confirmaciones WHERE evento = $1`,
      [evento],
    );
    return (rows as FilaConfirmacion[]).map(aConfirmacion);
  }

  async guardarConfirmacion(evento: string, userId: string, datos: DatosConfirmacion, ahora: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO portal.celebracion_confirmaciones (evento, user_id, asiste, preferencia, mensaje, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (evento, user_id) DO UPDATE
          SET asiste = EXCLUDED.asiste,
              preferencia = EXCLUDED.preferencia,
              mensaje = EXCLUDED.mensaje,
              actualizado_en = EXCLUDED.actualizado_en`,
      [evento, userId, datos.asiste, datos.preferencia, datos.mensaje, ahora],
    );
  }

  async reemplazarVotos(
    evento: string,
    votanteId: string,
    votadoId: string,
    cualidades: string[],
    ahora: Date,
  ): Promise<void> {
    await this.transaction(async (client) => {
      // Decisión D4: serializa los guardados de la misma persona. Dos a la vez
      // (doble clic) no pueden dejar más de 3 cualidades. Sin permisos especiales.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`celebracion:${evento}:${votanteId}`]);
      await client.query(
        `DELETE FROM portal.celebracion_votos WHERE evento = $1 AND votante_id = $2 AND votado_id = $3`,
        [evento, votanteId, votadoId],
      );
      if (cualidades.length > 0) {
        await client.query(
          `INSERT INTO portal.celebracion_votos (evento, votante_id, votado_id, cualidad, creado_en)
           SELECT $1::text, $2::uuid, $3::uuid, c, $5::timestamptz FROM unnest($4::text[]) AS c`,
          [evento, votanteId, votadoId, cualidades, ahora],
        );
      }
    });
  }

  /** BEGIN, el trabajo y COMMIT; un error hace ROLLBACK y se propaga. */
  private async transaction(fn: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
    } catch (err) {
      // Si el ROLLBACK también falla, no debe tapar el error original.
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
```

- [ ] **Paso 5: comprueba que pasa**

Run: `(cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/celebracion/repository.db.test.ts)`
Esperado: PASA (8 pruebas). Si la de privilegios falla porque `portal_app` no existe en el contenedor, lee `src/db.roles.db.test.ts` para ver cómo la comprueba ese fichero y copia su guarda. No borres la prueba.

- [ ] **Paso 6: commit**

```bash
git add apps/hub-api/src/celebracion/repository.ts apps/hub-api/src/celebracion/repository.db.test.ts
git commit -m "feat(hub-api): repositorio de la invitación de fin de año"
```

### Tarea 6: router y montaje

**Ficheros:**
- Crear: `apps/hub-api/src/celebracion/router.ts`
- Cambiar: `apps/hub-api/src/index.ts` (imports y montaje)
- Prueba: `apps/hub-api/src/celebracion/router.test.ts`

- [ ] **Paso 1: escribe la prueba que falla** (`apps/hub-api/src/celebracion/router.test.ts`)

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { captureError } from '../sentry.js';
import { CelebracionError } from './dominio.js';
import type { CelebracionActions } from './router.js';

// requireAuth lee JWT_SECRET al cargar auth.ts: se fija antes del import dinámico.
const SECRET = 'test-secret-celebracion';
process.env.JWT_SECRET = SECRET;

// requireAuth consulta la fila del usuario (rol, estado, token_version) con
// params[0] = user_id; aquí el rol sale de este mapa.
const roles = vi.hoisted(() => new Map<string, string>());
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => ({
      rows: [{ role: roles.get(String(params[0] ?? '')) ?? 'reader', status: 'active', apps: [], token_version: 0 }],
      rowCount: 1,
    }),
    on: () => {},
  }),
}));
vi.mock('../sentry.js', () => ({ captureError: vi.fn() }));

const { createCelebracionRouter } = await import('./router.js');

const ANA = '00000000-0000-4000-8000-00000000000a';
const BRUNO = '00000000-0000-4000-8000-00000000000b';
const ADMIN = '00000000-0000-4000-8000-0000000000ad';

function cabecera(userId: string, role = 'reader') {
  roles.set(userId, role);
  const token = jwt.sign({ sub: `${userId}@example.com`, user_id: userId, role, apps: [], token_version: 0 }, SECRET);
  return { Authorization: `Bearer ${token}` };
}

function stub(parcial: Partial<CelebracionActions> = {}): CelebracionActions {
  return {
    vista: vi.fn(async () => ({ hola: 'vista' }) as never),
    miEstado: vi.fn(async () => ({ respondido: false, confirmacionesAbiertas: true })),
    confirmar: vi.fn(async () => {}),
    votar: vi.fn(async () => {}),
    resumen: vi.fn(async () => ({ hola: 'resumen' }) as never),
    ...parcial,
  };
}

function montar(service: CelebracionActions) {
  const app = express();
  app.use(express.json());
  app.use('/api', createCelebracionRouter(service));
  return app;
}

const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');

afterEach(() => {
  vi.mocked(captureError).mockClear();
  roles.clear();
});

describe('router de la invitación', () => {
  it('sin sesión es 401', async () => {
    const res = await request(montar(stub())).get('/api/celebracion');
    expect(res.status).toBe(401);
  });

  it('GET /celebracion pasa quién soy y si soy admin', async () => {
    const service = stub();
    const res = await request(montar(service)).get('/api/celebracion').set(cabecera(ADMIN, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hola: 'vista' });
    expect(service.vista).toHaveBeenCalledWith({ userId: ADMIN, esAdmin: true });
  });

  it('GET /celebracion/mi-estado responde el estado de la persona', async () => {
    const service = stub();
    const res = await request(montar(service)).get('/api/celebracion/mi-estado').set(cabecera(ANA));
    expect(res.body).toEqual({ respondido: false, confirmacionesAbiertas: true });
    expect(service.miEstado).toHaveBeenCalledWith(ANA);
  });

  it('PUT /celebracion/confirmacion pasa el cuerpo tal cual', async () => {
    const service = stub();
    const res = await request(montar(service))
      .put('/api/celebracion/confirmacion')
      .set(cabecera(ANA))
      .send({ asiste: true, preferencia: 'general' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'confirmacion_guardada' });
    expect(service.confirmar).toHaveBeenCalledWith(ANA, { asiste: true, preferencia: 'general' });
  });

  it('PUT /celebracion/votos/:userId pasa votante, votado y cuerpo', async () => {
    const service = stub();
    const res = await request(montar(service))
      .put(`/api/celebracion/votos/${BRUNO}`)
      .set(cabecera(ANA))
      .send({ cualidades: ['Empatía'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'votos_guardados' });
    expect(service.votar).toHaveBeenCalledWith(ANA, BRUNO, { cualidades: ['Empatía'] });
  });

  it('un CelebracionError sale con su código: 400 o 409, nunca 401', async () => {
    const service = stub({
      votar: vi.fn(async () => {
        throw new CelebracionError('voto_propio');
      }),
      confirmar: vi.fn(async () => {
        throw new CelebracionError('confirmaciones_cerradas');
      }),
    });
    const app = montar(service);
    const voto = await request(app).put(`/api/celebracion/votos/${ANA}`).set(cabecera(ANA)).send({ cualidades: [] });
    expect(voto.status).toBe(400);
    expect(voto.body).toEqual({ error: 'voto_propio' });
    const conf = await request(app).put('/api/celebracion/confirmacion').set(cabecera(ANA)).send({ asiste: false });
    expect(conf.status).toBe(409);
    expect(conf.body).toEqual({ error: 'confirmaciones_cerradas' });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('cualquier otro error es 500 genérico y va a Sentry', async () => {
    const service = stub({
      vista: vi.fn(async () => {
        throw new Error('la BD se cayó');
      }),
    });
    const res = await request(montar(service)).get('/api/celebracion').set(cabecera(ANA));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { endpoint: 'celebracion_vista' });
  });

  it('GET /celebracion/resumen es solo para admin', async () => {
    const service = stub();
    const app = montar(service);
    expect((await request(app).get('/api/celebracion/resumen').set(cabecera(ANA))).status).toBe(403);
    expect(service.resumen).not.toHaveBeenCalled();
    const res = await request(app).get('/api/celebracion/resumen').set(cabecera(ADMIN, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hola: 'resumen' });
  });

  it('index.ts lo monta en /api con el servicio y el repositorio reales', () => {
    expect(leer('../index.ts')).toMatch(
      /app\.use\('\/api', createCelebracionRouter\(new CelebracionService\(\{\s*store: new CelebracionRepository\(getHubPool\(\)\),/,
    );
  });
});
```

- [ ] **Paso 2: comprueba que falla**

Run: `(cd apps/hub-api && npx vitest run src/celebracion/router.test.ts)`
Esperado: FALLA porque no existe `./router.js`.

- [ ] **Paso 3: escribe `router.ts`** (`apps/hub-api/src/celebracion/router.ts`)

```ts
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { CelebracionError } from './dominio.js';
import type { CelebracionService, Sesion } from './service.js';

// Rutas de la invitación de fin de año, montadas bajo /api (ver index.ts).
// Abiertas a cualquier usuario activo: basta requireAuth, sin app asignada.
// El resumen, además, exige admin.

/** Lo que el router necesita del servicio (los tests le pasan un stub). */
export type CelebracionActions = Pick<CelebracionService, 'vista' | 'miEstado' | 'confirmar' | 'votar' | 'resumen'>;

function sesionDe(req: Request): Sesion | null {
  const p = getPayload(req);
  return p?.user_id ? { userId: String(p.user_id), esAdmin: p.role === 'admin' } : null;
}

/** CelebracionError → su 400/409 con el código; cualquier otro error → 500 genérico y Sentry. */
function sendError(res: Response, e: unknown, ctx: string): void {
  if (e instanceof CelebracionError) {
    res.status(e.status).json({ error: e.code });
    return;
  }
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

/** Lee la sesión (requireAuth ya la validó), ejecuta el caso de uso y responde su resultado en JSON. */
function ruta(ctx: string, fn: (sesion: Sesion, req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response): Promise<void> => {
    const sesion = sesionDe(req);
    if (!sesion) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      res.json(await fn(sesion, req));
    } catch (e) {
      sendError(res, e, ctx);
    }
  };
}

export function createCelebracionRouter(service: CelebracionActions): Router {
  const router = Router();

  router.get('/celebracion', requireAuth, ruta('celebracion_vista', (s) => service.vista(s)));

  router.get('/celebracion/mi-estado', requireAuth, ruta('celebracion_mi_estado', (s) => service.miEstado(s.userId)));

  router.put(
    '/celebracion/confirmacion',
    requireAuth,
    ruta('celebracion_confirmar', async (s, req) => {
      await service.confirmar(s.userId, req.body);
      return { message: 'confirmacion_guardada' };
    }),
  );

  router.put(
    '/celebracion/votos/:userId',
    requireAuth,
    ruta('celebracion_votar', async (s, req) => {
      await service.votar(s.userId, req.params.userId, req.body);
      return { message: 'votos_guardados' };
    }),
  );

  router.get('/celebracion/resumen', requireAuth, requireAdmin, ruta('celebracion_resumen', () => service.resumen()));

  return router;
}
```

- [ ] **Paso 4: móntalo en `index.ts`**

En `apps/hub-api/src/index.ts`, detrás de la línea:

```ts
import { createAusenciasRouter } from './ausencias/router.js';
```

añade:

```ts
import { createCelebracionRouter } from './celebracion/router.js';
import { CelebracionService } from './celebracion/service.js';
import { CelebracionRepository } from './celebracion/repository.js';
```

Y detrás de la línea:

```ts
    app.use('/api', createAusenciasRouter(getHubPool()));
```

añade:

```ts
    // Invitación al almuerzo de fin de año: cualquier usuario activo, sin app asignada.
    app.use('/api', createCelebracionRouter(new CelebracionService({
      store: new CelebracionRepository(getHubPool()),
      now: () => new Date(),
    })));
```

No lo pongas entre el router de usuarios y el de restablecer la contraseña: `password-reset.router.test.ts:244-250` lo prohíbe.

- [ ] **Paso 5: comprueba que pasa**

Run: `(cd apps/hub-api && npx vitest run src/celebracion/router.test.ts src/users/password-reset/password-reset.router.test.ts)`
Esperado: PASA.

- [ ] **Paso 6: commit**

```bash
git add apps/hub-api/src/celebracion/router.ts apps/hub-api/src/celebracion/router.test.ts apps/hub-api/src/index.ts
git commit -m "feat(hub-api): rutas /api/celebracion de la invitación de fin de año"
```

### Tarea 7: Merge B

- [ ] **Paso 1:** la suite: `(cd apps/hub-api && npm test)`. Esperado: verde.
- [ ] **Paso 2:** la suite de BD entera (Docker encendido): `(cd apps/hub-api && npm run test:db)`. Esperado: verde. Comprueba que `aplicarMigraciones` aplica la 081 en el contenedor sin error.
- [ ] **Paso 3:** el build: `(cd apps/hub-api && npm run build)`. Esperado: sin errores.
- [ ] **Paso 4:** el tamaño (`git diff --shortstat ...`): unas 600 líneas más desde el merge A.
- [ ] **Paso 5:** la comprobación de privacidad, en un comando aparte. Esperado: ninguna línea.
- [ ] **Paso 6:** el merge, con el mensaje `merge: invitación de fin de año, migración 081 y rutas en hub-api`.

---

## MERGE C1 — portal: base y utilidades

### Tarea 8: ruta, tipos y API

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/ruta.ts`
- Crear: `apps/portal/src/pages/celebracion/tipos.ts`
- Crear: `apps/portal/src/pages/celebracion/api.ts`
- Prueba: `apps/portal/src/pages/celebracion/api.test.ts`

- [ ] **Paso 1: escribe `ruta.ts` y `tipos.ts`** (sin lógica: solo una constante y tipos)

`apps/portal/src/pages/celebracion/ruta.ts`:

```ts
/** Ruta de la invitación: es la del mensaje de WhatsApp, no la cambies sin cambiar el mensaje. */
export const RUTA_CELEBRACION = '/celebracion-navidad-2026';
```

`apps/portal/src/pages/celebracion/tipos.ts`:

```ts
// Lo que devuelve hub-api (apps/hub-api/src/celebracion/service.ts). Las fechas
// llegan como texto ISO.

/** Largo máximo del mensaje (hub-api y la BD aplican el mismo). */
export const MENSAJE_MAX = 200;

export interface Preferencia {
  codigo: string;
  texto: string;
}

export interface Evento {
  id: string;
  titulo: string;
  inicio: string;
  fin: string;
  lugar: string;
  direccion: string;
  vestimenta: string;
  cierreConfirmaciones: string;
  confirmacionesAbiertas: boolean;
  votosAbiertos: boolean;
  cualidades: string[];
  preferencias: Preferencia[];
  maxCualidades: number;
}

export interface CualidadVotada {
  cualidad: string;
  votos: number;
}

export interface Miembro {
  userId: string;
  nombre: string;
  avatar: string | null;
  cualidades: CualidadVotada[];
}

export interface Respuesta {
  asiste: boolean;
  preferencia: string | null;
  mensaje: string | null;
  actualizadoEn: string;
}

export interface Vista {
  evento: Evento;
  yo: string;
  esAdmin: boolean;
  equipo: Miembro[];
  miRespuesta: Respuesta | null;
  misVotos: Record<string, string[]>;
}

export interface MiEstado {
  respondido: boolean;
  confirmacionesAbiertas: boolean;
}

export interface DatosConfirmacion {
  asiste: boolean;
  preferencia: string | null;
  mensaje: string | null;
}

export type EstadoRespuesta = 'va' | 'no_va' | 'sin_responder';

export interface FilaResumen {
  userId: string;
  nombre: string;
  estado: EstadoRespuesta;
  preferencia: string | null;
  mensaje: string | null;
  actualizadoEn: string | null;
}

export interface Resumen {
  totales: { van: number; noVan: number; sinResponder: number };
  porPreferencia: (Preferencia & { total: number })[];
  filas: FilaResumen[];
}
```

- [ ] **Paso 2: escribe la prueba que falla** (`apps/portal/src/pages/celebracion/api.test.ts`)

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { authFetch } from '../../lib/api';
import {
  cargarMiEstado,
  cargarResumen,
  cargarVista,
  ErrorApi,
  guardarConfirmacion,
  guardarVotos,
  mensajeDeError,
  subirMiFoto,
} from './api';

vi.mock('../../lib/api', () => ({ authFetch: vi.fn() }));
const mockFetch = vi.mocked(authFetch);

function respuesta(status: number, cuerpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo } as unknown as Response;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('api de la invitación', () => {
  it('las lecturas piden su ruta y devuelven el cuerpo', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { yo: 'u1' }));
    await expect(cargarVista()).resolves.toEqual({ yo: 'u1' });
    await cargarMiEstado();
    await cargarResumen();
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      '/api/celebracion',
      '/api/celebracion/mi-estado',
      '/api/celebracion/resumen',
    ]);
  });

  it('guardarConfirmacion manda un PUT con los datos', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { message: 'confirmacion_guardada' }));
    await guardarConfirmacion({ asiste: true, preferencia: 'general', mensaje: null });
    expect(mockFetch).toHaveBeenCalledWith('/api/celebracion/confirmacion', {
      method: 'PUT',
      body: JSON.stringify({ asiste: true, preferencia: 'general', mensaje: null }),
    });
  });

  it('guardarVotos manda las cualidades al compañero', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { message: 'votos_guardados' }));
    await guardarVotos('u-2', ['Empatía']);
    expect(mockFetch).toHaveBeenCalledWith('/api/celebracion/votos/u-2', {
      method: 'PUT',
      body: JSON.stringify({ cualidades: ['Empatía'] }),
    });
  });

  it('subirMiFoto usa el endpoint de avatar de siempre', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { message: 'avatar_updated' }));
    await subirMiFoto('data:image/jpeg;base64,AAAA');
    expect(mockFetch).toHaveBeenCalledWith('/api/users/me/avatar', {
      method: 'PATCH',
      body: JSON.stringify({ avatar: 'data:image/jpeg;base64,AAAA' }),
    });
  });

  it('un error del servidor sale como ErrorApi con su código y su estado', async () => {
    mockFetch.mockResolvedValue(respuesta(409, { error: 'confirmaciones_cerradas' }));
    await expect(guardarConfirmacion({ asiste: false, preferencia: null, mensaje: null })).rejects.toMatchObject({
      codigo: 'confirmaciones_cerradas',
      status: 409,
    });
  });

  it('una respuesta sin JSON también es ErrorApi', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('html');
      },
    } as unknown as Response);
    await expect(cargarVista()).rejects.toBeInstanceOf(ErrorApi);
  });

  it('mensajeDeError traduce los códigos y usa el genérico para lo demás', () => {
    expect(mensajeDeError(new ErrorApi('voto_propio', 400))).toBe('No puedes brindar por ti mismo.');
    expect(mensajeDeError(new ErrorApi('confirmaciones_cerradas', 409))).toBe('Las confirmaciones ya están cerradas.');
    expect(mensajeDeError(new ErrorApi('raro', 500))).toBe('No se pudo guardar. Vuelve a intentarlo.');
    expect(mensajeDeError(new Error('red'))).toBe('No se pudo guardar. Vuelve a intentarlo.');
  });
});
```

- [ ] **Paso 3: comprueba que falla**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/api.test.ts)`
Esperado: FALLA porque no existe `./api`.

- [ ] **Paso 4: escribe `api.ts`** (`apps/portal/src/pages/celebracion/api.ts`)

```ts
import { authFetch } from '../../lib/api';
import type { DatosConfirmacion, MiEstado, Resumen, Vista } from './tipos';

/** Error de la API con el código que manda hub-api (`{ error: '<codigo>' }`). */
export class ErrorApi extends Error {
  readonly codigo: string;
  readonly status: number;

  constructor(codigo: string, status: number) {
    super(codigo);
    this.name = 'ErrorApi';
    this.codigo = codigo;
    this.status = status;
  }
}

async function leer<T>(res: Response): Promise<T> {
  const cuerpo = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const codigo = (cuerpo as { error?: unknown } | null)?.error;
    throw new ErrorApi(typeof codigo === 'string' ? codigo : 'error', res.status);
  }
  return cuerpo as T;
}

const BASE = '/api/celebracion';

export async function cargarVista(): Promise<Vista> {
  return leer<Vista>(await authFetch(BASE));
}

export async function cargarMiEstado(): Promise<MiEstado> {
  return leer<MiEstado>(await authFetch(`${BASE}/mi-estado`));
}

export async function cargarResumen(): Promise<Resumen> {
  return leer<Resumen>(await authFetch(`${BASE}/resumen`));
}

export async function guardarConfirmacion(datos: DatosConfirmacion): Promise<void> {
  await leer(await authFetch(`${BASE}/confirmacion`, { method: 'PUT', body: JSON.stringify(datos) }));
}

export async function guardarVotos(userId: string, cualidades: string[]): Promise<void> {
  await leer(
    await authFetch(`${BASE}/votos/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ cualidades }),
    }),
  );
}

/** La foto propia: el mismo endpoint que Configuración (solo cambia la de quien llama). */
export async function subirMiFoto(dataUrl: string): Promise<void> {
  await leer(await authFetch('/api/users/me/avatar', { method: 'PATCH', body: JSON.stringify({ avatar: dataUrl }) }));
}

const MENSAJES: Record<string, string> = {
  confirmaciones_cerradas: 'Las confirmaciones ya están cerradas.',
  votos_cerrados: 'La votación ya se cerró.',
  asiste_invalido: 'Indica si vas o no.',
  preferencia_invalida: 'Elige una preferencia de menú.',
  mensaje_invalido: 'El mensaje no puede pasar de 200 caracteres ni llevar saltos de línea.',
  cualidad_invalida: 'Alguna cualidad no es válida. Recarga la página.',
  demasiadas_cualidades: 'Puedes elegir como mucho 3 cualidades.',
  voto_propio: 'No puedes brindar por ti mismo.',
  usuario_no_valido: 'Esa persona ya no está en el equipo. Recarga la página.',
};

const GENERICO = 'No se pudo guardar. Vuelve a intentarlo.';

/** Texto para el aviso de un error al guardar. */
export function mensajeDeError(e: unknown): string {
  return e instanceof ErrorApi ? (MENSAJES[e.codigo] ?? GENERICO) : GENERICO;
}
```

- [ ] **Paso 5: comprueba que pasa**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/api.test.ts)`
Esperado: PASA (7 pruebas).

- [ ] **Paso 6: commit**

```bash
git add apps/portal/src/pages/celebracion/ruta.ts apps/portal/src/pages/celebracion/tipos.ts apps/portal/src/pages/celebracion/api.ts apps/portal/src/pages/celebracion/api.test.ts
git commit -m "feat(portal): tipos y llamadas de la invitación de fin de año"
```

### Tarea 9: fechas, enlaces y persona

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/fechas.ts`, `enlaces.ts`, `marca.ts`, `persona.ts`
- Prueba: `apps/portal/src/pages/celebracion/fechas.test.ts`, `enlaces.test.ts`, `persona.test.ts`

- [ ] **Paso 1: escribe las pruebas que fallan**

`apps/portal/src/pages/celebracion/fechas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cuentaAtras, diaYMes, fechaHoraCorta, fechaLarga, hora } from './fechas';

describe('fechas de la invitación (hora de Bogotá)', () => {
  it('cuentaAtras reparte los segundos que faltan y no baja de cero', () => {
    const objetivo = new Date('2026-12-18T17:30:00Z');
    expect(cuentaAtras(objetivo, new Date('2026-12-17T16:29:58Z'))).toEqual({ dias: 1, horas: 1, minutos: 0, segundos: 2 });
    expect(cuentaAtras(objetivo, new Date('2026-12-19T00:00:00Z'))).toEqual({ dias: 0, horas: 0, minutos: 0, segundos: 0 });
  });

  it('fechaLarga empieza en mayúscula', () => {
    expect(fechaLarga('2026-12-18T12:30:00-05:00')).toBe('Viernes, 18 de diciembre de 2026');
  });

  it('hora y diaYMes', () => {
    expect(hora('2026-12-18T12:30:00-05:00')).toMatch(/^12:30\sp\.\s?m\.$/u);
    expect(diaYMes('2026-12-04T23:59:59-05:00')).toBe('4 de diciembre');
  });

  it('fechaHoraCorta da AAAA-MM-DD HH:MM en Bogotá', () => {
    expect(fechaHoraCorta('2026-12-01T15:00:00.000Z')).toBe('2026-12-01 10:00');
  });
});
```

`apps/portal/src/pages/celebracion/enlaces.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { contenidoIcs, fechaIcs, nombreFicheroIcs, urlGoogleCalendar, urlGoogleMaps, urlWaze } from './enlaces';
import { eventoDePrueba } from './fixtures';

describe('enlaces del evento', () => {
  const evento = eventoDePrueba();

  it('fechaIcs pasa a UTC en formato básico', () => {
    expect(fechaIcs('2026-12-18T12:30:00-05:00')).toBe('20261218T173000Z');
  });

  it('Maps y Waze llevan la dirección codificada', () => {
    expect(urlGoogleMaps(evento)).toBe(
      'https://www.google.com/maps/search/?api=1&query=Restaurante%20Anfitriona%2C%20Cl.%2083%20Bis%20%2324-09%2C%20Bogot%C3%A1%20D.C.',
    );
    expect(urlWaze(evento)).toBe('https://waze.com/ul?q=Cl.%2083%20Bis%20%2324-09%2C%20Bogot%C3%A1%20D.C.&navigate=yes');
  });

  it('Google Calendar lleva el título, las horas y el lugar', () => {
    const url = new URL(urlGoogleCalendar(evento));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Almuerzo de fin de año 2026');
    expect(url.searchParams.get('dates')).toBe('20261218T173000Z/20261218T210000Z');
    expect(url.searchParams.get('location')).toBe('Restaurante Anfitriona, Cl. 83 Bis #24-09, Bogotá D.C.');
  });

  it('el .ics es válido: CRLF, UTC y comas escapadas', () => {
    const ics = contenidoIcs(evento, new Date('2026-11-27T10:00:00Z'));
    const lineas = ics.split('\r\n');
    expect(lineas[0]).toBe('BEGIN:VCALENDAR');
    expect(lineas).toContain('DTSTART:20261218T173000Z');
    expect(lineas).toContain('DTEND:20261218T210000Z');
    expect(lineas).toContain('DTSTAMP:20261127T100000Z');
    expect(lineas).toContain('UID:fin-de-ano-2026@portal.ambientalia.cloud');
    expect(lineas).toContain('LOCATION:Restaurante Anfitriona\\, Cl. 83 Bis #24-09\\, Bogotá D.C.');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(nombreFicheroIcs(evento)).toBe('fin-de-ano-2026.ics');
  });
});
```

`apps/portal/src/pages/celebracion/persona.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { COLORES_AVATAR } from './marca';
import { colorDe, iniciales, primerNombre } from './persona';

describe('persona', () => {
  it('iniciales: 1.ª palabra y 2.ª (o 3.ª si hay cuatro o más), sin partículas', () => {
    expect(iniciales('Ana Ruiz')).toBe('AR');
    expect(iniciales('YENNY MARCELA NOREÑA VARGAS')).toBe('YN');
    expect(iniciales('maría de la paz gómez')).toBe('MP');
    expect(iniciales('Bruno')).toBe('B');
    expect(iniciales('   ')).toBe('?');
  });

  it('primerNombre en formato de nombre propio', () => {
    expect(primerNombre('BRUNO DÍAZ')).toBe('Bruno');
    expect(primerNombre('ñandú pérez')).toBe('Ñandú');
  });

  it('colorDe es estable y sale de la paleta de avatares', () => {
    const id = '00000000-0000-4000-8000-00000000000a';
    expect(colorDe(id)).toBe(colorDe(id));
    expect(COLORES_AVATAR).toContain(colorDe(id));
  });
});
```

`enlaces.test.ts` usa `./fixtures`. Escríbelo ya: `apps/portal/src/pages/celebracion/fixtures.ts` (datos ficticios para las pruebas; no lo importa la página):

```ts
import type { Evento, Vista } from './tipos';

// Datos ficticios para las pruebas de la invitación (el repo es público).

export const YO = '00000000-0000-4000-8000-00000000000a';
export const BRUNO = '00000000-0000-4000-8000-00000000000b';
export const CARLA = '00000000-0000-4000-8000-00000000000c';

export function eventoDePrueba(cambios: Partial<Evento> = {}): Evento {
  return {
    id: 'fin-de-ano-2026',
    titulo: 'Almuerzo de fin de año 2026',
    inicio: '2026-12-18T12:30:00-05:00',
    fin: '2026-12-18T16:00:00-05:00',
    lugar: 'Restaurante Anfitriona',
    direccion: 'Cl. 83 Bis #24-09, Bogotá D.C.',
    vestimenta: 'Smart casual',
    cierreConfirmaciones: '2026-12-04T23:59:59-05:00',
    confirmacionesAbiertas: true,
    votosAbiertos: true,
    cualidades: ['Liderazgo', 'Empatía', 'Compromiso', 'Creatividad', 'Trabajo en equipo'],
    preferencias: [
      { codigo: 'general', texto: 'Menú general (sin restricciones)' },
      { codigo: 'vegetariano', texto: 'Opción vegetariana' },
    ],
    maxCualidades: 3,
    ...cambios,
  };
}

export function vistaDePrueba(cambios: Partial<Vista> = {}): Vista {
  return {
    evento: eventoDePrueba(),
    yo: YO,
    esAdmin: false,
    equipo: [
      { userId: YO, nombre: 'Ana Ruiz', avatar: null, cualidades: [] },
      {
        userId: BRUNO,
        nombre: 'Bruno Díaz',
        avatar: null,
        cualidades: [
          { cualidad: 'Empatía', votos: 4 },
          { cualidad: 'Liderazgo', votos: 2 },
        ],
      },
      { userId: CARLA, nombre: 'Carla Gómez', avatar: null, cualidades: [] },
    ],
    miRespuesta: null,
    misVotos: {},
    ...cambios,
  };
}
```

- [ ] **Paso 2: comprueba que fallan**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/fechas.test.ts src/pages/celebracion/enlaces.test.ts src/pages/celebracion/persona.test.ts)`
Esperado: FALLAN porque no existen `./fechas`, `./enlaces`, `./marca` ni `./persona`.

- [ ] **Paso 3: escribe los cuatro módulos**

`apps/portal/src/pages/celebracion/fechas.ts`:

```ts
// Fechas de la invitación, siempre en hora de Bogotá (el evento es allí y el
// navegador puede estar en otra zona).

const ZONA = 'America/Bogota';

export interface Cuenta {
  dias: number;
  horas: number;
  minutos: number;
  segundos: number;
}

export function cuentaAtras(objetivo: Date, ahora: Date): Cuenta {
  const total = Math.max(0, Math.floor((objetivo.getTime() - ahora.getTime()) / 1000));
  return {
    dias: Math.floor(total / 86_400),
    horas: Math.floor(total / 3_600) % 24,
    minutos: Math.floor(total / 60) % 60,
    segundos: total % 60,
  };
}

const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** «Viernes, 18 de diciembre de 2026». */
export function fechaLarga(iso: string): string {
  return conMayuscula(
    new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONA }).format(
      new Date(iso),
    ),
  );
}

/** «12:30 p. m.». */
export function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: ZONA }).format(new Date(iso));
}

/** «4 de diciembre». */
export function diaYMes(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: ZONA }).format(new Date(iso));
}

/** «2026-12-01 10:00» (el formato sueco da justo AAAA-MM-DD HH:MM). */
export function fechaHoraCorta(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONA,
  }).format(new Date(iso));
}
```

`apps/portal/src/pages/celebracion/enlaces.ts`:

```ts
import type { Evento } from './tipos';

type Lugar = Pick<Evento, 'lugar' | 'direccion'>;

export function urlGoogleMaps(e: Lugar): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.lugar}, ${e.direccion}`)}`;
}

export function urlWaze(e: Lugar): string {
  return `https://waze.com/ul?q=${encodeURIComponent(e.direccion)}&navigate=yes`;
}

/** 2026-12-18T12:30:00-05:00 → 20261218T173000Z (UTC, formato básico de iCalendar). */
export function fechaIcs(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function urlGoogleCalendar(e: Evento): string {
  const parametros = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.titulo,
    dates: `${fechaIcs(e.inicio)}/${fechaIcs(e.fin)}`,
    details: `${e.titulo} del equipo Ambientalia.`,
    location: `${e.lugar}, ${e.direccion}`,
  });
  return `https://calendar.google.com/calendar/render?${parametros.toString()}`;
}

/** RFC 5545: barra invertida, punto y coma, coma y salto de línea se escapan. */
function escaparIcs(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function contenidoIcs(e: Evento, ahora: Date): string {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Ambientalia//Portal//ES',
      'BEGIN:VEVENT',
      `UID:${e.id}@portal.ambientalia.cloud`,
      `DTSTAMP:${fechaIcs(ahora.toISOString())}`,
      `DTSTART:${fechaIcs(e.inicio)}`,
      `DTEND:${fechaIcs(e.fin)}`,
      `SUMMARY:${escaparIcs(e.titulo)}`,
      `LOCATION:${escaparIcs(`${e.lugar}, ${e.direccion}`)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}

export function nombreFicheroIcs(e: Pick<Evento, 'id'>): string {
  return `${e.id}.ics`;
}
```

`apps/portal/src/pages/celebracion/marca.ts`:

```ts
// Colores de la marca Ambientalia (los del logo) y tipografías de la invitación.

export const COLORES = ['#D81B60', '#F47920', '#FDB913', '#8DC63F', '#008556', '#006699', '#3F3D99'] as const;

/** Los de buen contraste con texto blanco (sin el amarillo ni el lima). */
export const COLORES_AVATAR = ['#D81B60', '#F47920', '#008556', '#006699', '#3F3D99'] as const;

export const ESPECTRO =
  'linear-gradient(90deg, #D81B60 0%, #F47920 18%, #FDB913 36%, #8DC63F 54%, #008556 70%, #006699 85%, #3F3D99 100%)';

export const TITULO_DEGRADADO = 'linear-gradient(90deg, #D81B60, #F47920, #008556, #006699, #3F3D99)';

/** Ya se cargan en index.html; el body del portal usa las del sistema (decisión D12). */
export const FUENTE_TITULOS = "'Outfit', sans-serif";
export const FUENTE_TEXTO = "'Inter', sans-serif";
```

`apps/portal/src/pages/celebracion/persona.ts`:

```ts
import { COLORES_AVATAR } from './marca';

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

/** Decisión D9: 1.ª palabra y 2.ª (o 3.ª si hay cuatro o más), sin partículas. */
export function iniciales(nombre: string): string {
  const palabras = nombre
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '' && !PARTICULAS.has(p.toLowerCase()));
  if (palabras.length === 0) return '?';
  const segunda = palabras.length >= 4 ? palabras[2] : palabras[1];
  return (palabras[0].charAt(0) + (segunda ?? '').charAt(0)).toUpperCase();
}

/** «BRUNO DÍAZ» → «Bruno». */
export function primerNombre(nombre: string): string {
  const primera = nombre.trim().split(/\s+/)[0] ?? '';
  return primera.charAt(0).toUpperCase() + primera.slice(1).toLowerCase();
}

/** Color estable por persona para el avatar sin foto. */
export function colorDe(userId: string): string {
  let h = 0;
  for (const caracter of userId) h = (h * 31 + caracter.charCodeAt(0)) >>> 0;
  return COLORES_AVATAR[h % COLORES_AVATAR.length];
}
```

- [ ] **Paso 4: comprueba que pasan**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/fechas.test.ts src/pages/celebracion/enlaces.test.ts src/pages/celebracion/persona.test.ts)`
Esperado: PASA. Si `hora` falla solo por el espacio, imprime `JSON.stringify(hora(...))` para ver el carácter: el regex `\s` ya cubre el espacio duro y el estrecho.

- [ ] **Paso 5: commit**

```bash
git add apps/portal/src/pages/celebracion/fechas.ts apps/portal/src/pages/celebracion/fechas.test.ts apps/portal/src/pages/celebracion/enlaces.ts apps/portal/src/pages/celebracion/enlaces.test.ts apps/portal/src/pages/celebracion/marca.ts apps/portal/src/pages/celebracion/persona.ts apps/portal/src/pages/celebracion/persona.test.ts apps/portal/src/pages/celebracion/fixtures.ts
git commit -m "feat(portal): fechas, enlaces y avatares de la invitación"
```

### Tarea 10: confeti, descargas, estilos y piezas de UI

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/confeti.ts`, `descargar.ts`, `estilos.ts`, `ui.tsx`
- Prueba: `apps/portal/src/pages/celebracion/confeti.test.ts`

- [ ] **Paso 1: escribe la prueba que falla** (`apps/portal/src/pages/celebracion/confeti.test.ts`)

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { lanzarConfeti } from './confeti';

function movimientoReducido(reducido: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reducido }) as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// El orden importa: el módulo guarda su lienzo entre llamadas.
describe('confeti', () => {
  it('no hace nada si el sistema pide movimiento reducido', () => {
    movimientoReducido(true);
    lanzarConfeti();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('sin contexto 2D no deja el lienzo colgado', () => {
    movimientoReducido(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);
    lanzarConfeti();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('pinta en un lienzo fijo que no tapa los clics', () => {
    movimientoReducido(false);
    const ctx = { clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), fillRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    lanzarConfeti();
    const lienzo = document.querySelector('canvas');
    expect(lienzo?.style.position).toBe('fixed');
    expect(lienzo?.style.pointerEvents).toBe('none');
    expect(lienzo?.getAttribute('aria-hidden')).toBe('true');
  });
});
```

- [ ] **Paso 2: comprueba que falla**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/confeti.test.ts)`
Esperado: FALLA porque no existe `./confeti`.

- [ ] **Paso 3: escribe `confeti.ts`** (`apps/portal/src/pages/celebracion/confeti.ts`)

```ts
import { COLORES } from './marca';

// Confeti con los colores del logo, en un lienzo fijo que no tapa los clics y
// se quita solo al terminar. No hace nada si el sistema pide menos movimiento.

interface Particula {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tam: number;
  color: string;
  rot: number;
  vRot: number;
}

let lienzo: HTMLCanvasElement | null = null;
let particulas: Particula[] = [];
let animando = false;

export function prefiereMenosMovimiento(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function lanzarConfeti(cantidad = 85): void {
  if (prefiereMenosMovimiento()) return;
  if (!lienzo) {
    lienzo = document.createElement('canvas');
    lienzo.setAttribute('aria-hidden', 'true');
    Object.assign(lienzo.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '60',
    });
    document.body.appendChild(lienzo);
  }
  const ctx = lienzo.getContext('2d');
  if (!ctx) {
    lienzo.remove();
    lienzo = null;
    return;
  }
  lienzo.width = window.innerWidth;
  lienzo.height = window.innerHeight;
  for (let i = 0; i < cantidad; i++) {
    particulas.push({
      x: Math.random() * lienzo.width,
      y: -10 - Math.random() * 80,
      vx: (Math.random() - 0.5) * 5,
      vy: 2.5 + Math.random() * 4.5,
      tam: 6 + Math.random() * 6,
      color: COLORES[Math.floor(Math.random() * COLORES.length)],
      rot: Math.random() * 360,
      vRot: (Math.random() - 0.5) * 10,
    });
  }
  if (!animando) {
    animando = true;
    window.requestAnimationFrame(() => paso(ctx));
  }
}

function paso(ctx: CanvasRenderingContext2D): void {
  const actual = lienzo;
  if (!actual) {
    animando = false;
    return;
  }
  ctx.clearRect(0, 0, actual.width, actual.height);
  particulas = particulas.filter((p) => p.y < actual.height + 20);
  for (const p of particulas) {
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vRot;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.tam / 2, -p.tam / 2, p.tam, p.tam * 0.6);
    ctx.restore();
  }
  if (particulas.length > 0) {
    window.requestAnimationFrame(() => paso(ctx));
  } else {
    animando = false;
    actual.remove();
    lienzo = null;
  }
}
```

- [ ] **Paso 4: escribe `descargar.ts`, `estilos.ts` y `ui.tsx`.** Son presentación y efectos del navegador, sin lógica que probar aparte. Las cubren las pruebas de los componentes.

`apps/portal/src/pages/celebracion/descargar.ts`:

```ts
/** Descarga una URL (data: o blob:) con un nombre de fichero. */
export function descargarUrl(nombre: string, url: string): void {
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
}

/** Descarga un texto como fichero (el .ics). */
export function descargarTexto(nombre: string, contenido: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  descargarUrl(nombre, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

`apps/portal/src/pages/celebracion/estilos.ts`:

```ts
// Clases de Tailwind compartidas por las piezas de la invitación.

export const BOTON =
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-[#E6E8EF] bg-white px-4 py-2.5 text-sm font-bold text-[#2B2D35] transition hover:-translate-y-0.5 hover:border-[#006699] hover:text-[#006699] disabled:cursor-not-allowed disabled:opacity-50';

export const BOTON_PRIMARIO =
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006699] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#00527A] disabled:cursor-not-allowed disabled:opacity-50';

/** Botón grande con el degradado de la marca (el fondo va en `style`). */
export const BOTON_ESPECTRO =
  'w-full rounded-2xl px-6 py-4 text-base font-extrabold text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60';

export const CAMPO =
  'w-full rounded-xl border-[1.5px] border-[#E6E8EF] bg-white px-3.5 py-3 text-[15px] text-[#1F2229] focus:border-[#006699] focus:outline-none';

/** Botón de elección (Sí voy / No podré ir). */
export function opcion(activa: boolean): string {
  return `rounded-2xl border-2 px-4 py-4 text-base font-bold transition ${
    activa ? 'border-[#008556] bg-[#008556]/10 text-[#008556]' : 'border-[#E6E8EF] bg-white text-[#3E4352] hover:border-[#CBD2E1]'
  }`;
}
```

`apps/portal/src/pages/celebracion/ui.tsx`:

```tsx
import type { ReactNode } from 'react';
import { FUENTE_TITULOS } from './marca';

const TONOS = {
  teal: 'bg-[#006699]/10 text-[#006699]',
  green: 'bg-[#008556]/10 text-[#008556]',
  pink: 'bg-[#D81B60]/10 text-[#D81B60]',
  orange: 'bg-[#F47920]/10 text-[#D85B00]',
  indigo: 'bg-[#3F3D99]/10 text-[#3F3D99]',
} as const;

/** Pastilla de sección («📍 Coordenadas del encuentro»). */
export function Etiqueta({ tono, children }: { tono: keyof typeof TONOS; children: ReactNode }) {
  return (
    <span
      className={`mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide ${TONOS[tono]}`}
    >
      {children}
    </span>
  );
}

export function Titulo({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-4 text-2xl font-black text-[#1F2229]" style={{ fontFamily: FUENTE_TITULOS }}>
      {children}
    </h2>
  );
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[26px] border border-[#E6E8EF] bg-white/95 p-5 shadow-sm sm:p-7 ${className}`}>{children}</div>
  );
}
```

- [ ] **Paso 5: comprueba que pasa y que compila**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/confeti.test.ts && npx tsc -b)`
Esperado: PASA y `tsc -b` sin errores.

- [ ] **Paso 6: commit**

```bash
git add apps/portal/src/pages/celebracion/confeti.ts apps/portal/src/pages/celebracion/confeti.test.ts apps/portal/src/pages/celebracion/descargar.ts apps/portal/src/pages/celebracion/estilos.ts apps/portal/src/pages/celebracion/ui.tsx
git commit -m "feat(portal): confeti, descargas y piezas de UI de la invitación"
```

### Tarea 11: Merge C1

- [ ] **Paso 1:** las pruebas del portal: `(cd apps/portal && npm test)`. Esperado: verde.
- [ ] **Paso 2:** el build y el lint: `(cd apps/portal && npm run build && npm run lint)`. Esperado: sin errores (los avisos no paran).
- [ ] **Paso 3:** el tamaño: unas 650 líneas más desde el merge B.
- [ ] **Paso 4:** la comprobación de privacidad, en un comando aparte. Esperado: ninguna línea.
- [ ] **Paso 5:** el merge, con el mensaje `merge: invitación de fin de año, base del portal`.

---

## MERGE C2 — portal: confirmación, página y ruta

### Tarea 12: el formulario de confirmación

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/Confirmacion.tsx`
- Prueba: `apps/portal/src/pages/celebracion/Confirmacion.test.tsx`

- [ ] **Paso 1: escribe la prueba que falla** (`apps/portal/src/pages/celebracion/Confirmacion.test.tsx`)

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import Confirmacion from './Confirmacion';
import { eventoDePrueba } from './fixtures';
import type { Respuesta } from './tipos';

afterEach(() => {
  cleanup();
});

const VA: Respuesta = { asiste: true, preferencia: 'vegetariano', mensaje: '¡Allá estaré!', actualizadoEn: '2026-12-01T15:00:00Z' };

function pintar(respuesta: Respuesta | null, abiertas = true) {
  const onGuardar = vi.fn(async () => {});
  render(<Confirmacion evento={eventoDePrueba({ confirmacionesAbiertas: abiertas })} respuesta={respuesta} onGuardar={onGuardar} />);
  return onGuardar;
}

describe('Confirmacion', () => {
  it('sin responder: «Sí voy» pide el menú y guarda lo elegido', async () => {
    const onGuardar = pintar(null);
    const enviar = screen.getByRole('button', { name: /Confirmar respuesta/ }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Sí voy/ }));
    fireEvent.change(screen.getByLabelText('Preferencia de menú'), { target: { value: 'vegetariano' } });
    fireEvent.click(enviar);
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith({ asiste: true, preferencia: 'vegetariano', mensaje: null }));
  });

  it('sin responder: «No podré ir» no pide menú y manda el mensaje recortado', async () => {
    const onGuardar = pintar(null);
    fireEvent.click(screen.getByRole('button', { name: /No podré ir/ }));
    expect(screen.queryByLabelText('Preferencia de menú')).toBeNull();
    fireEvent.change(screen.getByLabelText('Mensaje o brindis (opcional)'), { target: { value: '  ¡Feliz año!  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith({ asiste: false, preferencia: null, mensaje: '¡Feliz año!' }));
  });

  it('respondida y abierta: enseña la respuesta y deja cambiarla con lo anterior ya puesto', () => {
    pintar(VA);
    expect(screen.getByText(/Vas al almuerzo · Opción vegetariana/)).toBeTruthy();
    expect(screen.getByText('“¡Allá estaré!”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Cambiar respuesta/ }));
    expect(screen.getByRole('button', { name: /Sí voy/ }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Preferencia de menú') as HTMLSelectElement).value).toBe('vegetariano');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: /Cambiar respuesta/ })).toBeTruthy();
  });

  it('cerrada sin respuesta: solo el aviso del cierre', () => {
    pintar(null, false);
    expect(screen.getByText('Las confirmaciones se cerraron el 4 de diciembre.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('cerrada con respuesta: la respuesta y el aviso, sin poder cambiarla', () => {
    pintar(VA, false);
    expect(screen.getByText(/Vas al almuerzo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cambiar respuesta/ })).toBeNull();
  });

  it('si guardar falla, el formulario sigue abierto', async () => {
    const onGuardar = vi.fn(async () => {
      throw new Error('red');
    });
    render(<Confirmacion evento={eventoDePrueba()} respuesta={null} onGuardar={onGuardar} />);
    fireEvent.click(screen.getByRole('button', { name: /No podré ir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() => expect(onGuardar).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Confirmar respuesta/ })).toBeTruthy();
  });
});
```

- [ ] **Paso 2: comprueba que falla**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/Confirmacion.test.tsx)`
Esperado: FALLA porque no existe `./Confirmacion`.

- [ ] **Paso 3: escribe `Confirmacion.tsx`** (`apps/portal/src/pages/celebracion/Confirmacion.tsx`)

```tsx
import { useState, type FormEvent } from 'react';
import { BOTON, BOTON_ESPECTRO, CAMPO, opcion } from './estilos';
import { diaYMes } from './fechas';
import { ESPECTRO } from './marca';
import { MENSAJE_MAX, type DatosConfirmacion, type Evento, type Respuesta } from './tipos';

interface Props {
  evento: Pick<Evento, 'confirmacionesAbiertas' | 'cierreConfirmaciones' | 'preferencias'>;
  respuesta: Respuesta | null;
  /** Guarda; si falla, el padre avisa y relanza, y el formulario sigue abierto. */
  onGuardar: (datos: DatosConfirmacion) => Promise<void>;
}

/** «Sí voy / No podré ir», con sus tres estados: sin responder, respondida y cerrada. */
export default function Confirmacion({ evento, respuesta, onGuardar }: Props) {
  const menuPorDefecto = evento.preferencias[0]?.codigo ?? '';
  const [editando, setEditando] = useState(respuesta === null);
  const [asiste, setAsiste] = useState<boolean | null>(respuesta?.asiste ?? null);
  const [preferencia, setPreferencia] = useState(respuesta?.preferencia ?? menuPorDefecto);
  const [mensaje, setMensaje] = useState(respuesta?.mensaje ?? '');
  const [guardando, setGuardando] = useState(false);

  const textoMenu = (codigo: string | null) => evento.preferencias.find((p) => p.codigo === codigo)?.texto ?? '';

  const cambiar = () => {
    setAsiste(respuesta?.asiste ?? null);
    setPreferencia(respuesta?.preferencia ?? menuPorDefecto);
    setMensaje(respuesta?.mensaje ?? '');
    setEditando(true);
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (asiste === null) return;
    const limpio = mensaje.trim();
    setGuardando(true);
    try {
      await onGuardar({ asiste, preferencia: asiste ? preferencia : null, mensaje: limpio === '' ? null : limpio });
      setEditando(false);
    } catch {
      // El padre ya mostró el aviso; el formulario sigue abierto para reintentar.
    } finally {
      setGuardando(false);
    }
  };

  if (!evento.confirmacionesAbiertas || !editando) {
    return (
      <div className="space-y-4">
        {respuesta && (
          <div className="rounded-2xl bg-[#F8F9FC] p-4">
            <p className="font-bold text-[#1F2229]">
              {respuesta.asiste ? `✅ Vas al almuerzo · ${textoMenu(respuesta.preferencia)}` : '🙏 Nos dijiste que no podrás ir.'}
            </p>
            {respuesta.mensaje && <p className="mt-1 italic text-[#4E5362]">“{respuesta.mensaje}”</p>}
          </div>
        )}
        {evento.confirmacionesAbiertas ? (
          <button type="button" className={BOTON} onClick={cambiar}>
            ✏️ Cambiar respuesta
          </button>
        ) : (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            Las confirmaciones se cerraron el {diaYMes(evento.cierreConfirmaciones)}.
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void enviar(e)} className="space-y-5">
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="¿Vas al almuerzo?">
        <button type="button" aria-pressed={asiste === true} className={opcion(asiste === true)} onClick={() => setAsiste(true)}>
          🎉 Sí voy
        </button>
        <button type="button" aria-pressed={asiste === false} className={opcion(asiste === false)} onClick={() => setAsiste(false)}>
          😔 No podré ir
        </button>
      </div>

      {asiste === true && (
        <div>
          <label htmlFor="celebracion-menu" className="mb-1.5 block text-sm font-bold text-[#3E4352]">
            Preferencia de menú
          </label>
          <select id="celebracion-menu" className={CAMPO} value={preferencia} onChange={(e) => setPreferencia(e.target.value)}>
            {evento.preferencias.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.texto}
              </option>
            ))}
          </select>
        </div>
      )}

      {asiste !== null && (
        <div>
          <label htmlFor="celebracion-mensaje" className="mb-1.5 block text-sm font-bold text-[#3E4352]">
            Mensaje o brindis (opcional)
          </label>
          <input
            id="celebracion-mensaje"
            type="text"
            className={CAMPO}
            maxLength={MENSAJE_MAX}
            placeholder="¡Listo para celebrar con el equipo!"
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="submit" disabled={asiste === null || guardando} className={BOTON_ESPECTRO} style={{ background: ESPECTRO }}>
          {guardando ? 'Guardando…' : '✨ Confirmar respuesta'}
        </button>
        {respuesta && (
          <button type="button" className={BOTON} onClick={() => setEditando(false)}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Paso 4: comprueba que pasa**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/Confirmacion.test.tsx)`
Esperado: PASA (6 pruebas). Mientras guarda, el botón dice «Guardando…» y la prueba del fallo vuelve a buscar «Confirmar respuesta» con `waitFor`. Si sale intermitente, envuelve la última aserción en `await waitFor(...)`.

- [ ] **Paso 5: commit**

```bash
git add apps/portal/src/pages/celebracion/Confirmacion.tsx apps/portal/src/pages/celebracion/Confirmacion.test.tsx
git commit -m "feat(portal): formulario de confirmación de la invitación"
```

### Tarea 13: la página, sus piezas y la ruta

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/Portada.tsx`, `CuentaAtras.tsx`, `TarjetasEvento.tsx`, `CelebracionNavidad.tsx`
- Cambiar: `apps/portal/src/App.tsx`
- Prueba: `apps/portal/src/pages/celebracion/CelebracionNavidad.test.tsx`, `apps/portal/src/pages/celebracion/ruta.test.ts`

- [ ] **Paso 1: escribe las pruebas que fallan**

`apps/portal/src/pages/celebracion/CelebracionNavidad.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import CelebracionNavidad from './CelebracionNavidad';
import { cargarVista, ErrorApi, guardarConfirmacion } from './api';
import { notify } from '../../lib/notify';
import { vistaDePrueba } from './fixtures';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarVista: vi.fn(),
  guardarConfirmacion: vi.fn(),
  guardarVotos: vi.fn(),
  subirMiFoto: vi.fn(),
  cargarResumen: vi.fn(),
}));
vi.mock('./confeti', () => ({ lanzarConfeti: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

beforeEach(() => {
  vi.mocked(cargarVista).mockResolvedValue(vistaDePrueba());
  vi.mocked(guardarConfirmacion).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function abrir() {
  render(<CelebracionNavidad />);
  fireEvent.click(await screen.findByRole('button', { name: /Abrir invitación/ }));
}

describe('CelebracionNavidad', () => {
  it('enseña la portada y, al abrirla, el evento', async () => {
    await abrir();
    expect(screen.queryByRole('button', { name: /Abrir invitación/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Fecha, hora y lugar' })).toBeTruthy();
    expect(screen.getByText('Viernes, 18 de diciembre de 2026')).toBeTruthy();
    expect(screen.getByText('Restaurante Anfitriona')).toBeTruthy();
    expect(screen.getByRole('timer', { name: 'Cuenta atrás' })).toBeTruthy();
  });

  it('si no carga, ofrece reintentar', async () => {
    vi.mocked(cargarVista).mockRejectedValueOnce(new Error('red'));
    render(<CelebracionNavidad />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: /Abrir invitación/ })).toBeTruthy();
    expect(cargarVista).toHaveBeenCalledTimes(2);
  });

  it('confirmar guarda, avisa y vuelve a cargar', async () => {
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: /Sí voy/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() =>
      expect(guardarConfirmacion).toHaveBeenCalledWith({ asiste: true, preferencia: 'general', mensaje: null }),
    );
    await waitFor(() => expect(cargarVista).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith('🎟️ ¡Asistencia confirmada!');
  });

  it('si el servidor rechaza, avisa con el texto de su código', async () => {
    vi.mocked(guardarConfirmacion).mockRejectedValue(new ErrorApi('confirmaciones_cerradas', 409));
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: /No podré ir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Las confirmaciones ya están cerradas.', 'error'));
    expect(cargarVista).toHaveBeenCalledTimes(1);
  });
});
```

`apps/portal/src/pages/celebracion/ruta.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RUTA_CELEBRACION } from './ruta';

const app = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8');

describe('ruta de la invitación', () => {
  it('es la del mensaje de WhatsApp', () => {
    expect(RUTA_CELEBRACION).toBe('/celebracion-navidad-2026');
  });

  it('está fuera del shell, con sesión y sin AppGuard', () => {
    const inicio = app.indexOf('path={RUTA_CELEBRACION}');
    expect(inicio).toBeGreaterThan(-1);
    const bloque = app.slice(inicio, app.indexOf('path="/*"'));
    expect(bloque).toContain('<RequireAuth>');
    expect(bloque).toContain('<CelebracionNavidad />');
    expect(bloque).not.toContain('AppGuard');
  });
});
```

- [ ] **Paso 2: comprueba que fallan**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/CelebracionNavidad.test.tsx src/pages/celebracion/ruta.test.ts)`
Esperado: FALLAN (no existe `./CelebracionNavidad` y `App.tsx` no tiene la ruta).

- [ ] **Paso 3: escribe las tres piezas de presentación**

`apps/portal/src/pages/celebracion/Portada.tsx`:

```tsx
import logo from '../../assets/ambientalia-logo.png';
import { ESPECTRO, FUENTE_TITULOS } from './marca';

/** El «sobre» que tapa la página hasta que se pulsa «Abrir invitación». */
export default function Portada({ onAbrir }: { onAbrir: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-gradient-to-br from-white via-[#f4f6fb] to-[#eef2f7] p-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] bg-white px-7 py-10 text-center shadow-[0_25px_60px_-15px_rgba(63,61,153,0.16)] ring-1 ring-black/5">
        <div className="absolute inset-x-0 top-0 h-[7px]" style={{ background: ESPECTRO }} />
        <span className="inline-flex items-center gap-2 rounded-full bg-[#F47920]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-[#D85B00]">
          ✨ Celebración de fin de año 2026
        </span>
        <img src={logo} alt="Ambientalia" className="mx-auto mt-6 h-16 w-auto" />
        <h1 className="mt-6 text-3xl font-black leading-tight text-[#22252E]" style={{ fontFamily: FUENTE_TITULOS }}>
          ¡Tenemos una cita especial para celebrar juntos!
        </h1>
        <p className="mt-3 leading-relaxed text-[#5C6170]">
          Un encuentro pensado para agradecer cada logro compartido durante este 2026 y brindar por un nuevo año lleno de éxitos
          en equipo.
        </p>
        <button
          type="button"
          onClick={onAbrir}
          className="mt-7 inline-flex items-center gap-2 rounded-full px-8 py-4 font-extrabold text-white shadow-lg transition hover:-translate-y-0.5"
          style={{ background: ESPECTRO }}
        >
          Abrir invitación 🎉
        </button>
      </div>
    </div>
  );
}
```

`apps/portal/src/pages/celebracion/CuentaAtras.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { cuentaAtras } from './fechas';
import { FUENTE_TITULOS } from './marca';

const CAJAS = [
  { clave: 'dias', texto: 'Días', color: '#D81B60' },
  { clave: 'horas', texto: 'Horas', color: '#F47920' },
  { clave: 'minutos', texto: 'Minutos', color: '#008556' },
  { clave: 'segundos', texto: 'Segundos', color: '#3F3D99' },
] as const;

/**
 * La hora se lee solo dentro del efecto: leerla al pintar (`new Date()`) lo
 * marca `react-hooks/purity`. Hasta el primer tic se ven «--», como en la
 * invitación original.
 */
export default function CuentaAtras({ objetivo }: { objetivo: string }) {
  const [ahora, setAhora] = useState<number | null>(null);

  useEffect(() => {
    const tic = () => setAhora(Date.now());
    tic();
    const id = window.setInterval(tic, 1000);
    return () => window.clearInterval(id);
  }, []);

  const cuenta = ahora === null ? null : cuentaAtras(new Date(objetivo), new Date(ahora));
  return (
    <div className="mx-auto grid max-w-lg grid-cols-4 gap-2 sm:gap-3" role="timer" aria-label="Cuenta atrás">
      {CAJAS.map((c) => (
        <div
          key={c.clave}
          className="rounded-2xl border border-[#E6E8EF] bg-white px-1 py-3 shadow-sm"
          style={{ borderTop: `4px solid ${c.color}` }}
        >
          <span className="block text-2xl font-black text-[#22252E] sm:text-4xl" style={{ fontFamily: FUENTE_TITULOS }}>
            {cuenta ? String(cuenta[c.clave]).padStart(2, '0') : '--'}
          </span>
          <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500 sm:text-xs">{c.texto}</span>
        </div>
      ))}
    </div>
  );
}
```

`apps/portal/src/pages/celebracion/TarjetasEvento.tsx`:

```tsx
import { notify } from '../../lib/notify';
import { descargarTexto } from './descargar';
import { contenidoIcs, nombreFicheroIcs, urlGoogleCalendar, urlGoogleMaps, urlWaze } from './enlaces';
import { BOTON, BOTON_PRIMARIO } from './estilos';
import { fechaLarga, hora } from './fechas';
import type { Evento } from './tipos';
import { Etiqueta, Tarjeta, Titulo } from './ui';

function Detalle({ icono, titulo, texto }: { icono: string; titulo: string; texto: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F4F6FA] text-lg" aria-hidden="true">
        {icono}
      </span>
      <div>
        <strong className="block text-[#1F2229]">{titulo}</strong>
        <span className="text-sm text-gray-500">{texto}</span>
      </div>
    </li>
  );
}

/** Las dos tarjetas del evento: dónde y cuándo, y la agenda con el calendario. */
export default function TarjetasEvento({ evento }: { evento: Evento }) {
  const copiarDireccion = async () => {
    try {
      await navigator.clipboard.writeText(`${evento.lugar}, ${evento.direccion}`);
      notify('📋 Dirección copiada.');
    } catch {
      notify('No se pudo copiar la dirección.', 'error');
    }
  };

  const descargarIcs = () => {
    descargarTexto(nombreFicheroIcs(evento), contenidoIcs(evento, new Date()), 'text/calendar;charset=utf-8');
    notify('📅 Evento descargado para tu calendario.');
  };

  return (
    <div className="mb-6 grid gap-6 md:grid-cols-2">
      <Tarjeta className="flex flex-col justify-between">
        <div>
          <Etiqueta tono="teal">📍 Coordenadas del encuentro</Etiqueta>
          <Titulo>Fecha, hora y lugar</Titulo>
          <ul className="mb-6 space-y-3.5">
            <Detalle icono="📅" titulo={fechaLarga(evento.inicio)} texto="Encuentro de cierre de año" />
            <Detalle icono="🕧" titulo={hora(evento.inicio)} texto="Bienvenida y brindis" />
            <Detalle icono="🍽️" titulo={evento.lugar} texto={evento.direccion} />
          </ul>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a className={BOTON_PRIMARIO} href={urlGoogleMaps(evento)} target="_blank" rel="noopener noreferrer">
            🗺️ Google Maps
          </a>
          <a className={BOTON} href={urlWaze(evento)} target="_blank" rel="noopener noreferrer">
            🚗 Waze
          </a>
          <button type="button" className={BOTON} onClick={() => void copiarDireccion()}>
            📋 Copiar dirección
          </button>
        </div>
      </Tarjeta>

      <Tarjeta className="flex flex-col justify-between">
        <div>
          <Etiqueta tono="green">🗓️ Agenda y detalles</Etiqueta>
          <Titulo>Prepárate para disfrutar</Titulo>
          <ul className="mb-6 space-y-3.5">
            <Detalle icono="🥂" titulo="Experiencia gastronómica" texto="Almuerzo especial de temporada y brindis corporativo" />
            <Detalle icono="👔" titulo={`Código de vestimenta: ${evento.vestimenta}`} texto="Cómodo, elegante y listo para celebrar" />
            <Detalle icono="⏰" titulo="Agéndalo en tu calendario" texto="Guarda el recordatorio con un solo clic" />
          </ul>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a className={BOTON} href={urlGoogleCalendar(evento)} target="_blank" rel="noopener noreferrer">
            📆 Google Calendar
          </a>
          <button type="button" className={BOTON} onClick={descargarIcs}>
            ⬇️ Descargar .ics
          </button>
        </div>
      </Tarjeta>
    </div>
  );
}
```

- [ ] **Paso 4: escribe la página** (`apps/portal/src/pages/celebracion/CelebracionNavidad.tsx`)

Las Tareas 16, 18 y 19 insertan el muro, el pase y el panel en sitios marcados de este fichero. No cambies los textos que se usan como ancla: la línea de `<section aria-labelledby="titulo-confirmacion"`, la de `<Confirmacion`, `<footer` y `</main>`.

```tsx
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import logo from '../../assets/ambientalia-logo.png';
import { notify } from '../../lib/notify';
import { cargarVista, guardarConfirmacion, mensajeDeError } from './api';
import { lanzarConfeti } from './confeti';
import Confirmacion from './Confirmacion';
import CuentaAtras from './CuentaAtras';
import { BOTON } from './estilos';
import { diaYMes } from './fechas';
import { ESPECTRO, FUENTE_TEXTO, FUENTE_TITULOS, TITULO_DEGRADADO } from './marca';
import Portada from './Portada';
import TarjetasEvento from './TarjetasEvento';
import type { DatosConfirmacion, Vista } from './tipos';
import { Etiqueta, Tarjeta, Titulo } from './ui';

const TITULO_PESTANA = 'Almuerzo de fin de año · Portal Ambientalia';

const MANCHAS = [
  { color: '#D81B60', clase: '-left-16 -top-20 h-80 w-80' },
  { color: '#FDB913', clase: '-right-24 top-1/3 h-96 w-96' },
  { color: '#008556', clase: 'bottom-[5%] left-[10%] h-80 w-80' },
  { color: '#006699', clase: '-bottom-16 right-[15%] h-72 w-72' },
];

function Fondo() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      {MANCHAS.map((m) => (
        <div key={m.color} className={`absolute rounded-full opacity-[0.12] blur-[45px] ${m.clase}`} style={{ background: m.color }} />
      ))}
    </div>
  );
}

function Centro({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#FAFAFC] p-6 text-center">{children}</div>;
}

/** `/celebracion-navidad-2026`: la invitación al almuerzo de fin de año. Fuera del shell; con sesión. */
export default function CelebracionNavidad() {
  const [vista, setVista] = useState<Vista | null>(null);
  const [fallo, setFallo] = useState(false);
  const [abierta, setAbierta] = useState(false);

  const recargar = useCallback(async () => {
    try {
      setVista(await cargarVista());
      setFallo(false);
    } catch {
      setFallo(true);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => {
    const anterior = document.title;
    document.title = TITULO_PESTANA;
    return () => {
      document.title = anterior;
    };
  }, []);

  if (!vista) {
    return (
      <Centro>
        {fallo ? (
          <>
            <p className="font-semibold text-[#3E4352]">No se pudo cargar la invitación.</p>
            <button type="button" className={BOTON} onClick={() => void recargar()}>
              Reintentar
            </button>
          </>
        ) : (
          <p role="status" className="text-[#5C6170]">
            Cargando invitación…
          </p>
        )}
      </Centro>
    );
  }

  const abrir = () => {
    setAbierta(true);
    lanzarConfeti();
  };

  const confirmar = async (datos: DatosConfirmacion) => {
    try {
      await guardarConfirmacion(datos);
    } catch (e) {
      notify(mensajeDeError(e), 'error');
      throw e;
    }
    if (datos.asiste) {
      notify('🎟️ ¡Asistencia confirmada!');
      lanzarConfeti();
    } else {
      notify('Gracias por avisarnos. ¡Te echaremos de menos!');
    }
    await recargar();
  };

  const { evento } = vista;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#FAFAFC] text-[#2B2D35]" style={{ fontFamily: FUENTE_TEXTO }}>
      <Fondo />
      {!abierta && <Portada onAbrir={abrir} />}

      <main
        aria-hidden={!abierta}
        className={`relative z-10 mx-auto max-w-5xl px-4 pb-20 pt-5 transition-all duration-700 sm:px-5 ${
          abierta ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
        }`}
      >
        <header className="mb-6 flex items-center justify-between gap-4 rounded-[22px] border border-[#E6E8EF] bg-white/90 px-4 py-3 shadow-sm backdrop-blur sm:px-6">
          <img src={logo} alt="Ambientalia" className="h-10 w-auto sm:h-12" />
          <button
            type="button"
            onClick={() => lanzarConfeti()}
            className="rounded-full border-[1.5px] border-[#FDB913] bg-[#FFF6E5] px-4 py-2 text-sm font-bold text-[#C95B00] transition hover:bg-[#FDB913] hover:text-[#1F2229]"
          >
            🎊 ¡Celebrar!
          </button>
        </header>

        <section className="relative mb-6 overflow-hidden rounded-[30px] border border-[#E6E8EF] bg-white/90 px-4 pb-12 pt-10 text-center shadow-sm sm:px-8">
          <span className="inline-flex rounded-full bg-[#F47920]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-[#D85B00]">
            🥂 Almuerzo corporativo de fin de año
          </span>
          <h1
            className="my-4 bg-clip-text text-4xl font-black leading-tight text-transparent sm:text-5xl"
            style={{ fontFamily: FUENTE_TITULOS, backgroundImage: TITULO_DEGRADADO }}
          >
            Brindemos por un 2026 extraordinario
          </h1>
          <p className="mx-auto mb-8 max-w-2xl leading-relaxed text-[#4E5362]">
            Queremos compartir una tarde inolvidable entre amigos y compañeros en un espacio gastronómico único en Bogotá. ¡Tu
            presencia hace la diferencia!
          </p>
          <CuentaAtras objetivo={evento.inicio} />
          <div className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: ESPECTRO }} />
        </section>

        <TarjetasEvento evento={evento} />

        <section aria-labelledby="titulo-confirmacion" className="mb-6">
          <Tarjeta>
            <Etiqueta tono="teal">🎟️ Confirmación y pase digital</Etiqueta>
            <Titulo id="titulo-confirmacion">¿Nos acompañas?</Titulo>
            {evento.confirmacionesAbiertas && (
              <p className="mb-5 text-sm text-[#5C6170]">
                Confirma antes del {diaYMes(evento.cierreConfirmaciones)}. Puedes cambiar tu respuesta hasta esa fecha.
              </p>
            )}
            <Confirmacion evento={evento} respuesta={vista.miRespuesta} onGuardar={confirmar} />
          </Tarjeta>
        </section>

        <footer className="mt-10 text-center text-sm text-gray-500">
          <strong>Ambientalia S.A.S.</strong> · {evento.titulo}
        </footer>
      </main>
    </div>
  );
}
```

- [ ] **Paso 5: añade la ruta en `App.tsx`**

En `apps/portal/src/App.tsx`, detrás de:

```tsx
import AdminUsers from './pages/admin/AdminUsers';
```

añade:

```tsx
import { RUTA_CELEBRACION } from './pages/celebracion/ruta';
```

Detrás de:

```tsx
const EquiposTaller = lazyConReintento(() => import('../../equipos-taller/src/App'));
```

añade:

```tsx
const CelebracionNavidad = lazyConReintento(() => import('./pages/celebracion/CelebracionNavidad'));
```

Y detrás de:

```tsx
        <Route path="/equipos-taller/mis-equipos" element={<RutaMisEquipos />} />
```

añade:

```tsx

        {/* Invitación al almuerzo de fin de año — fuera del shell; con sesión pero sin app asignada */}
        <Route
          path={RUTA_CELEBRACION}
          element={
            <RequireAuth>
              <Suspense fallback={<LoadingFallback />}>
                <CelebracionNavidad />
              </Suspense>
            </RequireAuth>
          }
        />
```

- [ ] **Paso 6: comprueba que pasan y que compila**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion && npx tsc -b)`
Esperado: PASA todo y `tsc -b` sin errores.

- [ ] **Paso 7: commit**

```bash
git add apps/portal/src/pages/celebracion/Portada.tsx apps/portal/src/pages/celebracion/CuentaAtras.tsx apps/portal/src/pages/celebracion/TarjetasEvento.tsx apps/portal/src/pages/celebracion/CelebracionNavidad.tsx apps/portal/src/pages/celebracion/CelebracionNavidad.test.tsx apps/portal/src/pages/celebracion/ruta.test.ts apps/portal/src/App.tsx
git commit -m "feat(portal): página /celebracion-navidad-2026 con la confirmación"
```

### Tarea 14: Merge C2

- [ ] **Paso 1:** `(cd apps/portal && npm test)`. Esperado: verde.
- [ ] **Paso 2:** `(cd apps/portal && npm run build && npm run lint)`. Esperado: sin errores.
- [ ] **Paso 3:** prueba de humo local, opcional pero recomendada. El login no funciona en local (ver la memoria `portal-auth`). Si quieres ver la página, monta un banco de pruebas desechable con `vistaDePrueba()` y bórralo después. No lo commitees.
- [ ] **Paso 4:** el tamaño: unas 750 líneas más desde el merge C1.
- [ ] **Paso 5:** la comprobación de privacidad, en un comando aparte. Esperado: ninguna línea.
- [ ] **Paso 6:** el merge, con el mensaje `merge: invitación de fin de año, página y confirmación`.

---

## MERGE D1 — portal: brindis y muro del equipo

### Tarea 15: el modal de cualidades

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/ModalCualidades.tsx`
- Prueba: `apps/portal/src/pages/celebracion/ModalCualidades.test.tsx`

- [ ] **Paso 1: escribe la prueba que falla** (`apps/portal/src/pages/celebracion/ModalCualidades.test.tsx`)

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ModalCualidades from './ModalCualidades';

const CUALIDADES = ['Liderazgo', 'Empatía', 'Compromiso', 'Creatividad', 'Trabajo en equipo'];

afterEach(() => {
  cleanup();
});

function pintar(seleccionInicial: string[] = []) {
  const props = {
    nombre: 'BRUNO DÍAZ',
    cualidades: CUALIDADES,
    max: 3,
    seleccionInicial,
    onGuardar: vi.fn(async () => {}),
    onCerrar: vi.fn(),
  };
  render(<ModalCualidades {...props} />);
  return props;
}

const boton = (nombre: RegExp) => screen.getByRole('button', { name: nombre }) as HTMLButtonElement;

describe('ModalCualidades', () => {
  it('es un diálogo titulado con el primer nombre', () => {
    pintar();
    expect(screen.getByRole('dialog', { name: /Brinda por Bruno/ })).toBeTruthy();
  });

  it('no deja marcar una cuarta cualidad', () => {
    pintar();
    for (const c of [/Liderazgo/, /Empatía/, /Compromiso/]) fireEvent.click(boton(c));
    expect(boton(/Creatividad/).disabled).toBe(true);
    fireEvent.click(boton(/Creatividad/));
    expect(boton(/Creatividad/).getAttribute('aria-pressed')).toBe('false');
    // Al desmarcar una, la cuarta vuelve a estar disponible.
    fireEvent.click(boton(/Liderazgo/));
    expect(boton(/Creatividad/).disabled).toBe(false);
  });

  it('trae marcado lo que ya voté y guarda la selección', async () => {
    const props = pintar(['Empatía']);
    expect(boton(/Empatía/).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(boton(/Liderazgo/));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar brindis' }));
    await waitFor(() => expect(props.onGuardar).toHaveBeenCalledWith(['Empatía', 'Liderazgo']));
  });

  it('Cancelar y Escape cierran', () => {
    const props = pintar();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onCerrar).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Paso 2: comprueba que falla**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/ModalCualidades.test.tsx)`
Esperado: FALLA porque no existe `./ModalCualidades`.

- [ ] **Paso 3: escribe `ModalCualidades.tsx`** (`apps/portal/src/pages/celebracion/ModalCualidades.tsx`)

```tsx
import { useEffect, useId, useState } from 'react';
import { BOTON } from './estilos';
import { ESPECTRO, FUENTE_TITULOS } from './marca';
import { primerNombre } from './persona';

interface Props {
  nombre: string;
  cualidades: string[];
  max: number;
  seleccionInicial: string[];
  /** Guarda; si falla, el padre avisa y relanza, y el modal sigue abierto. */
  onGuardar: (seleccion: string[]) => Promise<void>;
  onCerrar: () => void;
}

/** «Enviar brindis»: elegir hasta `max` cualidades para un compañero. */
export default function ModalCualidades({ nombre, cualidades, max, seleccionInicial, onGuardar, onCerrar }: Props) {
  const tituloId = useId();
  const [seleccion, setSeleccion] = useState<string[]>(seleccionInicial);
  const [guardando, setGuardando] = useState(false);
  const lleno = seleccion.length >= max;

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [onCerrar]);

  const alternar = (cualidad: string) =>
    setSeleccion((actual) => {
      if (actual.includes(cualidad)) return actual.filter((c) => c !== cualidad);
      return actual.length >= max ? actual : [...actual, cualidad];
    });

  const guardar = async () => {
    setGuardando(true);
    try {
      await onGuardar(seleccion);
    } catch {
      // El padre ya avisó; el modal sigue abierto para reintentar.
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={tituloId} className="text-xl font-black text-[#1F2229]" style={{ fontFamily: FUENTE_TITULOS }}>
          🥂 Brinda por {primerNombre(nombre)}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Elige hasta {max} cualidades. Tu voto es anónimo. ({seleccion.length}/{max})
        </p>

        <div className="my-5 flex flex-wrap gap-2">
          {cualidades.map((c) => {
            const activa = seleccion.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={activa}
                disabled={!activa && lleno}
                onClick={() => alternar(c)}
                className={`rounded-full border-[1.5px] px-3 py-1.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  activa ? 'border-[#008556] bg-[#008556]/10 text-[#008556]' : 'border-[#E6E8EF] bg-white text-[#3E4352] hover:border-[#CBD2E1]'
                }`}
              >
                {activa ? '✓ ' : ''}
                {c}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          <button type="button" className={BOTON} onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={() => void guardar()}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60"
            style={{ background: ESPECTRO }}
          >
            {guardando ? 'Guardando…' : 'Guardar brindis'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Paso 4: comprueba que pasa**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/ModalCualidades.test.tsx)`
Esperado: PASA (4 pruebas).

- [ ] **Paso 5: commit**

```bash
git add apps/portal/src/pages/celebracion/ModalCualidades.tsx apps/portal/src/pages/celebracion/ModalCualidades.test.tsx
git commit -m "feat(portal): modal para brindar por un compañero"
```

### Tarea 16: el muro del equipo, conectado a la página

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/MuroEquipo.tsx`
- Cambiar: `apps/portal/src/pages/celebracion/CelebracionNavidad.tsx`
- Prueba: `apps/portal/src/pages/celebracion/MuroEquipo.test.tsx`, `apps/portal/src/pages/celebracion/CelebracionNavidad.muro.test.tsx`

- [ ] **Paso 1: escribe las pruebas que fallan**

`apps/portal/src/pages/celebracion/MuroEquipo.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import MuroEquipo from './MuroEquipo';
import { notify } from '../../lib/notify';
import { BRUNO, CARLA, vistaDePrueba, YO } from './fixtures';

vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pintar(cambios: { votosAbiertos?: boolean; misVotos?: Record<string, string[]> } = {}) {
  const vista = vistaDePrueba();
  const props = {
    equipo: vista.equipo,
    yo: YO,
    misVotos: cambios.misVotos ?? {},
    votosAbiertos: cambios.votosAbiertos ?? true,
    onBrindis: vi.fn(),
    onSubirFoto: vi.fn(async () => {}),
  };
  render(<MuroEquipo {...props} />);
  return props;
}

const tarjeta = (nombre: string) => screen.getByRole('article', { name: nombre });

describe('MuroEquipo', () => {
  it('mi tarjeta va primera y tiene «Subir mi foto» en vez del brindis', () => {
    pintar();
    expect(screen.getAllByRole('article')[0].getAttribute('aria-label')).toBe('Ana Ruiz');
    expect(within(tarjeta('Ana Ruiz')).getByLabelText(/Subir mi foto/)).toBeTruthy();
    expect(within(tarjeta('Ana Ruiz')).queryByRole('button', { name: /brindis/ })).toBeNull();
    expect(within(tarjeta('Ana Ruiz')).getByText('Aún nadie ha brindado por ti.')).toBeTruthy();
  });

  it('las ajenas tienen «Enviar brindis» y sus cualidades con número', () => {
    const props = pintar();
    expect(within(tarjeta('Bruno Díaz')).getByText('✨ Empatía · 4')).toBeTruthy();
    expect(within(tarjeta('Bruno Díaz')).getByText('✨ Liderazgo · 2')).toBeTruthy();
    expect(within(tarjeta('Carla Gómez')).getByText('Sé el primero en brindar por Carla.')).toBeTruthy();
    fireEvent.click(within(tarjeta('Carla Gómez')).getByRole('button', { name: /Enviar brindis/ }));
    expect(props.onBrindis).toHaveBeenCalledWith(expect.objectContaining({ userId: CARLA }));
  });

  it('si ya voté a alguien, su botón dice «Brindis enviado»', () => {
    pintar({ misVotos: { [BRUNO]: ['Empatía'] } });
    expect(within(tarjeta('Bruno Díaz')).getByRole('button', { name: /Brindis enviado/ })).toBeTruthy();
  });

  it('con los votos cerrados no hay botón de brindis', () => {
    pintar({ votosAbiertos: false });
    expect(screen.queryByRole('button', { name: /brindis/i })).toBeNull();
    expect(within(tarjeta('Carla Gómez')).getByText('Sin brindis.')).toBeTruthy();
  });

  it('subir una imagen llama a onSubirFoto; otro tipo de fichero avisa y no sube', async () => {
    const props = pintar();
    const entrada = within(tarjeta('Ana Ruiz')).getByLabelText(/Subir mi foto/);
    fireEvent.change(entrada, { target: { files: [new File(['x'], 'nota.txt', { type: 'text/plain' })] } });
    expect(notify).toHaveBeenCalledWith('El archivo debe ser una imagen.', 'error');
    expect(props.onSubirFoto).not.toHaveBeenCalled();
    const foto = new File(['x'], 'yo.png', { type: 'image/png' });
    fireEvent.change(entrada, { target: { files: [foto] } });
    await waitFor(() => expect(props.onSubirFoto).toHaveBeenCalledWith(foto));
  });
});
```

`apps/portal/src/pages/celebracion/CelebracionNavidad.muro.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import CelebracionNavidad from './CelebracionNavidad';
import { cargarVista, guardarVotos, subirMiFoto } from './api';
import { notify } from '../../lib/notify';
import { BRUNO, vistaDePrueba } from './fixtures';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarVista: vi.fn(),
  guardarConfirmacion: vi.fn(),
  guardarVotos: vi.fn(),
  subirMiFoto: vi.fn(),
  cargarResumen: vi.fn(),
}));
vi.mock('./confeti', () => ({ lanzarConfeti: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../lib/image', () => ({ fileToResizedDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA') }));
vi.mock('../../hooks/useProfile', () => ({ notifyProfileUpdated: vi.fn() }));

beforeEach(() => {
  vi.mocked(cargarVista).mockResolvedValue(vistaDePrueba());
  vi.mocked(guardarVotos).mockResolvedValue();
  vi.mocked(subirMiFoto).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function abrir() {
  render(<CelebracionNavidad />);
  fireEvent.click(await screen.findByRole('button', { name: /Abrir invitación/ }));
}

describe('CelebracionNavidad · muro', () => {
  it('brindar por un compañero guarda sus cualidades, cierra el modal y recarga', async () => {
    await abrir();
    fireEvent.click(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByRole('button', { name: /Enviar brindis/ }));
    const dialogo = screen.getByRole('dialog', { name: /Brinda por Bruno/ });
    fireEvent.click(within(dialogo).getByRole('button', { name: /Compromiso/ }));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar brindis' }));
    await waitFor(() => expect(guardarVotos).toHaveBeenCalledWith(BRUNO, ['Compromiso']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(notify).toHaveBeenCalledWith('🥂 ¡Brindis enviado para Bruno!');
    expect(cargarVista).toHaveBeenCalledTimes(2);
  });

  it('subir mi foto la redimensiona, la guarda y recarga', async () => {
    await abrir();
    const entrada = within(screen.getByRole('article', { name: 'Ana Ruiz' })).getByLabelText(/Subir mi foto/);
    fireEvent.change(entrada, { target: { files: [new File(['x'], 'yo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(subirMiFoto).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA'));
    await waitFor(() => expect(cargarVista).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith('📸 Foto actualizada en el muro del equipo.');
  });
});
```

- [ ] **Paso 2: comprueba que fallan**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/MuroEquipo.test.tsx src/pages/celebracion/CelebracionNavidad.muro.test.tsx)`
Esperado: FALLAN (no existe `./MuroEquipo` y la página aún no tiene muro).

- [ ] **Paso 3: escribe `MuroEquipo.tsx`** (`apps/portal/src/pages/celebracion/MuroEquipo.tsx`)

```tsx
import { useState, type ChangeEvent } from 'react';
import { notify } from '../../lib/notify';
import { BOTON } from './estilos';
import { ESPECTRO, FUENTE_TITULOS } from './marca';
import { colorDe, iniciales, primerNombre } from './persona';
import type { Miembro } from './tipos';

interface Props {
  equipo: Miembro[];
  yo: string;
  misVotos: Record<string, string[]>;
  votosAbiertos: boolean;
  onBrindis: (miembro: Miembro) => void;
  onSubirFoto: (archivo: File) => Promise<void>;
}

function Avatar({ miembro }: { miembro: Miembro }) {
  return (
    <div className="mx-auto mb-3 h-[74px] w-[74px] rounded-full p-[3px]" style={{ background: ESPECTRO }}>
      {miembro.avatar ? (
        <img src={miembro.avatar} alt="" className="h-full w-full rounded-full bg-white object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center rounded-full text-xl font-black text-white"
          style={{ background: colorDe(miembro.userId), fontFamily: FUENTE_TITULOS }}
        >
          {iniciales(miembro.nombre)}
        </div>
      )}
    </div>
  );
}

/** Una tarjeta por persona activa; la mía primero (decisión D7). */
export default function MuroEquipo({ equipo, yo, misVotos, votosAbiertos, onBrindis, onSubirFoto }: Props) {
  const [subiendo, setSubiendo] = useState(false);
  const ordenados = [...equipo.filter((m) => m.userId === yo), ...equipo.filter((m) => m.userId !== yo)];

  const elegirFoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) {
      notify('El archivo debe ser una imagen.', 'error');
      return;
    }
    setSubiendo(true);
    try {
      await onSubirFoto(archivo);
    } finally {
      setSubiendo(false);
    }
  };

  const sinVotos = (m: Miembro, esMia: boolean) => {
    if (esMia) return 'Aún nadie ha brindado por ti.';
    return votosAbiertos ? `Sé el primero en brindar por ${primerNombre(m.nombre)}.` : 'Sin brindis.';
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ordenados.map((m) => {
        const esMia = m.userId === yo;
        const yaVote = (misVotos[m.userId]?.length ?? 0) > 0;
        return (
          <article
            key={m.userId}
            aria-label={m.nombre}
            className="flex flex-col justify-between rounded-[22px] border-[1.5px] border-[#E6E8EF] bg-white p-5 text-center transition hover:-translate-y-1 hover:shadow-lg"
          >
            <div>
              <Avatar miembro={m} />
              <p className="mb-2.5 font-extrabold leading-snug text-[#1F2229]" style={{ fontFamily: FUENTE_TITULOS }}>
                {m.nombre}
              </p>
              {m.cualidades.length > 0 ? (
                <ul className="mb-4 flex flex-wrap justify-center gap-1.5">
                  {m.cualidades.map((c) => (
                    <li key={c.cualidad} className="rounded-full bg-[#F4F6FA] px-2.5 py-1 text-xs font-bold text-[#3E4352]">
                      ✨ {c.cualidad} · {c.votos}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-sm text-gray-500">{sinVotos(m, esMia)}</p>
              )}
            </div>

            {esMia ? (
              <label className={`${BOTON} cursor-pointer`}>
                {subiendo ? 'Subiendo…' : '📷 Subir mi foto'}
                <input type="file" accept="image/*" className="sr-only" disabled={subiendo} onChange={(e) => void elegirFoto(e)} />
              </label>
            ) : (
              votosAbiertos && (
                <button
                  type="button"
                  className={yaVote ? `${BOTON} border-[#008556] text-[#008556]` : BOTON}
                  onClick={() => onBrindis(m)}
                >
                  {yaVote ? '🥂 Brindis enviado' : '🥂 Enviar brindis'}
                </button>
              )
            )}
          </article>
        );
      })}
    </div>
  );
}
```

- [ ] **Paso 4: conecta el muro en la página** (`apps/portal/src/pages/celebracion/CelebracionNavidad.tsx`, cinco cambios)

4a. Sustituye:

```tsx
import { cargarVista, guardarConfirmacion, mensajeDeError } from './api';
```

por:

```tsx
import { notifyProfileUpdated } from '../../hooks/useProfile';
import { fileToResizedDataUrl } from '../../lib/image';
import { cargarVista, guardarConfirmacion, guardarVotos, mensajeDeError, subirMiFoto } from './api';
```

4b. Sustituye:

```tsx
import Portada from './Portada';
import TarjetasEvento from './TarjetasEvento';
import type { DatosConfirmacion, Vista } from './tipos';
```

por:

```tsx
import ModalCualidades from './ModalCualidades';
import MuroEquipo from './MuroEquipo';
import { primerNombre } from './persona';
import Portada from './Portada';
import TarjetasEvento from './TarjetasEvento';
import type { DatosConfirmacion, Miembro, Vista } from './tipos';
```

4c. Detrás de:

```tsx
  const [abierta, setAbierta] = useState(false);
```

añade:

```tsx
  const [brindisPara, setBrindisPara] = useState<Miembro | null>(null);
```

4d. Detrás de la función `confirmar` (busca la línea `  const { evento } = vista;` y ponlo justo ANTES de ella) añade:

```tsx
  const brindar = async (cualidades: string[]) => {
    if (!brindisPara) return;
    try {
      await guardarVotos(brindisPara.userId, cualidades);
    } catch (e) {
      notify(mensajeDeError(e), 'error');
      throw e;
    }
    if (cualidades.length > 0) {
      notify(`🥂 ¡Brindis enviado para ${primerNombre(brindisPara.nombre)}!`);
      lanzarConfeti();
    } else {
      notify('Brindis retirado.');
    }
    setBrindisPara(null);
    await recargar();
  };

  const subirFoto = async (archivo: File) => {
    try {
      await subirMiFoto(await fileToResizedDataUrl(archivo, 256, 0.85));
    } catch {
      notify('No se pudo actualizar la foto.', 'error');
      return;
    }
    notify('📸 Foto actualizada en el muro del equipo.');
    notifyProfileUpdated();
    await recargar();
  };

```

4e. Antes de:

```tsx
        <section aria-labelledby="titulo-confirmacion" className="mb-6">
```

añade:

```tsx
        <section aria-labelledby="titulo-equipo" className="mb-6">
          <Tarjeta>
            <div className="mx-auto mb-6 max-w-2xl text-center">
              <Etiqueta tono="pink">🌟 El corazón de Ambientalia</Etiqueta>
              <Titulo id="titulo-equipo">Nuestro equipo</Titulo>
              <p className="text-sm text-[#5C6170]">
                Brinda por tus compañeros eligiendo hasta {evento.maxCualidades} cualidades: tu voto es anónimo. Sube tu foto
                desde tu tarjeta.
              </p>
            </div>
            <MuroEquipo
              equipo={vista.equipo}
              yo={vista.yo}
              misVotos={vista.misVotos}
              votosAbiertos={evento.votosAbiertos}
              onBrindis={setBrindisPara}
              onSubirFoto={subirFoto}
            />
          </Tarjeta>
        </section>

```

4f. Sustituye el final del componente:

```tsx
      </main>
    </div>
  );
}
```

por:

```tsx
      </main>

      {brindisPara && (
        <ModalCualidades
          nombre={brindisPara.nombre}
          cualidades={evento.cualidades}
          max={evento.maxCualidades}
          seleccionInicial={vista.misVotos[brindisPara.userId] ?? []}
          onGuardar={brindar}
          onCerrar={() => setBrindisPara(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Paso 5: comprueba que pasan y que compila**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion && npx tsc -b)`
Esperado: PASA todo (incluidas las pruebas de la Tarea 13) y `tsc -b` sin errores.

- [ ] **Paso 6: commit**

```bash
git add apps/portal/src/pages/celebracion/MuroEquipo.tsx apps/portal/src/pages/celebracion/MuroEquipo.test.tsx apps/portal/src/pages/celebracion/CelebracionNavidad.tsx apps/portal/src/pages/celebracion/CelebracionNavidad.muro.test.tsx
git commit -m "feat(portal): muro del equipo con brindis y foto propia"
```

### Tarea 17: Merge D1

- [ ] **Paso 1:** `(cd apps/portal && npm test)`. Esperado: verde.
- [ ] **Paso 2:** `(cd apps/portal && npm run build && npm run lint)`. Esperado: sin errores.
- [ ] **Paso 3:** el tamaño: unas 600 líneas más desde el merge C2.
- [ ] **Paso 4:** la comprobación de privacidad, en un comando aparte. Esperado: ninguna línea.
- [ ] **Paso 5:** el merge, con el mensaje `merge: invitación de fin de año, muro y brindis`.

---

## MERGE D2 — portal: pase, panel, aviso y despliegue

### Tarea 18: el pase digital

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/pase.ts`, `PaseDigital.tsx`
- Cambiar: `apps/portal/src/pages/celebracion/CelebracionNavidad.tsx`
- Prueba: `apps/portal/src/pages/celebracion/pase.test.ts`, `PaseDigital.test.tsx`

- [ ] **Paso 1: escribe las pruebas que fallan**

`apps/portal/src/pages/celebracion/pase.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lineasPase, nombreFicheroPase } from './pase';

describe('pase', () => {
  it('el nombre del fichero no lleva tildes ni espacios', () => {
    expect(nombreFicheroPase('fin-de-ano-2026', 'José Peña Núñez')).toBe('Pase_fin-de-ano-2026_Jose_Pena_Nunez.png');
    expect(nombreFicheroPase('fin-de-ano-2026', '  ')).toBe('Pase_fin-de-ano-2026_invitado.png');
  });

  it('las líneas del pase llevan fecha, hora, lugar y menú', () => {
    expect(
      lineasPase({
        titulo: 'Almuerzo',
        nombre: 'Ana Ruiz',
        fecha: 'Viernes, 18 de diciembre de 2026',
        hora: '12:30 p. m.',
        lugar: 'Restaurante Anfitriona · Cl. 83 Bis #24-09',
        preferencia: 'Opción vegetariana',
        mensaje: null,
      }),
    ).toEqual([
      '📅 Viernes, 18 de diciembre de 2026 · 12:30 p. m.',
      '📍 Restaurante Anfitriona · Cl. 83 Bis #24-09',
      '🍽️ Preferencia: Opción vegetariana',
    ]);
  });
});
```

`apps/portal/src/pages/celebracion/PaseDigital.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PaseDigital from './PaseDigital';
import { eventoDePrueba } from './fixtures';

vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
});

describe('PaseDigital', () => {
  it('enseña mi nombre, la fecha, mi menú y mi mensaje, sin QR', () => {
    render(
      <PaseDigital
        nombre="Ana Ruiz"
        evento={eventoDePrueba()}
        respuesta={{ asiste: true, preferencia: 'vegetariano', mensaje: '¡Allá estaré!', actualizadoEn: '2026-12-01T15:00:00Z' }}
      />,
    );
    const pase = screen.getByTestId('pase');
    expect(pase.textContent).toContain('Ana Ruiz');
    expect(pase.textContent).toContain('Viernes, 18 de diciembre de 2026');
    expect(pase.textContent).toContain('Opción vegetariana');
    expect(pase.textContent).toContain('“¡Allá estaré!”');
    expect(pase.querySelector('canvas')).toBeNull();
    expect(screen.getByRole('button', { name: /Descargar pase/ })).toBeTruthy();
  });
});
```

- [ ] **Paso 2: comprueba que fallan**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/pase.test.ts src/pages/celebracion/PaseDigital.test.tsx)`
Esperado: FALLAN porque no existen `./pase` ni `./PaseDigital`.

- [ ] **Paso 3: escribe `pase.ts` y `PaseDigital.tsx`**

`apps/portal/src/pages/celebracion/pase.ts`:

```ts
import { COLORES } from './marca';

// El pase en PNG, dibujado en un lienzo. Sin QR (diseño): el de la invitación
// original era decorativo y parecía escaneable.

export interface DatosPase {
  titulo: string;
  nombre: string;
  fecha: string;
  hora: string;
  lugar: string;
  preferencia: string;
  mensaje: string | null;
}

export function lineasPase(d: DatosPase): string[] {
  return [`📅 ${d.fecha} · ${d.hora}`, `📍 ${d.lugar}`, `🍽️ Preferencia: ${d.preferencia}`];
}

export function nombreFicheroPase(eventoId: string, nombre: string): string {
  const limpio = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `Pase_${eventoId}_${limpio || 'invitado'}.png`;
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const imagen = new Image();
    imagen.onload = () => resolver(imagen);
    imagen.onerror = () => rechazar(new Error('no cargó el logo'));
    imagen.src = src;
  });
}

/** Dibuja el pase y devuelve su data URL en PNG. */
export async function dibujarPase(d: DatosPase, logoUrl: string): Promise<string> {
  const lienzo = document.createElement('canvas');
  lienzo.width = 800;
  lienzo.height = 440;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('sin contexto 2D');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 800, 440);
  const franja = ctx.createLinearGradient(0, 0, 800, 0);
  COLORES.forEach((color, i) => franja.addColorStop(i / (COLORES.length - 1), color));
  ctx.fillStyle = franja;
  ctx.fillRect(0, 0, 800, 16);

  try {
    const logo = await cargarImagen(logoUrl);
    const alto = 56;
    ctx.drawImage(logo, 44, 40, (logo.width / logo.height) * alto, alto);
  } catch {
    ctx.fillStyle = '#525252';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('Ambientalia', 44, 80);
  }

  ctx.fillStyle = '#C95B00';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(`PASE OFICIAL · ${d.titulo.toUpperCase()}`, 44, 128, 712);

  ctx.fillStyle = '#6B7280';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('INVITADO', 44, 175);
  ctx.fillStyle = '#1F2229';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(d.nombre, 44, 212, 712);

  ctx.fillStyle = '#3E4352';
  ctx.font = '20px sans-serif';
  lineasPase(d).forEach((linea, i) => ctx.fillText(linea, 44, 270 + i * 37, 712));

  if (d.mensaje) {
    ctx.fillStyle = '#4E5362';
    ctx.font = 'italic 18px sans-serif';
    ctx.fillText(`“${d.mensaje}”`, 44, 400, 712);
  }
  return lienzo.toDataURL('image/png');
}
```

`apps/portal/src/pages/celebracion/PaseDigital.tsx`:

```tsx
import { useState } from 'react';
import logo from '../../assets/ambientalia-logo.png';
import { notify } from '../../lib/notify';
import { descargarUrl } from './descargar';
import { BOTON_PRIMARIO } from './estilos';
import { fechaLarga, hora } from './fechas';
import { ESPECTRO, FUENTE_TITULOS } from './marca';
import { dibujarPase, nombreFicheroPase, type DatosPase } from './pase';
import type { Evento, Respuesta } from './tipos';

interface Props {
  nombre: string;
  evento: Pick<Evento, 'id' | 'titulo' | 'inicio' | 'lugar' | 'direccion' | 'preferencias'>;
  respuesta: Respuesta;
}

/** El pase de quien va: en pantalla y para descargar en PNG. */
export default function PaseDigital({ nombre, evento, respuesta }: Props) {
  const [descargando, setDescargando] = useState(false);
  const datos: DatosPase = {
    titulo: evento.titulo,
    nombre,
    fecha: fechaLarga(evento.inicio),
    hora: hora(evento.inicio),
    lugar: `${evento.lugar} · ${evento.direccion}`,
    preferencia: evento.preferencias.find((p) => p.codigo === respuesta.preferencia)?.texto ?? '',
    mensaje: respuesta.mensaje,
  };

  const descargar = async () => {
    setDescargando(true);
    try {
      descargarUrl(nombreFicheroPase(evento.id, nombre), await dibujarPase(datos, logo));
      notify('📸 Pase descargado.');
    } catch {
      notify('No se pudo generar el pase. Vuelve a intentarlo.', 'error');
    } finally {
      setDescargando(false);
    }
  };

  return (
    <div className="mt-8 border-t-[1.5px] border-dashed border-[#E6E8EF] pt-8">
      <div data-testid="pase" className="mx-auto mb-4 max-w-md overflow-hidden rounded-3xl border-2 border-[#E6E8EF] bg-white text-left shadow-lg">
        <div className="h-2" style={{ background: ESPECTRO }} />
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <img src={logo} alt="Ambientalia" className="h-8 w-auto" />
            <span className="rounded-full bg-[#FFF4E6] px-2.5 py-1 text-[11px] font-extrabold text-[#C95B00]">PASE OFICIAL 2026</span>
          </div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Invitado</p>
          <p className="mb-3 text-xl font-black text-[#1F2229]" style={{ fontFamily: FUENTE_TITULOS }}>
            {nombre}
          </p>
          <dl className="grid grid-cols-2 gap-2.5 rounded-2xl bg-[#F8F9FC] p-3 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Fecha y hora</dt>
              <dd className="font-bold">
                {datos.fecha} · {datos.hora}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Preferencia</dt>
              <dd className="font-bold">{datos.preferencia}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-gray-500">Lugar</dt>
              <dd className="font-bold">{datos.lugar}</dd>
            </div>
          </dl>
          {respuesta.mensaje && <p className="mt-3 text-sm italic text-[#4E5362]">“{respuesta.mensaje}”</p>}
        </div>
      </div>
      <div className="text-center">
        <button type="button" disabled={descargando} onClick={() => void descargar()} className={`${BOTON_PRIMARIO} w-full max-w-xs`}>
          {descargando ? 'Generando…' : '📸 Descargar pase (PNG)'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Paso 4: conecta el pase en la página** (`CelebracionNavidad.tsx`)

4a. Detrás de:

```tsx
import MuroEquipo from './MuroEquipo';
```

añade:

```tsx
import PaseDigital from './PaseDigital';
```

4b. Sustituye:

```tsx
            <Confirmacion evento={evento} respuesta={vista.miRespuesta} onGuardar={confirmar} />
```

por:

```tsx
            <Confirmacion evento={evento} respuesta={vista.miRespuesta} onGuardar={confirmar} />
            {vista.miRespuesta?.asiste && (
              <PaseDigital
                nombre={vista.equipo.find((m) => m.userId === vista.yo)?.nombre ?? ''}
                evento={evento}
                respuesta={vista.miRespuesta}
              />
            )}
```

- [ ] **Paso 5: comprueba que pasan y que compila**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion && npx tsc -b)`
Esperado: PASA todo y `tsc -b` sin errores.

- [ ] **Paso 6: commit**

```bash
git add apps/portal/src/pages/celebracion/pase.ts apps/portal/src/pages/celebracion/pase.test.ts apps/portal/src/pages/celebracion/PaseDigital.tsx apps/portal/src/pages/celebracion/PaseDigital.test.tsx apps/portal/src/pages/celebracion/CelebracionNavidad.tsx
git commit -m "feat(portal): pase digital descargable de la invitación"
```

### Tarea 19: panel del admin con Excel

**Ficheros:**
- Cambiar: `apps/portal/package.json` y `package-lock.json` (dependencia `xlsx`, decisión D10)
- Crear: `apps/portal/src/pages/celebracion/excel.ts`, `PanelAdmin.tsx`
- Cambiar: `apps/portal/src/pages/celebracion/fixtures.ts`, `CelebracionNavidad.tsx`
- Prueba: `apps/portal/src/pages/celebracion/excel.test.ts`, `PanelAdmin.test.tsx`, `CelebracionNavidad.admin.test.tsx`

- [ ] **Paso 1: declara `xlsx` en el portal** (desde la raíz del repo):

```bash
npm install --workspace=apps/portal "xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
git diff --stat package-lock.json apps/portal/package.json
```

Esperado: cambia `apps/portal/package.json` (una línea en `dependencies`) y el lock en pocas líneas, porque el paquete ya está en la raíz. Si el lock cambia en más de ~40 líneas o el comando falla por red, deshaz los dos ficheros con `git checkout -- package-lock.json apps/portal/package.json`, sigue sin declararlo (resuelve por la raíz, como hoy) y anótalo en el informe final.

- [ ] **Paso 2: añade el resumen de prueba** al final de `apps/portal/src/pages/celebracion/fixtures.ts`

Sustituye:

```ts
import type { Evento, Vista } from './tipos';
```

por:

```ts
import type { Evento, Resumen, Vista } from './tipos';
```

y añade al final del fichero:

```ts

export function resumenDePrueba(): Resumen {
  return {
    totales: { van: 1, noVan: 1, sinResponder: 1 },
    porPreferencia: [
      { codigo: 'general', texto: 'Menú general (sin restricciones)', total: 0 },
      { codigo: 'vegetariano', texto: 'Opción vegetariana', total: 1 },
    ],
    filas: [
      {
        userId: YO,
        nombre: 'Ana Ruiz',
        estado: 'va',
        preferencia: 'vegetariano',
        mensaje: '¡Allá estaré!',
        actualizadoEn: '2026-12-01T15:00:00.000Z',
      },
      { userId: BRUNO, nombre: 'Bruno Díaz', estado: 'no_va', preferencia: null, mensaje: null, actualizadoEn: '2026-12-02T15:00:00.000Z' },
      { userId: CARLA, nombre: 'Carla Gómez', estado: 'sin_responder', preferencia: null, mensaje: null, actualizadoEn: null },
    ],
  };
}
```

- [ ] **Paso 3: escribe las pruebas que fallan**

`apps/portal/src/pages/celebracion/excel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { COLUMNAS_EXCEL, filasExcel, nombreFicheroExcel } from './excel';
import { eventoDePrueba, resumenDePrueba } from './fixtures';

describe('Excel de confirmaciones', () => {
  it('una cabecera y una fila por persona, con textos legibles', () => {
    const filas = filasExcel(resumenDePrueba(), eventoDePrueba().preferencias);
    expect(filas[0]).toEqual(COLUMNAS_EXCEL);
    expect(filas[1]).toEqual(['Ana Ruiz', 'Va', 'Opción vegetariana', '¡Allá estaré!', '2026-12-01 10:00']);
    expect(filas[2]).toEqual(['Bruno Díaz', 'No va', '', '', '2026-12-02 10:00']);
    expect(filas[3]).toEqual(['Carla Gómez', 'Sin responder', '', '', '']);
  });

  it('el fichero lleva el evento y la fecha', () => {
    expect(nombreFicheroExcel('fin-de-ano-2026', '2026-12-05')).toBe('Confirmaciones_fin-de-ano-2026_2026-12-05.xlsx');
  });
});
```

`apps/portal/src/pages/celebracion/PanelAdmin.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import PanelAdmin from './PanelAdmin';
import { cargarResumen } from './api';
import { eventoDePrueba, resumenDePrueba } from './fixtures';

vi.mock('./api', () => ({ cargarResumen: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PanelAdmin', () => {
  it('enseña los totales, los menús y la lista con quien no ha respondido', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    render(<PanelAdmin evento={eventoDePrueba()} version={0} />);
    expect((await screen.findByTestId('cifra-van')).textContent).toContain('1');
    expect(screen.getByTestId('cifra-no-van').textContent).toContain('1');
    expect(screen.getByTestId('cifra-sin-responder').textContent).toContain('1');
    expect(screen.getByText(/Opción vegetariana:/)).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Carla Gómez' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Descargar Excel/ })).toBeTruthy();
  });

  it('vuelve a pedir el resumen cuando cambia la versión', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    const { rerender } = render(<PanelAdmin evento={eventoDePrueba()} version={0} />);
    await waitFor(() => expect(cargarResumen).toHaveBeenCalledTimes(1));
    rerender(<PanelAdmin evento={eventoDePrueba()} version={1} />);
    await waitFor(() => expect(cargarResumen).toHaveBeenCalledTimes(2));
  });

  it('si falla, ofrece reintentar', async () => {
    vi.mocked(cargarResumen).mockRejectedValueOnce(new Error('red')).mockResolvedValue(resumenDePrueba());
    render(<PanelAdmin evento={eventoDePrueba()} version={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('cifra-van')).toBeTruthy();
  });
});
```

`apps/portal/src/pages/celebracion/CelebracionNavidad.admin.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CelebracionNavidad from './CelebracionNavidad';
import { cargarResumen, cargarVista } from './api';
import { resumenDePrueba, vistaDePrueba } from './fixtures';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarVista: vi.fn(),
  guardarConfirmacion: vi.fn(),
  guardarVotos: vi.fn(),
  subirMiFoto: vi.fn(),
  cargarResumen: vi.fn(),
}));
vi.mock('./confeti', () => ({ lanzarConfeti: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function abrirCon(esAdmin: boolean, asiste: boolean | null = null) {
  vi.mocked(cargarVista).mockResolvedValue(
    vistaDePrueba({
      esAdmin,
      miRespuesta: asiste === null ? null : { asiste, preferencia: asiste ? 'general' : null, mensaje: null, actualizadoEn: '2026-12-01T15:00:00Z' },
    }),
  );
  vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
  render(<CelebracionNavidad />);
  fireEvent.click(await screen.findByRole('button', { name: /Abrir invitación/ }));
}

describe('CelebracionNavidad · admin y pase', () => {
  it('el panel solo aparece para el admin', async () => {
    await abrirCon(false);
    expect(screen.queryByRole('heading', { name: 'Panel de confirmaciones' })).toBeNull();
    expect(cargarResumen).not.toHaveBeenCalled();
    cleanup();
    await abrirCon(true);
    expect(await screen.findByRole('heading', { name: 'Panel de confirmaciones' })).toBeTruthy();
  });

  it('el pase solo aparece si voy', async () => {
    await abrirCon(false, true);
    expect(screen.getByTestId('pase').textContent).toContain('Ana Ruiz');
    cleanup();
    await abrirCon(false, false);
    expect(screen.queryByTestId('pase')).toBeNull();
  });
});
```

- [ ] **Paso 4: comprueba que fallan**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion/excel.test.ts src/pages/celebracion/PanelAdmin.test.tsx src/pages/celebracion/CelebracionNavidad.admin.test.tsx)`
Esperado: FALLAN (no existen `./excel` ni `./PanelAdmin`, y la página no tiene panel).

- [ ] **Paso 5: escribe `excel.ts` y `PanelAdmin.tsx`**

`apps/portal/src/pages/celebracion/excel.ts`:

```ts
import { fechaHoraCorta } from './fechas';
import type { EstadoRespuesta, Preferencia, Resumen } from './tipos';

export const HOJA_EXCEL = 'Confirmaciones';
export const COLUMNAS_EXCEL = ['Nombre', 'Respuesta', 'Preferencia', 'Mensaje', 'Actualizado'];

const RESPUESTA: Record<EstadoRespuesta, string> = { va: 'Va', no_va: 'No va', sin_responder: 'Sin responder' };

/** Filas (con cabecera) para `XLSX.utils.aoa_to_sheet`. */
export function filasExcel(resumen: Resumen, preferencias: Preferencia[]): string[][] {
  const texto = new Map(preferencias.map((p) => [p.codigo, p.texto] as const));
  return [
    COLUMNAS_EXCEL,
    ...resumen.filas.map((f) => [
      f.nombre,
      RESPUESTA[f.estado],
      f.preferencia ? (texto.get(f.preferencia) ?? f.preferencia) : '',
      f.mensaje ?? '',
      f.actualizadoEn ? fechaHoraCorta(f.actualizadoEn) : '',
    ]),
  ];
}

export function nombreFicheroExcel(eventoId: string, hoy: string): string {
  return `Confirmaciones_${eventoId}_${hoy}.xlsx`;
}
```

`apps/portal/src/pages/celebracion/PanelAdmin.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { notify } from '../../lib/notify';
import { cargarResumen } from './api';
import { BOTON, BOTON_PRIMARIO } from './estilos';
import { filasExcel, HOJA_EXCEL, nombreFicheroExcel } from './excel';
import { fechaHoraCorta } from './fechas';
import type { EstadoRespuesta, Evento, Resumen } from './tipos';
import { Etiqueta, Tarjeta, Titulo } from './ui';

interface Props {
  evento: Pick<Evento, 'id' | 'preferencias'>;
  /** Sube cada vez que la página recarga sus datos: el panel relee el resumen (decisión D14). */
  version: number;
}

const ESTADO: Record<EstadoRespuesta, { texto: string; clase: string }> = {
  va: { texto: 'Va', clase: 'bg-[#008556]/10 text-[#008556]' },
  no_va: { texto: 'No va', clase: 'bg-[#D81B60]/10 text-[#D81B60]' },
  sin_responder: { texto: 'Sin responder', clase: 'bg-amber-50 text-amber-800' },
};

function Cifra({ id, etiqueta, valor, color }: { id: string; etiqueta: string; valor: number; color: string }) {
  return (
    <div data-testid={`cifra-${id}`} className="rounded-2xl border border-[#E6E8EF] bg-white p-3 text-center" style={{ borderTop: `4px solid ${color}` }}>
      <span className="block text-3xl font-black text-[#1F2229]">{valor}</span>
      <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{etiqueta}</span>
    </div>
  );
}

/** Solo para el admin: quién va, quién no y quién falta, y el Excel para el restaurante. */
export default function PanelAdmin({ evento, version }: Props) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [fallo, setFallo] = useState(false);
  const [exportando, setExportando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setResumen(await cargarResumen());
      setFallo(false);
    } catch {
      setFallo(true);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  const textoMenu = (codigo: string | null) =>
    codigo ? (evento.preferencias.find((p) => p.codigo === codigo)?.texto ?? codigo) : '';

  // SheetJS pesa unos 430 KB: se descarga al pulsar, no con la página.
  const exportar = async () => {
    if (!resumen) return;
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasExcel(resumen, evento.preferencias)), HOJA_EXCEL);
      XLSX.writeFile(libro, nombreFicheroExcel(evento.id, fechaHoraCorta(new Date().toISOString()).slice(0, 10)));
    } catch {
      notify('No se pudo generar el Excel. Vuelve a intentarlo.', 'error');
    } finally {
      setExportando(false);
    }
  };

  return (
    <section aria-labelledby="titulo-panel" className="mb-6">
      <Tarjeta className="border-[#3F3D99]/30">
        <Etiqueta tono="indigo">🔒 Solo administración</Etiqueta>
        <Titulo id="titulo-panel">Panel de confirmaciones</Titulo>

        {!resumen ? (
          fallo ? (
            <div className="space-y-3">
              <p className="text-sm text-[#3E4352]">No se pudo cargar el resumen.</p>
              <button type="button" className={BOTON} onClick={() => void cargar()}>
                Reintentar
              </button>
            </div>
          ) : (
            <p role="status" className="text-sm text-gray-500">
              Cargando resumen…
            </p>
          )
        ) : (
          <>
            <div className="mb-5 grid grid-cols-3 gap-3">
              <Cifra id="van" etiqueta="Van" valor={resumen.totales.van} color="#008556" />
              <Cifra id="no-van" etiqueta="No van" valor={resumen.totales.noVan} color="#D81B60" />
              <Cifra id="sin-responder" etiqueta="Sin responder" valor={resumen.totales.sinResponder} color="#F47920" />
            </div>

            <h3 className="mb-2 text-sm font-bold text-[#3E4352]">Menús de quienes van</h3>
            <ul className="mb-5 flex flex-wrap gap-2">
              {resumen.porPreferencia.map((p) => (
                <li key={p.codigo} className="rounded-full bg-[#F4F6FA] px-3 py-1 text-sm">
                  {p.texto}: <strong>{p.total}</strong>
                </li>
              ))}
            </ul>

            <div className="mb-5 overflow-x-auto rounded-2xl border border-[#E6E8EF]">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-[#F8F9FC] text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Respuesta</th>
                    <th className="px-3 py-2">Preferencia</th>
                    <th className="px-3 py-2">Mensaje</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.filas.map((f) => (
                    <tr key={f.userId} className="border-t border-[#E6E8EF]">
                      <td className="px-3 py-2 font-semibold">{f.nombre}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${ESTADO[f.estado].clase}`}>{ESTADO[f.estado].texto}</span>
                      </td>
                      <td className="px-3 py-2">{textoMenu(f.preferencia)}</td>
                      <td className="px-3 py-2 italic text-[#4E5362]">{f.mensaje ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button type="button" disabled={exportando} onClick={() => void exportar()} className={BOTON_PRIMARIO}>
              {exportando ? 'Generando…' : '⬇️ Descargar Excel'}
            </button>
          </>
        )}
      </Tarjeta>
    </section>
  );
}
```

- [ ] **Paso 6: conecta el panel en la página** (`CelebracionNavidad.tsx`, cuatro cambios)

6a. Detrás de:

```tsx
import MuroEquipo from './MuroEquipo';
```

añade:

```tsx
import PanelAdmin from './PanelAdmin';
```

6b. Detrás de:

```tsx
  const [brindisPara, setBrindisPara] = useState<Miembro | null>(null);
```

añade:

```tsx
  const [version, setVersion] = useState(0);
```

6c. Dentro de `recargar`, sustituye:

```tsx
      setVista(await cargarVista());
      setFallo(false);
```

por:

```tsx
      setVista(await cargarVista());
      setFallo(false);
      setVersion((v) => v + 1);
```

6d. Antes de:

```tsx
        <footer className="mt-10 text-center text-sm text-gray-500">
```

añade:

```tsx
        {vista.esAdmin && <PanelAdmin evento={evento} version={version} />}

```

- [ ] **Paso 7: comprueba que pasan y que compila**

Run: `(cd apps/portal && npx vitest run src/pages/celebracion && npx tsc -b)`
Esperado: PASA todo y `tsc -b` sin errores.

- [ ] **Paso 8: commit**

```bash
git add apps/portal/package.json package-lock.json apps/portal/src/pages/celebracion/excel.ts apps/portal/src/pages/celebracion/excel.test.ts apps/portal/src/pages/celebracion/PanelAdmin.tsx apps/portal/src/pages/celebracion/PanelAdmin.test.tsx apps/portal/src/pages/celebracion/CelebracionNavidad.admin.test.tsx apps/portal/src/pages/celebracion/fixtures.ts apps/portal/src/pages/celebracion/CelebracionNavidad.tsx
git commit -m "feat(portal): panel de confirmaciones con Excel para el admin"
```

(Si en el Paso 1 deshiciste los cambios de `package.json` y del lock, quítalos de este `git add`.)

### Tarea 20: aviso en el Inicio

**Ficheros:**
- Crear: `apps/portal/src/components/AvisoCelebracion.tsx`
- Cambiar: `apps/portal/src/pages/Dashboard.tsx`, `apps/portal/src/pages/Dashboard.test.tsx`
- Prueba: `apps/portal/src/components/AvisoCelebracion.test.tsx`

- [ ] **Paso 1: escribe la prueba que falla** (`apps/portal/src/components/AvisoCelebracion.test.tsx`)

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AvisoCelebracion from './AvisoCelebracion';
import { cargarMiEstado } from '../pages/celebracion/api';

vi.mock('../pages/celebracion/api', () => ({ cargarMiEstado: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pintar() {
  render(
    <MemoryRouter>
      <AvisoCelebracion />
    </MemoryRouter>,
  );
}

describe('AvisoCelebracion', () => {
  it('invita a confirmar a quien no ha respondido, con el enlace de la invitación', async () => {
    vi.mocked(cargarMiEstado).mockResolvedValue({ respondido: false, confirmacionesAbiertas: true });
    pintar();
    const enlace = await screen.findByRole('link', { name: /Confirma tu asistencia/ });
    expect(enlace.getAttribute('href')).toBe('/celebracion-navidad-2026');
  });

  it('no sale si ya respondió, si ya cerró o si falla la consulta', async () => {
    for (const preparar of [
      () => vi.mocked(cargarMiEstado).mockResolvedValue({ respondido: true, confirmacionesAbiertas: true }),
      () => vi.mocked(cargarMiEstado).mockResolvedValue({ respondido: false, confirmacionesAbiertas: false }),
      () => vi.mocked(cargarMiEstado).mockRejectedValue(new Error('red')),
    ]) {
      preparar();
      pintar();
      await waitFor(() => expect(cargarMiEstado).toHaveBeenCalled());
      await Promise.resolve();
      expect(screen.queryByRole('link')).toBeNull();
      cleanup();
      vi.mocked(cargarMiEstado).mockReset();
    }
  });
});
```

- [ ] **Paso 2: comprueba que falla**

Run: `(cd apps/portal && npx vitest run src/components/AvisoCelebracion.test.tsx)`
Esperado: FALLA porque no existe `./AvisoCelebracion`.

- [ ] **Paso 3: escribe `AvisoCelebracion.tsx`** (`apps/portal/src/components/AvisoCelebracion.tsx`)

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cargarMiEstado } from '../pages/celebracion/api';
import { RUTA_CELEBRACION } from '../pages/celebracion/ruta';

/** En el Inicio: «Confirma tu asistencia» mientras no hayas respondido y sigan abiertas. Si falla, no sale. */
export default function AvisoCelebracion() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let vivo = true;
    cargarMiEstado()
      .then((estado) => {
        if (vivo) setVisible(!estado.respondido && estado.confirmacionesAbiertas);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (!visible) return null;
  return (
    <Link
      to={RUTA_CELEBRACION}
      className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 transition hover:bg-amber-100"
    >
      <span className="font-semibold">🥂 Confirma tu asistencia al almuerzo de fin de año</span>
      <span className="shrink-0 text-sm font-bold">Abrir invitación →</span>
    </Link>
  );
}
```

- [ ] **Paso 4: ponlo en el Inicio**

En `apps/portal/src/pages/Dashboard.tsx`, detrás de:

```tsx
import { useAuth } from '../hooks/useAuth';
```

añade:

```tsx
import AvisoCelebracion from '../components/AvisoCelebracion';
```

Y antes de:

```tsx
      {/* Controles del dashboard de widgets */}
```

añade:

```tsx
      <AvisoCelebracion />

```

En `apps/portal/src/pages/Dashboard.test.tsx`, detrás de:

```tsx
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState.value }));
```

añade:

```tsx
// El aviso de la invitación consulta hub-api por su cuenta; aquí no interesa.
vi.mock('../components/AvisoCelebracion', () => ({ default: () => null }));
```

(Si la línea del mock de `useAuth` no casa exactamente, léela con Read y pon el mock nuevo justo debajo de ella.)

- [ ] **Paso 5: comprueba que pasan**

Run: `(cd apps/portal && npx vitest run src/components/AvisoCelebracion.test.tsx src/pages/Dashboard.test.tsx)`
Esperado: PASA.

- [ ] **Paso 6: commit**

```bash
git add apps/portal/src/components/AvisoCelebracion.tsx apps/portal/src/components/AvisoCelebracion.test.tsx apps/portal/src/pages/Dashboard.tsx apps/portal/src/pages/Dashboard.test.tsx
git commit -m "feat(portal): aviso en el Inicio para confirmar la asistencia"
```

### Tarea 21: Merge D2 y despliegue

- [ ] **Paso 1:** las suites:
  - `(cd apps/portal && npm test && npm run build && npm run lint)`
  - `(cd apps/hub-api && npm test)`

  Esperado: verde y sin errores.
- [ ] **Paso 2:** repasa la cobertura del diseño contra el código. Cada punto de «La página» y de «Endpoints» del diseño tiene que tener su sitio. Anota en el informe lo que falte.
- [ ] **Paso 3:** el tamaño: unas 700 líneas más desde el merge D1.
- [ ] **Paso 4:** la comprobación de privacidad, en un comando aparte. Esperado: ninguna línea.
- [ ] **Paso 5:** el merge, con el mensaje `merge: invitación de fin de año, pase, panel y aviso`.
- [ ] **Paso 6: despliegue (lo hace el usuario en EasyPanel).** Avísale con estos pasos, en este orden:
  1. **hub-api** primero. En el arranque se aplica la migración 081: en el log debe salir `migration applied: 081_celebracion.sql`. Comprobación: `GET /api/celebracion` con sesión responde 200.
  2. **Portal** después.
  3. Prueba en el navegador (mejor en el celular):
     - abrir `https://portal.ambientalia.cloud/celebracion-navidad-2026` sin sesión → login → vuelve a la invitación;
     - confirmar, brindar por alguien, subir la foto y descargar el pase;
     - como admin, ver el panel y descargar el Excel;
     - en el Inicio, el aviso aparece si no has respondido.
  4. Solo entonces, **enviar el mensaje de WhatsApp** con el link nuevo.
- [ ] **Paso 7:** informe final al usuario:
  - qué se mergeó (los seis merges);
  - qué falta (desplegar y probar);
  - cualquier decisión tomada sobre la marcha, como `xlsx` si no se pudo declarar.

## Autorrevisión del plan (hecha al escribirlo)

- **Cobertura del diseño:**
  - ruta con sesión y sin AppGuard (T13);
  - aviso del Inicio (T20);
  - configuración única en hub-api (T1, servida en `vista`);
  - cierres que hace cumplir el servidor (T1-T2);
  - tablas, CHECKs y CASCADE (T4-T5);
  - endpoints y códigos (T6);
  - muro de activos con top 3 y número (T2, T16);
  - foto propia con el endpoint existente (T8, T16);
  - modal con tope de 3 y «Brindis enviado» (T15-T16);
  - confirmación con sus tres estados (T12);
  - pase sin QR, con mensaje (T18);
  - panel con totales, menús, sin responder y Excel (T19);
  - avisos con `notify` y recarga tras guardar (T13, T16);
  - movimiento reducido (T10), logo real y tipografías (T13);
  - pruebas pedidas (todas las tareas) y orden de despliegue (T21).
- **Sin huecos:** ningún paso remite a «hacer lo mismo que la tarea N»; cada cambio trae su código.
- **Nombres coherentes:**
  - `CelebracionActions`, `Sesion`, `vista(sesion)`, `miEstado(userId)`, `confirmar(userId, body)`, `votar(votante, votado, body)` y `resumen()` se usan igual en el servicio, el router y sus pruebas.
  - En el portal, `RUTA_CELEBRACION`, `vistaDePrueba`, `eventoDePrueba`, `resumenDePrueba`, `YO`, `BRUNO` y `CARLA` se definen antes de usarse.
