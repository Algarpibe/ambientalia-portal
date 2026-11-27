# Cualidades ocultas y presentación para el admin — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que quien no es admin deje de recibir y de ver los resultados de las votaciones de cualidades, también los suyos, hasta el almuerzo, y que el admin pueda presentarlos ese día a pantalla completa, una persona por pantalla, e imprimirlos uno por hoja.

**Architecture:**
- **hub-api** (`apps/hub-api/src/celebracion/`, sin migración):
  - `dominio.ts` gana `ordenarCualidades`: todas las cualidades con el mismo comparador del top 3. `top3` pasa a ser sus 3 primeras.
  - `service.ts`:
    - `vista(sesion)` vacía las cualidades de todos para quien no es admin y añade `cualidadesOcultas`;
    - el caso de uso nuevo `cualidadesEquipo()` devuelve a los invitados con todas sus cualidades.
  - `router.ts`: `GET /api/celebracion/cualidades` con `requireAuth` y `requireAdmin`, igual que `/resumen`.
- **Portal** (`apps/portal/src/pages/celebracion/`):
  - `tipos.ts`, `api.ts` (`cargarCualidades`) y `fixtures.ts`.
  - `AvatarPersona.tsx`, que se extrae del muro para compartirlo con la presentación.
  - El muro y la página con los textos de «se desvelan el día del almuerzo». `brindis.ts` decide el aviso del último brindis.
  - `PresentacionCualidades.tsx`, abierta desde el panel del admin, con `pantallaCompleta.ts`. Se monta con `createPortal` en `<body>` y lleva su propia regla de impresión.

**Tech Stack:**
- hub-api: TypeScript, Express y PostgreSQL. Pruebas con Vitest 2 y supertest con JWT firmado. Esta ampliación no toca SQL.
- Portal: React 19, Vite y Tailwind 3.4 (variante `print:` y utilidades `break-after-*`). Pruebas con Vitest 4, jsdom 29 y Testing Library, sin jest-dom.

---

**Diseño aprobado:** `docs/superpowers/specs/2026-11-26-invitacion-fin-de-ano-design.md`, sección «Ampliación: cualidades ocultas y presentación para el admin (2026-11-27)». Léela entera antes de empezar. No añadas nada que no pida.

**Urgencia:** mientras esto no se despliegue, el muro sigue enseñando el top 3 de todos a todos.

## Convenciones de ejecución (obligatorias)

Son las de `docs/superpowers/plans/2026-11-26-invitacion-fin-de-ano.md`, líneas 29-108. Las críticas, repetidas:

- **Raíz del repo:** `C:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07`. En Git Bash es `/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07`. Todos los comandos parten de ahí.
- **Rama:** `feat/invitacion-fin-de-ano`, que es `main` más el commit del diseño (`5e7fe72`). Se trabaja en ella y se mergea en `main` por tandas. El usuario tiene autorización permanente para `git push origin main`. Empujar NO despliega: el despliegue lo hace el usuario a mano en EasyPanel.
- **Antes de la Tarea 1**, commitea este plan:

```bash
git add docs/superpowers/plans/2026-11-27-cualidades-ocultas.md
git commit -m "docs(celebracion): plan de cualidades ocultas y presentación para el admin"
```
- **Ficheros:** se crean y se cambian SOLO con las herramientas Write y Edit.
  - Nunca con `Set-Content`, `Out-File`, `sed`, `perl` ni redirecciones: PowerShell 5.1 destroza las tildes del fichero entero.
  - En disco están en CRLF y Edit lo respeta.
  - Si un texto a sustituir no casa, lee ese tramo con Read y copia el texto de ahí.
- **Git:**
  - Siempre con la herramienta **Bash (Git Bash)**.
  - Conventional commits en español, **sin línea «Co-Authored-By» ni ninguna atribución**.
  - Rutas explícitas en `git add`. Nunca `git add -A` ni `git add .`, y nunca `git stash`.
  - No toques `.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/` ni `openspec/`: ya están modificados o sin seguimiento, y son del usuario.
- **Repo PÚBLICO:**
  - Datos ficticios siempre: «Ana Ruiz», «Bruno Díaz», «Carla Gómez», «Diana Prieto», y correos `@example.com`.
  - Ningún nombre real del equipo en el código ni en las pruebas, aunque aparezca en la conversación.
  - Nunca leas `.env*` ni secretos.
- **Idioma:** español en identificadores, comentarios, textos de la interfaz y commits.
- **TDD estricto:** prueba que falla, verla fallar, código mínimo, verla pasar, commit.
- **Pruebas de hub-api:**
  - Un fichero: `(cd apps/hub-api && npx vitest run src/celebracion/<fichero>)`.
  - La suite: `(cd apps/hub-api && npx vitest run)`. El tipado: `(cd apps/hub-api && npm run build)`; el build revisa también los `*.test.ts`.
  - **Nunca lances vitest desde la raíz del repo**: mete los `.db.test.ts` y salen unos 281 fallos falsos.
  - No hacen falta Docker ni las `*.db.test.ts`: no cambia ni el SQL ni el repositorio.
- **Pruebas del portal:**
  - Un fichero: `(cd apps/portal && npx vitest run src/pages/celebracion/<fichero>)`.
  - **Antes de cada commit del portal:** `(cd apps/portal && npx tsc -b)` y `(cd apps/portal && npx eslint <ficheros tocados>)`. Las rutas que pasas a eslint son relativas a `apps/portal`.
  - En el merge: `(cd apps/portal && npx vitest run && npm run build)` y `(cd apps/portal && npm run lint)`.
  - Los ficheros de prueba con DOM empiezan con la línea `// @vitest-environment jsdom`. Los de lógica pura, no.
  - Testing Library **sin jest-dom**: nada de `toBeInTheDocument`. Usa `toBeTruthy()`, `toBeNull()`, `not.toBeNull()` y `textContent`, como las pruebas que ya existen.
- **Lint de React 19:**
  - `react-hooks/purity` es error: no se lee `new Date()`, `Date.now()` ni `Math.random()` al pintar. El código de este plan no los usa.
  - `react-hooks/set-state-in-effect` es aviso, no error.
  - No desactives ninguna regla.
- **Textos:** con los caracteres reales (tildes, «», …, emojis). Nunca escapes `\uXXXX`.
- **Errores conocidos que no son de este trabajo:**
  - `npx tsc -p tsconfig.json --noEmit` en hub-api puede dar un error en `src/ausencias/service/barril.test.ts` (tipos de `micromatch`). No lo persigas.
  - Bajo carga, la prueba 4.4 de usuarios de hub-api puede caer por tiempo. Repítela sola antes de investigar.

### Tamaño y merges

La regla del repo es menos de 800 líneas cambiadas por merge, sin contar los documentos de diseño y plan. Se mide con:

```bash
git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'
```

| Merge | Tareas | Contenido | Líneas aprox. |
|---|---|---|---|
| E1 | 1-5 | hub-api: orden de cualidades, vista oculta, `cualidadesEquipo` y ruta | 230 |
| E2 | 6-13 | portal: cualidades ocultas en el muro y la página, presentación e impresión | 730 |

- E2 se queda en una sola tanda porque la estimación queda por debajo de 800. Si en la Tarea 13 la medida pasa de 800, no partas nada a medias: avisa en el informe. Las Tareas 6-9 (cualidades ocultas) y las 10-12 (presentación) son las dos mitades naturales por si el usuario prefiere partirlo.
- E1 funciona solo: lo que no conoce, el portal de hoy lo ignora.
- **Se despliega una vez, tras el E2**: primero hub-api y después el portal. Si el portal anterior sigue publicado un rato, sus tarjetas salen sin cualidades y no enseñan nada que no deban.

**Cómo se mergea (cada tarea «Merge»):**

1. Primero, en un comando aparte, la búsqueda de secretos:

   ```bash
   git diff main...HEAD -- . ':(exclude)docs/superpowers' | grep -nE "ambientalia\.com\.co|BEGIN (RSA|OPENSSH|PRIVATE)|JWT_SECRET=|HUB_DB_URL="
   ```

   Lo esperado es **ninguna línea** (grep sale con código 1). Si sale algo, para y pregunta al usuario.

2. Después, en otro comando aparte, la de nombres de persona en lo añadido:

   ```bash
   git diff main...HEAD -- . ':(exclude)docs/superpowers' | grep -E '^\+' | grep -oE "[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+" | sort -u
   ```

   Lo esperado es que solo salgan los nombres ficticios de las pruebas («Ana Ruiz», «Bruno Díaz», «Carla Gómez», «Diana Prieto»). Si sale cualquier otro nombre de persona, para y pregunta al usuario.

   Ninguna de las dos se encadena con `&&` al merge ni al push: grep da 0 cuando encuentra resultados.

3. Por último, comando a comando:

   ```bash
   git switch main
   git pull --ff-only origin main
   git merge --no-ff feat/invitacion-fin-de-ano -m "<mensaje de la tarea>"
   git push origin main
   git switch feat/invitacion-fin-de-ano
   ```

## Decisiones tomadas en el plan

El diseño no dice nada en estos puntos, o el código obliga a concretarlos. El plan sigue la opción marcada.

| # | Silencio del diseño | Opción del plan |
|---|---|---|
| P1 | Cómo se oculta el resto del portal al imprimir. | `PresentacionCualidades` se monta con `createPortal` directamente en `<body>`, como hermana de `#root`, y lleva dentro un `<style>` con `@media print { body > :not([data-presentacion-cualidades]) { display: none !important; } }`. Un solo selector oculta el portal entero, los avisos y cualquier otra capa. No toca `index.css` ni deja una clase en `<body>` que haya que limpiar, y la regla existe solo mientras la presentación está abierta, porque se desmonta con ella. Se puede comprobar en jsdom: que la raíz cuelga de `<body>`, el texto de la regla y que hay N hojas. |
| P2 | Esc con la pantalla completa del sistema. | El navegador se queda la primera Esc para salir de su pantalla completa y no la pasa a la página. La segunda Esc ya cierra la capa, y «Cerrar» cierra siempre a la primera. No se escucha `fullscreenchange` para cerrar: algunos navegadores salen de la pantalla completa al abrir el diálogo de impresión, y se cerraría la presentación con el diálogo abierto. |
| P3 | Dónde se sale de la pantalla completa. | En el manejador de cierre del panel, no en la limpieza de un efecto. El portal usa `StrictMode` (`src/main.tsx`), que en desarrollo monta, desmonta y vuelve a montar: saldría de la pantalla completa nada más entrar. |
| P4 | Cómo se sabe que un brindis completa el mínimo. | Antes de guardar, con la función pura `completaLosBrindis(vista, votadoId, cualidades)` de `brindis.ts`. La lógica que ya existe en `CelebracionNavidad.tsx:83-93` (`bloqueadaODesconocido`) detecta otra cosa: que la confirmación pasa de bloqueada a libre, para lo que hacen falta la foto **y** los brindis, y solo con las confirmaciones abiertas. Además lo ve después de recargar. El aviso nuevo sustituye al de siempre, que sale antes de recargar, y tiene que salir también sin foto y después del 4 de diciembre, porque los votos siguen abiertos hasta el 18. Esa lógica se queda tal cual para bajar a la confirmación. |
| P5 | Fixtures. | `vistaDePrueba()` lleva `cualidadesOcultas: false`: las pruebas que ya existen pintan cualidades y siguen igual. `vistaDeEmpleado()` es la vista realista de quien no es admin, con las cualidades vacías y `cualidadesOcultas: true`. |
| P6 | Tipo de la respuesta de `GET /cualidades`. | La misma forma que un miembro de la vista. En hub-api es `CualidadesEquipo { equipo: MiembroVista[] }` y en el portal, `CualidadesEquipo { equipo: Miembro[] }`. Solo cambia que `cualidades` las trae todas, no las 3 primeras. |
| P7 | La presentación sin nadie. | «No hay nadie en la invitación.», con mover e imprimir deshabilitados. En la práctica no pasa: el admin no puede quitarse de la invitación. |
| P8 | Dónde va el botón. | Al pie del panel, fuera del bloque del resumen: se ve aunque el resumen esté cargando o haya fallado, porque no depende de él. |
| P9 | Colores al imprimir. | Fondo blanco en pantalla y en papel, para no gastar tinta. La regla de impresión lleva `print-color-adjust: exact` para que salgan el aro de color de la foto y las pastillas. |
| P10 | Las hojas que no se ven en pantalla. | Llevan `aria-hidden="true"` además de `hidden print:flex`. El lector de pantalla no las lee, y las pruebas distinguen la actual sin CSS (jsdom no carga Tailwind). |
| P11 | Un 401 en la ruta nueva. | Solo sale sin sesión, de `requireAuth`, como en todas las rutas. Los errores del caso de uso son 400, 403 o 409, nunca 401: el portal cierra la sesión ante un 401. A quien no es admin, `requireAdmin` le responde 403 `{ error: 'forbidden' }`. |

## Mapa de ficheros

**hub-api (`apps/hub-api/src/celebracion/`)**

| Fichero | Cambio |
|---|---|
| `dominio.ts` | `ordenarCualidades` nueva; `top3` la reutiliza (Tarea 1). |
| `service.ts` | `Vista.cualidadesOcultas`, la vista sin cualidades para quien no es admin (Tarea 2); `CualidadesEquipo`, `agruparPorVotado` y `cualidadesEquipo()` (Tarea 3). |
| `router.ts` | `cualidadesEquipo` en `CelebracionActions` y la ruta `GET /celebracion/cualidades` (Tarea 4). |
| `dominio.test.ts`, `service.test.ts`, `router.test.ts` | Pruebas de cada tarea. |

**Portal (`apps/portal/src/pages/celebracion/`)**

| Fichero | Cambio |
|---|---|
| `tipos.ts` | `Vista.cualidadesOcultas` y `CualidadesEquipo` (Tarea 6). |
| `api.ts`, `api.test.ts` | `cargarCualidades()` (Tarea 6). |
| `fixtures.ts` | `cualidadesOcultas` por defecto, `vistaDeEmpleado()` y `cualidadesDePrueba()` (Tarea 6). |
| `AvatarPersona.tsx` (nuevo), `AvatarPersona.test.tsx` (nuevo) | Avatar con foto graciosa, de perfil o iniciales, de tamaño configurable (Tarea 7). |
| `MuroEquipo.tsx`, `MuroEquipo.test.tsx` | Usa `AvatarPersona` (Tarea 7) y la prop `cualidadesOcultas` (Tarea 8). |
| `brindis.ts` (nuevo), `brindis.test.ts` (nuevo) | `completaLosBrindis` (Tarea 9). |
| `CelebracionNavidad.tsx`, `CelebracionNavidad.muro.test.tsx` | Pasa `cualidadesOcultas` al muro (Tarea 8); el aviso del último brindis y la línea fija (Tarea 9). |
| `pantallaCompleta.ts` (nuevo), `pantallaCompleta.test.ts` (nuevo) | Entrar y salir de la pantalla completa, con guarda (Tarea 10). |
| `PresentacionCualidades.tsx` (nuevo), `PresentacionCualidades.test.tsx` (nuevo) | La presentación en pantalla y en papel (Tarea 11). |
| `PanelAdmin.tsx`, `PanelAdmin.test.tsx` | El botón «🎤 Presentar cualidades» (Tarea 12). |

---

## MERGE E1 — hub-api: cualidades ocultas y ruta para el admin

### Tarea 1: `ordenarCualidades` en el dominio

**Ficheros:**
- Cambiar: `apps/hub-api/src/celebracion/dominio.ts:129-135` (`top3`)
- Prueba: `apps/hub-api/src/celebracion/dominio.test.ts`: el import de las líneas 3-12 y un bloque nuevo al final.

- [ ] **Paso 1: escribe la prueba que falla.** En el import de `./dominio.js` de `dominio.test.ts`:

  Busca:

```ts
  esUuid,
  parseConfirmacion,
```

  Cámbialo por:

```ts
  esUuid,
  ordenarCualidades,
  parseConfirmacion,
```

  Al final del fichero, busca el cierre del bloque `top3`:

```ts
  it('ignora las cualidades que ya no están en la lista', () => {
    expect(top3([{ cualidad: 'Puntualidad', votos: 9 }])).toEqual([]);
  });
});
```

  Y añade detrás:

```ts

describe('ordenarCualidades', () => {
  const conteos = [
    { cualidad: 'Creatividad', votos: 1 },
    { cualidad: 'Compromiso', votos: 2 },
    { cualidad: 'Puntualidad', votos: 9 },
    { cualidad: 'Empatía', votos: 2 },
    { cualidad: 'Generosidad', votos: 0 },
    { cualidad: 'Liderazgo', votos: 5 },
    { cualidad: 'Espíritu positivo', votos: 1 },
  ];

  it('devuelve todas, por votos y con el desempate de la lista, sin las de 0 votos ni las que ya no están', () => {
    expect(ordenarCualidades(conteos)).toEqual([
      { cualidad: 'Liderazgo', votos: 5 },
      { cualidad: 'Empatía', votos: 2 },
      { cualidad: 'Compromiso', votos: 2 },
      { cualidad: 'Creatividad', votos: 1 },
      { cualidad: 'Espíritu positivo', votos: 1 },
    ]);
  });

  it('sus 3 primeras son el top 3', () => {
    expect(top3(conteos)).toEqual(ordenarCualidades(conteos).slice(0, 3));
  });

  it('no cambia la lista que recibe', () => {
    const copia = conteos.map((c) => ({ ...c }));
    ordenarCualidades(conteos);
    expect(conteos).toEqual(copia);
  });
});
```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/hub-api && npx vitest run src/celebracion/dominio.test.ts)
```

  Esperado: las 3 pruebas nuevas fallan con `TypeError: … ordenarCualidades is not a function`. Las demás, en verde.

- [ ] **Paso 3: implementación mínima.** En `dominio.ts`:

  Busca:

```ts
/** Las 3 cualidades más votadas; empata el orden de la lista. Las que ya no están en la lista no salen. */
export function top3(conteos: readonly CualidadVotada[]): CualidadVotada[] {
  return conteos
    .filter((c) => c.votos > 0 && ORDEN.has(c.cualidad))
    .sort((a, b) => b.votos - a.votos || (ORDEN.get(a.cualidad) ?? 0) - (ORDEN.get(b.cualidad) ?? 0))
    .slice(0, MAX_CUALIDADES);
}
```

  Cámbialo por:

```ts
/**
 * Todas las cualidades con votos, de más a menos votadas; empata el orden de la lista.
 * Las que ya no están en la lista no salen. No cambia la lista que recibe.
 */
export function ordenarCualidades(conteos: readonly CualidadVotada[]): CualidadVotada[] {
  return conteos
    .filter((c) => c.votos > 0 && ORDEN.has(c.cualidad))
    .sort((a, b) => b.votos - a.votos || (ORDEN.get(a.cualidad) ?? 0) - (ORDEN.get(b.cualidad) ?? 0));
}

/** Las 3 cualidades más votadas: las primeras de `ordenarCualidades`. */
export function top3(conteos: readonly CualidadVotada[]): CualidadVotada[] {
  return ordenarCualidades(conteos).slice(0, MAX_CUALIDADES);
}
```

- [ ] **Paso 4: ejecútala y mírala en verde.** El mismo comando del Paso 2. Esperado: todo verde, también las dos pruebas de `top3` que ya existían.

- [ ] **Paso 5: commit.**

```bash
git add apps/hub-api/src/celebracion/dominio.ts apps/hub-api/src/celebracion/dominio.test.ts
git commit -m "feat(celebracion): ordenar todas las cualidades con el desempate del top 3"
```

---

### Tarea 2: la vista oculta las cualidades a quien no es admin

**Ficheros:**
- Cambiar: `apps/hub-api/src/celebracion/service.ts`: la interfaz `Vista` (líneas 75-90) y el `return` de `vista()` (líneas 184-198).
- Prueba: `apps/hub-api/src/celebracion/service.test.ts`: las pruebas de las líneas 63-74 y 432-443, y dos nuevas.

- [ ] **Paso 1: escribe la prueba que falla.**

  a) Las pruebas que ya leen las cualidades con `esAdmin: false` pasan a leerlas como admin. Siguen en verde antes y después del cambio.

  Busca:

```ts
  it('cada tarjeta trae su top 3 con número, sin contar votos de cuentas inactivas', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Empatía', 'Liderazgo'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, DIANA, BRUNO, ['Compromiso', 'Creatividad', 'Generosidad'], ANTES_DEL_CORTE);
    const { equipo } = await service.vista({ userId: ANA, esAdmin: false });
```

  Cámbialo por:

```ts
  it('al admin, cada tarjeta le trae su top 3 con número, sin contar votos de cuentas inactivas', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Empatía', 'Liderazgo'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, DIANA, BRUNO, ['Compromiso', 'Creatividad', 'Generosidad'], ANTES_DEL_CORTE);
    const { equipo } = await service.vista({ userId: ANA, esAdmin: true });
```

  Busca `    const durante = await service.vista({ userId: ANA, esAdmin: false });` y cámbialo por:

```ts
    const durante = await service.vista({ userId: ANA, esAdmin: true });
```

  Busca `    const despues = await service.vista({ userId: ANA, esAdmin: false });` y cámbialo por:

```ts
    const despues = await service.vista({ userId: ANA, esAdmin: true });
```

  b) Dos pruebas nuevas en el bloque `vista`. Busca el final de la prueba del top 3:

```ts
    expect(equipo.find((m) => m.userId === CARLA)?.cualidades).toEqual([]);
  });
```

  Y añade detrás:

```ts

  it('a quien no es admin no le llega ninguna cualidad, tampoco las suyas, y cualidadesOcultas lo dice', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, BRUNO, ANA, ['Empatía'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, ANA, BRUNO, ['Liderazgo'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, BRUNO, ['Liderazgo'], ANTES_DEL_CORTE);
    const vista = await service.vista({ userId: ANA, esAdmin: false });
    expect(vista.cualidadesOcultas).toBe(true);
    expect(vista.equipo.map((m) => m.cualidades)).toEqual([[], [], []]);
    // Ni rastro de los conteos en la respuesta: se verían en las herramientas del navegador.
    expect(JSON.stringify(vista.equipo)).not.toContain('votos');
    // Sus propios brindis sí le llegan, para poder cambiarlos.
    expect(vista.misVotos).toEqual({ [BRUNO]: ['Liderazgo'] });
  });

  it('el admin recibe cualidadesOcultas: false y también su propio top 3', async () => {
    const { store, service } = montar();
    await store.reemplazarVotos(EVENTO.id, BRUNO, ANA, ['Empatía'], ANTES_DEL_CORTE);
    const vista = await service.vista({ userId: ANA, esAdmin: true });
    expect(vista.cualidadesOcultas).toBe(false);
    expect(vista.equipo.find((m) => m.userId === ANA)?.cualidades).toEqual([{ cualidad: 'Empatía', votos: 1 }]);
  });
```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/hub-api && npx vitest run src/celebracion/service.test.ts)
```

  Esperado: fallan las 2 nuevas, con `expected undefined to be true` y `expected undefined to be false`. Las tres pruebas cambiadas a `esAdmin: true` siguen en verde.

- [ ] **Paso 3: implementación mínima.** En `service.ts`:

  Busca:

```ts
  /** Brindis por compañeros invitados distintos que llevo y los que hacen falta para responder. */
  brindis: { dados: number; minimo: number };
}
```

  Cámbialo por:

```ts
  /** Brindis por compañeros invitados distintos que llevo y los que hacen falta para responder. */
  brindis: { dados: number; minimo: number };
  /** true para quien no es admin: sus `cualidades` llegan vacías; se desvelan el día del almuerzo. */
  cualidadesOcultas: boolean;
}
```

  Busca:

```ts
      equipo: equipo.map((m) => ({
        ...m,
        cualidades: top3(porVotado.get(m.userId) ?? []),
        foto: fotoDe.get(m.userId.toLowerCase()) ?? null,
      })),
```

  Cámbialo por:

```ts
      // Los conteos solo le llegan al admin: si no, se verían en las herramientas del navegador.
      equipo: equipo.map((m) => ({
        ...m,
        cualidades: sesion.esAdmin ? top3(porVotado.get(m.userId) ?? []) : [],
        foto: fotoDe.get(m.userId.toLowerCase()) ?? null,
      })),
```

  Busca:

```ts
      brindis: this.brindis(equipo, mios, sesion.userId),
    };
```

  Cámbialo por:

```ts
      brindis: this.brindis(equipo, mios, sesion.userId),
      cualidadesOcultas: !sesion.esAdmin,
    };
```

- [ ] **Paso 4: ejecútala y mírala en verde.**

```bash
(cd apps/hub-api && npx vitest run src/celebracion/service.test.ts src/celebracion/router.test.ts)
```

  Esperado: todo verde.

- [ ] **Paso 5: commit.**

```bash
git add apps/hub-api/src/celebracion/service.ts apps/hub-api/src/celebracion/service.test.ts
git commit -m "feat(celebracion): ocultar las cualidades a quien no es admin"
```

---

### Tarea 3: `cualidadesEquipo()` en el servicio

**Ficheros:**
- Cambiar: `apps/hub-api/src/celebracion/service.ts`:
  - el import de `./dominio.js` (líneas 2-13);
  - `CualidadesEquipo`, detrás de `Vista`;
  - el bucle de `porVotado` en `vista()` (líneas 159-164);
  - `agruparPorVotado`, delante de la clase;
  - el método nuevo, detrás de `resumen()`.
- Prueba: `apps/hub-api/src/celebracion/service.test.ts`, con un bloque nuevo delante de `describe('resumen', …)`.

- [ ] **Paso 1: escribe la prueba que falla.** En `service.test.ts`, busca la línea `describe('resumen', () => {` y añade **delante**:

```ts
describe('cualidadesEquipo', () => {
  const FOTO_DE_BRUNO = 'data:image/png;base64,BBBB';

  /** Carla recibe 5 cualidades distintas, 4 empatadas a 1 voto; Diana, inactiva, vota y no cuenta. */
  async function votosDePrueba(store: FakeStore): Promise<void> {
    await store.reemplazarVotos(EVENTO.id, ANA, CARLA, ['Compromiso', 'Empatía', 'Creatividad'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, BRUNO, CARLA, ['Compromiso', 'Generosidad', 'Liderazgo'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, DIANA, CARLA, ['Perseverancia'], ANTES_DEL_CORTE);
    await store.reemplazarVotos(EVENTO.id, CARLA, ANA, ['Empatía'], ANTES_DEL_CORTE);
    await store.guardarFoto(EVENTO.id, BRUNO, FOTO_DE_BRUNO, ANTES_DEL_CORTE);
  }

  it('trae a los invitados por nombre, con su avatar, su foto y TODAS sus cualidades, por votos y con el desempate de la lista', async () => {
    const { store, service } = montar();
    await votosDePrueba(store);
    expect(await service.cualidadesEquipo()).toEqual({
      equipo: [
        { userId: ANA, nombre: 'Ana Ruiz', avatar: null, foto: null, cualidades: [{ cualidad: 'Empatía', votos: 1 }] },
        { userId: BRUNO, nombre: 'Bruno Díaz', avatar: 'data:image/jpeg;base64,AAAA', foto: FOTO_DE_BRUNO, cualidades: [] },
        {
          userId: CARLA,
          nombre: 'Carla Gómez',
          avatar: null,
          foto: null,
          cualidades: [
            { cualidad: 'Compromiso', votos: 2 },
            { cualidad: 'Liderazgo', votos: 1 },
            { cualidad: 'Empatía', votos: 1 },
            { cualidad: 'Creatividad', votos: 1 },
            { cualidad: 'Generosidad', votos: 1 },
          ],
        },
      ],
    });
  });

  it('sus 3 primeras son el top 3 que el admin ve en el muro', async () => {
    const { store, service } = montar();
    await votosDePrueba(store);
    const muro = await service.vista({ userId: ANA, esAdmin: true });
    const { equipo } = await service.cualidadesEquipo();
    expect(equipo.map((p) => p.cualidades.slice(0, 3))).toEqual(muro.equipo.map((m) => m.cualidades));
  });

  it('deja fuera a los excluidos y no cuenta sus votos', async () => {
    const { store, service } = montar();
    await votosDePrueba(store);
    await service.excluir(ANA, BRUNO);
    const { equipo } = await service.cualidadesEquipo();
    expect(equipo.map((p) => p.nombre)).toEqual(['Ana Ruiz', 'Carla Gómez']);
    expect(equipo[1].cualidades).toEqual([
      { cualidad: 'Empatía', votos: 1 },
      { cualidad: 'Compromiso', votos: 1 },
      { cualidad: 'Creatividad', votos: 1 },
    ]);
  });
});

```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/hub-api && npx vitest run src/celebracion/service.test.ts)
```

  Esperado: las 3 nuevas fallan con `TypeError: service.cualidadesEquipo is not a function`.

- [ ] **Paso 3: implementación mínima.** En `service.ts`, en este orden:

  a) En el import de `./dominio.js`, busca:

```ts
  esUuid,
  parseConfirmacion,
```

  Cámbialo por:

```ts
  esUuid,
  ordenarCualidades,
  parseConfirmacion,
```

  b) Detrás de `Vista`, busca:

```ts
  cualidadesOcultas: boolean;
}

export interface MiEstado {
```

  Cámbialo por:

```ts
  cualidadesOcultas: boolean;
}

/** GET /celebracion/cualidades (solo admin): los invitados, con TODAS sus cualidades y no solo el top 3. */
export interface CualidadesEquipo {
  equipo: MiembroVista[];
}

export interface MiEstado {
```

  c) En `vista()`, busca:

```ts
    const porVotado = new Map<string, CualidadVotada[]>();
    for (const c of conteos) {
      const lista = porVotado.get(c.votadoId) ?? [];
      lista.push({ cualidad: c.cualidad, votos: c.votos });
      porVotado.set(c.votadoId, lista);
    }
```

  Cámbialo por:

```ts
    const porVotado = agruparPorVotado(conteos);
```

  d) Delante de la clase, busca:

```ts
/** Casos de uso de la invitación. El reloj se inyecta: los cierres se prueban sin esperar a diciembre. */
export class CelebracionService {
```

  Cámbialo por:

```ts
/** Los conteos de cada votado, para buscarlos por su userId. */
function agruparPorVotado(conteos: readonly ConteoVotos[]): Map<string, CualidadVotada[]> {
  const porVotado = new Map<string, CualidadVotada[]>();
  for (const c of conteos) {
    const lista = porVotado.get(c.votadoId) ?? [];
    lista.push({ cualidad: c.cualidad, votos: c.votos });
    porVotado.set(c.votadoId, lista);
  }
  return porVotado;
}

/** Casos de uso de la invitación. El reloj se inyecta: los cierres se prueban sin esperar a diciembre. */
export class CelebracionService {
```

  e) Al final de la clase, busca el cierre de `resumen()` y de la clase:

```ts
      excluidos: todos
        .filter((m) => excluidos.has(m.userId.toLowerCase()))
        .map((m) => ({ userId: m.userId, nombre: m.nombre })),
    };
  }
}
```

  Cámbialo por:

```ts
      excluidos: todos
        .filter((m) => excluidos.has(m.userId.toLowerCase()))
        .map((m) => ({ userId: m.userId, nombre: m.nombre })),
    };
  }

  /**
   * Para la presentación del admin (el router exige admin): cada invitado, en el orden del equipo, con TODAS las
   * cualidades que recibió. Solo conteos, nunca quién votó; cuentan los mismos votos que en el muro.
   */
  async cualidadesEquipo(): Promise<CualidadesEquipo> {
    const [{ equipo }, conteos, fotos] = await Promise.all([
      this.invitados(),
      this.store.contarVotos(EVENTO.id),
      this.store.listarFotos(EVENTO.id),
    ]);
    const porVotado = agruparPorVotado(conteos);
    const fotoDe = new Map(fotos.map((f) => [f.userId.toLowerCase(), f.foto] as const));
    return {
      equipo: equipo.map((m) => ({
        ...m,
        cualidades: ordenarCualidades(porVotado.get(m.userId) ?? []),
        foto: fotoDe.get(m.userId.toLowerCase()) ?? null,
      })),
    };
  }
}
```

- [ ] **Paso 4: ejecútala y mírala en verde.** El comando del Paso 2. Esperado: todo verde, incluidas las pruebas de `vista`, porque `agruparPorVotado` hace lo mismo que el bucle que sustituye.

- [ ] **Paso 5: commit.**

```bash
git add apps/hub-api/src/celebracion/service.ts apps/hub-api/src/celebracion/service.test.ts
git commit -m "feat(celebracion): todas las cualidades del equipo para la presentación del admin"
```

---

### Tarea 4: la ruta `GET /api/celebracion/cualidades`, solo para el admin

**Ficheros:**
- Cambiar: `apps/hub-api/src/celebracion/router.ts`: el comentario de la línea 9, `CelebracionActions` en la línea 12 y la ruta nueva detrás de la de `/resumen` (línea 80).
- Prueba: `apps/hub-api/src/celebracion/router.test.ts`: el `stub` (líneas 41-53) y dos pruebas nuevas detrás de la de `/resumen` (líneas 165-173).

- [ ] **Paso 1: escribe la prueba que falla.**

  a) En `stub`, busca:

```ts
    resumen: vi.fn(async () => ({ hola: 'resumen' }) as never),
    ...parcial,
```

  Cámbialo por:

```ts
    resumen: vi.fn(async () => ({ hola: 'resumen' }) as never),
    cualidadesEquipo: vi.fn(async () => ({ equipo: [] })),
    ...parcial,
```

  b) Busca el final de la prueba de `/resumen`:

```ts
    const res = await request(app).get('/api/celebracion/resumen').set(cabecera(ADMIN, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hola: 'resumen' });
  });
```

  Y añade detrás:

```ts

  it('GET /celebracion/cualidades es solo para admin: a los demás, 403 forbidden sin tocar el servicio', async () => {
    const service = stub();
    const app = montar(service);
    const empleado = await request(app).get('/api/celebracion/cualidades').set(cabecera(ANA));
    expect(empleado.status).toBe(403);
    expect(empleado.body).toEqual({ error: 'forbidden' });
    expect(service.cualidadesEquipo).not.toHaveBeenCalled();
    const res = await request(app).get('/api/celebracion/cualidades').set(cabecera(ADMIN, 'admin'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ equipo: [] });
    expect(service.cualidadesEquipo).toHaveBeenCalledTimes(1);
  });

  it('si GET /celebracion/cualidades falla, es 500 genérico y va a Sentry con su endpoint', async () => {
    const service = stub({
      cualidadesEquipo: vi.fn(async () => {
        throw new Error('la BD se cayó');
      }),
    });
    const res = await request(montar(service)).get('/api/celebracion/cualidades').set(cabecera(ADMIN, 'admin'));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { endpoint: 'celebracion_cualidades' });
  });
```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/hub-api && npx vitest run src/celebracion/router.test.ts)
```

  Esperado: las 2 nuevas fallan con `expected 404 to be 403` y `expected 404 to be 500`, porque la ruta todavía no existe.

- [ ] **Paso 3: implementación mínima.** En `router.ts`:

  Busca:

```ts
// El resumen y quitar o readmitir personas, además, exigen admin.
```

  Cámbialo por:

```ts
// El resumen, las cualidades de todos y quitar o readmitir personas, además, exigen admin.
```

  Busca:

```ts
export type CelebracionActions = Pick<CelebracionService, 'vista' | 'miEstado' | 'confirmar' | 'votar' | 'resumen' | 'excluir' | 'readmitir' | 'subirFoto'>;
```

  Cámbialo por:

```ts
export type CelebracionActions = Pick<
  CelebracionService,
  'vista' | 'miEstado' | 'confirmar' | 'votar' | 'resumen' | 'excluir' | 'readmitir' | 'subirFoto' | 'cualidadesEquipo'
>;
```

  Busca:

```ts
  router.get('/celebracion/resumen', requireAuth, requireAdmin, ruta('celebracion_resumen', () => service.resumen()));
```

  Cámbialo por:

```ts
  router.get('/celebracion/resumen', requireAuth, requireAdmin, ruta('celebracion_resumen', () => service.resumen()));

  // Las cualidades de todos, para la presentación del día del almuerzo: solo el admin (403 a los demás).
  router.get(
    '/celebracion/cualidades',
    requireAuth,
    requireAdmin,
    ruta('celebracion_cualidades', () => service.cualidadesEquipo()),
  );
```

- [ ] **Paso 4: ejecútala y mírala en verde.**

```bash
(cd apps/hub-api && npx vitest run src/celebracion)
(cd apps/hub-api && npm run build)
```

  Esperado: todo verde, y el build sin errores. El build comprueba que el `stub` cumple `CelebracionActions`. `vitest.config.ts` deja fuera los `*.db.test.ts`, así que `src/celebracion` no necesita BD.

- [ ] **Paso 5: commit.**

```bash
git add apps/hub-api/src/celebracion/router.ts apps/hub-api/src/celebracion/router.test.ts
git commit -m "feat(celebracion): ruta GET /celebracion/cualidades solo para el admin"
```

---

### Tarea 5: Merge E1

- [ ] **Paso 1:** la suite de hub-api: `(cd apps/hub-api && npx vitest run)`. Esperado: todo verde, salvo los errores conocidos de las convenciones.
- [ ] **Paso 2:** el build: `(cd apps/hub-api && npm run build)`. Esperado: sin errores.
- [ ] **Paso 3:** el tamaño: `git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'`. Esperado: unas 230 líneas.
- [ ] **Paso 4:** las dos comprobaciones de privacidad, cada una en su comando (ver «Cómo se mergea»). Esperado: ninguna línea en la primera y solo nombres ficticios en la segunda.
- [ ] **Paso 5:** el merge, con el mensaje `merge: cualidades ocultas en hub-api y ruta de cualidades para el admin` (ver «Cómo se mergea»). No se despliega todavía: se despliega todo tras el E2.

---

## MERGE E2 — portal: cualidades ocultas y presentación

### Tarea 6: tipos, llamada y fixtures

**Ficheros:**
- Cambiar: `apps/portal/src/pages/celebracion/tipos.ts`: `Vista` (líneas 50-59) y `CualidadesEquipo` nuevo.
- Cambiar: `apps/portal/src/pages/celebracion/api.ts`: el import de la línea 2 y `cargarCualidades`, detrás de `cargarResumen` (líneas 36-38).
- Cambiar: `apps/portal/src/pages/celebracion/fixtures.ts`: el import de la línea 1, `vistaDePrueba` (líneas 52-64) y dos funciones nuevas.
- Prueba: `apps/portal/src/pages/celebracion/api.test.ts`.

- [ ] **Paso 1: escribe la prueba que falla.** En `api.test.ts`:

  Busca:

```ts
import {
  cargarMiEstado,
```

  Cámbialo por:

```ts
import {
  cargarCualidades,
  cargarMiEstado,
```

  Busca el final de la primera prueba:

```ts
      '/api/celebracion/resumen',
    ]);
  });
```

  Y añade detrás:

```ts

  it('cargarCualidades pide la ruta del admin y devuelve el equipo', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { equipo: [] }));
    await expect(cargarCualidades()).resolves.toEqual({ equipo: [] });
    expect(mockFetch).toHaveBeenCalledWith('/api/celebracion/cualidades');
  });
```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion/api.test.ts)
```

  Esperado: la nueva falla con `TypeError: … cargarCualidades is not a function`.

- [ ] **Paso 3: implementación mínima.**

  a) En `tipos.ts`, busca:

```ts
  /** Brindis por compañeros invitados distintos que llevo y los que hacen falta (todos) para responder. */
  brindis: { dados: number; minimo: number };
}
```

  Cámbialo por:

```ts
  /** Brindis por compañeros invitados distintos que llevo y los que hacen falta (todos) para responder. */
  brindis: { dados: number; minimo: number };
  /** true para quien no es admin: hub-api le manda las cualidades vacías; se desvelan el día del almuerzo. */
  cualidadesOcultas: boolean;
}

/** GET /api/celebracion/cualidades (solo admin): los invitados con TODAS sus cualidades, de más a menos votadas. */
export interface CualidadesEquipo {
  equipo: Miembro[];
}
```

  b) En `api.ts`, busca:

```ts
import type { DatosConfirmacion, MiEstado, Resumen, Vista } from './tipos';
```

  Cámbialo por:

```ts
import type { CualidadesEquipo, DatosConfirmacion, MiEstado, Resumen, Vista } from './tipos';
```

  Busca:

```ts
export async function cargarResumen(): Promise<Resumen> {
  return leer<Resumen>(await authFetch(`${BASE}/resumen`));
}
```

  Cámbialo por:

```ts
export async function cargarResumen(): Promise<Resumen> {
  return leer<Resumen>(await authFetch(`${BASE}/resumen`));
}

/** Solo admin: todas las cualidades de cada invitado, para presentarlas el día del almuerzo. */
export async function cargarCualidades(): Promise<CualidadesEquipo> {
  return leer<CualidadesEquipo>(await authFetch(`${BASE}/cualidades`));
}
```

  c) En `fixtures.ts`, busca:

```ts
import type { Evento, Miembro, Resumen, Vista } from './tipos';
```

  Cámbialo por:

```ts
import type { CualidadesEquipo, Evento, Miembro, Resumen, Vista } from './tipos';
```

  Busca:

```ts
    brindis: { dados: 2, minimo: 2 },
    ...cambios,
  };
}
```

  Cámbialo por:

```ts
    brindis: { dados: 2, minimo: 2 },
    // Como la ve el admin: las pruebas del muro pintan las cualidades. La del empleado es vistaDeEmpleado().
    cualidadesOcultas: false,
    ...cambios,
  };
}

/** Como la recibe quien no es admin: hub-api le manda las cualidades vacías y `cualidadesOcultas: true`. */
export function vistaDeEmpleado(cambios: Partial<Vista> = {}): Vista {
  return vistaDePrueba({
    cualidadesOcultas: true,
    equipo: equipoDePrueba().map((m) => ({ ...m, cualidades: [] })),
    ...cambios,
  });
}
```

  Al final del fichero, busca:

```ts
    excluidos: [],
  };
}
```

  Cámbialo por:

```ts
    excluidos: [],
  };
}

/** GET /cualidades de prueba: Ana con 5 cualidades (top 3 y 2 más), Bruno con una y foto de perfil, Carla sin brindis. */
export function cualidadesDePrueba(): CualidadesEquipo {
  return {
    equipo: [
      {
        userId: YO,
        nombre: 'Ana Ruiz',
        avatar: null,
        foto: FOTO_DE_PRUEBA,
        cualidades: [
          { cualidad: 'Empatía', votos: 5 },
          { cualidad: 'Liderazgo', votos: 3 },
          { cualidad: 'Compromiso', votos: 2 },
          { cualidad: 'Creatividad', votos: 1 },
          { cualidad: 'Trabajo en equipo', votos: 1 },
        ],
      },
      {
        userId: BRUNO,
        nombre: 'Bruno Díaz',
        avatar: 'data:image/jpeg;base64,PERFIL',
        foto: null,
        cualidades: [{ cualidad: 'Empatía', votos: 4 }],
      },
      { userId: CARLA, nombre: 'Carla Gómez', avatar: null, foto: null, cualidades: [] },
    ],
  };
}
```

- [ ] **Paso 4: ejecútala y mírala en verde.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion)
```

  Esperado: todo verde. Con `cualidadesOcultas: false` por defecto, ninguna prueba existente cambia.

- [ ] **Paso 5: tipos y lint.**

```bash
(cd apps/portal && npx tsc -b)
(cd apps/portal && npx eslint src/pages/celebracion/tipos.ts src/pages/celebracion/api.ts src/pages/celebracion/api.test.ts src/pages/celebracion/fixtures.ts)
```

  Esperado: sin errores.

- [ ] **Paso 6: commit.**

```bash
git add apps/portal/src/pages/celebracion/tipos.ts apps/portal/src/pages/celebracion/api.ts apps/portal/src/pages/celebracion/api.test.ts apps/portal/src/pages/celebracion/fixtures.ts
git commit -m "feat(portal): tipos y llamada de las cualidades ocultas y de la presentación"
```

---

### Tarea 7: `AvatarPersona`, extraído del muro

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/AvatarPersona.tsx`
- Cambiar: `apps/portal/src/pages/celebracion/MuroEquipo.tsx`: los imports (líneas 1-6), el `Avatar` local (líneas 17-34) y su uso (línea 74).
- Prueba: `apps/portal/src/pages/celebracion/AvatarPersona.test.tsx` (nuevo). `MuroEquipo.test.tsx` sigue igual y protege el cambio.

- [ ] **Paso 1: escribe la prueba que falla.** Crea `AvatarPersona.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import AvatarPersona from './AvatarPersona';
import { BRUNO } from './fixtures';

afterEach(() => {
  cleanup();
});

const SIN_FOTOS = { userId: BRUNO, nombre: 'Bruno Díaz', avatar: null, foto: null };

describe('AvatarPersona', () => {
  it('pinta la foto graciosa antes que la de perfil y, sin ella, la de perfil', () => {
    const { container, rerender } = render(
      <AvatarPersona persona={{ ...SIN_FOTOS, avatar: 'data:image/jpeg;base64,PERFIL', foto: 'data:image/jpeg;base64,GRACIOSA' }} />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,GRACIOSA');
    rerender(<AvatarPersona persona={{ ...SIN_FOTOS, avatar: 'data:image/jpeg;base64,PERFIL' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,PERFIL');
  });

  it('sin ninguna foto pinta las iniciales, con el tamaño del muro por defecto', () => {
    const { container } = render(<AvatarPersona persona={SIN_FOTOS} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('BD');
    expect((container.firstElementChild as HTMLElement).className).toContain('h-[74px]');
  });

  it('acepta otro tamaño y otras iniciales para la presentación', () => {
    const { container } = render(<AvatarPersona persona={SIN_FOTOS} className="h-44 w-44" claseIniciales="text-6xl" />);
    const aro = container.firstElementChild as HTMLElement;
    expect(aro.className).toContain('h-44');
    expect(aro.className).not.toContain('h-[74px]');
    expect(aro.querySelector('.text-6xl')?.textContent).toBe('BD');
  });
});
```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion/AvatarPersona.test.tsx)
```

  Esperado: el fichero falla al cargar con `Failed to resolve import "./AvatarPersona"`.

- [ ] **Paso 3: implementación mínima.**

  a) Crea `AvatarPersona.tsx`:

```tsx
import { ESPECTRO, FUENTE_TITULOS } from './marca';
import { colorDe, iniciales } from './persona';
import type { Miembro } from './tipos';

interface Props {
  persona: Pick<Miembro, 'userId' | 'nombre' | 'avatar' | 'foto'>;
  /** Tamaño, margen y grosor del aro; por defecto, los del muro. */
  className?: string;
  /** Tamaño de las iniciales cuando no hay foto. */
  claseIniciales?: string;
}

/** La foto graciosa; si no hay, la de perfil; si tampoco, las iniciales sobre su color. */
export default function AvatarPersona({ persona, className = 'mb-3 h-[74px] w-[74px] p-[3px]', claseIniciales = 'text-xl' }: Props) {
  const imagen = persona.foto ?? persona.avatar;
  return (
    <div className={`mx-auto rounded-full ${className}`} style={{ background: ESPECTRO }}>
      {imagen ? (
        <img src={imagen} alt="" className="h-full w-full rounded-full bg-white object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className={`flex h-full w-full items-center justify-center rounded-full font-black text-white ${claseIniciales}`}
          style={{ background: colorDe(persona.userId), fontFamily: FUENTE_TITULOS }}
        >
          {iniciales(persona.nombre)}
        </div>
      )}
    </div>
  );
}
```

  b) En `MuroEquipo.tsx`, busca:

```tsx
import { BOTON } from './estilos';
import { ESPECTRO, FUENTE_TITULOS } from './marca';
import { colorDe, iniciales, primerNombre } from './persona';
import type { Miembro } from './tipos';
```

  Cámbialo por:

```tsx
import AvatarPersona from './AvatarPersona';
import { BOTON } from './estilos';
import { FUENTE_TITULOS } from './marca';
import { primerNombre } from './persona';
import type { Miembro } from './tipos';
```

  c) Borra el `Avatar` local con la línea en blanco que lo sigue. Busca:

```tsx
function Avatar({ miembro }: { miembro: Miembro }) {
  const imagen = miembro.foto ?? miembro.avatar;
  return (
    <div className="mx-auto mb-3 h-[74px] w-[74px] rounded-full p-[3px]" style={{ background: ESPECTRO }}>
      {imagen ? (
        <img src={imagen} alt="" className="h-full w-full rounded-full bg-white object-cover" />
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
```

  Cámbialo por:

```tsx
/** Una tarjeta por persona activa; la mía primero (decisión D7). */
```

  d) Busca `              <Avatar miembro={m} />` y cámbialo por:

```tsx
              <AvatarPersona persona={m} />
```

- [ ] **Paso 4: ejecútala y mírala en verde.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion/AvatarPersona.test.tsx src/pages/celebracion/MuroEquipo.test.tsx)
```

  Esperado: todo verde. Las pruebas de foto y avatar del muro no cambian.

- [ ] **Paso 5: tipos y lint.**

```bash
(cd apps/portal && npx tsc -b)
(cd apps/portal && npx eslint src/pages/celebracion/AvatarPersona.tsx src/pages/celebracion/AvatarPersona.test.tsx src/pages/celebracion/MuroEquipo.tsx)
```

- [ ] **Paso 6: commit.**

```bash
git add apps/portal/src/pages/celebracion/AvatarPersona.tsx apps/portal/src/pages/celebracion/AvatarPersona.test.tsx apps/portal/src/pages/celebracion/MuroEquipo.tsx
git commit -m "refactor(portal): extraer AvatarPersona del muro para compartirlo"
```

---

### Tarea 8: el muro dice que las cualidades se desvelan el día del almuerzo

**Ficheros:**
- Cambiar: `apps/portal/src/pages/celebracion/MuroEquipo.tsx`: `Props`, la firma y el bloque de cualidades de la tarjeta.
- Cambiar: `apps/portal/src/pages/celebracion/CelebracionNavidad.tsx`: las props de `<MuroEquipo>` (líneas 250-257).
- Prueba: `apps/portal/src/pages/celebracion/MuroEquipo.test.tsx` (import de la línea 6, `pintar` de las líneas 16-28 y dos pruebas nuevas).
- Prueba: `apps/portal/src/pages/celebracion/CelebracionNavidad.muro.test.tsx` (import de la línea 9 y una prueba nueva).

- [ ] **Paso 1: escribe la prueba que falla.**

  a) En `MuroEquipo.test.tsx`, busca:

```ts
import { BRUNO, CARLA, equipoDePrueba, FOTO_DE_PRUEBA, vistaDePrueba, YO } from './fixtures';
```

  Cámbialo por:

```ts
import { BRUNO, CARLA, equipoDePrueba, FOTO_DE_PRUEBA, vistaDeEmpleado, vistaDePrueba, YO } from './fixtures';
```

  Busca:

```ts
function pintar(cambios: { votosAbiertos?: boolean; misVotos?: Record<string, string[]>; equipo?: Miembro[] } = {}) {
  const vista = vistaDePrueba();
  const props = {
    equipo: cambios.equipo ?? vista.equipo,
    yo: YO,
    misVotos: cambios.misVotos ?? {},
    votosAbiertos: cambios.votosAbiertos ?? true,
```

  Cámbialo por:

```ts
function pintar(
  cambios: { votosAbiertos?: boolean; misVotos?: Record<string, string[]>; equipo?: Miembro[]; cualidadesOcultas?: boolean } = {},
) {
  const vista = vistaDePrueba();
  const props = {
    equipo: cambios.equipo ?? vista.equipo,
    yo: YO,
    misVotos: cambios.misVotos ?? {},
    votosAbiertos: cambios.votosAbiertos ?? true,
    cualidadesOcultas: cambios.cualidadesOcultas ?? false,
```

  Al final del fichero, busca:

```ts
    await waitFor(() => expect(props.onSubirFoto).toHaveBeenCalledWith(foto));
  });
});
```

  Cámbialo por:

```ts
    await waitFor(() => expect(props.onSubirFoto).toHaveBeenCalledWith(foto));
  });

  it('con las cualidades ocultas, cada tarjeta dice que se desvelan el día del almuerzo, sin pistas, y los botones siguen', () => {
    pintar({ cualidadesOcultas: true, equipo: vistaDeEmpleado().equipo });
    for (const nombre of ['Ana Ruiz', 'Bruno Díaz', 'Carla Gómez']) {
      expect(within(tarjeta(nombre)).getByText('🤫 Se desvelan el día del almuerzo')).toBeTruthy();
    }
    expect(screen.queryByText('Aún nadie ha brindado por ti.')).toBeNull();
    expect(screen.queryByText(/Sé el primero en brindar/)).toBeNull();
    expect(screen.queryByText(/✨/)).toBeNull();
    expect(within(tarjeta('Bruno Díaz')).getByRole('button', { name: /Enviar brindis/ })).toBeTruthy();
    expect(within(tarjeta('Ana Ruiz')).getByLabelText(/foto graciosa/)).toBeTruthy();
  });

  it('con las cualidades ocultas y los votos cerrados tampoco dice «Sin brindis.»', () => {
    pintar({ cualidadesOcultas: true, votosAbiertos: false, equipo: vistaDeEmpleado().equipo });
    expect(screen.queryByText('Sin brindis.')).toBeNull();
    expect(screen.getAllByText('🤫 Se desvelan el día del almuerzo')).toHaveLength(3);
  });
});
```

  b) En `CelebracionNavidad.muro.test.tsx`, busca:

```ts
import { BRUNO, equipoDePrueba, vistaDePrueba } from './fixtures';
```

  Cámbialo por:

```ts
import { BRUNO, equipoDePrueba, vistaDeEmpleado, vistaDePrueba } from './fixtures';
```

  Al final del fichero, busca el cierre de la última prueba y del `describe`:

```ts
      expect(screen.getByRole('button', { name: /Sí voy/ })).toBeTruthy();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
```

  Cámbialo por:

```ts
      expect(screen.getByRole('button', { name: /Sí voy/ })).toBeTruthy();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('al empleado, las tarjetas le dicen que las cualidades se desvelan el día del almuerzo', async () => {
    vi.mocked(cargarVista).mockResolvedValue(vistaDeEmpleado());
    await abrir();
    expect(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByText('🤫 Se desvelan el día del almuerzo')).toBeTruthy();
  });
});
```

  El texto buscado aparece dos veces en el fichero, pero solo la segunda va seguida del cierre del `describe`, así que el bloque casa una sola vez.

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion/MuroEquipo.test.tsx src/pages/celebracion/CelebracionNavidad.muro.test.tsx)
```

  Esperado: fallan las 3 nuevas.
  - Las dos que buscan el texto, con `Unable to find an element with the text: 🤫 Se desvelan el día del almuerzo`.
  - La de los votos cerrados, con `Found multiple elements with the text: Sin brindis.`: hoy las tres tarjetas lo dicen, y `queryByText` falla si encuentra más de uno.

- [ ] **Paso 3: implementación mínima.**

  a) En `MuroEquipo.tsx`, busca:

```tsx
  votosAbiertos: boolean;
  onBrindis: (miembro: Miembro) => void;
```

  Cámbialo por:

```tsx
  votosAbiertos: boolean;
  /** Quien no es admin no recibe las cualidades: la tarjeta dice que se desvelan el día del almuerzo. */
  cualidadesOcultas: boolean;
  onBrindis: (miembro: Miembro) => void;
```

  Busca:

```tsx
export default function MuroEquipo({ equipo, yo, misVotos, votosAbiertos, onBrindis, onSubirFoto }: Props) {
```

  Cámbialo por:

```tsx
export default function MuroEquipo({ equipo, yo, misVotos, votosAbiertos, cualidadesOcultas, onBrindis, onSubirFoto }: Props) {
```

  Busca:

```tsx
              {m.cualidades.length > 0 ? (
```

  Cámbialo por:

```tsx
              {cualidadesOcultas ? (
                <p className="mb-4 text-sm font-semibold text-[#5C6170]">🤫 Se desvelan el día del almuerzo</p>
              ) : m.cualidades.length > 0 ? (
```

  b) En `CelebracionNavidad.tsx`, busca:

```tsx
              votosAbiertos={evento.votosAbiertos}
              onBrindis={setBrindisPara}
```

  Cámbialo por:

```tsx
              votosAbiertos={evento.votosAbiertos}
              cualidadesOcultas={vista.cualidadesOcultas}
              onBrindis={setBrindisPara}
```

- [ ] **Paso 4: ejecútala y mírala en verde.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion)
```

  Esperado: todo verde.

- [ ] **Paso 5: tipos y lint.**

```bash
(cd apps/portal && npx tsc -b)
(cd apps/portal && npx eslint src/pages/celebracion/MuroEquipo.tsx src/pages/celebracion/MuroEquipo.test.tsx src/pages/celebracion/CelebracionNavidad.tsx src/pages/celebracion/CelebracionNavidad.muro.test.tsx)
```

- [ ] **Paso 6: commit.**

```bash
git add apps/portal/src/pages/celebracion/MuroEquipo.tsx apps/portal/src/pages/celebracion/MuroEquipo.test.tsx apps/portal/src/pages/celebracion/CelebracionNavidad.tsx apps/portal/src/pages/celebracion/CelebracionNavidad.muro.test.tsx
git commit -m "feat(portal): el muro dice que las cualidades se desvelan el día del almuerzo"
```

---

### Tarea 9: el aviso del último brindis y la línea fija de «Nuestro equipo»

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/brindis.ts`
- Cambiar: `apps/portal/src/pages/celebracion/CelebracionNavidad.tsx`:
  - el import de `./api` (línea 5);
  - `brindar` (líneas 151-171);
  - `const bloqueada` (línea 187);
  - el hueco entre `<PasosEquipo>` y `<MuroEquipo>`.
- Prueba: `apps/portal/src/pages/celebracion/brindis.test.ts` (nuevo, sin DOM).
- Prueba: `apps/portal/src/pages/celebracion/CelebracionNavidad.muro.test.tsx`: el import, un ayudante y cuatro pruebas nuevas.

- [ ] **Paso 1: escribe la prueba que falla.**

  a) Crea `brindis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { completaLosBrindis } from './brindis';
import { BRUNO, CARLA } from './fixtures';

/** Falta un compañero: ya brindé por Carla y me queda Bruno. */
const faltaUno = { brindis: { dados: 1, minimo: 2 }, misVotos: { [CARLA]: ['Empatía'] } };

describe('completaLosBrindis', () => {
  it('es true al brindar por el último compañero que faltaba', () => {
    expect(completaLosBrindis(faltaUno, BRUNO, ['Compromiso'])).toBe(true);
  });

  it('es false si después todavía faltan', () => {
    expect(completaLosBrindis({ brindis: { dados: 0, minimo: 2 }, misVotos: {} }, BRUNO, ['Compromiso'])).toBe(false);
  });

  it('es false al cambiar el brindis de alguien por quien ya había brindado', () => {
    expect(completaLosBrindis(faltaUno, CARLA, ['Compromiso'])).toBe(false);
  });

  it('es false al retirar un brindis, con los brindis ya completos o sin nadie por quien brindar', () => {
    expect(completaLosBrindis(faltaUno, BRUNO, [])).toBe(false);
    expect(completaLosBrindis({ brindis: { dados: 2, minimo: 2 }, misVotos: {} }, BRUNO, ['Compromiso'])).toBe(false);
    expect(completaLosBrindis({ brindis: { dados: 0, minimo: 0 }, misVotos: {} }, BRUNO, ['Compromiso'])).toBe(false);
  });
});
```

  b) En `CelebracionNavidad.muro.test.tsx`, busca:

```ts
import { BRUNO, equipoDePrueba, vistaDeEmpleado, vistaDePrueba } from './fixtures';
```

  Cámbialo por:

```ts
import { BRUNO, CARLA, equipoDePrueba, eventoDePrueba, vistaDeEmpleado, vistaDePrueba } from './fixtures';
```

  Busca:

```tsx
async function abrir() {
  render(<CelebracionNavidad />);
  fireEvent.click(await screen.findByRole('button', { name: /Abrir invitación/ }));
}
```

  Cámbialo por:

```tsx
async function abrir() {
  render(<CelebracionNavidad />);
  fireEvent.click(await screen.findByRole('button', { name: /Abrir invitación/ }));
}

const LINEA_OCULTA = '🤫 Los resultados de los brindis se desvelarán el día del almuerzo';

/** Brinda por Bruno con «Compromiso» desde su tarjeta. */
function brindarPorBruno() {
  fireEvent.click(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByRole('button', { name: /Enviar brindis/ }));
  const dialogo = screen.getByRole('dialog', { name: /Brinda por Bruno/ });
  fireEvent.click(within(dialogo).getByRole('button', { name: /Compromiso/ }));
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar brindis' }));
}
```

  Al final del fichero, busca:

```ts
    expect(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByText('🤫 Se desvelan el día del almuerzo')).toBeTruthy();
  });
});
```

  Cámbialo por:

```ts
    expect(within(screen.getByRole('article', { name: 'Bruno Díaz' })).getByText('🤫 Se desvelan el día del almuerzo')).toBeTruthy();
  });

  it('con las cualidades ocultas, el brindis que completa el mínimo avisa de que los resultados se desvelarán', async () => {
    vi.mocked(cargarVista)
      .mockResolvedValueOnce(vistaDeEmpleado({ brindis: { dados: 1, minimo: 2 }, misVotos: { [CARLA]: ['Empatía'] } }))
      .mockResolvedValue(
        vistaDeEmpleado({ brindis: { dados: 2, minimo: 2 }, misVotos: { [CARLA]: ['Empatía'], [BRUNO]: ['Compromiso'] } }),
      );
    await abrir();
    brindarPorBruno();
    await waitFor(() => expect(guardarVotos).toHaveBeenCalledWith(BRUNO, ['Compromiso']));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('🥂 ¡Ya brindaste por todos! Los resultados se desvelarán el día del almuerzo'),
    );
    expect(notify).not.toHaveBeenCalledWith('🥂 ¡Brindis enviado para Bruno!');
  });

  it('el admin, que ve las cualidades, recibe el aviso de siempre aunque complete el mínimo', async () => {
    vi.mocked(cargarVista).mockResolvedValue(
      vistaDePrueba({ esAdmin: true, brindis: { dados: 1, minimo: 2 }, misVotos: { [CARLA]: ['Empatía'] } }),
    );
    await abrir();
    brindarPorBruno();
    await waitFor(() => expect(notify).toHaveBeenCalledWith('🥂 ¡Brindis enviado para Bruno!'));
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('desvelarán'));
  });

  it('con los brindis completos, «Nuestro equipo» dice que los resultados se desvelarán, también tras el cierre', async () => {
    vi.mocked(cargarVista).mockResolvedValue(vistaDeEmpleado());
    await abrir();
    expect(screen.getByText(LINEA_OCULTA)).toBeTruthy();
    cleanup();
    vi.mocked(cargarVista).mockResolvedValue(vistaDeEmpleado({ evento: eventoDePrueba({ confirmacionesAbiertas: false }) }));
    await abrir();
    expect(screen.queryByText('🎉 ¡Listo! Ya puedes confirmar tu asistencia')).toBeNull();
    expect(screen.getByText(LINEA_OCULTA)).toBeTruthy();
  });

  it('sin los brindis completos, o para el admin, no sale la línea', async () => {
    vi.mocked(cargarVista).mockResolvedValue(vistaDeEmpleado({ brindis: { dados: 1, minimo: 2 } }));
    await abrir();
    expect(screen.queryByText(LINEA_OCULTA)).toBeNull();
    cleanup();
    vi.mocked(cargarVista).mockResolvedValue(vistaDePrueba({ esAdmin: true }));
    await abrir();
    expect(screen.queryByText(LINEA_OCULTA)).toBeNull();
  });
});
```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion/brindis.test.ts src/pages/celebracion/CelebracionNavidad.muro.test.tsx)
```

  Esperado:
  - `brindis.test.ts` falla al cargar con `Error: Cannot find module './brindis'`. Sin jsdom, el mensaje es ese y no `Failed to resolve import`.
  - En la página fallan dos pruebas. La del aviso, porque `notify` recibió «🥂 ¡Brindis enviado para Bruno!». La de la línea fija, con `Unable to find an element with the text: 🤫 Los resultados…`.
  - Las otras dos ya pasan: son las guardas del admin y del empleado que aún no ha terminado, y tienen que seguir en verde después.

- [ ] **Paso 3: implementación mínima.**

  a) Crea `brindis.ts`:

```ts
import type { Vista } from './tipos';

/**
 * ¿Guardar `cualidades` para `votadoId` completa los brindis que faltaban para responder? Repite la cuenta de
 * hub-api: compañeros distintos con al menos una cualidad. Solo suma uno si aún no se había brindado por él.
 */
export function completaLosBrindis(
  vista: Pick<Vista, 'brindis' | 'misVotos'>,
  votadoId: string,
  cualidades: readonly string[],
): boolean {
  const { dados, minimo } = vista.brindis;
  const esNuevo = (vista.misVotos[votadoId]?.length ?? 0) === 0;
  return cualidades.length > 0 && esNuevo && dados < minimo && dados + 1 >= minimo;
}
```

  b) En `CelebracionNavidad.tsx`, busca:

```tsx
import { cargarVista, ErrorApi, guardarConfirmacion, guardarVotos, mensajeDeError, subirFotoCelebracion } from './api';
```

  Cámbialo por:

```tsx
import { cargarVista, ErrorApi, guardarConfirmacion, guardarVotos, mensajeDeError, subirFotoCelebracion } from './api';
import { completaLosBrindis } from './brindis';
```

  Busca:

```tsx
  const brindar = async (cualidades: string[]) => {
    if (!brindisPara) return;
    try {
```

  Cámbialo por:

```tsx
  const brindar = async (cualidades: string[]) => {
    if (!brindisPara) return;
    // Se decide antes de guardar, con la vista de antes: este aviso sustituye al de siempre (decisión P4).
    const ultimoBrindis = vista.cualidadesOcultas && completaLosBrindis(vista, brindisPara.userId, cualidades);
    try {
```

  Busca:

```tsx
      notify(`🥂 ¡Brindis enviado para ${primerNombre(brindisPara.nombre)}!`);
```

  Cámbialo por:

```tsx
      notify(
        ultimoBrindis
          ? '🥂 ¡Ya brindaste por todos! Los resultados se desvelarán el día del almuerzo'
          : `🥂 ¡Brindis enviado para ${primerNombre(brindisPara.nombre)}!`,
      );
```

  Busca:

```tsx
  const bloqueada = bloqueadaODesconocido === true;
```

  Cámbialo por:

```tsx
  const bloqueada = bloqueadaODesconocido === true;
  const brindisCompletos = vista.brindis.minimo > 0 && vista.brindis.dados >= vista.brindis.minimo;
```

  Busca:

```tsx
              onIrAConfirmar={() => irA(confirmacionRef)}
            />
            <MuroEquipo
```

  Cámbialo por:

```tsx
              onIrAConfirmar={() => irA(confirmacionRef)}
            />
            {/* Fija, también tras el cierre de confirmaciones, cuando PasosEquipo ya no pinta nada. */}
            {vista.cualidadesOcultas && brindisCompletos && (
              <p className="mx-auto mb-6 max-w-2xl rounded-2xl border border-[#3F3D99]/20 bg-[#3F3D99]/5 px-4 py-3 text-center text-sm font-bold text-[#3F3D99]">
                🤫 Los resultados de los brindis se desvelarán el día del almuerzo
              </p>
            )}
            <MuroEquipo
```

- [ ] **Paso 4: ejecútala y mírala en verde.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion)
```

  Esperado: todo verde, también las pruebas que ya había de bajar sola a la confirmación.

- [ ] **Paso 5: tipos y lint.**

```bash
(cd apps/portal && npx tsc -b)
(cd apps/portal && npx eslint src/pages/celebracion/brindis.ts src/pages/celebracion/brindis.test.ts src/pages/celebracion/CelebracionNavidad.tsx src/pages/celebracion/CelebracionNavidad.muro.test.tsx)
```

- [ ] **Paso 6: commit.**

```bash
git add apps/portal/src/pages/celebracion/brindis.ts apps/portal/src/pages/celebracion/brindis.test.ts apps/portal/src/pages/celebracion/CelebracionNavidad.tsx apps/portal/src/pages/celebracion/CelebracionNavidad.muro.test.tsx
git commit -m "feat(portal): aviso del último brindis y línea de resultados ocultos en el muro"
```

---

### Tarea 10: entrar y salir de la pantalla completa

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/pantallaCompleta.ts`
- Prueba: `apps/portal/src/pages/celebracion/pantallaCompleta.test.ts` (nuevo)

- [ ] **Paso 1: escribe la prueba que falla.** Crea `pantallaCompleta.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { entrarPantallaCompleta, salirPantallaCompleta } from './pantallaCompleta';

// jsdom no trae la API de pantalla completa, igual que el iPhone: cada prueba la pone a mano.
const raiz = document.documentElement as unknown as Record<string, unknown>;
const doc = document as unknown as Record<string, unknown>;

afterEach(() => {
  delete raiz.requestFullscreen;
  delete doc.exitFullscreen;
  delete doc.fullscreenElement;
});

describe('pantalla completa', () => {
  it('sin la API no hace nada y no falla', () => {
    expect(() => entrarPantallaCompleta()).not.toThrow();
    expect(() => salirPantallaCompleta()).not.toThrow();
  });

  it('pide la pantalla completa de toda la página y, si el navegador la niega, no falla', async () => {
    const pedir = vi.fn(() => Promise.reject(new Error('denegada')));
    raiz.requestFullscreen = pedir;
    entrarPantallaCompleta();
    expect(pedir).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // el rechazo ya tiene su catch: no sale «unhandled rejection»
  });

  it('sale de la pantalla completa solo si la página está en ella', () => {
    const salir = vi.fn(() => Promise.resolve());
    doc.exitFullscreen = salir;
    salirPantallaCompleta();
    expect(salir).not.toHaveBeenCalled();
    doc.fullscreenElement = document.documentElement;
    salirPantallaCompleta();
    expect(salir).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion/pantallaCompleta.test.ts)
```

  Esperado: el fichero falla al cargar con `Failed to resolve import "./pantallaCompleta"`.

- [ ] **Paso 3: implementación mínima.** Crea `pantallaCompleta.ts`:

```ts
// Pantalla completa del sistema para la presentación de cualidades. El navegador solo la concede dentro de un
// gesto del usuario (el clic de «Presentar cualidades»). El iPhone no trae la API: entonces no se hace nada y
// basta la capa fija de la presentación.

/** Pide la pantalla completa de toda la página; sin la API, o si el navegador la niega, no pasa nada. */
export function entrarPantallaCompleta(): void {
  const raiz = document.documentElement;
  if (typeof raiz.requestFullscreen !== 'function') return;
  // Promise.resolve: algún navegador antiguo devuelve undefined en vez de una promesa.
  Promise.resolve(raiz.requestFullscreen()).catch(() => {
    // Denegada: la presentación sigue en su capa.
  });
}

/** Sale de la pantalla completa solo si la página está en ella. */
export function salirPantallaCompleta(): void {
  if (!document.fullscreenElement || typeof document.exitFullscreen !== 'function') return;
  Promise.resolve(document.exitFullscreen()).catch(() => {
    // Ya había salido, por ejemplo con Esc: nada que hacer.
  });
}
```

- [ ] **Paso 4: ejecútala y mírala en verde.** El comando del Paso 2. Esperado: verde.

- [ ] **Paso 5: tipos y lint.**

```bash
(cd apps/portal && npx tsc -b)
(cd apps/portal && npx eslint src/pages/celebracion/pantallaCompleta.ts src/pages/celebracion/pantallaCompleta.test.ts)
```

- [ ] **Paso 6: commit.**

```bash
git add apps/portal/src/pages/celebracion/pantallaCompleta.ts apps/portal/src/pages/celebracion/pantallaCompleta.test.ts
git commit -m "feat(portal): entrar y salir de la pantalla completa con guarda"
```

---

### Tarea 11: la presentación de cualidades, en pantalla y en papel

**Ficheros:**
- Crear: `apps/portal/src/pages/celebracion/PresentacionCualidades.tsx`
- Prueba: `apps/portal/src/pages/celebracion/PresentacionCualidades.test.tsx` (nuevo)

**Cómo se oculta el resto del portal al imprimir (decisión P1):** la presentación se monta con `createPortal(…, document.body)`, así que su raíz (`[data-presentacion-cualidades]`) es hermana de `#root`. Dentro lleva un `<style>` con `@media print { body > :not([data-presentacion-cualidades]) { display: none !important; } }`, y en papel la capa deja de ser fija (`print:static print:block print:overflow-visible`). Todas las personas están en el DOM:
- en pantalla solo se ve la actual: `flex`, y las demás, `hidden`;
- en papel salen todas (`print:flex`), cada una en su hoja (`break-after-page`, salvo la última);
- la barra de botones lleva `print:hidden`.

- [ ] **Paso 1: escribe la prueba que falla.** Crea `PresentacionCualidades.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import PresentacionCualidades from './PresentacionCualidades';
import { cargarCualidades } from './api';
import { cualidadesDePrueba, FOTO_DE_PRUEBA } from './fixtures';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarCualidades: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(cargarCualidades).mockResolvedValue(cualidadesDePrueba());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pintar() {
  const onCerrar = vi.fn();
  render(<PresentacionCualidades onCerrar={onCerrar} />);
  return { onCerrar };
}

/** La hoja de esa persona, se vea o no en pantalla. */
const hoja = (nombre: string) =>
  screen.getAllByTestId('hoja').find((h) => h.getAttribute('aria-label') === nombre) as HTMLElement;
const contador = () => screen.getByTestId('contador').textContent;
const boton = (nombre: RegExp | string) => screen.getByRole('button', { name: nombre }) as HTMLButtonElement;

describe('PresentacionCualidades', () => {
  it('pide las cualidades al abrirse: «Cargando…» mientras tanto y, si fallan, «Reintentar»', async () => {
    vi.mocked(cargarCualidades).mockRejectedValueOnce(new Error('red'));
    pintar();
    expect(screen.getByText('Cargando…')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Ana Ruiz' })).toBeTruthy();
    expect(cargarCualidades).toHaveBeenCalledTimes(2);
  });

  it('es una capa fija sobre la página, con el foco, que empieza por la primera persona', async () => {
    pintar();
    const capa = screen.getByRole('dialog', { name: 'Presentación de cualidades' });
    expect(capa.className).toContain('fixed inset-0');
    expect(document.activeElement).toBe(capa);
    expect(await screen.findByRole('heading', { name: 'Ana Ruiz' })).toBeTruthy();
    expect(contador()).toBe('1 / 3');
  });

  it('cada persona lleva su foto, su nombre, el top 3 en grande y el resto en pequeño, con número; «Sin brindis» si no tiene', async () => {
    pintar();
    await screen.findByRole('heading', { name: 'Ana Ruiz' });
    const ana = hoja('Ana Ruiz');
    expect(ana.querySelector('img')?.getAttribute('src')).toBe(FOTO_DE_PRUEBA);
    const textos = (lista: string) =>
      within(within(ana).getByRole('list', { name: lista })).getAllByRole('listitem').map((li) => li.textContent);
    expect(textos('Top 3')).toEqual(['✨ Empatía · 5', '✨ Liderazgo · 3', '✨ Compromiso · 2']);
    expect(textos('Más cualidades')).toEqual(['Creatividad · 1', 'Trabajo en equipo · 1']);

    const bruno = hoja('Bruno Díaz');
    expect(bruno.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,PERFIL');
    expect(within(bruno).getByText('✨ Empatía · 4')).toBeTruthy();
    expect(bruno.querySelector('[aria-label="Más cualidades"]')).toBeNull();

    const carla = hoja('Carla Gómez');
    expect(carla.querySelector('img')).toBeNull();
    expect(carla.textContent).toContain('CG');
    expect(within(carla).getByText('Sin brindis')).toBeTruthy();
  });

  it('se mueve con «Anterior», «Siguiente» y las flechas; el contador sigue la posición y los extremos se deshabilitan', async () => {
    pintar();
    await screen.findByRole('heading', { name: 'Ana Ruiz' });
    expect(boton(/Anterior/).disabled).toBe(true);
    fireEvent.click(boton(/Siguiente/));
    expect(screen.getByRole('heading', { name: 'Bruno Díaz' })).toBeTruthy();
    expect(contador()).toBe('2 / 3');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Carla Gómez' })).toBeTruthy();
    expect(contador()).toBe('3 / 3');
    expect(boton(/Siguiente/).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(contador()).toBe('3 / 3');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(contador()).toBe('1 / 3');
    expect(screen.queryByRole('heading', { name: 'Bruno Díaz' })).toBeNull();
  });

  it('Esc y «Cerrar» la cierran', async () => {
    const { onCerrar } = pintar();
    await screen.findByRole('heading', { name: 'Ana Ruiz' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
    fireEvent.click(boton('Cerrar'));
    expect(onCerrar).toHaveBeenCalledTimes(2);
  });

  it('«Imprimir» abre el diálogo del navegador; la versión imprimible tiene a todos, uno por hoja, sin botones ni el resto del portal', async () => {
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {});
    try {
      pintar();
      await screen.findByRole('heading', { name: 'Ana Ruiz' });
      fireEvent.click(boton(/Imprimir/));
      expect(imprimir).toHaveBeenCalledTimes(1);

      // Todas están en el DOM: en pantalla solo la actual; en papel todas, cada una en su hoja.
      const hojas = screen.getAllByTestId('hoja');
      expect(hojas.map((h) => h.getAttribute('aria-label'))).toEqual(['Ana Ruiz', 'Bruno Díaz', 'Carla Gómez']);
      expect(hojas.map((h) => h.getAttribute('aria-hidden'))).toEqual(['false', 'true', 'true']);
      for (const h of hojas) expect(h.className).toContain('break-after-page');
      for (const h of hojas.slice(1)) expect(h.className).toContain('hidden print:flex');

      // Sin botones y sin el resto del portal: cuelga de <body> y su regla de impresión oculta a sus hermanos.
      expect(boton(/Imprimir/).closest('.print\\:hidden')).not.toBeNull();
      const raiz = document.querySelector('[data-presentacion-cualidades]');
      expect(raiz?.parentElement).toBe(document.body);
      expect(raiz?.querySelector('style')?.textContent).toContain('body > :not([data-presentacion-cualidades])');
    } finally {
      imprimir.mockRestore();
    }
  });
});
```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion/PresentacionCualidades.test.tsx)
```

  Esperado: el fichero falla al cargar con `Failed to resolve import "./PresentacionCualidades"`.

- [ ] **Paso 3: implementación mínima.** Crea `PresentacionCualidades.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cargarCualidades } from './api';
import AvatarPersona from './AvatarPersona';
import { BOTON, BOTON_PRIMARIO } from './estilos';
import { FUENTE_TEXTO, FUENTE_TITULOS } from './marca';
import type { Miembro } from './tipos';

interface Props {
  /** Cierra la presentación; el panel sale también de la pantalla completa. */
  onCerrar: () => void;
}

// Al imprimir solo sale la presentación (decisión P1). Cuelga directamente de <body>, así que basta ocultar a
// sus hermanos: el #root con todo el portal, los avisos y cualquier otra capa. La regla vive dentro de la
// propia presentación: existe solo mientras está abierta.
const REGLA_IMPRESION = `@media print {
  body > :not([data-presentacion-cualidades]) { display: none !important; }
  [data-presentacion-cualidades] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

/** Las que van en grande, como el top 3 del muro. */
const EN_GRANDE = 3;

/** Una persona: en pantalla solo se ve la actual; al imprimir, todas, cada una en su hoja. */
function Hoja({ persona, actual }: { persona: Miembro; actual: boolean }) {
  const grandes = persona.cualidades.slice(0, EN_GRANDE);
  const resto = persona.cualidades.slice(EN_GRANDE);
  return (
    <section
      data-testid="hoja"
      aria-label={persona.nombre}
      aria-hidden={!actual}
      className={`${actual ? 'flex' : 'hidden print:flex'} flex-1 break-after-page flex-col items-center justify-center px-6 py-10 text-center last:break-after-auto print:py-8`}
    >
      <AvatarPersona persona={persona} className="mb-6 h-44 w-44 p-1.5 sm:h-60 sm:w-60" claseIniciales="text-6xl" />
      <h2 className="mb-8 text-4xl font-black text-[#1F2229] sm:text-6xl" style={{ fontFamily: FUENTE_TITULOS }}>
        {persona.nombre}
      </h2>
      {persona.cualidades.length === 0 ? (
        <p className="text-2xl font-bold text-[#5C6170]">Sin brindis</p>
      ) : (
        <>
          <ol aria-label="Top 3" className="mb-8 space-y-3">
            {grandes.map((c) => (
              <li key={c.cualidad} className="text-3xl font-extrabold text-[#2B2D35] sm:text-5xl" style={{ fontFamily: FUENTE_TITULOS }}>
                ✨ {c.cualidad} · {c.votos}
              </li>
            ))}
          </ol>
          {resto.length > 0 && (
            <ul aria-label="Más cualidades" className="flex max-w-3xl flex-wrap justify-center gap-2">
              {resto.map((c) => (
                <li key={c.cualidad} className="rounded-full bg-[#F4F6FA] px-3 py-1 text-base font-bold text-[#3E4352]">
                  {c.cualidad} · {c.votos}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** «🎤 Presentar cualidades» (solo admin): una persona por pantalla y, al imprimir, una por hoja. */
export default function PresentacionCualidades({ onCerrar }: Props) {
  const [equipo, setEquipo] = useState<Miembro[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [indice, setIndice] = useState(0);
  const capaRef = useRef<HTMLDivElement>(null);
  const total = equipo?.length ?? 0;
  const listo = equipo !== null && total > 0;

  // Se piden al abrirla, no con el panel: así las fotos no se descargan en cada recarga.
  const cargar = useCallback(async () => {
    try {
      setEquipo((await cargarCualidades()).equipo);
      setFallo(false);
    } catch {
      setFallo(true);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    capaRef.current?.focus();
  }, []);

  const mover = useCallback(
    (paso: number) => setIndice((i) => Math.min(Math.max(i + paso, 0), Math.max(total - 1, 0))),
    [total],
  );

  // Con la pantalla completa del sistema, la primera Esc se la queda el navegador para salir de ella (decisión P2).
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
      else if (e.key === 'ArrowRight') mover(1);
      else if (e.key === 'ArrowLeft') mover(-1);
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [mover, onCerrar]);

  const reintentar = () => {
    setFallo(false);
    void cargar();
  };

  return createPortal(
    <div
      ref={capaRef}
      data-presentacion-cualidades=""
      role="dialog"
      aria-modal="true"
      aria-label="Presentación de cualidades"
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-white text-[#2B2D35] outline-none print:static print:block print:overflow-visible"
      style={{ fontFamily: FUENTE_TEXTO }}
    >
      <style>{REGLA_IMPRESION}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8EF] px-4 py-3 print:hidden">
        <span data-testid="contador" className="text-lg font-extrabold" style={{ fontFamily: FUENTE_TITULOS }}>
          {listo ? `${indice + 1} / ${total}` : ''}
        </span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BOTON} disabled={!listo || indice === 0} onClick={() => mover(-1)}>
            ← Anterior
          </button>
          <button type="button" className={BOTON} disabled={!listo || indice >= total - 1} onClick={() => mover(1)}>
            Siguiente →
          </button>
          <button type="button" className={BOTON} disabled={!listo} onClick={() => window.print()}>
            🖨️ Imprimir
          </button>
          <button type="button" className={BOTON_PRIMARIO} onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>

      {equipo === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          {fallo ? (
            <>
              <p className="font-semibold text-[#3E4352]">No se pudieron cargar las cualidades.</p>
              <button type="button" className={`${BOTON} flex-none`} onClick={reintentar}>
                Reintentar
              </button>
            </>
          ) : (
            <p role="status" className="text-[#5C6170]">
              Cargando…
            </p>
          )}
        </div>
      ) : total === 0 ? (
        <p className="flex-1 p-6 text-center text-[#5C6170]">No hay nadie en la invitación.</p>
      ) : (
        <div className="flex flex-1 flex-col print:block">
          {equipo.map((persona, i) => (
            <Hoja key={persona.userId} persona={persona} actual={i === indice} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
```

- [ ] **Paso 4: ejecútala y mírala en verde.** El comando del Paso 2. Esperado: las 6 en verde. jsdom puede escribir `Not implemented: window.print` solo si el espía no se puso; con `vi.spyOn` no sale.

- [ ] **Paso 5: tipos y lint.**

```bash
(cd apps/portal && npx tsc -b)
(cd apps/portal && npx eslint src/pages/celebracion/PresentacionCualidades.tsx src/pages/celebracion/PresentacionCualidades.test.tsx)
```

  Esperado: sin errores. Un aviso de `react-hooks/set-state-in-effect` por `void cargar()` es aceptable: es el mismo patrón que `PanelAdmin`.

- [ ] **Paso 6: commit.**

```bash
git add apps/portal/src/pages/celebracion/PresentacionCualidades.tsx apps/portal/src/pages/celebracion/PresentacionCualidades.test.tsx
git commit -m "feat(portal): presentación de cualidades a pantalla completa e imprimible"
```

---

### Tarea 12: el botón «🎤 Presentar cualidades» en el panel del admin

**Ficheros:**
- Cambiar: `apps/portal/src/pages/celebracion/PanelAdmin.tsx`: los imports (línea 6), el estado (línea 43) y el pie de la tarjeta (líneas 191-196).
- Prueba: `apps/portal/src/pages/celebracion/PanelAdmin.test.tsx`: imports y mocks (líneas 1-15) y dos pruebas nuevas.

- [ ] **Paso 1: escribe la prueba que falla.** En `PanelAdmin.test.tsx`:

  Busca:

```ts
import { cargarResumen, ErrorApi, excluirInvitado, readmitirInvitado } from './api';
import { BRUNO, CARLA, eventoDePrueba, resumenDePrueba, YO } from './fixtures';
import { notify } from '../../lib/notify';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarResumen: vi.fn(),
  excluirInvitado: vi.fn(),
  readmitirInvitado: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
```

  Cámbialo por:

```ts
import { cargarCualidades, cargarResumen, ErrorApi, excluirInvitado, readmitirInvitado } from './api';
import { BRUNO, CARLA, cualidadesDePrueba, eventoDePrueba, resumenDePrueba, YO } from './fixtures';
import { notify } from '../../lib/notify';
import { entrarPantallaCompleta, salirPantallaCompleta } from './pantallaCompleta';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarResumen: vi.fn(),
  cargarCualidades: vi.fn(),
  excluirInvitado: vi.fn(),
  readmitirInvitado: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('./pantallaCompleta', () => ({ entrarPantallaCompleta: vi.fn(), salirPantallaCompleta: vi.fn() }));
```

  Al final del fichero, busca:

```ts
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No puedes quitarte a ti mismo de la invitación.', 'error'));
    expect(onCambio).not.toHaveBeenCalled();
  });
});
```

  Cámbialo por:

```ts
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No puedes quitarte a ti mismo de la invitación.', 'error'));
    expect(onCambio).not.toHaveBeenCalled();
  });

  it('«Presentar cualidades» pide la pantalla completa en el mismo clic y solo entonces carga las cualidades; «Cerrar» sale de ella', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    vi.mocked(cargarCualidades).mockResolvedValue(cualidadesDePrueba());
    pintar();
    await screen.findByTestId('cifra-van');
    expect(cargarCualidades).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Presentar cualidades/ }));
    expect(entrarPantallaCompleta).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Presentación de cualidades' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Ana Ruiz' })).toBeTruthy();
    expect(cargarCualidades).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(salirPantallaCompleta).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-presentacion-cualidades]')).toBeNull();
  });

  it('«Presentar cualidades» no depende del resumen: sigue ahí aunque falle', async () => {
    vi.mocked(cargarResumen).mockRejectedValue(new Error('red'));
    pintar();
    await screen.findByRole('button', { name: 'Reintentar' });
    expect(screen.getByRole('button', { name: /Presentar cualidades/ })).toBeTruthy();
  });
});
```

- [ ] **Paso 2: ejecútala y mira cómo falla.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion/PanelAdmin.test.tsx)
```

  Esperado: las 2 nuevas fallan con `Unable to find an accessible element with the role "button" and name "/Presentar cualidades/"`.

- [ ] **Paso 3: implementación mínima.** En `PanelAdmin.tsx`:

  Busca:

```tsx
import { fechaHoraCorta } from './fechas';
```

  Cámbialo por:

```tsx
import { fechaHoraCorta } from './fechas';
import { entrarPantallaCompleta, salirPantallaCompleta } from './pantallaCompleta';
import PresentacionCualidades from './PresentacionCualidades';
```

  Busca:

```tsx
  const [ocupado, setOcupado] = useState(false);
```

  Cámbialo por:

```tsx
  const [ocupado, setOcupado] = useState(false);
  const [presentando, setPresentando] = useState(false);

  // La pantalla completa se pide en el mismo clic: el navegador solo la concede con un gesto del usuario.
  const presentar = () => {
    entrarPantallaCompleta();
    setPresentando(true);
  };

  // Se sale aquí y no al desmontar: con StrictMode, en desarrollo, saldría nada más entrar (decisión P3).
  const cerrarPresentacion = useCallback(() => {
    salirPantallaCompleta();
    setPresentando(false);
  }, []);
```

  Busca:

```tsx
            <button type="button" disabled={exportando} onClick={() => void exportar()} className={BOTON_PRIMARIO}>
              {exportando ? 'Generando…' : '⬇️ Descargar Excel'}
            </button>
          </>
        )}
      </Tarjeta>
```

  Cámbialo por:

```tsx
            <button type="button" disabled={exportando} onClick={() => void exportar()} className={BOTON_PRIMARIO}>
              {exportando ? 'Generando…' : '⬇️ Descargar Excel'}
            </button>
          </>
        )}

        {/* Fuera del bloque del resumen: no depende de él (decisión P8). */}
        <div className="mt-3">
          <button type="button" onClick={presentar} className={BOTON}>
            🎤 Presentar cualidades
          </button>
        </div>
        {presentando && <PresentacionCualidades onCerrar={cerrarPresentacion} />}
      </Tarjeta>
```

- [ ] **Paso 4: ejecútala y mírala en verde.**

```bash
(cd apps/portal && npx vitest run src/pages/celebracion)
```

  Esperado: todo verde, también `CelebracionNavidad.admin.test.tsx`, que pinta el panel sin abrir la presentación.

- [ ] **Paso 5: tipos y lint.**

```bash
(cd apps/portal && npx tsc -b)
(cd apps/portal && npx eslint src/pages/celebracion/PanelAdmin.tsx src/pages/celebracion/PanelAdmin.test.tsx)
```

- [ ] **Paso 6: commit.**

```bash
git add apps/portal/src/pages/celebracion/PanelAdmin.tsx apps/portal/src/pages/celebracion/PanelAdmin.test.tsx
git commit -m "feat(portal): botón «Presentar cualidades» en el panel del admin"
```

---

### Tarea 13: Merge E2 y despliegue

- [ ] **Paso 1:** las suites:
  - `(cd apps/portal && npx vitest run && npm run build)`
  - `(cd apps/portal && npm run lint)`
  - `(cd apps/hub-api && npx vitest run)`

  Esperado: verde y sin errores. Los avisos de `react-hooks/set-state-in-effect` no bloquean.
- [ ] **Paso 2: prueba de humo local, opcional.** El login no funciona en local (memoria `portal-auth`). Si quieres ver la presentación y la vista previa de impresión, monta un banco de pruebas desechable que pinte `<PresentacionCualidades>` con `cualidadesDePrueba()`, mira la vista previa de impresión del navegador (una hoja por persona y nada del portal) y bórralo. No lo commitees.
- [ ] **Paso 3:** el tamaño: `git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'`. Esperado: unas 730 líneas desde el merge E1. Si pasa de 800, sigue con el merge y dilo en el informe (ver «Tamaño y merges»).
- [ ] **Paso 4:** las dos comprobaciones de privacidad, cada una en su comando (ver «Cómo se mergea»). Esperado: ninguna línea en la primera y solo nombres ficticios en la segunda.
- [ ] **Paso 5:** el merge, con el mensaje `merge: cualidades ocultas y presentación para el admin en el portal` (ver «Cómo se mergea»).
- [ ] **Paso 6: despliegue (lo hace el usuario en EasyPanel).** Avísale con estos pasos, en este orden:
  1. **hub-api** primero. No hay migración. Comprobaciones:
     - `GET /api/celebracion` con una cuenta que no sea admin trae `cualidadesOcultas: true` y `cualidades: []` en todos;
     - con la del admin trae el top 3 y `cualidadesOcultas: false`;
     - `GET /api/celebracion/cualidades` responde 200 al admin y 403 a los demás.
  2. **Portal** después.
  3. Prueba en el navegador:
     - con una cuenta que no sea admin: cada tarjeta dice «🤫 Se desvelan el día del almuerzo»; con los brindis completos, sale la línea fija; el último brindis da el aviso nuevo;
     - como admin: el muro sigue con el top 3; «🎤 Presentar cualidades» abre a pantalla completa (en el iPhone, en la capa); Anterior/Siguiente, flechas, contador y Esc o «Cerrar»;
     - «🖨️ Imprimir»: la vista previa trae una hoja por invitado y nada del resto del portal; guardar como PDF también sirve.
- [ ] **Paso 7:** informe final al usuario:
  - qué se mergeó (E1 y E2) y las líneas de cada uno;
  - qué falta: desplegar y probar;
  - lo de la primera Esc con la pantalla completa del sistema (decisión P2).

---

## Autorrevisión del plan (hecha al escribirlo)

**Cobertura del diseño, punto por punto:**

- **Servidor:**
  - Se ocultan en hub-api y no solo en la pantalla: T2, que comprueba que la respuesta no contiene `votos`.
  - `GET /api/celebracion` a quien no es admin trae `cualidades: []` en todos, también en el suyo, y `cualidadesOcultas: true`. El admin recibe el top 3 y `cualidadesOcultas: false`: T2.
  - `misVotos` se sigue enviando: T2 (prueba).
  - `GET /cualidades` con `requireAdmin` y 403 para los demás: T4.
  - `{ equipo }` en orden alfabético, con `userId`, `nombre`, `avatar`, `foto` y todas las cualidades con su número: T3.
  - El mismo orden que el top 3, de modo que las 3 primeras coinciden con el muro del admin: T1 y T3 (prueba «sus 3 primeras»).
  - Solo conteos, el voto sigue anónimo, cuentan los mismos votos (activos e invitados) y no salen los excluidos: T3, sobre `contarVotos` e `invitados()`.
- **Página del empleado:**
  - «🤫 Se desvelan el día del almuerzo» en cada tarjeta, sin «Aún nadie ha brindado por ti» ni «Sé el primero en brindar por …»: T8.
  - El aviso al completar el mínimo: T9.
  - La línea fija con los brindis completos, también tras el cierre: T9.
  - El admin no ve ninguno de estos textos: T8, porque `cualidadesOcultas` viene en false, y T9, con dos pruebas de admin.
- **Presentación del admin:**
  - El botón «🎤 Presentar cualidades» en el panel; los datos se piden al abrirla; «Cargando…» y «Reintentar»: T11 y T12.
  - Capa a pantalla completa y, si se puede, la del sistema; en el iPhone se queda en la capa: T10, T11 y T12.
  - Una persona por pantalla: foto graciosa, de perfil o iniciales, nombre, top 3 en grande, el resto en pequeño, con número, y «Sin brindis»: T7 y T11.
  - Anterior y Siguiente, flechas, Esc o «Cerrar», y el contador «N / total»: T11. La primera Esc en la pantalla completa del sistema va en la decisión P2.
  - Versión imprimible con todos, uno por hoja, sin botones ni el resto del portal: T11 (decisión P1).
  - Fotos de 256 px: ya se suben así (`CelebracionNavidad.tsx:177`). No hay nada que hacer.
- **Pruebas pedidas:**
  - hub-api: la vista con y sin cualidades (T2) y `GET /cualidades` con su 403, el orden, la lista completa con el desempate y sin los no invitados (T3 y T4).
  - Portal: el texto oculto en las tarjetas (T8), el aviso y la línea fija (T9), y la navegación y la versión imprimible con todos (T11).
- **Despliegue:** hub-api primero y después el portal (T13).

**Ensayo del plan (2026-11-26):** todos sus cambios se aplicaron, tarea a tarea, en una copia de `apps/hub-api` y `apps/portal` fuera del repo, que usaba sus mismos `node_modules`.
- Cada texto «Busca» casó una sola vez en su fichero.
- Cada prueba falló con el mensaje que da su Paso 2 y pasó tras su Paso 3.
- Al final quedaron en verde las 91 pruebas de `src/celebracion` de hub-api y las 110 de `src/pages/celebracion` del portal.
- `tsc` quedó sin errores en las dos apps, y eslint con 0 errores y 2 avisos de `set-state-in-effect`: el nuevo de `PresentacionCualidades` y el de `PanelAdmin`, que ya existía.
- Diff medido: 228 líneas en hub-api (E1) y 727 en el portal (E2).

**Sin placeholders:**
- No hay «TBD», «similar a la tarea N», «añadir validación» ni pasos sin código.
- Cada cambio trae el texto exacto que se busca y el que lo sustituye, o el fichero entero.
- Cada prueba nueva lleva su comando y el fallo esperado.

**Nombres y tipos coherentes:**
- hub-api:
  - `ordenarCualidades` y `top3` (T1);
  - `cualidadesOcultas` en `Vista` (T2);
  - `CualidadesEquipo { equipo: MiembroVista[] }`, `agruparPorVotado` y `cualidadesEquipo()` (T3);
  - `'cualidadesEquipo'` en `CelebracionActions` y en el `stub`, y el endpoint `celebracion_cualidades` (T4).
- Portal:
  - `cualidadesOcultas` en `Vista`, `CualidadesEquipo { equipo: Miembro[] }`, `cargarCualidades`, `vistaDeEmpleado` y `cualidadesDePrueba` (T6);
  - `AvatarPersona` con `persona`, `className` y `claseIniciales` (T7);
  - la prop `cualidadesOcultas` de `MuroEquipo` (T8);
  - `completaLosBrindis` (T9);
  - `entrarPantallaCompleta` y `salirPantallaCompleta` (T10);
  - `PresentacionCualidades` con `onCerrar`, `data-presentacion-cualidades`, `data-testid="hoja"` y `data-testid="contador"` (T11);
  - `presentar` y `cerrarPresentacion` (T12).
- Las pruebas usan solo lo que ya existe (`YO`, `BRUNO`, `CARLA`, `FOTO_DE_PRUEBA`, `equipoDePrueba`, `eventoDePrueba`, `vistaDePrueba`, `resumenDePrueba`, `FakeStore`, `montar`, `cabecera`, `stub`) o lo que crean estas tareas antes de usarlo.
- Los imports de cada prueba nombran solo lo que esa tarea usa, para que `no-unused-vars` no salte.
