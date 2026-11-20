# Equipos en taller — «Mis equipos» al entrar desde el celular: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quien abre «Equipos en taller» en un celular (pantalla de menos de 768 px) y sin `?vista=` en la dirección llega directamente a «Mis equipos». Allí ve solo lo suyo: las visitas que el portal asignó a su cuenta y las que tienen como Encargado de Desk el único nombre que coincide con el suyo. Desaparecen «¿Quién eres?», «Cambiar» y el nombre recordado en el dispositivo.

**Architecture:** el salto vive en el **portal**, que ya tiene el router. `EntradaEquiposTaller` (nuevo, en `apps/portal/src/components/`) va dentro del `AppGuard` de `/equipos-taller/*` y envuelve a la sub-app. Decide una sola vez, al montar (inicializador de `useState`), con `useLocation()`. Si la ruta es la raíz `/equipos-taller`, la dirección no trae `vista` y `window.matchMedia('(max-width: 767px)')` casa, pinta `<Navigate to="/equipos-taller/mis-equipos" replace />`: sin recargar la página, y «Atrás» vuelve a donde estaba el usuario. Si no, pinta la sub-app como hoy. En la sub-app, «Tabla» pasa a escribir `?vista=tabla`. En `MisEquipos.tsx` el filtro sigue siendo `esMia`, ahora con el nombre reconocido (el único de Desk que casa) en lugar del elegido o recordado. Se quitan `Selector`, «Cambiar» y la lectura y escritura de `CLAVE_TECNICO`, que se borra al abrir. La cabecera usa el nombre del portal y `inicialesDe`, la regla de iniciales de las tarjetas. El núcleo la exporta sin cambiarla.

**Tech Stack:** portal: React Router 7.18 (`BrowserRouter`; `MemoryRouter`, `useNavigationType` y `useNavigate` en las pruebas), Vitest 2 y Testing Library con jsdom por docblock. ESLint aplica `react-refresh/only-export-components` como error. Sub-app `apps/equipos-taller`: React 19, Vitest 2 y Testing Library, con jsdom 25 opt-in por docblock `// @vitest-environment jsdom`. No usa react-router: su «Tabla | Tablero» toca la dirección con `history.replaceState`. Núcleo puro `apps/hub-api/src/equipos/nucleo/`, importado por la pantalla por ruta relativa (`src/nucleo.ts`).

**Spec (contrato, no se reabre):** `docs/superpowers/specs/2026-11-19-equipos-movil-design.md` (decisiones D1–D6).
**Rama:** `feat/equipos-movil` (ya existe; el diseño está en `386a055`).

---

## Reglas para quien implemente

- **TDD estricto:** cada prueba nueva se ve en ROJO, y por la razón esperada, antes de escribir el código. Las pruebas marcadas «de guarda» ya pasan hoy y deben seguir pasando: fijan lo que no puede romperse.
- **Comandos:** para Git Bash (la herramienta Bash), desde la raíz del repo. Cada bloque empieza en la raíz.
  - Sub-app: `npm test --workspace=apps/equipos-taller -- <rutas>`, la suite entera `npm test --workspace=apps/equipos-taller` y los tipos `npx tsc --noEmit -p apps/equipos-taller/tsconfig.json`.
  - Portal: `npm test --workspace=apps/portal -- src/components/EntradaEquiposTaller.test.tsx src/components/RutaMisEquipos.test.tsx` y `npm run build --workspace=apps/portal; echo "exit=$?"` (su `tsc -b` comprueba también la sub-app). Mirar el código de salida aunque se lea «built in»: en Windows ya apareció una vez un cierre `0xC0000409` justo después. Si sale distinto de 0, repetir el build; si persiste, es un fallo real.
  - Núcleo (solo Tarea 1 y verificación final): **solo desde `apps/hub-api`**, `cd apps/hub-api && npx vitest run <rutas>`. Desde la raíz, Vitest mete los `*.db.test.ts` y salen ~281 fallos falsos. Tipos: `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json`.
  - Este cambio **no** tiene migración ni pruebas de base de datos, y no toca el servidor.
- **Editar solo con Edit/Write.** Nunca `Set-Content`, `Out-File`, `sed -i` ni `perl -pi`: destrozan las tildes. Los ficheros están en CRLF en la copia de trabajo (`core.autocrlf=true`, LF en el índice). Reescribir un fichero entero con Write es seguro: Git normaliza al preparar y el diff solo muestra los cambios reales. Si se usara un script, comprobar después en disco que las barras invertidas de las expresiones regulares siguen intactas.
- **Commits:** conventional commits en español, **sin** `Co-Authored-By` ni ninguna atribución. Siempre `git add <ruta> <ruta>…` con rutas explícitas; nunca `git add -A` ni `git add .`.
- **No tocar ni preparar:** `.gitignore`, `.atl/`, `openspec/`, `img/`, `apps/WO-sales/prompts/`, `apps/equipos-desk2/`, `apps/hub-api/src/equipos/nucleo/fixtures-reales/` ni nada bajo `apps/equipos-taller/diseño-kanban/`. Nunca `git stash` sin rutas.
- **Repo PÚBLICO.** Solo datos inventados: los seriales `18A9000x`, `Cliente Demo`, `María Pérez Gómez`, `Técnico Dos`, `Alguien Más`, `Admin Uno`, `u-yo`, `u-otro`. Antes de **cada** commit, en un comando aparte:

  ```bash
  cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
  ```

  Esperado: `Sin valores reales en: src/equipos, scripts, ../equipos-taller/src, ../../docs` y código de salida 0. Si dice `FUGA`, no se commitea.
- **Núcleo puro:** solo se exporta una función que ya existe, en el mismo fichero y sin imports nuevos. `nucleo/pureza.test.ts` (siete ficheros, imports solo de su carpeta) sigue en verde.
- **Tablero:** sin colores nuevos; si hiciera falta alguno, solo con tokens `--tt-*` (`tablero.css.test.ts`). No se añaden temporizadores. El sondeo de 60 s se limpia al desmontar: su prueba con `vi.getTimerCount()` sigue en verde.

## Adaptaciones al código real (lo que la spec no fija o lo que el código contradice)

| # | Spec | Código real | Qué hace este plan |
|---|---|---|---|
| A1 | La entrada desde el celular va en `apps/equipos-taller/src/App.tsx` y «se navega … sustituyendo la entrada del historial (`replace`)». | La sub-app no depende de react-router. Desde ella, la única forma de cambiar de ruta del portal es `location.replace`, que recarga todo el portal en el teléfono: lento y con parpadeo. El portal sí tiene el router y monta la sub-app en `/equipos-taller/*`, dentro de un `AppGuard`. | El salto vive en el portal. `EntradaEquiposTaller` va dentro del `AppGuard` y envuelve a `<EquiposTaller />`, que sigue siendo el `lazyConReintento` de `App.tsx` bajo el mismo `Suspense` del shell. Salta con `<Navigate to="/equipos-taller/mis-equipos" replace />`, sin recargar. Las pruebas comprueban el `replace` por comportamiento: `useNavigationType()` da `REPLACE` y «Atrás» vuelve al inicio. En la sub-app, `App.tsx` solo cambia «Tabla». En desarrollo, StrictMode ejecuta dos veces el efecto de `Navigate`; las dos son `replace`, así que es inofensivo. |
| A2 | «Al montar la app…» | Si la sub-app llega a pintarse, descarga su chunk y `EquiposServicio` pide `GET /api/equipos-taller` antes de salir. | La decisión se toma en el inicializador de `useState`, una sola vez por montaje. Mientras salta, `EntradaEquiposTaller` no pinta a sus hijos: el `lazy` ni se carga ni pide datos. El shell (barra lateral y superior) sí se ve durante un fotograma, antes del `Navigate`. |
| A3 | «Las iniciales se calculan del nombre con la misma regla que las tarjetas». | La regla es `const iniciales` en `nucleo/taller-board.ts`: privada, sin exportar. | Se exporta como `inicialesDe`, junto a `avatarDe`, y `tarjetaDe` la usa igual que antes. Es el **único** fichero de `apps/hub-api` que cambia, más su prueba. No cambia ningún comportamiento del servidor, así que hub-api no se redespliega: el portal empaqueta el núcleo. «Sin tocar hub-api» de la spec se cumple en lo que importa, que es el despliegue. |
| A4 | «El color del avatar es el neutro cuando no hay tarjetas.» No dice cuál con tarjetas. | Hoy el color sale de la primera tarjeta. | Con tarjetas, se mantiene el de su primera tarjeta, el mismo color que la persona tiene en el tablero y la TV. Sin tarjetas, `tt-av-neutro`. Sin nombre del portal, las iniciales son `–`, como hoy. |
| A5 | Pruebas con `matchMedia`. | jsdom 25 no trae `window.matchMedia` (comprobado: `typeof` da `undefined`), y `src/vitest.setup.ts` del portal no lo añade. | El código comprueba `typeof window.matchMedia === 'function'`: sin ella no salta, y hay una prueba para eso. Las demás usan `vi.stubGlobal('matchMedia', …)` (en ese entorno `globalThis === window`), con `vi.unstubAllGlobals()` en `afterEach`. |
| A6 | «Si la dirección no tiene `vista`…» y «la raíz». | La ruta del portal es `/equipos-taller/*`. | Salta solo en la raíz (`/equipos-taller` o `/equipos-taller/`), y solo si no hay `URLSearchParams.has('vista')`. Por eso cualquier `?vista=`, también `?vista=otra` y `?vista=`, evita el salto, y la sub-app lo lee como tabla, como hoy. Una subruta no salta. |
| A9 | Un helper de decisión puro, si ayuda a probar. | El ESLint del portal aplica `react-refresh/only-export-components` como **error** (`configs.vite`): un fichero de componente no puede exportar además una función. | `vaAMisEquipos(pathname, search)` es una función privada del componente. Las pruebas la cubren a través del componente, con `MemoryRouter` y `Routes`, al estilo de `RutaMisEquipos.test.tsx`. |
| A7 | Se quitan `Selector` y «Cambiar». | Quedan sin uso las reglas `.tt-mis-cambiar` y `.tt-mis-selector` de `mis-equipos.css`. Además, «¿Quién eres?» sigue nombrado en comentarios de `tecnico.ts` y `RutaMisEquipos.tsx` y en nombres de pruebas. | Se borran esas tres reglas CSS. `tablero.css.test.ts` sigue exigiendo más de 10 variables `--tt-*`, y quedan 19. Se corrigen los comentarios y los nombres de prueba. |
| A8 | Se borra `CLAVE_TECNICO` al abrir. | El almacenamiento en memoria de `MisEquipos.test.tsx` no tiene `removeItem`. | Se le añade. `CLAVE_TECNICO` se sigue exportando, solo para que la prueba siembre la clave antigua. |

---

## Mapa de archivos

| Fichero | Acción | Responsabilidad |
|---|---|---|
| `apps/hub-api/src/equipos/nucleo/taller-board.ts` | Modificar (L153, L188) | Exporta `inicialesDe` (la regla de siempre) y `tarjetaDe` la usa. |
| `apps/hub-api/src/equipos/nucleo/taller-board.test.ts` | Modificar (L5, tras L161) | `inicialesDe` da lo mismo que la tarjeta. |
| `apps/equipos-taller/src/App.tsx` | Modificar (L20-23) | «Tabla» escribe `?vista=tabla`. |
| `apps/equipos-taller/src/App.test.tsx` | Modificar (L74, L83) | `?vista=tabla` tras pulsar «Tabla». |
| `apps/portal/src/components/EntradaEquiposTaller.tsx` | Crear | Decide una vez, al montar, si salta a «Mis equipos» (`<Navigate replace>`) o pinta la sub-app. |
| `apps/portal/src/components/EntradaEquiposTaller.test.tsx` | Crear | Salto con `replace` y «Atrás» al inicio; sin salto con `?vista=`, en pantalla ancha, sin `matchMedia` o en una subruta; una sola vez. |
| `apps/portal/src/App.tsx` | Modificar (L10, L98) | `/equipos-taller/*` envuelve a `<EquiposTaller />` con `EntradaEquiposTaller`, dentro del `AppGuard`. |
| `apps/equipos-taller/src/MisEquipos.tsx` | Reescribir | Solo lo suyo; sin `Selector`, «Cambiar» ni nombre recordado; cabecera del usuario. |
| `apps/equipos-taller/src/MisEquipos.test.tsx` | Reescribir | Las pruebas de identidad pasan a «solo lo suyo»; cabecera y mensaje sin equipos. |
| `apps/equipos-taller/src/tablero/mis-equipos.css` | Modificar (L11, L17-18) | Fuera las reglas de «Cambiar» y del selector. |
| `apps/equipos-taller/src/tecnico.ts` | Modificar (L18-21, L35-38) | Comentarios sin «¿Quién eres?». |
| `apps/equipos-taller/src/tecnico.test.ts` | Modificar (L46) | Nombre de la prueba sin «¿Quién eres?». |
| `apps/portal/src/components/RutaMisEquipos.tsx` | Modificar (L14) | Comentario: por qué espera al perfil. |
| `apps/portal/src/components/RutaMisEquipos.test.tsx` | Modificar (L38) | Nombre de la prueba. |
| `docs/equipos-taller.md` | Modificar (L149, L151) | Filas «Tabla \| Tablero» y `/equipos-taller/mis-equipos`. |
| `apps/equipos-taller/CLAUDE.md` | Modificar (L21, L22, L27) | Dónde vive el salto del celular (en el portal) y «solo lo suyo». |

---

### Tarea 1: El núcleo exporta la regla de las iniciales

**Files:**
- Modify: `apps/hub-api/src/equipos/nucleo/taller-board.ts` (L153, L188)
- Test: `apps/hub-api/src/equipos/nucleo/taller-board.test.ts` (L5, tras L161)

- [ ] **Step 1: Escribir la prueba que falla**

En `apps/hub-api/src/equipos/nucleo/taller-board.test.ts`, reemplazar:

```ts
  AJUSTES_TABLERO_POR_DEFECTO, avatarDe, construirTablero, diasEnTaller, fechaBogota, horaBogota, tonoDias, validarAjustesTablero,
```

por:

```ts
  AJUSTES_TABLERO_POR_DEFECTO, avatarDe, construirTablero, diasEnTaller, fechaBogota, horaBogota, inicialesDe, tonoDias, validarAjustesTablero,
```

Y reemplazar (final de la prueba «iniciales de una sola palabra y con espacios», en `describe('contenido de la tarjeta')`):

```ts
    expect(i('  ana  maria  lopez ')).toBe('AM');
    expect(i('ana')).toBe('A');
  });
```

por:

```ts
    expect(i('  ana  maria  lopez ')).toBe('AM');
    expect(i('ana')).toBe('A');
  });

  it('inicialesDe: la misma regla de las tarjetas, para quien aún no tiene ninguna («Mis equipos»)', () => {
    expect(inicialesDe('  ana  maria  lopez ')).toBe('AM');
    expect(inicialesDe('ana')).toBe('A');
    expect(inicialesDe('')).toBe('');
    expect(inicialesDe('Técnico Uno')).toBe(tarjeta(fila('A1', 'En Proceso')).tecnico?.iniciales);
  });
```

- [ ] **Step 2: Verla fallar**

```bash
cd apps/hub-api && npx vitest run src/equipos/nucleo/taller-board.test.ts
```

Esperado: FAIL, `1 failed`: `contenido de la tarjeta > inicialesDe: …` con `inicialesDe is not a function`. El resto, en verde.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/equipos/nucleo/taller-board.ts`, reemplazar:

```ts
const iniciales = (nombre: string): string =>
```

por:

```ts
/** Iniciales (las dos primeras palabras) de un nombre: las de las tarjetas y la cabecera de «Mis equipos». */
export const inicialesDe = (nombre: string): string =>
```

Y, dentro de `tarjetaDe` (L188), reemplazar:

```ts
iniciales: iniciales(resp.nombre)
```

por:

```ts
iniciales: inicialesDe(resp.nombre)
```

`index.ts` ya hace `export * from "./taller-board.js"` y la pantalla lo recibe por `src/nucleo.ts`. Ningún otro `inicialesDe` existe en el núcleo ni en `contrato.ts`, así que no hay choque en los `export *`.

- [ ] **Step 4: Verla pasar**

```bash
cd apps/hub-api && npx vitest run src/equipos/nucleo
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS (con `pureza.test.ts` en verde: mismo fichero, sin imports nuevos) y los dos `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/hub-api/src/equipos/nucleo/taller-board.ts apps/hub-api/src/equipos/nucleo/taller-board.test.ts
git commit -m "refactor(equipos-taller): el núcleo exporta la regla de las iniciales"
```

---

### Tarea 2: «Tabla» deja `?vista=tabla` en la dirección

**Files:**
- Modify: `apps/equipos-taller/src/App.tsx` (L20-23, dentro de `cambiar`)
- Test: `apps/equipos-taller/src/App.test.tsx` (L74, L83)

Sin esto, quien elige la tabla en el celular volvería a «Mis equipos» al recargar: la dirección quedaría sin `vista` y el portal saltaría (Tarea 3).

- [ ] **Step 1: Escribir la prueba que falla**

En `apps/equipos-taller/src/App.test.tsx`, reemplazar:

```ts
  it('al cambiar usa replaceState conservando history.state, no pushState', async () => {
```

por:

```ts
  it('al cambiar usa replaceState conservando history.state, no pushState, y deja la vista en la dirección', async () => {
```

Y reemplazar (en esa misma prueba):

```ts
    fireEvent.click(boton('Tabla'));
    expect(location.search).toBe('');
```

por:

```ts
    fireEvent.click(boton('Tabla'));
    expect(location.search).toBe('?vista=tabla');
```

- [ ] **Step 2: Verla fallar**

```bash
npm test --workspace=apps/equipos-taller -- src/App.test.tsx
```

Esperado: FAIL, `1 failed | 8 passed`: `al cambiar usa replaceState … y deja la vista en la dirección` con `expected '' to be '?vista=tabla'`.

- [ ] **Step 3: Implementar**

En `apps/equipos-taller/src/App.tsx`, dentro de `cambiar`, reemplazar:

```ts
    // replaceState con el state actual: no añade historial y conserva el del router del portal.
    const url = new URL(location.href);
    if (v === 'tablero') url.searchParams.set('vista', 'tablero');
    else url.searchParams.delete('vista');
```

por:

```ts
    // replaceState con el state actual: no añade historial y conserva el del router del portal. La vista queda
    // escrita (también `tabla`): sin `?vista=`, el portal abriría «Mis equipos» en el celular al recargar.
    const url = new URL(location.href);
    url.searchParams.set('vista', v);
```

`leerVista` no cambia: `?vista=tablero` es el tablero y cualquier otro valor, o ninguno, la tabla.

- [ ] **Step 4: Verla pasar**

```bash
npm test --workspace=apps/equipos-taller -- src/App.test.tsx
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS (`9 passed`) y `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/equipos-taller/src/App.tsx apps/equipos-taller/src/App.test.tsx
git commit -m "feat(equipos-taller): «Tabla» deja la vista en la dirección"
```

---

### Tarea 3: En el celular, el portal abre «Mis equipos»

**Files:**
- Create: `apps/portal/src/components/EntradaEquiposTaller.tsx`
- Modify: `apps/portal/src/App.tsx` (import tras L10; ruta `/equipos-taller/*`, L98)
- Test: `apps/portal/src/components/EntradaEquiposTaller.test.tsx` (nuevo)

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `apps/portal/src/components/EntradaEquiposTaller.test.tsx`:

```tsx
// @vitest-environment jsdom
// Entrada de «Equipos en taller»: en el celular, sin ?vista=, abre «Mis equipos» con el router del portal. Todo ficticio.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useNavigationType } from 'react-router-dom';
import EntradaEquiposTaller from './EntradaEquiposTaller';

// jsdom no trae matchMedia: cada prueba fija el ancho de la pantalla.
const pantalla = (celular: boolean) => {
  const consulta = vi.fn((q: string) => ({ matches: celular, media: q }));
  vi.stubGlobal('matchMedia', consulta);
  return consulta;
};
// Dice cómo se llegó (REPLACE si sustituyó la entrada, PUSH si añadió otra) y permite volver atrás.
function SondaMisEquipos() {
  const navegar = useNavigate();
  return <button type="button" onClick={() => navegar(-1)}>{`MIS EQUIPOS (${useNavigationType()})`}</button>;
}
// Antes de la app, el usuario estaba en el inicio: «Atrás» debe devolverle ahí.
const arbol = (entrada: string) => (
  <MemoryRouter initialEntries={['/', entrada]} initialIndex={1}>
    <Routes>
      <Route path="/equipos-taller/mis-equipos" element={<SondaMisEquipos />} />
      <Route path="/equipos-taller/*" element={<EntradaEquiposTaller><div>LA APP</div></EntradaEquiposTaller>} />
      <Route path="/" element={<div>INICIO</div>} />
    </Routes>
  </MemoryRouter>
);
const montar = (entrada: string) => render(arbol(entrada));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('EntradaEquiposTaller', () => {
  it.each(['/equipos-taller', '/equipos-taller/'])('en el celular, %s sin ?vista= abre «Mis equipos» sustituyendo la entrada', async (entrada) => {
    const consulta = pantalla(true);
    montar(entrada);
    expect(await screen.findByText('MIS EQUIPOS (REPLACE)')).toBeTruthy();
    expect(consulta).toHaveBeenCalledWith('(max-width: 767px)');
    expect(screen.queryByText('LA APP')).toBeNull();
  });

  it('«Atrás» desde «Mis equipos» vuelve a donde estaba, sin rebotar a la app', async () => {
    pantalla(true);
    montar('/equipos-taller');
    fireEvent.click(await screen.findByText('MIS EQUIPOS (REPLACE)'));
    expect(await screen.findByText('INICIO')).toBeTruthy();
  });

  it.each(['?vista=tabla', '?vista=tablero', '?vista=otra', '?vista='])('con %s manda la dirección también en el celular', async (busqueda) => {
    pantalla(true);
    montar('/equipos-taller' + busqueda);
    expect(await screen.findByText('LA APP')).toBeTruthy();
    expect(screen.queryByText(/MIS EQUIPOS/)).toBeNull();
  });

  it('en pantalla ancha se queda en la app', async () => {
    pantalla(false);
    montar('/equipos-taller');
    expect(await screen.findByText('LA APP')).toBeTruthy();
    expect(screen.queryByText(/MIS EQUIPOS/)).toBeNull();
  });

  it('sin matchMedia (navegadores viejos) se queda en la app', async () => {
    expect(typeof window.matchMedia).toBe('undefined');
    montar('/equipos-taller');
    expect(await screen.findByText('LA APP')).toBeTruthy();
  });

  it('una subruta de la app no salta', async () => {
    pantalla(true);
    montar('/equipos-taller/otra');
    expect(await screen.findByText('LA APP')).toBeTruthy();
  });

  it('mira el ancho una sola vez, al abrir: girar el teléfono después no mueve a nadie', async () => {
    const consulta = pantalla(false);
    const { rerender } = montar('/equipos-taller');
    await screen.findByText('LA APP');
    pantalla(true);
    fireEvent(window, new Event('resize'));
    rerender(arbol('/equipos-taller'));
    expect(screen.getByText('LA APP')).toBeTruthy();
    expect(consulta).toHaveBeenCalledTimes(1);
  });
});
```

La sonda prueba el `replace` por comportamiento, sin leer código. Con un `push`, el tipo de navegación sería `PUSH`. Además, «Atrás» volvería a `/equipos-taller` y rebotaría otra vez a «Mis equipos», en lugar de llegar al inicio.

- [ ] **Step 2: Verlas fallar**

```bash
npm test --workspace=apps/portal -- src/components/EntradaEquiposTaller.test.tsx
```

Esperado: FAIL, `Test Files 1 failed`, `no tests`: `Failed to resolve import "./EntradaEquiposTaller" from "src/components/EntradaEquiposTaller.test.tsx". Does the file exist?`

- [ ] **Step 3: Implementar**

Crear `apps/portal/src/components/EntradaEquiposTaller.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/** Celular = pantalla de menos de 768 px (D2). Algunos navegadores viejos (y jsdom) no traen `matchMedia`. */
const esPantallaDeCelular = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;

/**
 * D1–D3: se entra por la raíz de la app, sin `?vista=` y desde un celular. Con `?vista=` (cualquier valor) manda la
 * dirección en cualquier ancho; una subruta tampoco salta. No se exporta: el fichero solo exporta el componente
 * (regla `react-refresh/only-export-components`), y sus pruebas lo cubren a través de él.
 */
const vaAMisEquipos = (pathname: string, search: string): boolean =>
  pathname.replace(/\/+$/, '') === '/equipos-taller' && !new URLSearchParams(search).has('vista') && esPantallaDeCelular();

/**
 * Entrada de `/equipos-taller/*` dentro del shell (va dentro del `AppGuard`). En el celular abre «Mis equipos» con el
 * router del portal, sin recargar la página. `replace` sustituye la entrada del historial: «Atrás» vuelve a donde
 * estaba el usuario. Decide UNA vez, al montar: girar el teléfono después no mueve a nadie. Mientras salta no pinta
 * la app, así que ni descarga su chunk ni pide sus datos.
 */
export default function EntradaEquiposTaller({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const [salta] = useState(() => vaAMisEquipos(pathname, search));
  return salta ? <Navigate to="/equipos-taller/mis-equipos" replace /> : <>{children}</>;
}
```

En `apps/portal/src/App.tsx`, reemplazar:

```tsx
import RutaMisEquipos from './components/RutaMisEquipos';
```

por:

```tsx
import RutaMisEquipos from './components/RutaMisEquipos';
import EntradaEquiposTaller from './components/EntradaEquiposTaller';
```

Y reemplazar:

```tsx
                    <Route path="/equipos-taller/*" element={<AppGuard appId="equipos-taller"><EquiposTaller /></AppGuard>} />
```

por:

```tsx
                    <Route path="/equipos-taller/*" element={<AppGuard appId="equipos-taller"><EntradaEquiposTaller><EquiposTaller /></EntradaEquiposTaller></AppGuard>} />
```

`EquiposTaller` sigue siendo el `lazyConReintento` de siempre, bajo el `Suspense` del shell. `/equipos-taller/tv` y `/equipos-taller/mis-equipos` son rutas propias, fuera del shell, así que nunca pasan por la entrada. Este cableado de una línea no tiene prueba propia: lo comprueban el `tsc -b` del build y la prueba en el navegador de la Tarea 6.

- [ ] **Step 4: Verlas pasar**

```bash
npm test --workspace=apps/portal -- src/components/EntradaEquiposTaller.test.tsx src/components/RutaMisEquipos.test.tsx src/components/RutaTableroTv.test.tsx
npm run build --workspace=apps/portal; echo "exit=$?"
```

Esperado: PASS (`EntradaEquiposTaller.test.tsx`: `11 passed`; las rutas de «Mis equipos» y de la TV siguen en verde) y el build con `exit=0`.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/portal/src/components/EntradaEquiposTaller.tsx apps/portal/src/components/EntradaEquiposTaller.test.tsx apps/portal/src/App.tsx
git commit -m "feat(portal): en el celular, «Equipos en taller» abre «Mis equipos»"
```

---

### Tarea 4: «Mis equipos» muestra solo lo del usuario

**Files:**
- Modify: `apps/equipos-taller/src/MisEquipos.tsx` (se reescribe entero)
- Modify: `apps/equipos-taller/src/tablero/mis-equipos.css` (L11, L17-18)
- Modify: `apps/equipos-taller/src/tecnico.ts` (solo comentarios, L18-21 y L35-38)
- Test: `apps/equipos-taller/src/MisEquipos.test.tsx` (se reescribe entero)
- Test: `apps/equipos-taller/src/tecnico.test.ts` (nombre de la prueba, L46)

- [ ] **Step 1: Escribir las pruebas que fallan**

Reemplazar todo el contenido de `apps/equipos-taller/src/MisEquipos.test.tsx` por el siguiente. Cambia respecto al actual:
- importa `avatarDe`;
- el almacenamiento en memoria tiene `removeItem`;
- `describe('MisEquipos: identidad')` pasa a `describe('MisEquipos: solo lo suyo')`;
- en «asignación del portal», la primera prueba ya no espera el selector y se añade la de cuenta más nombre;
- «es de solo lectura» ya no lista «Cambiar»;
- se añade la prueba de la cabecera con el nombre del portal.

El resto es igual.

```tsx
// @vitest-environment jsdom
// «Mis equipos»: vista de solo lectura del técnico. Fuente de datos inyectada. Datos ficticios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EST, avatarDe, claveFila, type Fila, type RespuestaEquipos } from './nucleo';
import MisEquipos, { CLAVE_TECNICO } from './MisEquipos';

const AHORA = Date.parse('2026-11-11T20:00:00Z');
// Almacenamiento en memoria: el localStorage de jsdom choca con el global de Node 22+.
const memoria = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() }; };
const almacen = { actual: memoria() };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AHORA); almacen.actual = memoria(); vi.stubGlobal('localStorage', almacen.actual); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const z = (n: string, st: string, enc: string) => ({ n, id: n, st, stt: 'Open', u: 'https://x/' + n, m: '', enc, eq: 'EDM180C', srv: '', fs: '', cl: '' });
const fila = (sn: string, d: string, st: string, enc: string, n = sn.slice(-4)): Fila =>
  ({ id: 'F' + sn, d, c: 'Cliente Demo', sn, est: EST.TALLER, src: '', why: [], x: null, z: z(n, st, enc), zc: false, pa: [], xd: '', eq: '' });
const UNO = 'María Pérez Gómez';
const FILAS = [
  fila('18A90001', '2026-08-01', 'Notificación cliente', UNO, '1234'), // 102 d: rojo
  fila('18A90002', '2026-11-01', 'Notificación cliente', 'maria perez gomez'),
  fila('18A90003', '2026-10-01', 'Ingresado', UNO), // 41 d
  fila('18A90004', '2026-11-05', 'Por entregar', 'maria PEREZ gomez'),
  fila('18A90005', '2026-11-05', 'Ingresado', 'Técnico Dos'),
];
const resp = (filas = FILAS): RespuestaEquipos => ({
  actualizando: false, configurado: true, ultima: null, ultimaBuena: null, incidente: null, ajustes: {},
  permisos: { editaAjustes: false, recibeAlertas: false, esAdmin: false, puedeEditar: false },
  snap: { at: '2026-11-11T19:10:00Z', hoy: '2026-11-11', rows: filas },
});
const montar = (nombre: string | null, filas = FILAS, extra: Partial<Parameters<typeof MisEquipos>[0]> = {}) =>
  render(<MisEquipos nombre={nombre} pedir={vi.fn(async () => structuredClone(resp(filas)))} {...extra} />);
const listo = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const grupo = (n: string) => screen.getByRole('region', { name: n });
const SIN_EQUIPOS = 'No tienes equipos asignados. Si falta alguno, pide que te lo asignen desde la tabla.';
const avatar = () => document.querySelector('.tt-mis-cab .tt-av')!;

describe('MisEquipos: solo lo suyo', () => {
  it('un único técnico que coincide se usa sin preguntar', async () => {
    montar(UNO);
    await listo();
    expect(screen.queryByText('¿Quién eres?')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });
  it('sin coincidencia no pregunta «¿Quién eres?» ni ofrece «Cambiar»: lo dice, con la cabecera del usuario', async () => {
    montar('Alguien Más');
    await listo();
    expect(screen.queryByText('¿Quién eres?')).toBeNull();
    expect(screen.queryByRole('group', { name: '¿Quién eres?' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cambiar' })).toBeNull();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText(SIN_EQUIPOS)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Alguien Más' })).toBeTruthy();
    expect(avatar().textContent).toBe('AM');
    expect(avatar().className).toContain('tt-av-neutro');
  });
  it('si casan dos nombres de Desk, no muestra los equipos de ninguno de los dos (ni pregunta)', async () => {
    montar('Técnico Pérez', [...FILAS, fila('18A90006', '2026-11-05', 'Ingresado', 'Técnico Tres Pérez'), fila('18A90007', '2026-11-05', 'Ingresado', 'Técnico Cuatro Pérez')]);
    await listo();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByRole('group', { name: '¿Quién eres?' })).toBeNull();
    expect(screen.getByText(SIN_EQUIPOS)).toBeTruthy();
  });
  it('un nombre recordado en el dispositivo (de otra persona) ya no cuenta y se borra al abrir', async () => {
    localStorage.setItem(CLAVE_TECNICO, 'Técnico Dos');
    montar('Alguien Más');
    await listo();
    expect(screen.queryByLabelText('Equipo 18A90005')).toBeNull();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(localStorage.getItem(CLAVE_TECNICO)).toBeNull();
  });
  it('si el almacenamiento local falla, sigue funcionando', async () => {
    const falla = () => { throw new Error('x'); };
    vi.stubGlobal('localStorage', { getItem: falla, setItem: falla, removeItem: falla });
    montar(UNO);
    await listo();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });
});

describe('MisEquipos: asignación del portal (por la cuenta)', () => {
  const asignado = (userId: string, nombre: string) => ({ userId, nombre, por: 'Admin Uno', en: '2026-11-11T15:00:00.000Z' });

  it('muestra la tarjeta por userId aunque el nombre no coincida, y nada más (sin preguntar «¿Quién eres?»)', async () => {
    const filas = [...FILAS, fila('18A90008', '2026-11-05', 'Ingresado', '')];
    const r: RespuestaEquipos = { ...resp(filas), responsables: { [claveFila(filas[5])]: asignado('u-yo', 'Nombre En Cuenta') } };
    render(<MisEquipos nombre="Alguien Más" userId="u-yo" pedir={vi.fn(async () => structuredClone(r))} />);
    await listo();
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Equipo 18A90008']);
    expect(screen.queryByRole('group', { name: '¿Quién eres?' })).toBeNull();
  });

  it('salen las asignadas a su cuenta y las del único nombre de Desk que casa; las de otros no', async () => {
    const filas = [...FILAS, fila('18A90008', '2026-11-05', 'Ingresado', '')];
    const r: RespuestaEquipos = { ...resp(filas), responsables: { [claveFila(filas[5])]: asignado('u-yo', 'Nombre En Cuenta') } };
    render(<MisEquipos nombre={UNO} userId="u-yo" pedir={vi.fn(async () => structuredClone(r))} />);
    await listo();
    const sns = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(sns).toHaveLength(5);
    expect(sns).toContain('Equipo 18A90008');
    expect(sns).toContain('Equipo 18A90001');
    expect(sns).not.toContain('Equipo 18A90005');
  });

  it('si el portal asignó la visita a otra cuenta, no te aparece aunque el nombre coincida y Desk diga que es tuya', async () => {
    const r: RespuestaEquipos = { ...resp(), responsables: { [claveFila(FILAS[0])]: asignado('u-otro', UNO) } };
    render(<MisEquipos nombre={UNO} userId="u-yo" pedir={vi.fn(async () => structuredClone(r))} />);
    await listo();
    expect(screen.queryByLabelText('Equipo 18A90001')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
});

describe('MisEquipos: lista y cabecera', () => {
  it('agrupa por columna en el orden del tablero, con cuenta y tarjetas por antigüedad', async () => {
    montar(UNO);
    await listo();
    const grupos = screen.getAllByRole('region').map((g) => g.getAttribute('aria-label'));
    expect(grupos).toEqual(['Rev. / Diagnóstico', 'Notificación cliente', 'Por entregar']);
    const g = grupo('Notificación cliente');
    expect(within(g).getByLabelText('Total 2')).toBeTruthy();
    expect(within(g).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Equipo 18A90001', 'Equipo 18A90002']);
  });
  it('la tarjeta muestra serial, píldora suave de días, equipo y «Cliente · #ticket»', async () => {
    montar(UNO);
    await listo();
    const t = screen.getByLabelText('Equipo 18A90001');
    expect(within(t).getByText('18A90001').className).toContain('tt-mono');
    expect(within(t).getByText('102 d').className).toContain('tt-dias-suave-rojo');
    expect(within(t).getByText('EDM180C')).toBeTruthy();
    expect(within(t).getByText('Cliente Demo · #1234')).toBeTruthy();
  });
  it('es de solo lectura: sin botones de acción ni campos (solo «Escanear S/N» y el enlace al taller)', async () => {
    montar(UNO);
    await listo();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Escanear S/N']);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(document.querySelector('input,textarea,select,video')).toBeNull();
  });
  it('cabecera: «Mis equipos», nombre y mini KPIs (asignados, esperan cliente, más de 90 d)', async () => {
    montar(UNO);
    await listo();
    expect(screen.getByRole('heading', { name: UNO })).toBeTruthy();
    expect(screen.getByText('Mis equipos')).toBeTruthy();
    const kpis = within(screen.getByRole('list', { name: 'Indicadores' })).getAllByRole('listitem').map((x) => x.textContent);
    expect(kpis).toEqual(['4Asignados', '2Esperan cliente', '1Más de 90 d']);
  });
  it('la cabecera lleva el nombre del portal y sus iniciales, no el de Desk; el color, el de su tarjeta', async () => {
    montar('Pérez Gómez María');
    await listo();
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Pérez Gómez María' })).toBeTruthy();
    expect(avatar().textContent).toBe('PG');
    expect(avatar().classList.contains(`tt-av-${avatarDe(UNO)}`)).toBe(true);
  });
});

describe('MisEquipos: navegación y sondeo', () => {
  it('«Ver taller completo» va a la pestaña del tablero y mide al menos 44 px', async () => {
    montar(UNO);
    await listo();
    const a = screen.getByRole('link', { name: 'Ver taller completo' });
    expect(a.getAttribute('href')).toBe('/equipos-taller?vista=tablero');
    expect(a.className).toContain('tt-mis-boton');
  });
  it('sondea cada 60 s, avisa si pasan más de 5 minutos sin acierto y limpia al desmontar', async () => {
    const pedir = vi.fn(async () => structuredClone(resp()));
    const { unmount } = render(<MisEquipos nombre={UNO} pedir={pedir} />);
    await listo();
    pedir.mockRejectedValue(new Error('red'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000 * 7); });
    expect(pedir.mock.calls.length).toBeGreaterThan(3);
    expect(screen.getByRole('alert').textContent).toContain('Datos desactualizados');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('sin datos todavía o sin acceso no queda en blanco', async () => {
    montar(UNO, FILAS, { pedir: vi.fn(async () => { throw Object.assign(new Error('x'), { status: 401 }); }) });
    expect(screen.getByText('Cargando tablero…')).toBeTruthy();
    await listo();
    expect(screen.getByRole('alert').textContent).toContain('No tienes acceso');
  });
});

describe('MisEquipos: Escanear S/N', () => {
  const abrir = async () => { montar(UNO); await listo(); fireEvent.click(screen.getByRole('button', { name: 'Escanear S/N' })); };
  const buscar = (sn: string) => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Número de serie' }), { target: { value: sn } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  };
  const camara = (lectura: string) => {
    const parar = vi.fn();
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => [{ rawValue: lectura }]); });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: parar }] })) } });
    return parar;
  };
  afterEach(() => { Reflect.deleteProperty(navigator, 'mediaDevices'); });

  it('a mano: encuentra el equipo en todo el taller (sin importar mayúsculas) o avisa que no existe', async () => {
    await abrir();
    buscar(' 18a90005 ');
    expect(within(screen.getByRole('region', { name: 'Resultado de la búsqueda' })).getByLabelText('Equipo 18A90005')).toBeTruthy();
    buscar('NOEXISTE1');
    expect(screen.getByText('No hay un equipo con el S/N NOEXISTE1.')).toBeTruthy();
  });
  it('sin lector de códigos del navegador solo ofrece la entrada manual', async () => {
    await abrir();
    expect(screen.queryByRole('button', { name: 'Usar la cámara' })).toBeNull();
  });
  it('con cámara: lee el código, muestra el equipo y apaga la cámara', async () => {
    const parar = camara('18A90005');
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Usar la cámara' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByLabelText('Equipo 18A90005')).toBeTruthy();
    expect(parar).toHaveBeenCalled();
  });
  it('cerrar el panel con la cámara encendida la apaga y no deja temporizadores propios', async () => {
    const parar = camara('SINLECTURA');
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Usar la cámara' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(parar).toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
```

En `apps/equipos-taller/src/tecnico.test.ts` (L46), reemplazar:

```ts
  it('solo los nombres de Desk: las asignaciones del portal se reconocen por la cuenta, no por «¿Quién eres?»', () => {
```

por:

```ts
  it('solo los nombres de Desk: las asignaciones del portal se reconocen por la cuenta, no por el nombre', () => {
```

- [ ] **Step 2: Verlas fallar**

```bash
npm test --workspace=apps/equipos-taller -- src/MisEquipos.test.tsx src/tecnico.test.ts
```

Esperado: FAIL, `6 failed` en `MisEquipos.test.tsx`; `tecnico.test.ts`, en verde:
- `solo lo suyo > sin coincidencia no pregunta «¿Quién eres?» …`: `expected <h2></h2> to be null` (sigue el selector);
- `solo lo suyo > si casan dos nombres de Desk …`: `expected <div role="group" …> to be null`;
- `solo lo suyo > un nombre recordado en el dispositivo …`: `expected <article …> to be null` (se ve `18A90005` de «Técnico Dos»);
- `asignación del portal > muestra la tarjeta por userId … y nada más`: `expected <div role="group" …> to be null`;
- `lista y cabecera > es de solo lectura …`: `expected [ 'Cambiar', 'Escanear S/N' ] to deeply equal [ 'Escanear S/N' ]`;
- `lista y cabecera > la cabecera lleva el nombre del portal …`: `Unable to find an accessible element with the role "heading" and name "Pérez Gómez María"` (hoy la cabecera lleva el nombre de Desk).

Son de guarda, y pasan ya: «un único técnico…», «si el almacenamiento local falla…» y «salen las asignadas a su cuenta y las del único nombre…».

- [ ] **Step 3: Implementar**

Reemplazar todo el contenido de `apps/equipos-taller/src/MisEquipos.tsx` por:

```tsx
// «Mis equipos»: vista de solo lectura, pensada para el celular, de los equipos de un técnico. Reutiliza el
// sondeo y el modelo del tablero (no duplica reglas). Solo lo suyo (D4): las visitas que el portal asignó a su
// cuenta (`userId`) y las que tienen como Encargado de Desk el ÚNICO nombre del tablero que casa con el suyo. Los
// dos datos los da el portal. Sin coincidencia única no se pregunta nada: la vía es asignarle sus equipos desde la tabla.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { inicialesDe, type ColumnaTablero, type Tarjeta } from './nucleo';
import { apiEquipos } from './api';
import { Raiz, SinTablero, hhmm, useTableroDatos } from './tablero/Tablero';
import EscanearSerial from './EscanearSerial';
import { coincideTecnico, esMia, tecnicosDelTablero } from './tecnico';
import './tablero/tablero.css';
import './tablero/mis-equipos.css';

/** Donde antes se recordaba en el dispositivo el nombre elegido en «¿Quién eres?». Ya no se lee: se borra al abrir. */
export const CLAVE_TECNICO = 'equipos-taller:mis-equipos:tecnico';

// Sin esto, un nombre recordado de otra persona seguiría a la vista. El almacenamiento local puede no existir
// (modo privado, política del navegador): nunca rompe la vista.
const olvidarNombreRecordado = () => { try { localStorage.removeItem(CLAVE_TECNICO); } catch { /* sin almacenamiento: nada que borrar */ } };

export function Ficha({ t }: { t: Tarjeta }) {
  return (
    <article className="tt-tarjeta" aria-label={`Equipo ${t.sn}`}>
      <div className="tt-tarjeta-cab">
        <span className="tt-sn tt-mono">{t.sn}</span>
        <span className={`tt-dias-suave tt-dias-suave-${t.tono}`}>{`${t.dias} d`}</span>
      </div>
      <div className="tt-equipo">{t.equipo}</div>
      <div className="tt-cliente">{t.ticket ? `${t.cliente} · #${t.ticket}` : t.cliente}</div>
      {t.etiquetas.length ? <div className="tt-etiquetas">{t.etiquetas.map((e) => <span key={e.tipo + e.texto} className="tt-etiqueta">{e.texto}</span>)}</div> : null}
    </article>
  );
}

function Grupo({ col }: { col: ColumnaTablero }) {
  return (
    <section className={`tt-mis-grupo tt-col-${col.id}`} aria-label={col.nombre}>
      <div className="tt-col-cab">
        <span className="tt-punto" aria-hidden />
        <h3 className="tt-col-nombre">{col.nombre}</h3>
        <span className="tt-cuenta" aria-label={`Total ${col.tarjetas.length}`}>{col.tarjetas.length}</span>
      </div>
      {col.tarjetas.map((t) => <Ficha key={t.clave} t={t} />)}
    </section>
  );
}

export default function MisEquipos({ nombre, userId = null, pedir: pedirProp }: {
  nombre: string | null;
  /** La cuenta del usuario: reconoce las visitas que el portal le asignó aunque su nombre no coincida. */
  userId?: string | null;
  pedir?: (s: AbortSignal) => ReturnType<ReturnType<typeof apiEquipos>['estado']>;
}) {
  const pedirSesion = useMemo(() => apiEquipos().estado, []);
  const pedir = useCallback((s: AbortSignal) => (pedirProp ?? pedirSesion)(s), [pedirProp, pedirSesion]);
  const { datos, modelo, ajustes, okEn, fallo, obsoleto } = useTableroDatos(pedir);
  const [escaneando, setEscaneando] = useState(false);
  useEffect(olvidarNombreRecordado, []);
  if (!modelo) return <SinTablero tema="sistema" hayDatos={!!datos} fallo={fallo} />;

  // El único nombre de Desk que casa con el del usuario; si casan varios, o ninguno, null.
  const coinciden = nombre ? tecnicosDelTablero(modelo).filter((n) => coincideTecnico(nombre, n)) : [];
  const reconocido = coinciden.length === 1 ? coinciden[0] : null;
  const grupos = modelo.columnas
    .map((c) => ({ ...c, tarjetas: c.tarjetas.filter((t) => esMia(t, { userId, nombre: reconocido })) }))
    .filter((c) => c.tarjetas.length > 0);
  const todas = grupos.flatMap((g) => g.tarjetas);
  // La cabecera es del usuario aunque no tenga equipos: su nombre del portal y sus iniciales con la regla de las
  // tarjetas. El color, el de su primera tarjeta (como en el tablero); sin tarjetas, el neutro.
  const color = todas[0]?.tecnico?.avatar;
  const iniciales = nombre ? inicialesDe(nombre) : '';
  const kpis = [
    { e: 'Asignados', v: todas.length },
    { e: 'Esperan cliente', v: grupos.filter((g) => g.id === 'notificacion').reduce((s, g) => s + g.tarjetas.length, 0) },
    { e: `Más de ${ajustes.umbralRojo} d`, v: todas.filter((t) => t.dias > ajustes.umbralRojo).length },
  ];

  return (
    <Raiz tema="sistema" clase="tt-mis">
      <header className="tt-mis-cab">
        <span className={`tt-av tt-av-grande ${color !== undefined ? `tt-av-${color}` : 'tt-av-neutro'}`} aria-hidden>{iniciales || '–'}</span>
        <div className="tt-mis-id">
          <p>Mis equipos</p>
          <h1>{nombre ?? ''}</h1>
        </div>
      </header>
      {obsoleto && okEn !== null ? <p role="alert" className="tt-aviso">{`Datos desactualizados desde ${hhmm(okEn)}`}</p> : null}
      <ul className="tt-mis-kpis" aria-label="Indicadores">
        {kpis.map((k) => <li key={k.e} className="tt-kpi"><span className="tt-kpi-n">{k.v}</span><span className="tt-kpi-e">{k.e}</span></li>)}
      </ul>
      {todas.length === 0 ? <p className="tt-mensaje">No tienes equipos asignados. Si falta alguno, pide que te lo asignen desde la tabla.</p> : null}
      {escaneando ? <EscanearSerial tarjetas={modelo.columnas.flatMap((c) => c.tarjetas)} onCerrar={() => setEscaneando(false)} mostrar={(t) => <Ficha key={t.clave} t={t} />} /> : null}
      {grupos.map((g) => <Grupo key={g.id} col={g} />)}
      <nav className="tt-mis-barra" aria-label="Taller">
        <button type="button" className="tt-mis-boton" onClick={() => setEscaneando(true)}>Escanear S/N</button>
        <a className="tt-mis-boton" href="/equipos-taller?vista=tablero">Ver taller completo</a>
      </nav>
    </Raiz>
  );
}
```

`Ficha`, `Grupo`, los contadores, «Escanear S/N» (con todas las tarjetas del taller, D5), «Ver taller completo», el aviso de datos desactualizados y el sondeo no cambian. `color` comprueba `!== undefined` porque el avatar `0` es válido.

En `apps/equipos-taller/src/tablero/mis-equipos.css`, borrar (con Edit, sustituyendo cada línea con su salto por nada) estas tres reglas, que ya no tienen elemento:

```css
.tt-mis-cambiar { background: transparent; color: var(--tt-tx-cab); border-color: var(--tt-tx-cab-tenue); }
```

```css
.tt-mis-selector { display: flex; flex-direction: column; gap: 8px; }
.tt-mis-selector h2 { font-size: 18px; margin: 0; }
```

`.tt-mis-boton` y `.tt-mis-grupo`, que están al lado, se quedan.

En `apps/equipos-taller/src/tecnico.ts`, reemplazar:

```ts
/**
 * Nombres distintos (por clave normalizada) de los técnicos de DESK con tarjetas, en orden alfabético. Las
 * asignadas en el portal no entran: se reconocen por la cuenta, no por «¿Quién eres?».
 */
```

por:

```ts
/**
 * Nombres distintos (por clave normalizada) de los técnicos de DESK con tarjetas, en orden alfabético: contra ellos
 * se busca el nombre del usuario en «Mis equipos». Las asignadas en el portal no entran: se reconocen por la cuenta.
 */
```

Y reemplazar:

```ts
 * ¿Es mía esta tarjeta? Con asignación del portal, solo si es de mi cuenta (aunque Desk o el nombre digan otra
 * cosa). Sin ella, por el nombre elegido o reconocido, como antes.
```

por:

```ts
 * ¿Es mía esta tarjeta? Con asignación del portal, solo si es de mi cuenta (aunque Desk o el nombre digan otra
 * cosa). Sin ella, por el nombre reconocido: el único de Desk que casa con el mío.
```

- [ ] **Step 4: Verlas pasar**

```bash
npm test --workspace=apps/equipos-taller -- src/MisEquipos.test.tsx src/tecnico.test.ts src/tablero/tablero.css.test.ts
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS (`MisEquipos.test.tsx`: `20 passed`; `tablero.css.test.ts` sigue viendo más de 10 variables `--tt-*` en `mis-equipos.css` y ningún literal de color) y `tsc` sin errores. Que `tsc` no se queje de `Selector`, `leer`, `guardar`, `guardado`, `cambiando`, `elegir` ni `dueno`, que ya no existen (`noUnusedLocals`).

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/equipos-taller/src/MisEquipos.tsx apps/equipos-taller/src/MisEquipos.test.tsx apps/equipos-taller/src/tablero/mis-equipos.css apps/equipos-taller/src/tecnico.ts apps/equipos-taller/src/tecnico.test.ts
git commit -m "feat(equipos-taller): «Mis equipos» muestra solo lo del usuario, sin «¿Quién eres?»"
```

---

### Tarea 5: Documentación y comentarios del portal

**Files:**
- Modify: `docs/equipos-taller.md` (L149, L151)
- Modify: `apps/equipos-taller/CLAUDE.md` (L21, L22, L27)
- Modify: `apps/portal/src/components/RutaMisEquipos.tsx` (comentario, L14)
- Modify: `apps/portal/src/components/RutaMisEquipos.test.tsx` (nombre de la prueba, L38)

Son documentación y comentarios, sin cambio de comportamiento. La comprobación es releer, más la prueba del portal para confirmar que el cambio de nombre no rompe nada.

- [ ] **Step 1: `docs/equipos-taller.md`**

Reemplazar:

```markdown
| Botones «Tabla \| Tablero» de la app (`?vista=tablero`) | El tablero dentro del portal, para todos los que tienen la app. Su tema es el «Tema del tablero» de Ajustes (el mismo que la TV); no hay selector en la pestaña. |
```

por:

```markdown
| Botones «Tabla \| Tablero» de la app (`?vista=tabla` / `?vista=tablero`) | El tablero dentro del portal, para todos los que tienen la app. Su tema es el «Tema del tablero» de Ajustes (el mismo que la TV); no hay selector en la pestaña. Cada botón deja su vista en la dirección: al recargar no cambia, tampoco en el celular. |
```

Y reemplazar:

```markdown
| `/equipos-taller/mis-equipos` | «Mis equipos» en el móvil: los equipos del técnico, agrupados por columna. Una visita asignada en el portal es suya si se asignó a su cuenta (aunque el nombre no coincida), y de nadie más. Las demás se reconocen por el nombre del portal frente al Encargado de Desk; si no coincide con ninguno, o con varios, pregunta «¿Quién eres?» y el móvil lo recuerda. Sin botones de cambio de estado. |
```

por:

```markdown
| `/equipos-taller/mis-equipos` | «Mis equipos» en el celular: solo los equipos del usuario, agrupados por columna. Se abre sola al entrar a la app con una pantalla de menos de 768 px y sin `?vista=` en la dirección; se mira una vez, al abrir, y «Atrás» vuelve a donde estaba. A la tabla se vuelve con «Ver taller completo» y el botón «Tabla». Son suyas las visitas asignadas en el portal a su cuenta (aunque el nombre no coincida, y de nadie más) y las que tienen como Encargado de Desk el único nombre que coincide con el suyo del portal. Si coinciden varios, o ninguno, dice «No tienes equipos asignados…»: no hay «¿Quién eres?» ni «Cambiar», y la vía es asignarle sus equipos desde la tabla con el Responsable. «Escanear S/N» y «Ver taller completo» siguen mostrando cualquier equipo: no es una restricción de seguridad. Sin botones de cambio de estado ni de remisión firmada (escribirían en Desk 2.0). |
```

- [ ] **Step 2: `apps/equipos-taller/CLAUDE.md`**

Reemplazar:

```markdown
`src/App.tsx` (botones «Tabla | Tablero»; el tema sale del ajuste «Tema del tablero», sin selector en la pestaña)
```

por:

```markdown
`src/App.tsx` (botones «Tabla | Tablero», que escriben `?vista=tabla|tablero`; el tema sale del ajuste «Tema del tablero», sin selector en la pestaña)
```

Reemplazar:

```markdown
  - Rutas del portal fuera del shell: `apps/portal/src/components/RutaTableroTv.tsx` y `RutaMisEquipos.tsx`.
```

por:

```markdown
  - Rutas del portal fuera del shell: `apps/portal/src/components/RutaTableroTv.tsx` y `RutaMisEquipos.tsx`. Dentro del shell, `EntradaEquiposTaller.tsx` envuelve la app en `/equipos-taller/*`: en el celular salta a «Mis equipos».
```

Y reemplazar:

```markdown
  - Pantalla: la misma columna «Responsable» de siempre; el selector solo aparece con permiso. La cola de guardado (una petición cada vez por visita) vive en `src/responsable.ts` (`useAsignarResponsable`). «Mis equipos» (`tecnico.ts`, `esMia`): con asignación del portal, por la cuenta (`userId`, que manda `RutaMisEquipos`); sin ella, por el nombre como antes.
```

por:

```markdown
  - Pantalla: la misma columna «Responsable» de siempre; el selector solo aparece con permiso. La cola de guardado (una petición cada vez por visita) vive en `src/responsable.ts` (`useAsignarResponsable`). «Mis equipos» (`tecnico.ts`, `esMia`): con asignación del portal, por la cuenta (`userId`, que manda `RutaMisEquipos`); sin ella, por el único nombre de Desk que casa con el suyo.
- **«Mis equipos» al entrar desde el celular** (diseño `docs/superpowers/specs/2026-11-19-equipos-movil-design.md`):
  - El salto vive en el **portal**, que tiene el router: `apps/portal/src/components/EntradaEquiposTaller.tsx`, dentro del `AppGuard` de `/equipos-taller/*`. En la raíz, sin `?vista=` y con `matchMedia('(max-width: 767px)')`, pinta `<Navigate to="/equipos-taller/mis-equipos" replace />`, sin recargar la página. Decide una vez, al montar, y mientras salta no pinta la app. `src/App.tsx` solo deja la vista en la dirección («Tabla» escribe `?vista=tabla`), para que la tabla elegida sobreviva a una recarga.
  - `src/MisEquipos.tsx`: solo lo suyo. Sin «¿Quién eres?», sin «Cambiar» y sin nombre recordado: `CLAVE_TECNICO` se borra de `localStorage` al abrir. La cabecera usa el nombre del portal e `inicialesDe` del núcleo (`nucleo/taller-board.ts`), la misma regla que las tarjetas.
```

- [ ] **Step 3: Comentarios del portal**

En `apps/portal/src/components/RutaMisEquipos.tsx`, reemplazar:

```ts
 * Espera al perfil propio: sin él, la vista preguntaría «¿Quién eres?» aunque el nombre coincida. Manda el
```

por:

```ts
 * Espera al perfil propio: sin él, la vista diría «No tienes equipos asignados» aunque los tenga. Manda el
```

En `apps/portal/src/components/RutaMisEquipos.test.tsx`, reemplazar:

```ts
  it('mientras el perfil carga no monta la vista (evita mostrar el selector por error)', () => {
```

por:

```ts
  it('mientras el perfil carga no monta la vista (evita decir por error que no tiene equipos)', () => {
```

- [ ] **Step 4: Releer y comprobar**

Releer las dos filas de la tabla de `docs/equipos-taller.md`: siguen con dos columnas, sin `|` sueltos (el de «Tabla \| Tablero» va escapado). Releer también las viñetas nuevas de `CLAUDE.md`, con la sangría de dos espacios de las demás.

```bash
npm test --workspace=apps/portal -- src/components/RutaMisEquipos.test.tsx
```

Esperado: PASS (4 pruebas).

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add docs/equipos-taller.md apps/equipos-taller/CLAUDE.md apps/portal/src/components/RutaMisEquipos.tsx apps/portal/src/components/RutaMisEquipos.test.tsx
git commit -m "docs(equipos-taller): «Mis equipos» al entrar desde el celular"
```

---

### Tarea 6: Verificación final y despliegue

**Files:** ninguno (solo comprobaciones).

- [ ] **Step 1: Todas las suites**

```bash
npm test --workspace=apps/equipos-taller
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
cd apps/hub-api && npx vitest run src/equipos scripts
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
npm test --workspace=apps/portal -- src/components/EntradaEquiposTaller.test.tsx src/components/RutaMisEquipos.test.tsx src/components/RutaTableroTv.test.tsx
npm run build --workspace=apps/portal; echo "exit=$?"
```

Esperado:
- todo PASS y `exit=0` en el build del portal;
- en la sub-app, `App.test.tsx`, `MisEquipos.test.tsx`, `tablero.css.test.ts`, `TvEquipos.test.tsx` y `Tablero.test.tsx` en verde;
- en el portal, `EntradaEquiposTaller.test.tsx` (11) y las dos rutas fuera del shell en verde;
- en hub-api, `nucleo/pureza.test.ts` y `router-kiosco.test.ts` (T1–T8) en verde. El núcleo solo ganó un `export`.

- [ ] **Step 2: Privacidad, en un comando aparte, antes de empujar**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git status --short
git log --oneline main..feat/equipos-movil
git diff --stat main..feat/equipos-movil
```

Esperado:
- la verificación dice `Sin valores reales en: …`;
- `git status` solo muestra lo que ya era del usuario: ` M .gitignore` y `?? .atl/`, `?? apps/WO-sales/prompts/`, `?? img/`, `?? openspec/`;
- el diff solo toca los ficheros del mapa de archivos, el diseño y este plan;
- nada de `fixtures-reales/`, `apps/equipos-desk2/` ni `apps/equipos-taller/diseño-kanban/`.

- [ ] **Step 3: Empujar (rama → fast-forward a `main` → push)**

```bash
git checkout main
git merge --ff-only feat/equipos-movil
git push origin main
git checkout feat/equipos-movil
```

Los cambios sin commitear del usuario (`.gitignore` y las carpetas sin seguimiento) viajan intactos entre ramas: **no** hacer `git stash`. Si `--ff-only` falla porque `main` avanzó, parar y avisar; no hacer merge ni rebase por cuenta propia.

- [ ] **Step 4: Nota de despliegue para el usuario (empujar no despliega)**

1. **Solo el portal, en EasyPanel.** No hay migración. Lo único que cambia en `apps/hub-api` es que el núcleo exporta `inicialesDe` (misma regla, mismo resultado). El portal empaqueta el núcleo: hub-api no necesita desplegarse.
2. **Prueba en el navegador:**
   - en un celular (o con la ventana a menos de 768 px), abrir «Equipos en taller» desde el menú: debe aparecer «Mis equipos» sin recargar la página (la barra lateral solo asoma un instante), y «Atrás» debe volver a la página de antes;
   - «Ver taller completo» abre el tablero; desde ahí, «Tabla» deja `?vista=tabla` en la dirección y, al recargar, la tabla se queda;
   - en escritorio, con la ventana ancha, se sigue abriendo la tabla;
   - con una cuenta cuyo nombre no casa con ningún Encargado de Desk, sale «No tienes equipos asignados…»; tras asignarle una visita desde la columna «Responsable», esa visita aparece en su «Mis equipos» en el siguiente refresco de 60 s;
   - en un celular que antes eligió un nombre en «¿Quién eres?», ya no salen los equipos de esa persona.
