# Remediación de `laboratorios-ambientales` — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la app de una maqueta parcial en un buscador de laboratorios funcional y correcto: portar la lógica del prototipo huérfano a React, corregir los bugs de datos y eliminar el módulo de IA.

**Architecture:** La app es una **librería de vistas consumida por el portal** (`apps/portal/src/App.tsx:24` importa `../../laboratorios-ambientales/src/App.tsx`); no tiene entrada standalone propia y no la necesita. La lógica pura (normalización, filtros en cascada, mapeo de equipos, cliente de datos) vive en `src/lib/` y `src/services/` con tests unitarios en vitest; los componentes de `src/pages/` solo orquestan esa lógica. Se elimina el prototipo vanilla de la raíz (`index.tsx`, 724 líneas) tras portar lo que aporta valor.

**Tech Stack:** React 19 + TypeScript 5.9 (strict) + Tailwind 3 (compilado por el portal) + vitest 2 + SODA API de datos.gov.co (dataset `2waz-acaa`).

---

## Contexto verificado (no re-investigar)

Datos comprobados contra la API en vivo el 2026-07-15:

- **Total de registros:** 19.056. La app actual pide `$limit=5000` sin paginar → carga el 26%.
- **`estado_de_la_acreditaci_n` solo tiene dos valores:** `Activa` (18.689) y `Suspendida` (367). El código compara contra `'Activo'` y `'VIGENTE'`, que **no existen** → el KPI "Acreditación Vigente" siempre da 0 y el badge verde nunca se pinta.
- **CORS:** `Access-Control-Allow-Origin: *`. Los tres proxies de respaldo del prototipo (`allorigins`, `corsproxy.io`) son innecesarios — **no portarlos**.
- **Payload:** 4,7 MB en crudo. El cache de `localStorage` comparte los ~5 MB del origen con el resto del portal.

**Nombres de campo reales de la API** (los del prototipo están desactualizados en dos casos):

```
c_digo_de_laboratorio, estado_de_la_acreditaci_n, matriz, componente, actividad,
grupo, variable, t_cnica, m_todo, rango_de_trabajo, nombre_de_la_estaci_n,
ubicaci_n_de_la_estaci_n, latitud, longitud, identificaci_n_de_equipo,
nombre_del_laboratorio, nit, contacto, ciudad, departamento, direcci_n,
tel_fono, correo, actos_administrativos_que, desde, hasta, acogimiento_a_resoluci_n
```

⚠️ El prototipo mapea `intervalo_de_medici_n_directa` (hoy es `rango_de_trabajo`) y `direcci_n_de_la_estaci_n` (hoy es `ubicaci_n_de_la_estaci_n`). Usar **siempre** los nombres de la lista de arriba.

**Registro real de ejemplo** (fixture para tests):

```json
{"c_digo_de_laboratorio":"1","estado_de_la_acreditaci_n":"Activa","matriz":"Agua","componente":"Continental","actividad":"Análisis","grupo":"Fisicoquímicos","variable":"Alcalinidad","t_cnica":"Volumetría","m_todo":"SM 2320 B","rango_de_trabajo":"5 mg CaCO3/L - 1 000 mg CaCO3/L","nombre_del_laboratorio":"CORPORACIÓN AUTÓNOMA REGIONAL DEL CENTRO DE ANTIOQUIA – CORANTIOQUIA – LABORATORIO AMBIENTAL","nit":"811.000.231-7","contacto":"Liliana María Taborda González","ciudad":"Medellín","departamento":"Antioquia","direcci_n":"Carrera 65 No. 44A-32 Piso 4","tel_fono":"6044938888 Ext. 1807- 1800","correo":"laboratorioaguas@corantioquia.gov.co","actos_administrativos_que":"0396 del 28 de marzo de 2022","desde":"2022-04-21T00:00:00.000","hasta":"---"}
```

## Decisiones tomadas

| Decisión | Motivo |
|---|---|
| **El módulo de IA se elimina**, no se migra a backend | Prescindible por ahora. Cierra SEC-002 (key en el bundle), SEC-004 (XSS) y AI-101 (RCE vía `new Function`) sin construir el proxy en `hub-api`. |
| **El "Análisis de Marcas" se mantiene** | Se porta el `equipmentMap` (46 equipos) del prototipo a `src/lib/equipment.ts`. |
| **La app no tiene entrada standalone** | No tiene `tailwind.config.js` propio: standalone saldría sin estilos. El portal ya la compila. Se borran `index.html`, `src/index.tsx` y `metadata.json`; el script `build` pasa a ser solo `tsc -b`. |
| **Sin proxies CORS** | Verificado `Access-Control-Allow-Origin: *`. |
| **El cache de `localStorage` se conserva con degradación limpia** | Si excede cuota, se borran las claves y se sigue con los datos en memoria. IndexedDB queda como mejora futura. |

## File Structure

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `src/lib/normalize.ts` | Normalizadores de `estado`/`matriz`/`componente`/`actividad`. Fuente única de los valores canónicos. |
| `src/lib/normalize.test.ts` | Tests de los normalizadores. |
| `src/lib/filters.ts` | Filtrado y opciones en cascada. Lógica pura, sin DOM. |
| `src/lib/filters.test.ts` | Tests de filtros y cascada. |
| `src/lib/equipment.ts` | `EQUIPMENT_MAP` (46 equipos) + extracción de equipo desde el texto del método. |
| `src/lib/equipment.test.ts` | Tests de extracción de equipos. |
| `src/lib/brands.ts` | Agrupación laboratorio→equipos para el Análisis de Marcas. |
| `src/lib/brands.test.ts` | Tests de agrupación. |
| `src/services/api.test.ts` | Tests de mapeo y paginación (fetch mockeado). |
| `src/pages/Buscador.tsx` | Vista del buscador. |
| `src/pages/Dashboard.tsx` | Vista de Análisis de Marcas. |

**Se modifican:** `src/types/index.ts`, `src/services/api.ts`, `src/App.tsx`, `package.json`, `README.md`.

**Se borran:** `index.tsx` (raíz), `index.html`, `src/index.tsx`, `metadata.json`, `.env.local`, `R1.02.code-workspace`.

---

## Task 1: Limpieza — borrar código muerto y el módulo de IA

Deja la app más pequeña y compilando, y cierra tres hallazgos de auditoría (SEC-002, SEC-004, AI-101). No hay tests porque es puramente eliminación; la verificación es el build y `git grep`.

**Files:**
- Delete: `apps/laboratorios-ambientales/index.tsx`
- Delete: `apps/laboratorios-ambientales/index.html`
- Delete: `apps/laboratorios-ambientales/src/index.tsx`
- Delete: `apps/laboratorios-ambientales/metadata.json`
- Delete: `apps/laboratorios-ambientales/.env.local`
- Delete: `apps/laboratorios-ambientales/R1.02.code-workspace`
- Modify: `apps/laboratorios-ambientales/package.json`
- Modify: `apps/laboratorios-ambientales/src/services/api.ts` (quitar `analyzeWithAI`)
- Modify: `apps/laboratorios-ambientales/src/App.tsx` (quitar la vista de IA)
- Modify: `apps/inventory-consolidation/vite.config.ts` (cierra el resto de AI-101)

- [ ] **Step 1: Rescatar el mapa de equipos antes de borrar el prototipo**

El `equipmentMap` (46 equipos) se necesita en la Task 6. Guardarlo fuera del árbol de trabajo:

```bash
cd apps/laboratorios-ambientales
git show c517907:apps/laboratorios-ambientales/index.tsx | sed -n '328,375p' > /tmp/equipment-map.txt
wc -l /tmp/equipment-map.txt
```

Esperado: `48 /tmp/equipment-map.txt` (la línea de apertura, 46 entradas y la de cierre).

Queda siempre recuperable con el mismo comando aunque se pierda `/tmp`: el commit `c517907` contiene el archivo.

- [ ] **Step 2: Borrar los archivos muertos**

```bash
cd apps/laboratorios-ambientales
git rm index.tsx index.html src/index.tsx metadata.json R1.02.code-workspace
```

`index.tsx` nunca se compiló (`tsconfig.app.json` tiene `"include": ["src"]`) y nadie lo importaba. `index.html` cargaba `/src/index.tsx`, que monta React sobre un `<div id="root">` que ese HTML no tiene.

`.env.local` (con el `GEMINI_API_KEY=PLACEHOLDER_API_KEY`) está gitignorado, así que **no** va en el `git rm` — incluirlo aborta el comando entero con "did not match any files" y no borra nada. En un worktree limpio ni siquiera existe. Borrarlo solo si aparece:

```bash
rm -f .env.local
```

⚠️ `index.css` **se conserva**: `App.tsx` lo importa y define `.custom-scroll`, que usan las vistas nuevas.

- [ ] **Step 3: Actualizar `package.json`**

Reemplazar el archivo completo por:

```json
{
  "name": "laboratorios-ambientales",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.1",
    "@types/node": "^24.10.1",
    "@types/react": "^19.2.5",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "eslint": "^9.39.1",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.4.24",
    "globals": "^16.5.0",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.46.4",
    "vite": "^7.2.4",
    "vitest": "^2.1.9"
  }
}
```

Cambios y por qué:
- `build` pasa de `tsc -b && vite build` a `tsc -b`. Sin `index.html` no hay bundle que hacer y `vite build` fallaría; el portal es quien compila estas vistas. El `tsc -b` mantiene el typecheck en `npm run build` desde la raíz.
- Se van `dev` y `preview`: no hay entrada standalone. El flujo de desarrollo es `npm run dev` en la raíz, que levanta el portal.
- Se van `@google/genai`, `marked` y `dompurify`: solo los usaba `index.tsx` (verificado con grep — ningún otro archivo del monorepo los importa).
- Se va `react-router-dom`: la app no lo importa; el enrutado es del portal.
- Se van `tailwindcss`, `postcss` y `autoprefixer`: la app no tiene config propia de Tailwind; sus clases las compila el portal vía `apps/portal/tailwind.config.js:11`.
- Entra `vitest` (misma versión que `customer-valuation`).

- [ ] **Step 4: Quitar `analyzeWithAI` de `api.ts`**

Borrar íntegro este bloque del final de `src/services/api.ts` (era un mock de dos `if`, no una IA):

```ts
export const analyzeWithAI = async (query: string, data: Laboratorio[]): Promise<string> => {
    // Placeholder for AI logic
    // In a real implementation this would call the Gemini API
    console.log("Analyzing with AI:", query);

    // Simple mock response based on keyword matching
    if (query.toLowerCase().includes('cantidad')) {
        return `Se encontraron ${data.length} registros de laboratorios en la base de datos actual.`;
    }

    if (query.toLowerCase().includes('agua')) {
        const aguaLabs = data.filter(l => l.matriz?.toLowerCase().includes('agua')).length;
        return `Hay ${aguaLabs} laboratorios acreditados para la matriz Agua.`;
    }

    return "Lo siento, soy una IA en modo demostración. Para análisis completos se requiere configurar la API Key de Gemini.";
};
```

- [ ] **Step 5: Quitar la vista de IA de `App.tsx`**

En `src/App.tsx`, hacer estos cinco cambios:

1. Línea 4 — quitar `analyzeWithAI` del import:
```ts
import { fetchLaboratorios } from './services/api';
```

2. Línea 9 — quitar `'analisis'` de la unión de vistas:
```ts
const [view, setView] = useState<'main' | 'buscador' | 'dashboard'>('main');
```

3. Líneas 21-23 — borrar los tres estados de IA:
```ts
const [aiQuery, setAiQuery] = useState('');
const [aiResponse, setAiResponse] = useState('');
const [aiLoading, setAiLoading] = useState(false);
```

4. Líneas 66-77 — borrar la función `handleAiAnalysis` completa.

5. Borrar el botón "Análisis con IA" (líneas 107-109) y el bloque entero `{view === 'analisis' && (...)}` (líneas 281-335).

`tsconfig.app.json` tiene `noUnusedLocals: true`, así que si queda algo suelto el build lo dirá.

- [ ] **Step 6: Quitar el `define` de Gemini en `inventory-consolidation`**

Cierra la parte de AI-101 que vive fuera de esta app: inyecta la API key en el bundle de cliente de una app que ya no usa IA. En `apps/inventory-consolidation/vite.config.ts`, borrar estas cuatro líneas:

```ts
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
```

Al quedar `loadEnv` sin uso, quitarlo también del import y borrar la línea `const env = loadEnv(mode, '.', '');` y el parámetro `{ mode }`. El archivo queda:

```ts
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
```

- [ ] **Step 7: Reinstalar y verificar**

```bash
cd ../..
npm install
npm run build --workspace=apps/laboratorios-ambientales
```
Esperado: exit 0, sin salida de error.

```bash
npm run build --workspace=apps/portal
```
Esperado: exit 0 y `apps/portal/dist/` generado.

```bash
git grep -n "process.env.API_KEY" -- apps
git grep -n "GEMINI_API_KEY" -- apps
```
Esperado: **sin resultados** en ambos (así se cierra AI-101).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(laboratorios): borrar prototipo huérfano y el módulo de IA (AI-101, SEC-002, SEC-004)"
```

---

## Task 2: Normalizadores con tests

Primera pieza de lógica pura y arranque de vitest en esta app. `normalizeEstado` es la corrección del bug de fondo: los únicos estados reales son `Activa` y `Suspendida`.

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/normalize.ts`
- Test: `apps/laboratorios-ambientales/src/lib/normalize.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeEstado, normalizeMatriz, normalizeComponente, normalizeActividad } from './normalize';

describe('normalizeEstado', () => {
  it('acepta los dos únicos valores que existen en el dataset', () => {
    expect(normalizeEstado('Activa')).toBe('Activa');
    expect(normalizeEstado('Suspendida')).toBe('Suspendida');
  });

  it('es insensible a mayúsculas y recorta espacios', () => {
    expect(normalizeEstado('  ACTIVA ')).toBe('Activa');
    expect(normalizeEstado('suspendida')).toBe('Suspendida');
  });

  it('descarta los valores que la app usaba y el dataset nunca trajo', () => {
    expect(normalizeEstado('VIGENTE')).toBe('');
    expect(normalizeEstado('Activo')).toBe('');
  });

  it('devuelve cadena vacía ante entrada vacía', () => {
    expect(normalizeEstado('')).toBe('');
  });
});

describe('normalizeMatriz', () => {
  it('agrupa las variantes en las matrices canónicas', () => {
    expect(normalizeMatriz('Agua residual')).toBe('Agua');
    expect(normalizeMatriz('AIRE')).toBe('Aire');
    expect(normalizeMatriz('Suelos')).toBe('Suelo');
  });

  it('clasifica RESPEL antes que agua', () => {
    expect(normalizeMatriz('Residuos peligrosos')).toBe('Residuos Peligrosos (RESPEL)');
  });

  it('deja pasar sin tocar un valor desconocido, solo recortado', () => {
    expect(normalizeMatriz('  Biota ')).toBe('Biota');
  });

  it('unifica las dos grafías de aceite dieléctrico que trae el dataset', () => {
    expect(normalizeMatriz('Aceite Dieléctrico')).toBe('Aceite Dieléctrico');
    expect(normalizeMatriz('Aceite dieléctrico')).toBe('Aceite Dieléctrico');
  });

  it('no estropea los demás valores desconocidos del dataset', () => {
    expect(normalizeMatriz('Sedimento')).toBe('Sedimento');
    expect(normalizeMatriz('Biosólido')).toBe('Biosólido');
    expect(normalizeMatriz('Biota')).toBe('Biota');
    expect(normalizeMatriz('Lodo')).toBe('Lodo');
  });

  it('unifica también las dos grafías de RESPEL', () => {
    expect(normalizeMatriz('ReSIduos Peligrosos (RESPEL)')).toBe('Residuos Peligrosos (RESPEL)');
  });
});

describe('normalizeComponente', () => {
  it('canoniza los componentes conocidos', () => {
    expect(normalizeComponente('CALIDAD DE AIRE')).toBe('Calidad del Aire');
    expect(normalizeComponente('fuentes fijas')).toBe('Fuentes Fijas');
  });

  it('conserva los demás', () => {
    expect(normalizeComponente('Continental')).toBe('Continental');
  });
});

describe('normalizeActividad', () => {
  it('pasa a Capitalizado Por Palabra', () => {
    expect(normalizeActividad('análisis')).toBe('Análisis');
    expect(normalizeActividad('TOMA DE MUESTRAS')).toBe('Toma De Muestras');
  });

  it('devuelve cadena vacía ante entrada vacía', () => {
    expect(normalizeActividad('')).toBe('');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: FAIL — `Failed to resolve import "./normalize"`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/lib/normalize.ts`:

```ts
// Los valores canónicos salen del dataset real (2waz-acaa): estado solo toma
// 'Activa' (18 689 registros) o 'Suspendida' (367). Cualquier otra cosa es ruido.
export type EstadoAcreditacion = 'Activa' | 'Suspendida' | '';

export function normalizeEstado(value: string): EstadoAcreditacion {
  const v = (value || '').toLowerCase().trim();
  if (v === 'activa') return 'Activa';
  if (v === 'suspendida') return 'Suspendida';
  return '';
}

export function normalizeMatriz(value: string): string {
  if (!value) return '';
  const v = value.toLowerCase().trim();
  // RESPEL va primero: su descripción puede contener «agua».
  if (v.includes('residuos peligrosos')) return 'Residuos Peligrosos (RESPEL)';
  if (v.includes('agua')) return 'Agua';
  if (v.includes('aire')) return 'Aire';
  if (v.includes('suelo')) return 'Suelo';
  // El dataset trae la misma matriz con distinta capitalización ('Aceite Dieléctrico'
  // vs 'Aceite dieléctrico'): sin unificar, cada grafía sería una opción de filtro.
  return normalizeActividad(value);
}

export function normalizeComponente(value: string): string {
  if (!value) return '';
  const v = value.toLowerCase().trim();
  // El dataset trae 'Calidad del Aire' (1302) y 'Calidad de aire' (15): la misma
  // faceta con distinta preposición. La Task 7 filtra por el literal canónico.
  if (v.includes('calidad de aire') || v.includes('calidad del aire')) return 'Calidad del Aire';
  if (v.includes('fuentes fijas')) return 'Fuentes Fijas';
  return normalizeActividad(value);
}

export function normalizeActividad(value: string): string {
  if (!value) return '';
  // \b\w NO sirve: \w es solo ASCII, así que en «análisis» abre un límite de palabra
  // falso tras la «á» y produce «AnáLisis». El dataset es colombiano y va lleno de
  // tildes, así que el title-case tiene que ser Unicode-aware.
  return value.trim().toLowerCase().replace(/(?<![\p{L}\p{N}])\p{L}/gu, (l) => l.toUpperCase());
}
```

> **Corregido durante la ejecución (2026-07-15).** El borrador de este plan traía tres bugs, los tres detectados al contrastar con el dataset en vivo:
>
> 1. **`/\b\w/g` rompía todo valor con tilde.** `\w` es solo ASCII, así que en «análisis» abre un límite de palabra falso tras la «á»: producía `AnáLisis`, `MedicióN`, `ñAndú`. Contradecía al propio test del plan. Viene heredado del prototipo.
> 2. **`normalizeMatriz` y `normalizeComponente` hacían `return value.trim()`** en el fallthrough, dejando la misma faceta con dos o tres grafías como opciones de filtro distintas (`Aceite dieléctrico`/`Aceite Dieléctrico`, `Biota acuática marina`/`Biota Acuática Marina`/`Biota acuática Marina`, `Olores ofensivos`/`Olores Ofensivos`…).
> 3. **🔴 El más grave: la regla de calidad del aire perdía el 98,9% de sus registros.** El dataset trae `Calidad del Aire` (1302) y `Calidad de aire` (15) — la misma faceta con distinta preposición. `v.includes('calidad de aire')` **no** captura `"calidad del aire"` (hay una `l` en medio), así que 1302 registros caían al fallthrough. Como la Task 7 filtra el Análisis de Marcas por `componente === 'Calidad de aire'`, esa vista habría mostrado **15 de 1317 registros** — y habría parecido que funcionaba.
>
> **Los 11 valores reales de `matriz`**: Agua 12058 · Aire 2534 · Suelo 1426 · Biota 1136 · Sedimento 983 · Residuos Peligrosos (RESPEL) 392 · Lodo 372 · Aceite Dieléctrico 78 · Biosólido 53 · ReSIduos Peligrosos (RESPEL) 16 · Aceite dieléctrico 8. Ninguno contiene «agua» y «aire» a la vez, así que el orden de las reglas es seguro.
>
> **Los 28 de `componente`**: Continental 11415 · Suelo 1424 · Calidad del Aire 1302 · Biota Acuática Continental 949 · Fuentes Fijas 885 · Marina 658 · Sedimento Continental 578 · Residuos Peligrosos (RESPEL) 408 · Sedimento Marino 378 · Lodo 372 · Ruido 185 · Biota Acuática Marina 95 · Olores Ofensivos 80 · Aceite Dieléctrico 74 · Fuentes fijas 60 · Biosólido 53 · Biota Terrestre 31 · Biota acuática continental 27 · Biota acuática marina 22 · Calidad de aire 15 · Biota acuática Marina 12 · Sedimento 10 · Aceite dieléctrico 7 · Vibraciones 6 · Superficies Sólidas No Porosas 4 · Agua de Poro 3 · Olores ofensivos 2 · Superficies sólidas no porosas 1.
>
> **`actividad`** trae 37 valores con la misma clase de divergencia, que el title-case ya resuelve (`Determinación directa` 631 / `Determinación Directa` 37, `Muestreo puntual` 52 / `Muestreo Puntual` 1201…). Dos quedan **sin resolver a propósito**: el typo de origen `Muestreo Intregrado` (27 registros, ~4 variantes) no se corrige — no nos toca inventar ortografía sobre la fuente oficial; el doble espacio de `Muestreo  Integrado en Cuerpo Lótico` (7) sí, colapsando espacios internos.
>
> **Lección para el resto del plan:** ningún literal de faceta debe darse por bueno sin comprobarlo con `$select=<campo>,count(*)&$group=<campo>`. La fuente es un dataset público con captura manual y la divergencia de grafías es la norma, no la excepción.
>
> **Ejecutado (Task 2, commits `f70d47b` + `5c92567`).** El resultado se apartó del borrador en tres puntos, todos por evidencia:
>
> - **🔴 El literal canónico de calidad del aire es `'Calidad del Aire'`, NO `'Calidad de aire'`.** El borrador imponía la grafía minoritaria (15 registros) sobre la mayoritaria (1302), que además es el español correcto y encaja con el estilo title-case del resto del desplegable. **Las Tasks 5, 7, 9 y 11 usan `'Calidad del Aire'`.**
> - **Las reglas `agua`/`aire`/`suelo`/`fuentes fijas` se eliminaron.** Sobre los valores reales eran no-ops (los datos ya vienen exactos, y `Fuentes fijas` llega a `Fuentes Fijas` por title-case igual). Y `includes('agua')` era además sobre-ansiosa: con `Agua de Poro` como componente real, una matriz futura así se colapsaría a `Agua`, destruyendo una faceta. Criterio adoptado: **una regla explícita por cada colapso que los datos exijan, cero generalidad especulativa.**
> - **`toTitleCase` se extrajo de `normalizeActividad`** (que queda como alias): `normalizeMatriz` llamando a `normalizeActividad` para normalizar matrices confundía.
>
> Resultado verificado ejecutando las funciones contra los valores reales: `matriz` 11 grafías → **9 opciones**, `componente` 28 → **20**, con los 1317 registros de calidad del aire en una sola y el acrónimo RESPEL intacto en ambos campos.
>
> **Riesgo anotado (no es bug hoy):** los fallthroughs aplican title-case a cualquier valor nuevo, así que un acrónimo futuro del IDEAM (`COV`, `HAP`) se degradaría en silencio a `Cov`/`Hap`. Los 39 valores actuales están verificados uno a uno; cuando aparezca uno nuevo, se le añade su regla explícita.

### ⚠️ `variable`: mismo problema, solución distinta (afecta a las Tasks 4, 5 y 8)

`variable` alimenta el multiselect del Buscador y **arrastra la misma divergencia**: 994 valores crudos que colapsan a 888 al bajar a minúsculas y colapsar espacios — **99 grupos duplicados** (`Plomo`/`plomo`, `Dureza Total`/`Dureza total`, `Sólidos Totales`/`Sólidos totales`, `Fósforo Reactivo Total (Leído como Ortofosfato)` en 3 grafías…).

**Pero aquí title-case NO sirve: destruiría 74 nombres técnicos.** Verificado:

| Crudo | Con title-case (❌) |
|---|---|
| `pH` | `Ph` |
| `Demanda Química de Oxígeno (DQO)` | `Demanda Química De Oxígeno (Dqo)` |
| `n-Decano (C10)` | `N-Decano (C10)` |
| `p-Xileno` | `P-Xileno` |
| `Compuestos Orgánicos Volátiles - BTEX` | `Compuestos Orgánicos Volátiles - Btex` |
| `Surfactantes Aniónicos como SAAM` | `Surfactantes Aniónicos Como Saam` |

`matriz`/`componente`/`actividad` son facetas en prosa y admiten title-case; `variable` es **nomenclatura técnica**, donde la capitalización es semántica. No añadir un `normalizeVariable` con title-case.

**Enfoque para `variable`:** `mapRecord` (Task 4) solo hace `trim()` + colapsar espacios internos, sin tocar mayúsculas. La deduplicación se resuelve al **cotejar**, no al normalizar: `optionsFor` (Task 5) agrupa por clave en minúsculas y muestra como canónica la grafía más frecuente, y `applyFilters` compara en minúsculas para que seleccionar `Plomo` no pierda los registros de `plomo`. Sin esto, el multiselect muestra 994 opciones con ~99 duplicados y filtrar por una grafía pierde la otra.

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: PASS — 4 suites, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/normalize.ts apps/laboratorios-ambientales/src/lib/normalize.test.ts
git commit -m "feat(laboratorios): normalizadores con los valores reales del dataset"
```

---

## Task 3: Tipos alineados con la API real

Reemplaza el tipo `Laboratorio` inventado (con `parametro`, `vigencia_acreditacion`, `resolucion`) por uno que refleja los campos que la API devuelve de verdad.

**Files:**
- Modify: `apps/laboratorios-ambientales/src/types/index.ts`

- [ ] **Step 1: Reescribir el archivo de tipos**

Reemplazar `src/types/index.ts` completo por:

```ts
import type { EstadoAcreditacion } from '../lib/normalize';

// Un registro = un parámetro acreditado de un laboratorio (no un laboratorio).
// Los nombres de campo derivan del dataset 2waz-acaa de datos.gov.co.
export type Laboratorio = {
  codigo: string;
  estado: EstadoAcreditacion;
  matriz: string;
  componente: string;
  actividad: string;
  grupo: string;
  variable: string;
  tecnica: string;
  metodo: string;
  rango: string;
  nombreLaboratorio: string;
  nit: string;
  contacto: string;
  ciudad: string;
  departamento: string;
  direccion: string;
  telefono: string;
  correo: string;
  actoAdministrativo: string;
  desde: string;
  hasta: string;
};

export type FilterState = {
  busqueda: string;
  estado: string;
  matriz: string;
  componente: string;
  actividad: string;
  variables: string[];
  metodo: string;
};

export const EMPTY_FILTERS: FilterState = {
  busqueda: '',
  estado: '',
  matriz: '',
  componente: '',
  actividad: '',
  variables: [],
  metodo: '',
};
```

Se elimina `AIResponse`: era del módulo de IA.

- [ ] **Step 2: Verificar que el build falla como se espera**

```bash
npm run build --workspace=apps/laboratorios-ambientales
```
Esperado: FAIL. `api.ts` y `App.tsx` todavía usan los campos viejos (`nombre_laboratorio`, `parametro`, `filters.nombre`). Las Tasks 4 y 8 los arreglan. Es una rotura intencional y acotada: **no** commitear todavía.

- [ ] **Step 3: Anotar y seguir**

Sin commit — este cambio se commitea junto con la Task 4, que devuelve el árbol a verde. Se define aquí para que `api.ts` tenga contra qué compilar.

---

## Task 4: Cliente de datos paginado y con el mapeo correcto

Corrige los dos bugs de datos más graves: solo se cargaba el 26% del dataset y el mapeo de campos no coincidía con la API. Además, los fallos de red dejan de devolver `[]` en silencio.

**Files:**
- Modify: `apps/laboratorios-ambientales/src/services/api.ts`
- Test: `apps/laboratorios-ambientales/src/services/api.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/api.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapRecord, fetchLaboratorios, PAGE_SIZE } from './api';

// Registro real de la API, recortado a los campos que mapeamos.
const RAW = {
  c_digo_de_laboratorio: '1',
  estado_de_la_acreditaci_n: 'Activa',
  matriz: 'Agua',
  componente: 'Continental',
  actividad: 'Análisis',
  grupo: 'Fisicoquímicos',
  variable: 'Alcalinidad',
  t_cnica: 'Volumetría',
  m_todo: 'SM 2320 B',
  rango_de_trabajo: '5 mg CaCO3/L - 1 000 mg CaCO3/L',
  nombre_del_laboratorio: 'CORANTIOQUIA – LABORATORIO AMBIENTAL',
  nit: '811.000.231-7',
  contacto: 'Liliana María Taborda González',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  direcci_n: 'Carrera 65 No. 44A-32 Piso 4',
  tel_fono: '6044938888 Ext. 1807- 1800',
  correo: 'laboratorioaguas@corantioquia.gov.co',
  actos_administrativos_que: '0396 del 28 de marzo de 2022',
  desde: '2022-04-21T00:00:00.000',
  hasta: '---',
};

const page = (n: number) => Array.from({ length: n }, () => RAW);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapRecord', () => {
  it('mapea los nombres de campo reales de la API', () => {
    const lab = mapRecord(RAW);
    expect(lab.codigo).toBe('1');
    expect(lab.estado).toBe('Activa');
    expect(lab.variable).toBe('Alcalinidad');
    expect(lab.metodo).toBe('SM 2320 B');
    expect(lab.tecnica).toBe('Volumetría');
    expect(lab.rango).toBe('5 mg CaCO3/L - 1 000 mg CaCO3/L');
    expect(lab.nombreLaboratorio).toBe('CORANTIOQUIA – LABORATORIO AMBIENTAL');
    expect(lab.ciudad).toBe('Medellín');
    expect(lab.departamento).toBe('Antioquia');
    expect(lab.correo).toBe('laboratorioaguas@corantioquia.gov.co');
  });

  it('normaliza estado, matriz, componente y actividad al mapear', () => {
    const lab = mapRecord({ ...RAW, estado_de_la_acreditaci_n: 'ACTIVA', matriz: 'Agua residual' });
    expect(lab.estado).toBe('Activa');
    expect(lab.matriz).toBe('Agua');
  });

  it('convierte los campos ausentes en cadena vacía, no undefined', () => {
    const lab = mapRecord({ variable: 'pH' });
    expect(lab.nombreLaboratorio).toBe('');
    expect(lab.metodo).toBe('');
    expect(lab.estado).toBe('');
  });
});

describe('fetchLaboratorios', () => {
  it('pagina hasta agotar el dataset', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page(PAGE_SIZE) })
      .mockResolvedValueOnce({ ok: true, json: async () => page(PAGE_SIZE) })
      .mockResolvedValueOnce({ ok: true, json: async () => page(37) });
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchLaboratorios();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(data).toHaveLength(PAGE_SIZE * 2 + 37);
  });

  it('pide offsets crecientes y ordena por :id para paginar estable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page(PAGE_SIZE) })
      .mockResolvedValueOnce({ ok: true, json: async () => page(1) });
    vi.stubGlobal('fetch', fetchMock);

    await fetchLaboratorios();

    expect(fetchMock.mock.calls[0][0]).toContain('$offset=0');
    expect(fetchMock.mock.calls[0][0]).toContain('$order=:id');
    expect(fetchMock.mock.calls[1][0]).toContain(`$offset=${PAGE_SIZE}`);
  });

  it('para en una sola petición si la primera página no está llena', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => page(10) });
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchLaboratorios();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data).toHaveLength(10);
  });

  it('reporta el avance', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page(PAGE_SIZE) })
      .mockResolvedValueOnce({ ok: true, json: async () => page(5) });
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();

    await fetchLaboratorios(onProgress);

    expect(onProgress).toHaveBeenNthCalledWith(1, PAGE_SIZE);
    expect(onProgress).toHaveBeenNthCalledWith(2, PAGE_SIZE + 5);
  });

  it('lanza el error si la red falla y no hay cache, en vez de devolver vacío', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchLaboratorios()).rejects.toThrow('503');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: FAIL — `mapRecord` y `PAGE_SIZE` no existen (`api.ts` solo exporta `fetchLaboratorios`).

- [ ] **Step 3: Reescribir `api.ts`**

Reemplazar `src/services/api.ts` completo por:

```ts
import type { Laboratorio } from '../types';
import { normalizeActividad, normalizeComponente, normalizeEstado, normalizeMatriz } from '../lib/normalize';

// Dataset «Laboratorios ambientales acreditados por el IDEAM» de datos.gov.co.
// Sirve CORS abierto (Access-Control-Allow-Origin: *): no hacen falta proxies.
const DATASET_ID = '2waz-acaa';
const BASE_URL = `https://www.datos.gov.co/resource/${DATASET_ID}.json`;

export const PAGE_SIZE = 5000;

const CACHE_KEY_DATA = 'labs_cache_data';
const CACHE_KEY_TIMESTAMP = 'labs_cache_timestamp';
const CACHE_DURATION = 24 * 60 * 60 * 1000;

export function mapRecord(record: Record<string, string | undefined>): Laboratorio {
  return {
    codigo: record.c_digo_de_laboratorio ?? '',
    estado: normalizeEstado(record.estado_de_la_acreditaci_n ?? ''),
    matriz: normalizeMatriz(record.matriz ?? ''),
    componente: normalizeComponente(record.componente ?? ''),
    actividad: normalizeActividad(record.actividad ?? ''),
    grupo: (record.grupo ?? '').trim(),
    variable: (record.variable ?? '').trim(),
    tecnica: record.t_cnica ?? '',
    metodo: record.m_todo ?? '',
    rango: record.rango_de_trabajo ?? '',
    nombreLaboratorio: record.nombre_del_laboratorio ?? '',
    nit: record.nit ?? '',
    contacto: record.contacto ?? '',
    ciudad: record.ciudad ?? '',
    departamento: record.departamento ?? '',
    direccion: record.direcci_n ?? '',
    telefono: record.tel_fono ?? '',
    correo: record.correo ?? '',
    actoAdministrativo: record.actos_administrativos_que ?? '',
    desde: record.desde ?? '',
    hasta: record.hasta ?? '',
  };
}

function readCache(ignoreAge = false): Laboratorio[] | null {
  try {
    const data = localStorage.getItem(CACHE_KEY_DATA);
    const ts = localStorage.getItem(CACHE_KEY_TIMESTAMP);
    if (!data || !ts) return null;
    if (!ignoreAge && Date.now() - parseInt(ts, 10) >= CACHE_DURATION) return null;
    return JSON.parse(data) as Laboratorio[];
  } catch {
    return null;
  }
}

function writeCache(data: Laboratorio[]): void {
  try {
    localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(data));
    localStorage.setItem(CACHE_KEY_TIMESTAMP, Date.now().toString());
  } catch {
    // El dataset ronda los 3 MB y el portal comparte los ~5 MB del origen: si no
    // cabe, dejamos el cache limpio en vez de una entrada a medias. Los datos ya
    // están en memoria, así que la sesión sigue funcionando.
    try {
      localStorage.removeItem(CACHE_KEY_DATA);
      localStorage.removeItem(CACHE_KEY_TIMESTAMP);
    } catch {
      // localStorage no disponible; nada que limpiar.
    }
  }
}

export async function fetchLaboratorios(onProgress?: (cargados: number) => void): Promise<Laboratorio[]> {
  const cached = readCache();
  if (cached) return cached;

  try {
    const all: Laboratorio[] = [];
    let offset = 0;

    for (;;) {
      // $order=:id es lo que hace estable la paginación en SODA: sin un orden
      // explícito el servidor puede repetir u omitir filas entre páginas.
      const url = `${BASE_URL}?$limit=${PAGE_SIZE}&$offset=${offset}&$order=:id`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Error de red al consultar datos.gov.co: ${response.status}`);

      const records = (await response.json()) as Record<string, string>[];
      all.push(...records.map(mapRecord));
      onProgress?.(all.length);

      if (records.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    writeCache(all);
    return all;
  } catch (error) {
    const stale = readCache(true);
    if (stale) return stale;
    throw error;
  }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: PASS — 2 suites nuevas, 9 tests (20 en total con los de `normalize`).

- [ ] **Step 5: Confirmar contra la API real que se cargan los 19.056**

```bash
curl -s "https://www.datos.gov.co/resource/2waz-acaa.json?\$select=count(*)"
```
Esperado: `[{"count":"19056"}]`. Con `PAGE_SIZE=5000` son 4 peticiones (5000+5000+5000+4056), y la última corta el bucle por venir incompleta.

- [ ] **Step 6: Commit**

Incluye los tipos de la Task 3, que vuelven a compilar con este cambio.

```bash
git add apps/laboratorios-ambientales/src/types/index.ts apps/laboratorios-ambientales/src/services/api.ts apps/laboratorios-ambientales/src/services/api.test.ts
git commit -m "fix(laboratorios): paginar el dataset completo y mapear los campos reales de la API"
```

Nota: `App.tsx` sigue roto (usa `filters.nombre`, `item.parametro`). Lo arregla la Task 8. Si necesitas el árbol verde antes, ejecuta las Tasks 5-8 en orden sin parar.

---

## Task 5: Filtros en cascada

Porta la capacidad principal que perdió la versión React: los filtros dependientes. Cada filtro solo ofrece opciones que existen dentro de lo ya seleccionado aguas arriba.

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/filters.ts`
- Test: `apps/laboratorios-ambientales/src/lib/filters.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { EMPTY_FILTERS } from '../types';
import { applyFilters, optionsFor } from './filters';

const lab = (over: Partial<Laboratorio>): Laboratorio => ({
  codigo: '1', estado: 'Activa', matriz: 'Agua', componente: 'Continental',
  actividad: 'Análisis', grupo: 'Fisicoquímicos', variable: 'pH', tecnica: 'Electrometría',
  metodo: 'SM 4500', rango: '', nombreLaboratorio: 'Lab Uno', nit: '', contacto: '',
  ciudad: 'Medellín', departamento: 'Antioquia', direccion: '', telefono: '', correo: '',
  actoAdministrativo: '', desde: '', hasta: '', ...over,
});

const DATA: Laboratorio[] = [
  lab({ matriz: 'Agua', componente: 'Continental', variable: 'pH', metodo: 'SM 4500' }),
  lab({ matriz: 'Agua', componente: 'Continental', variable: 'Alcalinidad', metodo: 'SM 2320 B' }),
  lab({ matriz: 'Aire', componente: 'Calidad del Aire', variable: 'PM10', metodo: 'EQPM-0798-122', nombreLaboratorio: 'Lab Dos' }),
  lab({ matriz: 'Aire', componente: 'Fuentes Fijas', variable: 'SO2', metodo: 'M6', estado: 'Suspendida' }),
];

describe('applyFilters', () => {
  it('sin filtros devuelve todo', () => {
    expect(applyFilters(DATA, EMPTY_FILTERS)).toHaveLength(4);
  });

  it('busca por nombre de laboratorio y por variable', () => {
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, busqueda: 'lab dos' })).toHaveLength(1);
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, busqueda: 'alcalinidad' })).toHaveLength(1);
  });

  it('la búsqueda es insensible a mayúsculas y recorta espacios', () => {
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, busqueda: '  PM10 ' })).toHaveLength(1);
  });

  it('filtra por estado con los valores reales', () => {
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, estado: 'Activa' })).toHaveLength(3);
    expect(applyFilters(DATA, { ...EMPTY_FILTERS, estado: 'Suspendida' })).toHaveLength(1);
  });

  it('combina filtros en conjunción', () => {
    const res = applyFilters(DATA, { ...EMPTY_FILTERS, matriz: 'Aire', estado: 'Activa' });
    expect(res).toHaveLength(1);
    expect(res[0].variable).toBe('PM10');
  });

  it('trata variables como un OR entre las seleccionadas', () => {
    const res = applyFilters(DATA, { ...EMPTY_FILTERS, variables: ['pH', 'PM10'] });
    expect(res).toHaveLength(2);
  });
});

describe('optionsFor', () => {
  it('acota componente a la matriz elegida', () => {
    expect(optionsFor(DATA, 'componente', { ...EMPTY_FILTERS, matriz: 'Agua' })).toEqual(['Continental']);
    expect(optionsFor(DATA, 'componente', { ...EMPTY_FILTERS, matriz: 'Aire' })).toEqual(['Calidad del Aire', 'Fuentes Fijas']);
  });

  it('sin filtros aguas arriba ofrece todas las opciones, ordenadas y sin repetir', () => {
    expect(optionsFor(DATA, 'componente', EMPTY_FILTERS)).toEqual(['Calidad del Aire', 'Continental', 'Fuentes Fijas']);
  });

  it('acota variable a matriz + componente', () => {
    const filters = { ...EMPTY_FILTERS, matriz: 'Agua', componente: 'Continental' };
    expect(optionsFor(DATA, 'variable', filters)).toEqual(['Alcalinidad', 'pH']);
  });

  it('acota método por las variables seleccionadas', () => {
    const filters = { ...EMPTY_FILTERS, matriz: 'Agua', variables: ['Alcalinidad'] };
    expect(optionsFor(DATA, 'metodo', filters)).toEqual(['SM 2320 B']);
  });

  it('el estado también acota, aunque no esté en la cascada', () => {
    expect(optionsFor(DATA, 'componente', { ...EMPTY_FILTERS, matriz: 'Aire', estado: 'Activa' })).toEqual(['Calidad del Aire']);
  });

  it('ignora el propio filtro del campo al calcular sus opciones', () => {
    const filters = { ...EMPTY_FILTERS, matriz: 'Aire', componente: 'Calidad del Aire' };
    expect(optionsFor(DATA, 'componente', filters)).toEqual(['Calidad del Aire', 'Fuentes Fijas']);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: FAIL — `Failed to resolve import "./filters"`.

- [ ] **Step 3: Escribir la implementación**

Crear `src/lib/filters.ts`:

```ts
import type { FilterState, Laboratorio } from '../types';

// Orden de la cascada: cada filtro solo ofrece valores presentes en lo que ya
// acotaron los de su izquierda.
export type CascadeField = 'componente' | 'actividad' | 'variable' | 'metodo';
type ScalarField = 'matriz' | 'componente' | 'actividad';

const UPSTREAM_SCALARS: Record<CascadeField, ScalarField[]> = {
  componente: ['matriz'],
  actividad: ['matriz', 'componente'],
  variable: ['matriz', 'componente', 'actividad'],
  metodo: ['matriz', 'componente', 'actividad'],
};

// Solo «método» está aguas abajo del multiselect de variables.
const USES_VARIABLES: Record<CascadeField, boolean> = {
  componente: false,
  actividad: false,
  variable: false,
  metodo: true,
};

export function applyFilters(data: Laboratorio[], filters: FilterState): Laboratorio[] {
  const busqueda = filters.busqueda.trim().toLowerCase();

  return data.filter((item) =>
    (busqueda === '' ||
      item.nombreLaboratorio.toLowerCase().includes(busqueda) ||
      item.variable.toLowerCase().includes(busqueda)) &&
    (filters.estado === '' || item.estado === filters.estado) &&
    (filters.matriz === '' || item.matriz === filters.matriz) &&
    (filters.componente === '' || item.componente === filters.componente) &&
    (filters.actividad === '' || item.actividad === filters.actividad) &&
    (filters.variables.length === 0 || filters.variables.includes(item.variable)) &&
    (filters.metodo === '' || item.metodo === filters.metodo)
  );
}

export function optionsFor(data: Laboratorio[], field: CascadeField, filters: FilterState): string[] {
  let scoped = data;

  for (const key of UPSTREAM_SCALARS[field]) {
    const value = filters[key];
    if (value) scoped = scoped.filter((item) => item[key] === value);
  }

  if (USES_VARIABLES[field] && filters.variables.length > 0) {
    scoped = scoped.filter((item) => filters.variables.includes(item.variable));
  }

  if (filters.estado) scoped = scoped.filter((item) => item.estado === filters.estado);

  const options = new Set<string>();
  for (const item of scoped) {
    const value = item[field];
    if (value) options.add(value);
  }

  return [...options].sort((a, b) => a.localeCompare(b, 'es'));
}

// Al cambiar un filtro hay que limpiar los de aguas abajo: su valor puede haber
// dejado de existir dentro del nuevo recorte.
export function clearDownstream(filters: FilterState, changed: 'matriz' | 'componente' | 'actividad' | 'variable'): FilterState {
  const next = { ...filters };
  if (changed === 'matriz') {
    next.componente = '';
    next.actividad = '';
    next.variables = [];
    next.metodo = '';
  } else if (changed === 'componente') {
    next.actividad = '';
    next.variables = [];
    next.metodo = '';
  } else if (changed === 'actividad') {
    next.variables = [];
    next.metodo = '';
  } else {
    next.metodo = '';
  }
  return next;
}
```

- [ ] **Step 4: Añadir el test de `clearDownstream`**

Agregar al final de `src/lib/filters.test.ts`:

```ts
describe('clearDownstream', () => {
  const full = { busqueda: 'x', estado: 'Activa', matriz: 'Agua', componente: 'Continental', actividad: 'Análisis', variables: ['pH'], metodo: 'SM 4500' };

  it('cambiar matriz limpia todo lo que va debajo', () => {
    const next = clearDownstream(full, 'matriz');
    expect(next.componente).toBe('');
    expect(next.actividad).toBe('');
    expect(next.variables).toEqual([]);
    expect(next.metodo).toBe('');
  });

  it('cambiar actividad no toca matriz ni componente', () => {
    const next = clearDownstream(full, 'actividad');
    expect(next.matriz).toBe('Agua');
    expect(next.componente).toBe('Continental');
    expect(next.variables).toEqual([]);
    expect(next.metodo).toBe('');
  });

  it('no toca búsqueda ni estado, que están fuera de la cascada', () => {
    const next = clearDownstream(full, 'matriz');
    expect(next.busqueda).toBe('x');
    expect(next.estado).toBe('Activa');
  });
});
```

Y ampliar el import de la primera línea del archivo:

```ts
import { applyFilters, optionsFor, clearDownstream } from './filters';
```

- [ ] **Step 5: Correr el test para verificar que pasa**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: PASS — 3 suites nuevas, 15 tests (35 en total).

- [ ] **Step 6: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/filters.ts apps/laboratorios-ambientales/src/lib/filters.test.ts
git commit -m "feat(laboratorios): filtros en cascada portados del prototipo"
```

---

## Task 6: Mapa de equipos (Análisis de Marcas)

Porta el `equipmentMap` del prototipo. Es la base de la vista de marcas, que se mantiene.

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/equipment.ts`
- Test: `apps/laboratorios-ambientales/src/lib/equipment.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/equipment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EQUIPMENT_MAP, extractEquipment, listBrands, listModels } from './equipment';

describe('EQUIPMENT_MAP', () => {
  it('conserva los 46 equipos del catálogo original', () => {
    expect(Object.keys(EQUIPMENT_MAP)).toHaveLength(46);
  });

  it('cada entrada trae marca, modelo y contaminante', () => {
    for (const [code, equipo] of Object.entries(EQUIPMENT_MAP)) {
      expect(equipo.brand, `${code} sin marca`).toBeTruthy();
      expect(equipo.model, `${code} sin modelo`).toBeTruthy();
      expect(equipo.pollutant, `${code} sin contaminante`).toBeTruthy();
    }
  });
});

describe('extractEquipment', () => {
  it('reconoce un código de equipo dentro del texto del método', () => {
    const eq = extractEquipment('Método de referencia EQPM-0798-122 según protocolo');
    expect(eq?.brand).toBe('Met One Instruments, Inc.');
    expect(eq?.model).toBe('BAM 1020');
    expect(eq?.pollutant).toBe('Partículas');
  });

  it('devuelve null si el método no contiene ningún código conocido', () => {
    expect(extractEquipment('SM 2320 B')).toBeNull();
  });

  it('devuelve null ante un método vacío', () => {
    expect(extractEquipment('')).toBeNull();
  });

  it('distingue las dos grafías de la norma UNE-EN que conviven en el catálogo', () => {
    // El dataset trae 'UNE-EN 16450' y 'UNE EN 16450'; ambas son el mismo equipo.
    expect(extractEquipment('Norma UNE-EN 16450')?.model).toBe('EDM180');
    expect(extractEquipment('Norma UNE EN 16450')?.model).toBe('EDM180');
  });

  it('ignora los códigos que aparecen dentro de una frase más larga sin ser el equipo', () => {
    // El match es por subcadena: un método que no cita ningún código no mapea.
    expect(extractEquipment('Método interno basado en la norma ASTM D1739')).toBeNull();
  });
});

describe('listBrands / listModels', () => {
  it('lista las marcas sin repetir y ordenadas', () => {
    const brands = listBrands();
    expect(brands).toEqual([...brands].sort((a, b) => a.localeCompare(b, 'es')));
    expect(new Set(brands).size).toBe(brands.length);
    expect(brands).toContain('Teledyne API');
  });

  it('lista los modelos de una marca', () => {
    expect(listModels('Horiba')).toEqual(['APMA-370', 'APNA-370', 'APOA-370', 'APSA-370']);
  });

  it('devuelve lista vacía para una marca desconocida', () => {
    expect(listModels('No Existe')).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: FAIL — `Failed to resolve import "./equipment"`.

- [ ] **Step 3: Crear `equipment.ts` con el catálogo portado**

El catálogo son 46 entradas rescatadas en la Task 1. **No las transcribas a mano** (riesgo de error en los códigos): pégalas desde el archivo rescatado.

```bash
cat /tmp/equipment-map.txt
```

Si `/tmp` se perdió, recupéralo del historial:

```bash
git show c517907:apps/laboratorios-ambientales/index.tsx | sed -n '328,375p'
```

Crear `src/lib/equipment.ts` con esta estructura, pegando el cuerpo del objeto (las 46 líneas `'CÓDIGO': { brand: ..., model: ..., pollutant: ... },`) tal cual dentro de `EQUIPMENT_MAP`:

```ts
// Catálogo de equipos de calidad del aire acreditados, portado del prototipo.
// La clave es el código de designación (US EPA / UNE-EN) que aparece embebido en
// el texto libre del campo «método» del dataset.
export type Equipo = {
  brand: string;
  model: string;
  pollutant: string;
};

export type EquipoIdentificado = Equipo & { code: string };

export const EQUIPMENT_MAP: Record<string, Equipo> = {
  'EQPM-0798-122': { brand: 'Met One Instruments, Inc.', model: 'BAM 1020', pollutant: 'Partículas' },
  // ⬆ pegar aquí las 46 entradas de /tmp/equipment-map.txt, sustituyendo esta línea de ejemplo
};

export function extractEquipment(metodo: string): EquipoIdentificado | null {
  if (!metodo) return null;
  // De más largo a más corto: evita que un código que es prefijo de otro gane el match.
  const codes = Object.keys(EQUIPMENT_MAP).sort((a, b) => b.length - a.length);
  for (const code of codes) {
    if (metodo.includes(code)) return { code, ...EQUIPMENT_MAP[code] };
  }
  return null;
}

export function listBrands(): string[] {
  const brands = new Set(Object.values(EQUIPMENT_MAP).map((e) => e.brand));
  return [...brands].sort((a, b) => a.localeCompare(b, 'es'));
}

export function listModels(brand: string): string[] {
  const models = new Set(
    Object.values(EQUIPMENT_MAP)
      .filter((e) => e.brand === brand)
      .map((e) => e.model)
  );
  return [...models].sort((a, b) => a.localeCompare(b, 'es'));
}
```

Al pegar, quitar la línea de ejemplo y comprobar que el bloque abre y cierra bien. El test de las 46 entradas detecta cualquier pérdida.

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: PASS — 3 suites nuevas, 10 tests (45 en total).

Si "conserva los 46 equipos" falla, el pegado quedó incompleto: repetir el Step 3.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/equipment.ts apps/laboratorios-ambientales/src/lib/equipment.test.ts
git commit -m "feat(laboratorios): portar el catálogo de equipos de calidad del aire"
```

---

## Task 7: Agrupación de laboratorios por equipo

La lógica de negocio del Análisis de Marcas: qué laboratorios tienen equipos acreditados de cada marca/modelo.

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/brands.ts`
- Test: `apps/laboratorios-ambientales/src/lib/brands.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/brands.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { groupLabsByEquipment } from './brands';

const lab = (over: Partial<Laboratorio>): Laboratorio => ({
  codigo: '1', estado: 'Activa', matriz: 'Aire', componente: 'Calidad del Aire',
  actividad: 'Análisis', grupo: '', variable: 'PM10', tecnica: '', metodo: '',
  rango: '', nombreLaboratorio: 'Lab Uno', nit: '', contacto: 'Ana Ruiz',
  ciudad: 'Bogotá', departamento: 'Cundinamarca', direccion: '', telefono: '601',
  correo: 'ana@lab.co', actoAdministrativo: '', desde: '', hasta: '', ...over,
});

describe('groupLabsByEquipment', () => {
  it('solo cuenta acreditaciones activas de calidad del aire', () => {
    const data = [
      lab({ metodo: 'EQPM-0798-122' }),
      lab({ metodo: 'EQPM-0798-122', estado: 'Suspendida', nombreLaboratorio: 'Lab Suspendido' }),
      lab({ metodo: 'EQPM-0798-122', matriz: 'Agua', nombreLaboratorio: 'Lab Agua' }),
      lab({ metodo: 'EQPM-0798-122', componente: 'Fuentes Fijas', nombreLaboratorio: 'Lab Fijas' }),
    ];
    const res = groupLabsByEquipment(data, '', '');
    expect(res).toHaveLength(1);
    expect(res[0].nombreLaboratorio).toBe('Lab Uno');
  });

  it('descarta los registros cuyo método no mapea a ningún equipo', () => {
    expect(groupLabsByEquipment([lab({ metodo: 'SM 2320 B' })], '', '')).toHaveLength(0);
  });

  it('agrupa varios equipos bajo un mismo laboratorio', () => {
    const data = [
      lab({ metodo: 'EQPM-0798-122' }),
      lab({ metodo: 'EQSA-0495-100', variable: 'SO2' }),
    ];
    const res = groupLabsByEquipment(data, '', '');
    expect(res).toHaveLength(1);
    expect(res[0].equipos).toHaveLength(2);
  });

  it('no repite el mismo método dentro de un laboratorio', () => {
    const data = [lab({ metodo: 'EQPM-0798-122' }), lab({ metodo: 'EQPM-0798-122' })];
    expect(groupLabsByEquipment(data, '', '')[0].equipos).toHaveLength(1);
  });

  it('filtra por marca', () => {
    const data = [
      lab({ metodo: 'EQPM-0798-122' }),
      lab({ metodo: 'EQSA-0495-100' }),
    ];
    const res = groupLabsByEquipment(data, 'Teledyne API', '');
    expect(res[0].equipos).toHaveLength(1);
    expect(res[0].equipos[0].brand).toBe('Teledyne API');
  });

  it('filtra por marca y modelo a la vez', () => {
    const data = [
      lab({ metodo: 'EQSA-0495-100' }),
      lab({ metodo: 'RFCA-1093-093' }),
    ];
    const res = groupLabsByEquipment(data, 'Teledyne API', '300 Series');
    expect(res[0].equipos).toHaveLength(1);
    expect(res[0].equipos[0].model).toBe('300 Series');
  });

  it('omite los laboratorios que se quedan sin equipos tras filtrar', () => {
    expect(groupLabsByEquipment([lab({ metodo: 'EQPM-0798-122' })], 'Horiba', '')).toHaveLength(0);
  });

  it('descarta registros sin nombre de laboratorio', () => {
    expect(groupLabsByEquipment([lab({ metodo: 'EQPM-0798-122', nombreLaboratorio: '' })], '', '')).toHaveLength(0);
  });

  it('ordena los laboratorios por nombre y expone sus datos de contacto', () => {
    const data = [
      lab({ metodo: 'EQPM-0798-122', nombreLaboratorio: 'Zeta' }),
      lab({ metodo: 'EQPM-0798-122', nombreLaboratorio: 'Alfa' }),
    ];
    const res = groupLabsByEquipment(data, '', '');
    expect(res.map((l) => l.nombreLaboratorio)).toEqual(['Alfa', 'Zeta']);
    expect(res[0].contacto).toBe('Ana Ruiz');
    expect(res[0].correo).toBe('ana@lab.co');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: FAIL — `Failed to resolve import "./brands"`.

- [ ] **Step 3: Escribir la implementación**

Crear `src/lib/brands.ts`:

```ts
import type { Laboratorio } from '../types';
import type { EquipoIdentificado } from './equipment';
import { extractEquipment } from './equipment';

export type EquipoDeLab = EquipoIdentificado & { metodo: string };

export type LabConEquipos = {
  nombreLaboratorio: string;
  ciudad: string;
  contacto: string;
  correo: string;
  telefono: string;
  equipos: EquipoDeLab[];
};

// El Análisis de Marcas solo mira acreditaciones activas de calidad del aire:
// es el único ámbito donde el campo «método» trae códigos de equipo.
export function groupLabsByEquipment(data: Laboratorio[], brand: string, model: string): LabConEquipos[] {
  const porLab = new Map<string, LabConEquipos>();

  for (const item of data) {
    if (item.estado !== 'Activa') continue;
    if (item.matriz !== 'Aire') continue;
    if (item.componente !== 'Calidad del Aire') continue;
    if (!item.nombreLaboratorio) continue;

    const equipo = extractEquipment(item.metodo);
    if (!equipo) continue;
    if (brand && equipo.brand !== brand) continue;
    if (model && equipo.model !== model) continue;

    let lab = porLab.get(item.nombreLaboratorio);
    if (!lab) {
      lab = {
        nombreLaboratorio: item.nombreLaboratorio,
        ciudad: item.ciudad,
        contacto: item.contacto,
        correo: item.correo,
        telefono: item.telefono,
        equipos: [],
      };
      porLab.set(item.nombreLaboratorio, lab);
    }

    // Un mismo equipo aparece en varias filas (una por variable acreditada).
    if (!lab.equipos.some((e) => e.metodo === item.metodo)) {
      lab.equipos.push({ ...equipo, metodo: item.metodo });
    }
  }

  return [...porLab.values()].sort((a, b) => a.nombreLaboratorio.localeCompare(b.nombreLaboratorio, 'es'));
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: PASS — 1 suite nueva, 9 tests (54 en total).

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/brands.ts apps/laboratorios-ambientales/src/lib/brands.test.ts
git commit -m "feat(laboratorios): agrupación de laboratorios por equipo acreditado"
```

---

## Task 8: Vista del Buscador

Conecta los filtros en cascada a la interfaz. Devuelve el árbol a verde.

**Files:**
- Create: `apps/laboratorios-ambientales/src/pages/Buscador.tsx`

- [ ] **Step 1: Crear el componente**

Crear `src/pages/Buscador.tsx`:

```tsx
import { useMemo } from 'react';
import type { FilterState, Laboratorio } from '../types';
import { EMPTY_FILTERS } from '../types';
import { applyFilters, optionsFor, clearDownstream } from '../lib/filters';

const LIMITE_VISIBLE = 60;

type Props = {
  data: Laboratorio[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onBack: () => void;
};

export default function Buscador({ data, filters, onFiltersChange, onBack }: Props) {
  const resultados = useMemo(() => applyFilters(data, filters), [data, filters]);
  const componentes = useMemo(() => optionsFor(data, 'componente', filters), [data, filters]);
  const actividades = useMemo(() => optionsFor(data, 'actividad', filters), [data, filters]);
  const variables = useMemo(() => optionsFor(data, 'variable', filters), [data, filters]);
  const metodos = useMemo(() => optionsFor(data, 'metodo', filters), [data, filters]);

  const matrices = useMemo(() => {
    const set = new Set(data.map((d) => d.matriz).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [data]);

  const visibles = resultados.slice(0, LIMITE_VISIBLE);

  const toggleVariable = (variable: string) => {
    const variables = filters.variables.includes(variable)
      ? filters.variables.filter((v) => v !== variable)
      : [...filters.variables, variable];
    onFiltersChange(clearDownstream({ ...filters, variables }, 'variable'));
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <button onClick={onBack} className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
        &larr; Volver al Menú Principal
      </button>

      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Buscador por Parámetros Ambientales</h1>
        <p className="mt-2 text-lg text-gray-600">Encuentra laboratorios acreditados filtrando por parámetros y variables técnicas.</p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-md mb-8 ring-1 ring-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-gray-700 mb-1">Buscar Parámetro o Laboratorio</label>
            <input
              type="text"
              value={filters.busqueda}
              onChange={(e) => onFiltersChange({ ...filters, busqueda: e.target.value })}
              placeholder="Ej: pH, Alcalinidad, Corantioquia..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Estado</label>
            <select
              value={filters.estado}
              onChange={(e) => onFiltersChange({ ...filters, estado: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Cualquier Estado</option>
              <option value="Activa">Activa</option>
              <option value="Suspendida">Suspendida</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Matriz</label>
            <select
              value={filters.matriz}
              onChange={(e) => onFiltersChange(clearDownstream({ ...filters, matriz: e.target.value }, 'matriz'))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Todas las Matrices</option>
              {matrices.map((val) => <option key={val} value={val}>{val}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Componente</label>
            <select
              value={filters.componente}
              onChange={(e) => onFiltersChange(clearDownstream({ ...filters, componente: e.target.value }, 'componente'))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Todos los Componentes</option>
              {componentes.map((val) => <option key={val} value={val}>{val}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Actividad</label>
            <select
              value={filters.actividad}
              onChange={(e) => onFiltersChange(clearDownstream({ ...filters, actividad: e.target.value }, 'actividad'))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Todas las Actividades</option>
              {actividades.map((val) => <option key={val} value={val}>{val}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Método</label>
            <select
              value={filters.metodo}
              onChange={(e) => onFiltersChange({ ...filters, metodo: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Todos los Métodos</option>
              {metodos.map((val) => <option key={val} value={val}>{val}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Variables {filters.variables.length > 0 && `(${filters.variables.length} seleccionadas)`}
          </label>
          <div className="max-h-40 overflow-y-auto border border-gray-300 rounded-lg p-2 bg-white custom-scroll">
            {variables.length === 0 && <p className="text-sm text-slate-400 p-2">No hay variables para los filtros actuales.</p>}
            {variables.map((val) => (
              <label key={val} className="flex items-center p-1.5 hover:bg-gray-50 cursor-pointer rounded">
                <input
                  type="checkbox"
                  checked={filters.variables.includes(val)}
                  onChange={() => toggleVariable(val)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                />
                <span className="ml-2 text-sm text-gray-700">{val}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="px-6 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors"
          >
            Limpiar Filtros
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-gray-200 pb-2">
          <h3 className="text-xl font-bold text-gray-800">Vista por Parámetro ({resultados.length} registros)</h3>
          <p className="text-sm text-gray-500 italic">Mostrando resultados individuales por parámetro</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibles.map((lab, idx) => (
            <div key={`${lab.codigo}-${lab.variable}-${idx}`} className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all border border-slate-100 overflow-hidden flex flex-col group">
              <div className="bg-indigo-50 p-4 border-b border-indigo-100 group-hover:bg-indigo-100 transition-colors">
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1 block">{lab.matriz}</span>
                <h4 className="font-extrabold text-indigo-900 leading-tight line-clamp-2 min-h-[3rem]">{lab.variable || 'Variable no especificada'}</h4>
              </div>
              <div className="p-5 flex-grow space-y-3">
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Laboratorio</p>
                  <p className="text-sm font-bold text-slate-800 line-clamp-2">{lab.nombreLaboratorio}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">Ubicación</p>
                    <p className="text-xs text-slate-600 font-medium">{lab.ciudad}, {lab.departamento}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">Estado</p>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${lab.estado === 'Activa' ? 'bg-emerald-500' : 'bg-slate-400'}`}>
                      {lab.estado || 'Sin dato'}
                    </span>
                  </div>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100 mt-2">
                  <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Método de Análisis</p>
                  <p className="text-[11px] text-slate-600 leading-relaxed italic line-clamp-3">{lab.metodo}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {resultados.length > LIMITE_VISIBLE && (
          <div className="text-center py-8">
            <p className="text-gray-500 italic">
              Mostrando {LIMITE_VISIBLE} de {resultados.length} registros. Ajusta los filtros para refinar la búsqueda.
            </p>
          </div>
        )}

        {resultados.length === 0 && (
          <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl text-slate-300">🔍</span>
            </div>
            <p className="text-lg font-bold text-slate-400">No se encontraron parámetros con los filtros seleccionados</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

Cambios de fondo respecto a la versión que reemplaza: el badge compara contra `'Activa'` (antes `'VIGENTE'`, que nunca existió); el select de estado ofrece los dos valores reales; y el contador dice cuántos registros hay de verdad en vez de "los primeros 60".

- [ ] **Step 2: Commit**

```bash
git add apps/laboratorios-ambientales/src/pages/Buscador.tsx
git commit -m "feat(laboratorios): vista de buscador con filtros en cascada"
```

---

## Task 9: Vista de Análisis de Marcas

**Files:**
- Create: `apps/laboratorios-ambientales/src/pages/Dashboard.tsx`

- [ ] **Step 1: Crear el componente**

Crear `src/pages/Dashboard.tsx`:

```tsx
import { useMemo, useState } from 'react';
import type { Laboratorio } from '../types';
import { groupLabsByEquipment } from '../lib/brands';
import { listBrands, listModels } from '../lib/equipment';

type Props = {
  data: Laboratorio[];
  onBack: () => void;
};

export default function Dashboard({ data, onBack }: Props) {
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');

  const brands = useMemo(() => listBrands(), []);
  const models = useMemo(() => (brand ? listModels(brand) : []), [brand]);
  const labs = useMemo(() => groupLabsByEquipment(data, brand, model), [data, brand, model]);

  const totalEquipos = labs.reduce((acc, lab) => acc + lab.equipos.length, 0);

  const handleBrandChange = (value: string) => {
    setBrand(value);
    setModel(''); // el modelo elegido puede no existir en la marca nueva
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <button onClick={onBack} className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
        &larr; Volver al Menú Principal
      </button>

      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Análisis de Marcas de Calidad del Aire</h1>
        <p className="mt-2 text-lg text-gray-600">Equipos acreditados vigentes, identificados por su código de designación.</p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-md mb-8 ring-1 ring-slate-200">
        <div className="mb-4 pb-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-500 uppercase mb-2">Ámbito fijo del análisis</h2>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <p><strong>Estado:</strong> Activa</p>
            <p><strong>Matriz:</strong> Aire</p>
            <p><strong>Componente:</strong> Calidad del Aire</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Marca</label>
            <select
              value={brand}
              onChange={(e) => handleBrandChange(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Todas las Marcas</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Modelo</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!brand}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Todos los Modelos</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <button
              onClick={() => { setBrand(''); setModel(''); }}
              className="w-full px-6 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors"
            >
              Limpiar Filtros
            </button>
          </div>
        </div>

        <p className="mt-4 text-sm font-medium text-gray-700">
          {labs.length} laboratorios · {totalEquipos} equipos acreditados
        </p>
      </div>

      <div className="space-y-6">
        {labs.length === 0 && (
          <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
            <p className="text-lg font-bold text-slate-400">No se encontraron equipos con los filtros seleccionados</p>
          </div>
        )}

        {labs.map((lab) => (
          <div key={lab.nombreLaboratorio} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-indigo-700">{lab.nombreLaboratorio}</h3>
              <p className="text-sm text-gray-500">
                {[lab.ciudad, lab.contacto, lab.correo, lab.telefono].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-left border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-slate-600">Marca</th>
                    <th className="px-3 py-2 font-semibold text-slate-600">Modelo</th>
                    <th className="px-3 py-2 font-semibold text-slate-600">Contaminante</th>
                    <th className="px-3 py-2 font-semibold text-slate-600">Código</th>
                  </tr>
                </thead>
                <tbody>
                  {lab.equipos.map((eq) => (
                    <tr key={eq.metodo} className="border-t border-slate-100">
                      <td className="px-3 py-2">{eq.brand}</td>
                      <td className="px-3 py-2">{eq.model}</td>
                      <td className="px-3 py-2 font-medium">{eq.pollutant}</td>
                      <td className="px-3 py-2 text-xs text-slate-400 font-mono">{eq.code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/laboratorios-ambientales/src/pages/Dashboard.tsx
git commit -m "feat(laboratorios): vista de análisis de marcas portada del prototipo"
```

---

## Task 10: Rehacer `App.tsx` como shell

Une todo: carga con progreso, error con reintento, y navegación a las dos vistas. Corrige el KPI que siempre daba 0.

**Files:**
- Modify: `apps/laboratorios-ambientales/src/App.tsx`

- [ ] **Step 1: Reescribir `App.tsx`**

Reemplazar `src/App.tsx` completo por:

```tsx
import { useState, useEffect, useCallback } from 'react';
import '../index.css';
import type { FilterState, Laboratorio } from './types';
import { EMPTY_FILTERS } from './types';
import { fetchLaboratorios } from './services/api';
import Buscador from './pages/Buscador';
import Dashboard from './pages/Dashboard';

type View = 'main' | 'buscador' | 'dashboard';

export default function App() {
  const [view, setView] = useState<View>('main');
  const [data, setData] = useState<Laboratorio[]>([]);
  const [loading, setLoading] = useState(true);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProgreso(0);
    try {
      const result = await fetchLaboratorios(setProgreso);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const activos = data.filter((d) => d.estado === 'Activa').length;
  const laboratorios = new Set(data.map((d) => d.nombreLaboratorio).filter(Boolean)).size;

  return (
    <div className="w-full flex-grow bg-[#F7F8FA]" style={{ minHeight: '100vh' }}>
      {view === 'main' && (
        <div className="flex items-center justify-center min-h-screen p-6">
          <div className="text-center p-12 bg-white rounded-xl shadow-lg max-w-3xl mx-auto w-full">
            <h1 className="text-4xl font-bold text-gray-800 mb-4">Plataforma de Análisis de Laboratorios Ambientales</h1>
            <p className="text-lg text-gray-600 mb-8">Laboratorios acreditados por el IDEAM, desde la fuente oficial datos.gov.co.</p>

            {loading && (
              <div className="mb-6 h-20 flex flex-col justify-center items-center">
                <div className="w-8 h-8 rounded-full border-4 border-t-indigo-600 border-gray-200 animate-spin" />
                <p className="mt-3 text-sm text-gray-600">
                  {progreso > 0 ? `Cargando ${progreso.toLocaleString('es-CO')} registros...` : 'Conectando con datos.gov.co...'}
                </p>
              </div>
            )}

            {error && !loading && (
              <div className="mb-6 flex flex-col items-center gap-4">
                <p className="text-red-600 font-semibold">No se pudo cargar la información: {error}</p>
                <button onClick={() => void cargar()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                  Reintentar
                </button>
              </div>
            )}

            {!loading && !error && (
              <>
                <div className="flex flex-wrap gap-4 justify-center">
                  <button onClick={() => setView('buscador')} className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md text-lg transition-colors">
                    Buscador de Laboratorios
                  </button>
                  <button onClick={() => setView('dashboard')} className="px-8 py-4 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg shadow-md text-lg transition-colors">
                    Análisis de Marcas
                  </button>
                </div>
                <p className="mt-6 text-sm text-gray-500">
                  {laboratorios.toLocaleString('es-CO')} laboratorios · {data.length.toLocaleString('es-CO')} acreditaciones · {activos.toLocaleString('es-CO')} activas
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {view === 'buscador' && (
        <Buscador data={data} filters={filters} onFiltersChange={setFilters} onBack={() => setView('main')} />
      )}

      {view === 'dashboard' && <Dashboard data={data} onBack={() => setView('main')} />}
    </div>
  );
}
```

El KPI de la portada ahora cuenta `'Activa'` (antes comparaba con `'Activo'`/`'VIGENTE'` y siempre daba 0) y distingue laboratorios de acreditaciones: cada fila del dataset es un parámetro acreditado, no un laboratorio.

- [ ] **Step 2: Verificar typecheck, lint y tests**

```bash
cd ../..
npm run build --workspace=apps/laboratorios-ambientales
```
Esperado: exit 0.

```bash
npm run lint --workspace=apps/laboratorios-ambientales
```
Esperado: exit 0, sin warnings.

```bash
npm test --workspace=apps/laboratorios-ambientales
```
Esperado: PASS — 54 tests.

- [ ] **Step 3: Verificar que el portal compila**

```bash
npm run build --workspace=apps/portal
```
Esperado: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/laboratorios-ambientales/src/App.tsx
git commit -m "fix(laboratorios): contar acreditaciones activas con el valor real del dataset"
```

---

## Task 11: Verificación end-to-end en el navegador

Los tests cubren la lógica pura; esto comprueba que la app funciona de verdad contra la API real dentro del portal.

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Levantar el portal**

```bash
npm run dev
```

Entrar con un usuario que tenga acceso a la app y navegar a `/laboratorios-ambientales`.

⚠️ Antes de probar, limpiar el cache viejo en la consola del navegador — tiene datos con el esquema anterior y el `estado` mal:

```js
localStorage.removeItem('labs_cache_data'); localStorage.removeItem('labs_cache_timestamp');
```

- [ ] **Step 2: Verificar la carga y los contadores**

Recargar la página. Esperado:
- El contador de progreso sube en varios saltos (son 4 peticiones).
- La portada termina mostrando **19.056 acreditaciones** y **18.689 activas**. Si dice 5.000, la paginación no está funcionando; si dice 0 activas, `normalizeEstado` no se está aplicando en `mapRecord`.
- En la pestaña Network: 4 peticiones a `datos.gov.co`, con `$offset` 0, 5000, 10000 y 15000.

- [ ] **Step 3: Verificar la cascada del buscador**

Entrar a "Buscador de Laboratorios":
- Elegir Matriz = **Aire** → el select de Componente debe ofrecer solo componentes de aire (entre ellos "Calidad del Aire" y "Fuentes Fijas"), no los de agua.
- Elegir Componente = **Calidad del Aire** → la lista de Variables debe reducirse.
- Volver a poner Matriz = **Todas** → Componente, Actividad, Variables y Método deben quedar limpios.
- Marcar dos variables → el contador de resultados debe crecer respecto a marcar una sola (es un OR).
- Con Estado = **Activa**, las tarjetas deben mostrar el badge **verde**. Con **Suspendida**, gris. (Antes ninguna era verde.)

- [ ] **Step 4: Verificar el Análisis de Marcas**

Entrar a "Análisis de Marcas":
- Debe listar laboratorios con sus tablas de equipos; el resumen dice cuántos laboratorios y equipos.
- El select de Modelo empieza deshabilitado; al elegir Marca = **Horiba** se habilita y ofrece APMA-370, APNA-370, APOA-370, APSA-370.
- Elegir Modelo = **APSA-370** → solo quedan laboratorios con ese equipo, y todas las filas de las tablas son APSA-370.
- Cambiar la marca a **Teledyne API** → el modelo debe resetearse a "Todos los Modelos" y no quedar en un modelo de Horiba.

- [ ] **Step 5: Verificar el cache y el reintento**

- Recargar: la segunda carga debe ser instantánea y **sin peticiones** a `datos.gov.co` (cache).
- Si en la consola aparece un error de cuota de `localStorage`, comprobar que la app **sigue funcionando** (los datos están en memoria) y que no quedan claves a medias: `localStorage.getItem('labs_cache_data')` debe dar `null`.
- Limpiar el cache, poner la pestaña Network en modo **Offline** y recargar: debe salir el mensaje de error con el botón "Reintentar". Volver a Online, pulsar Reintentar → carga bien. (Antes este caso mostraba 0 registros en silencio.)

- [ ] **Step 6: Anotar los resultados**

Si algo de los pasos 2-5 no se cumple, **no cerrar el plan**: abrir la corrección como tarea aparte antes de la Task 12.

---

## Task 12: Documentación y cierre de hallazgos

**Files:**
- Modify: `apps/laboratorios-ambientales/README.md` (versionado, va en el commit)
- Modify: `AUDIT_REPORT.md` (⚠️ **gitignorado — nunca commitear**)
- Modify: `PLAN_REMEDIACION.md` (⚠️ **gitignorado — nunca commitear**)

> ⚠️ **Los tres docs de auditoría (`AUDIT_FINDINGS.md`, `AUDIT_REPORT.md`, `PLAN_REMEDIACION.md`) están en `.gitignore` a propósito:** llevan el detalle de las vulnerabilidades y **el repo es público** (`github.com/Algarpibe/ambientalia-portal`). Editarlos sí; `git add`-earlos **no**. Un `git add -f` publicaría el mapa de vulnerabilidades del sistema.
>
> Por estar ignorados **no existen en el worktree**: viven solo en el checkout principal, en
> `c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07\`.
> Editarlos ahí con rutas absolutas.

- [ ] **Step 1: Reescribir el README**

El actual es la plantilla de Google AI Studio ("Run and deploy your AI Studio app") y ya no describe nada real. Reemplazar `apps/laboratorios-ambientales/README.md` completo por:

```markdown
# Laboratorios Ambientales

Buscador y análisis de los laboratorios ambientales acreditados por el IDEAM,
sobre el dataset abierto [`2waz-acaa`](https://www.datos.gov.co/resource/2waz-acaa.json)
de datos.gov.co (~19.000 acreditaciones).

## Cómo se ejecuta

Esta app **no tiene entrada standalone**: es un conjunto de vistas que monta el
portal, que es además quien compila su CSS de Tailwind. Para verla:

```bash
npm run dev          # desde la raíz del monorepo: levanta el portal
```

y navegar a `/laboratorios-ambientales`.

```bash
npm run build --workspace=apps/laboratorios-ambientales   # typecheck (tsc -b)
npm test  --workspace=apps/laboratorios-ambientales       # tests unitarios
```

## Estructura

| Ruta | Responsabilidad |
|---|---|
| `src/services/api.ts` | Descarga paginada del dataset + cache de 24 h en `localStorage`. |
| `src/lib/normalize.ts` | Valores canónicos de estado, matriz, componente y actividad. |
| `src/lib/filters.ts` | Filtrado y opciones en cascada. |
| `src/lib/equipment.ts` | Catálogo de 46 equipos de calidad del aire. |
| `src/lib/brands.ts` | Agrupación laboratorio→equipos del Análisis de Marcas. |
| `src/pages/` | Vistas: `Buscador` y `Dashboard` (Análisis de Marcas). |
| `src/App.tsx` | Shell: carga, errores y navegación. |

## Notas sobre los datos

- **Un registro es un parámetro acreditado, no un laboratorio.** Un laboratorio
  aparece en tantas filas como variables tenga acreditadas.
- **`estado` solo toma dos valores:** `Activa` y `Suspendida`. Cualquier otro se
  normaliza a cadena vacía.
- **La paginación usa `$order=:id`.** Sin un orden explícito, SODA puede repetir
  u omitir filas entre páginas.
- **La API sirve CORS abierto**, no hacen falta proxies.
- **El catálogo de equipos (`equipment.ts`) se mantiene a mano.** Los códigos de
  designación (US EPA / UNE-EN) se buscan como subcadena dentro del texto libre
  del campo «método»: si el IDEAM acredita un equipo nuevo, hay que añadirlo ahí
  o no aparecerá en el Análisis de Marcas.

## Mejoras pendientes

- El cache completo (~3 MB) va a `localStorage`, que comparte los ~5 MB del
  origen con el resto del portal. Si empieza a fallar por cuota, migrar a
  IndexedDB. Hoy degrada limpio: si no cabe, se sigue con los datos en memoria.
- El módulo de "Análisis con IA" se eliminó (llamaba a Gemini desde el navegador,
  lo que exigía la API key en el bundle, y ejecutaba código del modelo con
  `new Function`). Si se retoma, debe ir tras un proxy en `hub-api` con la key
  server-side y sin ejecutar código generado.
```

- [ ] **Step 2: Marcar AI-101 como cerrado** (solo en el checkout principal, sin commit)

En `AUDIT_REPORT.md`, marcar la casilla de la línea 74:

```markdown
- [x] Borrar `laboratorios-ambientales/index.tsx` + `define` de Gemini (AI-101).
```

En `PLAN_REMEDIACION.md` (tabla "Wave 1", línea 32), reemplazar la fila de AI-101 por esta — la tabla no usa casillas, así que el estado va en la celda de Acción:

```markdown
| 4 | AI-101 | MEDIA | ✅ **Hecho** — `laboratorios-ambientales/index.tsx` y el `define` de Gemini en `inventory-consolidation/vite.config.ts` borrados | `git grep process.env.API_KEY -- apps` vacío; build portal exit 0 |
```

Con el módulo de IA fuera, SEC-002 (key de Gemini en el bundle) y SEC-004 (XSS por `innerHTML` con salida del modelo) quedan sin superficie en esta app. Comprobarlo:

```bash
git grep -n "process.env.API_KEY\|GEMINI_API_KEY\|dangerouslySetInnerHTML\|innerHTML" -- apps/laboratorios-ambientales
```
Esperado: sin resultados.

Nota: SEC-002 menciona también `inventory-consolidation`, cuyo `define` se quitó en la Task 1. Su cierre total depende de que ninguna otra app inyecte la key — lo confirma el `git grep` de la Task 1 Step 7.

- [ ] **Step 3: Commit (solo el README)**

```bash
git add apps/laboratorios-ambientales/README.md
git commit -m "docs(laboratorios): documentar la arquitectura real de la app"
```

Verificar que los docs de auditoría **no** se colaron en el commit:

```bash
git show --stat --oneline HEAD | grep -i "AUDIT\|PLAN_REMEDIACION" && echo "⛔ FUGA: revertir el commit" || echo "✅ limpio"
```
Esperado: `✅ limpio`.

---

## Resumen de la priorización

| # | Task | Qué arregla | Riesgo |
|---|---|---|---|
| 1 | Limpieza + quitar IA | AI-101, SEC-002, SEC-004; −724 líneas muertas y 4 dependencias | Bajo — solo eliminación |
| 2-4 | Normalizadores, tipos, API | **Los bugs de datos**: 26%→100% del dataset, mapeo real, KPI de activas, errores visibles | Bajo — cubierto por tests |
| 5 | Filtros en cascada | La capacidad principal que faltaba en React | Bajo — lógica pura con tests |
| 6-7 | Catálogo de equipos + agrupación | Base del Análisis de Marcas | Medio — el catálogo se pega a mano (el test de las 46 entradas lo protege) |
| 8-10 | Vistas + shell | Conecta todo; badge verde y contadores correctos | Medio — sin tests de componentes |
| 11 | Verificación en navegador | Confirma el comportamiento real contra la API | — |
| 12 | Docs y cierre | README real, hallazgos cerrados | Bajo |

Las Tasks 1-4 ya dejan la app **correcta** aunque limitada; las 5-10 la dejan **completa**. Si hay que parar a mitad, el corte natural es después de la Task 4.
