# Prospectos de grasas y aceites — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** añadir a Laboratorios ambientales la vista «Prospectos de grasas y aceites», que lista los laboratorios con una acreditación activa en grasas y aceites, los separa en «Usan infrarrojo» y «Solo gravimetría», los filtra, los ordena por vigencia y los exporta a Excel, y hacer que el Buscador junte «Aceites y Grasas» con «Grasas y Aceites».
**Architecture:** la lógica es pura y vive en `src/lib/`: `fechas.ts` (hoy local y meses de calendario), `prospects.ts` (qué acreditación cuenta, infrarrojo o no, agrupación por código de laboratorio, vigencia, orden y filtros), `exportProspects.ts` (las filas y el nombre del Excel) y el sinónimo en `variableKey` de `filters.ts`. `src/pages/Prospectos.tsx` solo orquesta: estado local, pestañas, filtros, tabla y el botón que carga SheetJS con `import('xlsx')` al pulsar. `view.ts` publica la vista como `#prospectos` y `App.tsx` añade la tarjeta del menú; el cache y `mapRecord` no cambian.
**Tech Stack:** React 19 + TypeScript 5.9 (Vite, Tailwind compilado por el portal), Vitest 2 en entorno `node` (sin jsdom), ESLint 9 con `react-hooks` 7, SheetJS 0.20.3 desde el tarball de cdn.sheetjs.com.
---

**Diseño aprobado:** `docs/superpowers/specs/2026-11-26-prospectos-grasas-aceites-design.md` (léelo entero antes de empezar; es el contrato).

## Convenciones de ejecución (obligatorias)

- **Raíz del repo:** `C:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07` (en Git Bash: `/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07`). Todos los comandos de este plan parten de ahí; si tu shell no conserva el directorio entre llamadas, empieza cada una con `cd /c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07 &&`.
- **Rama:** `feat/laboratorios-prospectos` (ya existe y lleva el commit del diseño, `245ad1a`). Se trabaja en ella. **Este plan no hace push ni merge**: los hace el orquestador.
- **Ficheros:** se crean y se cambian SOLO con las herramientas Write y Edit. Nunca con `Set-Content`, `Out-File`, `sed`, `perl` ni redirecciones: PowerShell 5.1 destroza las tildes del fichero entero. En disco conviven CRLF (`App.tsx`, `filters.ts`, `README.md`) y LF (`view.ts`, `view.test.ts`, `filters.test.ts`); Edit respeta lo que haya (`core.autocrlf=true`). Cada «sustituir» de este plan se comprobó el 2026-11-26: el texto viejo aparece exactamente una vez en su fichero en el momento de aplicarlo, en el orden de las tareas. Si alguno no casa, lee ese tramo con Read y copia el texto de ahí.
- **Git:** con la herramienta **Bash (Git Bash)**, desde la raíz. Mensajes con `git commit -F - <<'EOF' … EOF`. Conventional commits en español, **sin línea «Co-Authored-By» ni ninguna atribución**. Se añaden rutas explícitas: nunca `git add -A` ni `git add .`, nunca `git stash`. No se tocan `.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/` ni `openspec/` (ya están modificados o sin seguimiento y son del usuario).
- **Repo público:** los fixtures usan valores reales del dataset para variable, técnica, método, matriz y fechas, pero **el laboratorio, el NIT y el contacto son ficticios** (`@example.com`): son datos personales.
- **TDD estricto** en todo `src/lib/`: prueba que falla, verla fallar, código mínimo, verla pasar, commit. `Prospectos.tsx` y `App.tsx` no tienen pruebas (no hay jsdom): se comprueban con `npm run lint`, `npm run build` y `npx tsc -b` del portal.
- **Pruebas:** una sola, `cd apps/laboratorios-ambientales && npx vitest run src/lib/<fichero>.test.ts`; la suite de la app, `cd apps/laboratorios-ambientales && npm test`. **Punto de partida: 7 ficheros, 108 pruebas, todo en verde** (comprobado el 2026-11-26). Nunca lances vitest desde la raíz del repo (mete las pruebas de hub-api).
- **`tsc -b` también compila las pruebas** (`tsconfig.app.json` incluye todo `src`, con `noUnusedLocals`): un import que sobra en un `.test.ts` rompe el build. Cada tarea deja los imports exactos que usa.
- **Línea base de lint y build (2026-11-26):** `npm run lint` y `npm run build` de la app y `npx tsc -b` del portal salen limpios. El de portal tarda unos 25 s.
- **Tamaño:** unas 1 200 líneas cambiadas sin contar diseño y plan (≈ 525 son pruebas). Si el orquestador aplica la regla de menos de 800 líneas por merge, el corte natural es **A = Tareas 1-6** (Buscador y lógica pura, ≈ 700; funciona sola: el Buscador mejora y lo demás no se usa aún) y **B = Tareas 7-12** (dependencia, Excel, vista, menú y README, ≈ 500).

## Decisiones tomadas en el plan

El diseño no dice nada, o deja abierto, en estos puntos. El plan sigue la opción marcada.

| # | Silencio o choque | Opción del plan |
|---|---|---|
| D1 | El diseño escribe `filasExcel(prospectos)`, pero la columna «Estado de la vigencia» necesita `hoy`. | `filasExcel(prospectos: Prospecto[], hoy: string): string[][]`. |
| D2 | No dice si `filasExcel` lleva la cabecera. | Sí: la primera fila es `COLUMNAS_EXCEL` y la vista llama a `XLSX.utils.aoa_to_sheet(filasExcel(…))`. Todas las celdas son texto: `aoa_to_sheet` escribe un texto como celda `t: 's'` (comprobado en el código de SheetJS 0.20.3 y con una prueba), así que nada sale como fórmula y un NIT o un teléfono no pierden ceros. La hoja, `HOJA_EXCEL = 'Prospectos'`. |
| D3 | Dónde vive «hoy» y el «+ 6 meses». | `src/lib/fechas.ts`: `hoyLocal(d?)` (el patrón de `apps/contabilidad/src/cartera.ts`, reproducido, sin importar entre apps) y `sumarMeses(fecha, meses)`, que se queda en el último día del mes (2026-08-31 → 2027-02-28; 2027-08-31 → 2028-02-29). `estadoVigencia` usa `sumarMeses(hoy, MESES_DE_AVISO)`. |
| D4 | La tarea pedía reutilizar un quitador de tildes si existía. | **No existe** (`normalize.ts` solo hace title-case). Se crea `clave()` privada en `prospects.ts` (NFD, sin U+0300–U+036F, minúsculas, espacios colapsados). `normalize.ts` no se toca: el diseño no lo lista. |
| D5 | Las opciones de departamento. | Función pura `departamentosDe(prospectos)` en `prospects.ts`, probada: distintos, sin vacíos, `localeCompare(…, 'es')`. |
| D6 | «Búsqueda por NIT». El dataset guarda «811.000.231-7» y un comercial teclea «811000231». | Además de la subcadena normal, si lo tecleado son solo cifras y separadores (`/^[\d\s.-]+$/`), se comparan las cifras. Con letras no: «ambiental 2» no casa con cualquier NIT que lleve un 2. |
| D7 | Textos de grupo y de estado. | `ETIQUETA_GRUPO` = «Usan infrarrojo» / «Solo gravimetría» (pestañas y columna «Grupo» del Excel). `ETIQUETA_VIGENCIA` = «Sin fecha», «Vencida», «Vence en menos de 6 meses», «Vigente». |
| D8 | Formato de la vigencia. | Texto `AAAA-MM-DD` en pantalla y en el Excel (no una celda de fecha de Excel). Sin fecha: «—» en pantalla y celda vacía en el Excel. |
| D9 | Qué «hoy» usa la vista. | Se fija al abrirla (`useState(hoyLocal)`): las insignias y el Excel usan el mismo día y no se recalcula en cada render. |
| D10 | Exportar sin filas. | El botón se desactiva sin filas y mientras exporta. El error sale junto al botón con `role="alert"`. |
| D11 | «Los registros salen de filas reales del dataset». | Forma real (la de `RAW` en `api.test.ts`, pasada por `mapRecord`) y valores reales de variable, técnica, método, matriz y `hasta`; laboratorio, NIT y contacto ficticios (repo público). La variable «Grasas» (con «grasa» y sin «aceite») es inventada: el diseño pide el caso y no da ejemplo real. |
| D12 | Técnica que informa algo que no es infrarrojo (p. ej. «Gravimetría») con un método `NTC 3362 C`. | Manda la técnica: no es infrarrojo. El método solo se mira si la técnica no informa nada. Queda fijado por una prueba. |
| D13 | ¿Los datos de contacto salen de todas las filas del laboratorio o solo de las de grasas y aceites? | `groupProspects` filtra primero con `esGrasasYAceites`, así que todo (ficha, matrices, métodos, grupo y vigencia) sale de sus filas de grasas y aceites. |
| D14 | Columnas de la tabla en pantalla. | Laboratorio (con NIT y código debajo), Ciudad, Departamento, Matrices, Métodos, Vigencia más próxima (con insignia de color) y Contacto (contacto, teléfono y correo). Añadir «Cliente» es una columna más. |
| D15 | Aviso de lo que la vista no sabe. | Un recuadro ámbar como el de «Ámbito fijo» del Análisis de Marcas: el grupo sale de la técnica o el método; el dataset no dice quién tiene un OCMA. |
| D16 | Color de la tarjeta del menú. | `bg-amber-700` (contraste suficiente con texto blanco; `amber-600` se queda corto). |
| D17 | Cómo se escribe el sinónimo. | Un `Map` (`'aceites y grasas'` → `'grasas y aceites'`) y no un objeto: una variable llamada «constructor» encontraría la del prototipo. |

## Mapa de ficheros

| Fichero | Tarea | Responsabilidad |
|---|---|---|
| `apps/laboratorios-ambientales/src/lib/fechas.ts` (nuevo) | 1 | `hoyLocal` (hoy en hora local, `AAAA-MM-DD`) y `sumarMeses` (meses de calendario, al último día del mes si no existe). |
| `apps/laboratorios-ambientales/src/lib/fechas.test.ts` (nuevo) | 1 | Sus casos, con `vi.setSystemTime`. |
| `apps/laboratorios-ambientales/src/lib/filters.ts` | 2 | El sinónimo «aceites y grasas» = «grasas y aceites» dentro de `variableKey`. |
| `apps/laboratorios-ambientales/src/lib/filters.test.ts` | 2 | El Buscador con el sinónimo, en los dos sentidos. |
| `apps/laboratorios-ambientales/src/lib/prospects.ts` (nuevo) | 3-6 | Tipos (`Prospecto`, `GrupoProspecto`, `EstadoVigencia`, `FiltrosProspectos`), etiquetas y las funciones puras `esGrasasYAceites`, `esInfrarrojo`, `groupProspects`, `estadoVigencia`, `sortProspects`, `filterProspects`, `departamentosDe`. |
| `apps/laboratorios-ambientales/src/lib/prospects.test.ts` (nuevo) | 3-6 | Sus casos, con filas de forma real pasadas por `mapRecord`. |
| `apps/laboratorios-ambientales/package.json` | 7 | La dependencia `xlsx` (tarball de SheetJS 0.20.3). |
| `package-lock.json` (raíz) | 7 | La misma dependencia en el bloque de la app (lo escribe `npm install`). |
| `apps/laboratorios-ambientales/src/lib/exportProspects.ts` (nuevo) | 8 | `HOJA_EXCEL`, `COLUMNAS_EXCEL`, `filasExcel` y `nombreDeFichero`. |
| `apps/laboratorios-ambientales/src/lib/exportProspects.test.ts` (nuevo) | 8 | Columnas, orden, separador, celdas de texto y nombre del fichero. |
| `apps/laboratorios-ambientales/src/lib/view.ts` | 9 | La vista `prospectos`, publicada como `#prospectos`. |
| `apps/laboratorios-ambientales/src/lib/view.test.ts` | 9 | `#prospectos` en `parseView` y en el inverso. |
| `apps/laboratorios-ambientales/src/pages/Prospectos.tsx` (nuevo) | 10 | La vista: pestañas, filtros, tabla, aviso y botón de exportar. |
| `apps/laboratorios-ambientales/src/App.tsx` | 11 | La tarjeta del menú y la rama de la vista. |
| `apps/laboratorios-ambientales/README.md` | 12 | La tabla de estructura y una sección de la vista nueva. |

El `Dockerfile` de la raíz ya copia `apps/laboratorios-ambientales/package*.json` antes de `npm ci` (línea 11): no cambia. `src/services/api.ts`, `src/types/index.ts` y `src/lib/normalize.ts` tampoco cambian: el cache conserva su forma y su versión.

---

## Tarea 1: `fechas.ts` — hoy local y suma de meses de calendario

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/fechas.ts`
- Test: `apps/laboratorios-ambientales/src/lib/fechas.test.ts`

- [ ] **Paso 1: escribir la prueba que falla.** Crea `apps/laboratorios-ambientales/src/lib/fechas.test.ts` con:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { hoyLocal, sumarMeses } from './fechas';

afterEach(() => {
  vi.useRealTimers();
});

describe('hoyLocal', () => {
  it('sin argumento lee el reloj y da la fecha local, no la UTC', () => {
    vi.useFakeTimers();
    // A las 23:30 en Colombia (UTC−5) ya es el día 27 en UTC.
    vi.setSystemTime(new Date(2026, 10, 26, 23, 30));
    expect(hoyLocal()).toBe('2026-11-26');
  });

  it('rellena mes y día con cero', () => {
    expect(hoyLocal(new Date(2026, 0, 5, 8, 0))).toBe('2026-01-05');
  });
});

describe('sumarMeses', () => {
  it('suma meses de calendario y conserva el día', () => {
    expect(sumarMeses('2026-11-26', 6)).toBe('2027-05-26');
  });

  it('cruza el año', () => {
    expect(sumarMeses('2026-07-15', 6)).toBe('2027-01-15');
  });

  it('si el día no existe en el mes de llegada, se queda en el último', () => {
    expect(sumarMeses('2026-03-31', 6)).toBe('2026-09-30');
  });

  it('31 de agosto + 6 meses es el 28 de febrero en un año normal', () => {
    expect(sumarMeses('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('y el 29 de febrero en un año bisiesto', () => {
    expect(sumarMeses('2027-08-31', 6)).toBe('2028-02-29');
  });
});
```

- [ ] **Paso 2: verla fallar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/fechas.test.ts`
Expected: FAIL — `FAIL src/lib/fechas.test.ts` con `Error: Failed to load url ./fechas (resolved id: ./fechas) in …/src/lib/fechas.test.ts. Does the file exist?` y `Test Files 1 failed (1)`.

- [ ] **Paso 3: el código mínimo.** Crea `apps/laboratorios-ambientales/src/lib/fechas.ts` con:

```typescript
const dos = (n: number): string => String(n).padStart(2, '0');

// Fecha de hoy (AAAA-MM-DD) en la zona horaria del navegador. No sirve
// `toISOString()`: da la fecha UTC, y en Colombia (UTC−5) desde las 7 p. m. ya
// marca el día siguiente. Es el mismo patrón que `hoyLocal` de contabilidad
// (apps/contabilidad/src/cartera.ts), repetido aquí porque las apps no se
// importan entre sí.
export function hoyLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// Suma meses de calendario a una fecha AAAA-MM-DD. Si el día no existe en el mes
// de llegada, se queda en el último: el 31 de agosto + 6 meses es el 28 de
// febrero (el 29 en bisiesto), y no el 3 de marzo, que es lo que daría Date al
// desbordarse.
export function sumarMeses(fecha: string, meses: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const indice = anio * 12 + (mes - 1) + meses;
  const anioFinal = Math.floor(indice / 12);
  const mesFinal = indice - anioFinal * 12; // 0 = enero
  // El día 0 del mes siguiente es el último de este. En UTC, para que la zona
  // horaria no mueva el día.
  const ultimoDia = new Date(Date.UTC(anioFinal, mesFinal + 1, 0)).getUTCDate();
  return `${anioFinal}-${dos(mesFinal + 1)}-${dos(Math.min(dia, ultimoDia))}`;
}
```

- [ ] **Paso 4: verla pasar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/fechas.test.ts`
Expected: PASS — `✓ src/lib/fechas.test.ts (7 tests)`.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 8 passed (8)` y `Tests 115 passed (115)`.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/lib/fechas.ts apps/laboratorios-ambientales/src/lib/fechas.test.ts
git commit -F - <<'EOF'
feat(laboratorios): fecha local de hoy y suma de meses de calendario

hoyLocal da AAAA-MM-DD en la zona del navegador (no la UTC) y sumarMeses
se queda en el último día del mes: 31 de agosto + 6 meses es el 28 de
febrero, o el 29 en bisiesto. Las usará el aviso de vigencia.
EOF
```

---

## Tarea 2: Buscador — «Aceites y Grasas» y «Grasas y Aceites» son una casilla

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/filters.ts:29-32` (`variableKey` y su comentario)
- Test: `apps/laboratorios-ambientales/src/lib/filters.test.ts:196-199` (añadir detrás del último `describe`)

- [ ] **Paso 1: escribir la prueba que falla.** En `apps/laboratorios-ambientales/src/lib/filters.test.ts`, sustituir:

```typescript
  it('marcar añade la grafía mostrada', () => {
    expect(toggleVariable(['pH'], 'Plomo')).toEqual(['pH', 'Plomo']);
  });
});
```

por:

```typescript
  it('marcar añade la grafía mostrada', () => {
    expect(toggleVariable(['pH'], 'Plomo')).toEqual(['pH', 'Plomo']);
  });
});

// La misma variable llega con el orden cambiado: «Aceites y Grasas» (116 filas),
// «Grasas y Aceites» (35), «Aceites y grasas» y «Grasas y aceites».
describe('grasas y aceites: un sinónimo explícito', () => {
  const GYA: Laboratorio[] = [
    lab({ variable: 'Aceites y Grasas' }),
    lab({ variable: 'Aceites y Grasas' }),
    lab({ variable: 'Grasas y Aceites' }),
    lab({ variable: 'Aceites y grasas' }),
    lab({ variable: 'Grasas y aceites' }),
    lab({ variable: 'pH' }),
  ];

  it('con «Aceites y Grasas» marcado salen también los registros «Grasas y Aceites»', () => {
    expect(applyFilters(GYA, { ...EMPTY_FILTERS, variables: ['Aceites y Grasas'] })).toHaveLength(5);
  });

  it('y al revés', () => {
    expect(applyFilters(GYA, { ...EMPTY_FILTERS, variables: ['Grasas y Aceites'] })).toHaveLength(5);
  });

  it('las cuatro grafías son una sola casilla, con la más frecuente', () => {
    expect(optionsFor(GYA, 'variable', EMPTY_FILTERS)).toEqual(['Aceites y Grasas', 'pH']);
  });

  it('la casilla cuenta como marcada aunque se marcara con el otro orden', () => {
    expect(isVariableSelected(['Grasas y Aceites'], 'Aceites y Grasas')).toBe(true);
  });

  it('el sinónimo es solo para ese par', () => {
    const OTRAS: Laboratorio[] = [
      lab({ variable: 'Aceites y Grasas' }),
      lab({ variable: 'Grasas' }),
      lab({ variable: 'Aceites minerales' }),
    ];
    expect(applyFilters(OTRAS, { ...EMPTY_FILTERS, variables: ['Grasas y Aceites'] })).toHaveLength(1);
  });
});
```

- [ ] **Paso 2: verla fallar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/filters.test.ts`
Expected: FAIL — `Failed Tests 5`, los cinco del `describe` nuevo: `expected […] to have a length of 5 but got 3`, `… of 5 but got 2`, `expected [ 'Aceites y Grasas', …(2) ] to deeply equal [ 'Aceites y Grasas', 'pH' ]`, `expected false to be true` y `expected [] to have a length of 1 but got +0`. Las 27 de antes siguen en verde.

- [ ] **Paso 3: el código mínimo.** En `apps/laboratorios-ambientales/src/lib/filters.ts`, sustituir:

```typescript
// El colapso de \s+ replica el que normalize.ts ya hace por el mismo motivo.
// applyFilters y optionsFor DEBEN usar esta misma clave: si difirieran, elegir
// la opción canónica dejaría fuera los registros de las demás grafías.
const variableKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');
```

por:

```typescript
// El colapso de \s+ replica el que normalize.ts ya hace por el mismo motivo.
// applyFilters y optionsFor DEBEN usar esta misma clave: si difirieran, elegir
// la opción canónica dejaría fuera los registros de las demás grafías.
// Los sinónimos van uno a uno y solo donde los datos lo piden: «Aceites y
// Grasas» (116 filas) y «Grasas y Aceites» (35) son la misma variable con el
// orden cambiado. Un Map y no un objeto: una variable llamada «constructor»
// encontraría la del prototipo.
const SINONIMOS_VARIABLE = new Map([['aceites y grasas', 'grasas y aceites']]);

const variableKey = (value: string): string => {
  const clave = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return SINONIMOS_VARIABLE.get(clave) ?? clave;
};
```

- [ ] **Paso 4: verla pasar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/filters.test.ts`
Expected: PASS — `✓ src/lib/filters.test.ts (32 tests)`.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 8 passed (8)` y `Tests 120 passed (120)`.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/lib/filters.ts apps/laboratorios-ambientales/src/lib/filters.test.ts
git commit -F - <<'EOF'
fix(laboratorios): el Buscador junta «Aceites y Grasas» y «Grasas y Aceites»

Eran dos casillas para la misma variable. variableKey lleva un sinónimo
explícito y solo para ese par; la casilla muestra la grafía más frecuente
del recorte, como con cualquier otro grupo de grafías.
EOF
```

---

## Tarea 3: `prospects.ts` — tipos, etiquetas, `esGrasasYAceites` y `esInfrarrojo`

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/prospects.ts`
- Test: `apps/laboratorios-ambientales/src/lib/prospects.test.ts`

Aquí se definen ya todos los tipos y etiquetas (`Prospecto`, `GrupoProspecto`, `EstadoVigencia`, `FiltrosProspectos`, `GRUPOS`, `ETIQUETA_GRUPO`, `MESES_DE_AVISO`, `ETIQUETA_VIGENCIA`): las Tareas 4-11 los usan con estos nombres.

- [ ] **Paso 1: escribir la prueba que falla.** Crea `apps/laboratorios-ambientales/src/lib/prospects.test.ts` con:

```typescript
import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { mapRecord } from '../services/api';
import { esGrasasYAceites, esInfrarrojo } from './prospects';

// Una fila con la forma real del dataset (como RAW en services/api.test.ts),
// pasada por mapRecord igual que en la app. Variable, técnica, método, matriz y
// fechas son valores reales de grasas y aceites (consultados el 2026-11-26); el
// laboratorio y su contacto son ficticios: el repo es público y son datos
// personales.
const RAW_GYA = {
  c_digo_de_laboratorio: '101',
  estado_de_la_acreditaci_n: 'Activa',
  matriz: 'Agua',
  componente: 'Continental',
  actividad: 'Análisis',
  grupo: 'Fisicoquímicos',
  variable: 'Aceites y Grasas',
  t_cnica: 'Gravimetría',
  m_todo: 'SM 5520 B',
  rango_de_trabajo: '5 mg/L - 1 000 mg/L',
  nombre_del_laboratorio: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
  nit: '900.000.001-1',
  contacto: 'Contacto Ficticio Uno',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  direcci_n: 'Calle 1 # 2-3',
  tel_fono: '6040000001',
  correo: 'lab.andino@example.com',
  actos_administrativos_que: '0001 del 2 de enero de 2023',
  desde: '2023-01-15T00:00:00.000',
  hasta: '2027-04-21T00:00:00.000',
};

const fila = (over: Record<string, string> = {}): Laboratorio => mapRecord({ ...RAW_GYA, ...over });

describe('esGrasasYAceites', () => {
  it('reconoce las cuatro grafías de la variable', () => {
    for (const variable of ['Aceites y Grasas', 'Grasas y Aceites', 'Aceites y grasas', 'Grasas y aceites']) {
      expect(esGrasasYAceites(fila({ variable }))).toBe(true);
    }
  });

  it('no distingue mayúsculas ni espacios de más', () => {
    expect(esGrasasYAceites(fila({ variable: '  GRASAS  y   ACEITES ' }))).toBe(true);
  });

  it('vale para cualquier matriz', () => {
    for (const matriz of ['Agua', 'Suelo', 'Sedimento', 'Lodo']) {
      expect(esGrasasYAceites(fila({ matriz }))).toBe(true);
    }
  });

  it('una variable con «grasa» pero sin «aceite» queda fuera', () => {
    expect(esGrasasYAceites(fila({ variable: 'Grasas' }))).toBe(false);
  });

  it('otra variable queda fuera', () => {
    expect(esGrasasYAceites(fila({ variable: 'Alcalinidad' }))).toBe(false);
  });

  it('una acreditación Suspendida queda fuera', () => {
    expect(esGrasasYAceites(fila({ estado_de_la_acreditaci_n: 'Suspendida' }))).toBe(false);
  });
});

describe('esInfrarrojo', () => {
  it('la técnica «Fotometría» es infrarrojo', () => {
    expect(esInfrarrojo(fila({ t_cnica: 'Fotometría', m_todo: 'SM 5520 C' }))).toBe(true);
  });

  it('una técnica que dice «infrarrojo» también lo es', () => {
    expect(esInfrarrojo(fila({ t_cnica: 'Espectroscopía Infrarroja', m_todo: 'Método interno' }))).toBe(true);
  });

  it('la técnica «Gravimetría» no lo es', () => {
    expect(esInfrarrojo(fila({ t_cnica: 'Gravimetría', m_todo: 'SM 5520 D' }))).toBe(false);
  });

  it('si la técnica informa algo, manda ella y el método no se mira', () => {
    expect(esInfrarrojo(fila({ t_cnica: 'Gravimetría', m_todo: 'NTC 3362 C' }))).toBe(false);
  });

  it('técnica «---» con «NTC 3362 Métodos C, F»: el método dice infrarrojo', () => {
    expect(esInfrarrojo(fila({ t_cnica: '---', m_todo: 'NTC 3362 Métodos C, F' }))).toBe(true);
  });

  it('técnica «---» con «SM 5520 B»: no es infrarrojo', () => {
    expect(esInfrarrojo(fila({ t_cnica: '---', m_todo: 'SM 5520 B' }))).toBe(false);
  });

  it('con la técnica vacía, «---» o «No Aplica», todos los métodos por infrarrojo del dataset cuentan', () => {
    const metodos = [
      'SM 5520 C',
      'SM 5520 C, F',
      'NTC 3362 C',
      'NTC 3362 Método C',
      'NTC 3362 C Modificado',
      'NTC 3362 C, F',
      'ASTM D7066-04',
    ];
    for (const tecnica of ['', '---', 'No Aplica']) {
      for (const metodo of metodos) {
        expect(esInfrarrojo(fila({ t_cnica: tecnica, m_todo: metodo })), `${tecnica} / ${metodo}`).toBe(true);
      }
    }
  });

  it('los métodos gravimétricos del dataset no cuentan como infrarrojo', () => {
    const metodos = ['SM 5520 D', 'SM 5520 B, F', 'SM 5520 D, F', 'EPA 9071 B', 'EPA 9071 B, SM 5520 F Modificado'];
    for (const metodo of metodos) {
      expect(esInfrarrojo(fila({ t_cnica: '---', m_todo: metodo })), metodo).toBe(false);
    }
  });
});
```

- [ ] **Paso 2: verla fallar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/prospects.test.ts`
Expected: FAIL — `Error: Failed to load url ./prospects (resolved id: ./prospects) in …/src/lib/prospects.test.ts. Does the file exist?`

- [ ] **Paso 3: el código mínimo.** Crea `apps/laboratorios-ambientales/src/lib/prospects.ts` con:

```typescript
import type { Laboratorio } from '../types';

// Ambientalia vende el Horiba OCMA-500, que mide grasas y aceites por
// infrarrojo. Quien ya usa infrarrojo es oportunidad de servicio, consumibles o
// reposición; quien solo usa gravimetría, de vender el equipo.
export type GrupoProspecto = 'infrarrojo' | 'gravimetria';

export type EstadoVigencia = 'sin-fecha' | 'vencida' | 'pronto' | 'vigente';

// Un laboratorio, no una acreditación: junta todas sus filas activas de grasas y
// aceites (una por matriz y método).
export type Prospecto = {
  codigo: string;
  nombre: string;
  nit: string;
  ciudad: string;
  departamento: string;
  contacto: string;
  telefono: string;
  correo: string;
  matrices: string[];
  metodos: string[];
  grupo: GrupoProspecto;
  // AAAA-MM-DD, o null si ninguna de sus acreditaciones trae una fecha válida.
  vigenciaMasProxima: string | null;
};

export type FiltrosProspectos = {
  grupo: GrupoProspecto;
  // '' = todos los departamentos.
  departamento: string;
  busqueda: string;
};

// El orden de las pestañas: la primera es la que se abre por defecto.
export const GRUPOS: readonly GrupoProspecto[] = ['infrarrojo', 'gravimetria'];

// «Solo gravimetría» y no «Sin infrarrojo»: hoy los 64 laboratorios de este
// grupo son gravimétricos. Si alguno usara otra técnica sin infrarrojo, caería
// aquí y la columna de métodos lo dejaría a la vista.
export const ETIQUETA_GRUPO: Record<GrupoProspecto, string> = {
  infrarrojo: 'Usan infrarrojo',
  gravimetria: 'Solo gravimetría',
};

// Cuánto antes del vencimiento se avisa.
export const MESES_DE_AVISO = 6;

export const ETIQUETA_VIGENCIA: Record<EstadoVigencia, string> = {
  'sin-fecha': 'Sin fecha',
  vencida: 'Vencida',
  pronto: `Vence en menos de ${MESES_DE_AVISO} meses`,
  vigente: 'Vigente',
};

// Minúsculas, sin tildes y con los espacios colapsados: el dataset es de captura
// manual y la misma palabra llega con varias grafías.
function clave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// La variable llega como «Aceites y Grasas», «Grasas y Aceites», «Aceites y
// grasas» o «Grasas y aceites»: basta con que estén las dos palabras, en
// cualquier orden. Vale para cualquier matriz (agua, suelo, sedimento, lodo).
export function esGrasasYAceites(registro: Pick<Laboratorio, 'estado' | 'variable'>): boolean {
  if (registro.estado !== 'Activa') return false;
  const variable = clave(registro.variable);
  return variable.includes('grasa') && variable.includes('aceite');
}

// «---» y «No Aplica» son los rellenos del dataset cuando la técnica no se informó.
const TECNICA_SIN_DATO = new Set(['', '---', 'no aplica']);

// Los métodos por infrarrojo: SM 5520 C, NTC 3362 C (con o sin «Método» o
// «Métodos» delante de la C) y ASTM D7066. El \b impide que la C case con el
// principio de otra palabra.
const METODO_INFRARROJO = /5520 c\b|ntc 3362 (?:metodos? )?c\b|d7066/;

export function esInfrarrojo(registro: Pick<Laboratorio, 'tecnica' | 'metodo'>): boolean {
  const tecnica = clave(registro.tecnica);
  // La técnica manda cuando dice algo; el método solo se mira si no informa nada.
  if (!TECNICA_SIN_DATO.has(tecnica)) return tecnica.includes('fotometr') || tecnica.includes('infrarroj');
  return METODO_INFRARROJO.test(clave(registro.metodo));
}
```

La clase de `clave()` va escrita con escapes Unicode, como en el bloque de arriba: barra invertida, «u» y las cifras 0300; guion; barra invertida, «u» y 036f. Comprueba tras escribir el fichero que quedaron así: alguna herramienta los convierte al copiar en los propios caracteres combinantes, que funcionan igual pero no se leen. Si pasa, corrígelo.

- [ ] **Paso 4: verla pasar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/prospects.test.ts`
Expected: PASS — `✓ src/lib/prospects.test.ts (14 tests)`.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 9 passed (9)` y `Tests 134 passed (134)`.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/lib/prospects.ts apps/laboratorios-ambientales/src/lib/prospects.test.ts
git commit -F - <<'EOF'
feat(laboratorios): qué acreditación es de grasas y aceites y cuál usa infrarrojo

Activa y con «grasa» y «aceite» en la variable, sin tildes ni espacios de
más y en cualquier matriz. Infrarrojo si la técnica dice fotometría o
infrarrojo; si no informa nada, se mira el método (5520 C, NTC 3362 C,
D7066). Trae ya los tipos y las etiquetas de la vista.
EOF
```

---

## Tarea 4: `groupProspects` — un prospecto por laboratorio

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/prospects.ts:88-89` (añadir detrás de `esInfrarrojo`)
- Test: `apps/laboratorios-ambientales/src/lib/prospects.test.ts:4` (import) y `:112-115` (añadir detrás del `describe` de `esInfrarrojo`)

- [ ] **Paso 1: escribir la prueba que falla** — dos Edit.

(a) En `apps/laboratorios-ambientales/src/lib/prospects.test.ts`, sustituir:

```typescript
import { esGrasasYAceites, esInfrarrojo } from './prospects';
```

por:

```typescript
import { esGrasasYAceites, esInfrarrojo, groupProspects } from './prospects';
```

(b) En el mismo fichero, sustituir:

```typescript
      expect(esInfrarrojo(fila({ t_cnica: '---', m_todo: metodo })), metodo).toBe(false);
    }
  });
});
```

por:

```typescript
      expect(esInfrarrojo(fila({ t_cnica: '---', m_todo: metodo })), metodo).toBe(false);
    }
  });
});

describe('groupProspects', () => {
  it('arma la ficha de un laboratorio a partir de sus acreditaciones', () => {
    expect(groupProspects([fila()])).toEqual([
      {
        codigo: '101',
        nombre: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
        nit: '900.000.001-1',
        ciudad: 'Medellín',
        departamento: 'Antioquia',
        contacto: 'Contacto Ficticio Uno',
        telefono: '6040000001',
        correo: 'lab.andino@example.com',
        matrices: ['Agua'],
        metodos: ['SM 5520 B'],
        grupo: 'gravimetria',
        vigenciaMasProxima: '2027-04-21',
      },
    ]);
  });

  it('solo cuentan sus acreditaciones activas de grasas y aceites', () => {
    const prospectos = groupProspects([
      fila({ variable: 'Alcalinidad', m_todo: 'SM 2320 B', hasta: '2026-12-01T00:00:00.000' }),
      fila({ estado_de_la_acreditaci_n: 'Suspendida', t_cnica: 'Fotometría', m_todo: 'SM 5520 C' }),
      fila(),
    ]);
    expect(prospectos).toHaveLength(1);
    expect(prospectos[0].metodos).toEqual(['SM 5520 B']);
    expect(prospectos[0].grupo).toBe('gravimetria');
    expect(prospectos[0].vigenciaMasProxima).toBe('2027-04-21');
  });

  it('un laboratorio sin acreditaciones de grasas y aceites no sale', () => {
    expect(groupProspects([fila({ variable: 'pH' })])).toEqual([]);
  });

  it('un laboratorio con las dos técnicas cuenta como infrarrojo', () => {
    const [prospecto] = groupProspects([
      fila({ t_cnica: 'Gravimetría', m_todo: 'SM 5520 B' }),
      fila({ t_cnica: 'Fotometría', m_todo: 'SM 5520 C' }),
    ]);
    expect(prospecto.grupo).toBe('infrarrojo');
    expect(prospecto.metodos).toEqual(['SM 5520 B', 'SM 5520 C']);
  });

  it('un mismo NIT con dos códigos son dos laboratorios', () => {
    const prospectos = groupProspects([
      fila({ c_digo_de_laboratorio: '101' }),
      fila({ c_digo_de_laboratorio: '102', ciudad: 'Rionegro' }),
    ]);
    expect(prospectos.map((p) => [p.codigo, p.nit, p.ciudad])).toEqual([
      ['101', '900.000.001-1', 'Medellín'],
      ['102', '900.000.001-1', 'Rionegro'],
    ]);
  });

  it('sin código, agrupa por nombre', () => {
    const prospectos = groupProspects([
      fila({ c_digo_de_laboratorio: '', m_todo: 'SM 5520 B' }),
      fila({ c_digo_de_laboratorio: '', m_todo: 'SM 5520 D' }),
      fila({ c_digo_de_laboratorio: '', nombre_del_laboratorio: 'LABORATORIO DEL LLANO LTDA.' }),
    ]);
    expect(prospectos.map((p) => [p.nombre, p.metodos])).toEqual([
      ['LABORATORIO ANDINO DE AGUAS S.A.S.', ['SM 5520 B', 'SM 5520 D']],
      ['LABORATORIO DEL LLANO LTDA.', ['SM 5520 B']],
    ]);
  });

  it('cada dato de la ficha es el primero no vacío, en el orden del dataset', () => {
    const [prospecto] = groupProspects([
      fila({ contacto: '', tel_fono: '' }),
      fila({ contacto: 'Contacto Ficticio Dos', tel_fono: '6040000002' }),
      fila({ contacto: 'Contacto Ficticio Tres', tel_fono: '6040000003' }),
    ]);
    expect(prospecto.contacto).toBe('Contacto Ficticio Dos');
    expect(prospecto.telefono).toBe('6040000002');
    expect(prospecto.correo).toBe('lab.andino@example.com');
  });

  it('junta matrices y métodos sin repetir y ordenados', () => {
    const [prospecto] = groupProspects([
      fila({ matriz: 'Suelo', m_todo: 'EPA 9071 B' }),
      fila({ matriz: 'Agua', m_todo: 'SM 5520 D' }),
      fila({ matriz: 'Agua', m_todo: 'SM 5520 B' }),
      fila({ matriz: 'Agua', m_todo: 'SM 5520 B' }),
    ]);
    expect(prospecto.matrices).toEqual(['Agua', 'Suelo']);
    expect(prospecto.metodos).toEqual(['EPA 9071 B', 'SM 5520 B', 'SM 5520 D']);
  });

  describe('vigencia más próxima', () => {
    it('es la más temprana de varias', () => {
      const [prospecto] = groupProspects([
        fila({ hasta: '2027-04-21T00:00:00.000' }),
        fila({ hasta: '2026-12-01T00:00:00.000' }),
        fila({ hasta: '2028-01-10T00:00:00.000' }),
      ]);
      expect(prospecto.vigenciaMasProxima).toBe('2026-12-01');
    });

    it('ignora «---»', () => {
      const [prospecto] = groupProspects([fila({ hasta: '---' }), fila({ hasta: '2027-04-21T00:00:00.000' })]);
      expect(prospecto.vigenciaMasProxima).toBe('2027-04-21');
    });

    it('si todas son «---», es null', () => {
      const [prospecto] = groupProspects([fila({ hasta: '---' }), fila({ hasta: '---' })]);
      expect(prospecto.vigenciaMasProxima).toBeNull();
    });
  });
});
```

- [ ] **Paso 2: verla fallar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/prospects.test.ts`
Expected: FAIL — `Failed Tests 11`, todas con `TypeError: groupProspects is not a function`; las 14 de la Tarea 3 siguen en verde.

- [ ] **Paso 3: el código mínimo.** En `apps/laboratorios-ambientales/src/lib/prospects.ts`, sustituir:

```typescript
  return METODO_INFRARROJO.test(clave(registro.metodo));
}
```

por:

```typescript
  return METODO_INFRARROJO.test(clave(registro.metodo));
}

// `hasta` llega como «2027-04-21T00:00:00.000» o como «---».
const FECHA_ISO = /^(\d{4}-\d{2}-\d{2})/;

function fechaDeHasta(hasta: string): string | null {
  const encontrada = FECHA_ISO.exec(hasta.trim());
  return encontrada ? encontrada[1] : null;
}

const compararTexto = (a: string, b: string): number => a.localeCompare(b, 'es');

function distintos(valores: string[]): string[] {
  return [...new Set(valores.map((valor) => valor.trim()).filter(Boolean))].sort(compararTexto);
}

function aProspecto(filas: Laboratorio[]): Prospecto {
  // El primer valor no vacío en el orden del dataset: el contacto o el teléfono
  // faltan a menudo en una fila y están en otra del mismo laboratorio.
  const primero = (campo: keyof Laboratorio): string => {
    for (const fila of filas) {
      const valor = fila[campo].trim();
      if (valor) return valor;
    }
    return '';
  };
  // AAAA-MM-DD se ordena bien como texto: tras el sort, la primera es la más temprana.
  const fechas = filas
    .map((fila) => fechaDeHasta(fila.hasta))
    .filter((fecha): fecha is string => fecha !== null)
    .sort();

  return {
    codigo: primero('codigo'),
    nombre: primero('nombreLaboratorio'),
    nit: primero('nit'),
    ciudad: primero('ciudad'),
    departamento: primero('departamento'),
    contacto: primero('contacto'),
    telefono: primero('telefono'),
    correo: primero('correo'),
    matrices: distintos(filas.map((fila) => fila.matriz)),
    metodos: distintos(filas.map((fila) => fila.metodo)),
    grupo: filas.some(esInfrarrojo) ? 'infrarrojo' : 'gravimetria',
    vigenciaMasProxima: fechas[0] ?? null,
  };
}

// Por código de laboratorio y no por NIT: una misma empresa tiene varias sedes
// acreditadas, cada una con su código. Sin código, por nombre. Los prefijos
// impiden que un nombre choque con un código. El Map conserva el orden del dataset.
export function groupProspects(data: Laboratorio[]): Prospecto[] {
  const porLaboratorio = new Map<string, Laboratorio[]>();
  for (const registro of data) {
    if (!esGrasasYAceites(registro)) continue;
    const codigo = registro.codigo.trim();
    const id = codigo ? `codigo:${codigo}` : `nombre:${registro.nombreLaboratorio.trim()}`;
    const filas = porLaboratorio.get(id);
    if (filas) filas.push(registro);
    else porLaboratorio.set(id, [registro]);
  }
  return [...porLaboratorio.values()].map(aProspecto);
}
```

- [ ] **Paso 4: verla pasar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/prospects.test.ts`
Expected: PASS — `✓ src/lib/prospects.test.ts (25 tests)`.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 9 passed (9)` y `Tests 145 passed (145)`.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/lib/prospects.ts apps/laboratorios-ambientales/src/lib/prospects.test.ts
git commit -F - <<'EOF'
feat(laboratorios): agrupar las acreditaciones de grasas y aceites por laboratorio

Por código de laboratorio (un mismo NIT puede tener varias sedes) y, sin
código, por nombre. Cada dato de la ficha es el primero no vacío; matrices
y métodos van sin repetir y ordenados; el grupo es infrarrojo si alguna lo
es, y la vigencia, la fecha válida más temprana.
EOF
```

---

## Tarea 5: `estadoVigencia` — vencida, pronto, vigente o sin fecha

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/prospects.ts:1` (import) y `:150-151` (añadir detrás de `groupProspects`)
- Test: `apps/laboratorios-ambientales/src/lib/prospects.test.ts:4` (import) y `:224-227` (añadir detrás del `describe` de `groupProspects`)

- [ ] **Paso 1: escribir la prueba que falla** — dos Edit.

(a) En `apps/laboratorios-ambientales/src/lib/prospects.test.ts`, sustituir:

```typescript
import { esGrasasYAceites, esInfrarrojo, groupProspects } from './prospects';
```

por:

```typescript
import { esGrasasYAceites, esInfrarrojo, estadoVigencia, groupProspects } from './prospects';
```

(b) En el mismo fichero, sustituir:

```typescript
      expect(prospecto.vigenciaMasProxima).toBeNull();
    });
  });
});
```

por:

```typescript
      expect(prospecto.vigenciaMasProxima).toBeNull();
    });
  });
});

describe('estadoVigencia', () => {
  // Hoy + 6 meses = 2027-05-26.
  const HOY = '2026-11-26';

  it('sin fecha', () => {
    expect(estadoVigencia(null, HOY)).toBe('sin-fecha');
  });

  it('vencida: anterior a hoy', () => {
    expect(estadoVigencia('2026-11-25', HOY)).toBe('vencida');
  });

  it('el mismo día de hoy ya es «pronto», no «vencida» (borde de abajo)', () => {
    expect(estadoVigencia(HOY, HOY)).toBe('pronto');
  });

  it('«pronto» llega hasta la víspera de hoy + 6 meses', () => {
    expect(estadoVigencia('2027-05-25', HOY)).toBe('pronto');
  });

  it('hoy + 6 meses justo ya es «vigente»: el límite queda fuera (borde de arriba)', () => {
    expect(estadoVigencia('2027-05-26', HOY)).toBe('vigente');
  });

  it('más allá, «vigente»', () => {
    expect(estadoVigencia('2028-01-10', HOY)).toBe('vigente');
  });

  it('el límite se queda en el último día del mes: el 31 de agosto da el 28 de febrero', () => {
    expect(estadoVigencia('2027-02-27', '2026-08-31')).toBe('pronto');
    expect(estadoVigencia('2027-02-28', '2026-08-31')).toBe('vigente');
  });

  it('y en bisiesto, el 29 de febrero', () => {
    expect(estadoVigencia('2028-02-28', '2027-08-31')).toBe('pronto');
    expect(estadoVigencia('2028-02-29', '2027-08-31')).toBe('vigente');
  });
});
```

- [ ] **Paso 2: verla fallar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/prospects.test.ts`
Expected: FAIL — `Failed Tests 8`, todas con `TypeError: estadoVigencia is not a function`; las 25 anteriores siguen en verde.

- [ ] **Paso 3: el código mínimo** — dos Edit.

(a) En `apps/laboratorios-ambientales/src/lib/prospects.ts`, sustituir:

```typescript
import type { Laboratorio } from '../types';
```

por:

```typescript
import type { Laboratorio } from '../types';
import { sumarMeses } from './fechas';
```

(b) En el mismo fichero, sustituir:

```typescript
  return [...porLaboratorio.values()].map(aProspecto);
}
```

por:

```typescript
  return [...porLaboratorio.values()].map(aProspecto);
}

// `hoy` llega como argumento para que el resultado no dependa del reloj. El
// límite es hoy + 6 meses de calendario, ajustado al último día del mes
// (sumarMeses), y queda fuera: esa fecha ya es «vigente».
export function estadoVigencia(fecha: string | null, hoy: string): EstadoVigencia {
  if (fecha === null) return 'sin-fecha';
  if (fecha < hoy) return 'vencida';
  if (fecha < sumarMeses(hoy, MESES_DE_AVISO)) return 'pronto';
  return 'vigente';
}
```

- [ ] **Paso 4: verla pasar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/prospects.test.ts`
Expected: PASS — `✓ src/lib/prospects.test.ts (33 tests)`.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 9 passed (9)` y `Tests 153 passed (153)`.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/lib/prospects.ts apps/laboratorios-ambientales/src/lib/prospects.test.ts
git commit -F - <<'EOF'
feat(laboratorios): estado de la vigencia con aviso a seis meses

Vencida antes de hoy; «pronto» desde hoy hasta hoy + 6 meses de
calendario, límite excluido y ajustado al último día del mes; vigente
después, y sin fecha si no hay ninguna. Hoy llega como argumento.
EOF
```

---

## Tarea 6: `sortProspects`, `filterProspects` y `departamentosDe`

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/prospects.ts:160-162` (añadir detrás de `estadoVigencia`)
- Test: `apps/laboratorios-ambientales/src/lib/prospects.test.ts:4` (imports) y `:264-266` (añadir detrás del `describe` de `estadoVigencia`)

- [ ] **Paso 1: escribir la prueba que falla** — dos Edit.

(a) En `apps/laboratorios-ambientales/src/lib/prospects.test.ts`, sustituir:

```typescript
import { esGrasasYAceites, esInfrarrojo, estadoVigencia, groupProspects } from './prospects';
```

por:

```typescript
import type { Prospecto } from './prospects';
import {
  departamentosDe,
  esGrasasYAceites,
  esInfrarrojo,
  estadoVigencia,
  filterProspects,
  groupProspects,
  sortProspects,
} from './prospects';
```

(b) En el mismo fichero, sustituir:

```typescript
    expect(estadoVigencia('2028-02-29', '2027-08-31')).toBe('vigente');
  });
});
```

por:

```typescript
    expect(estadoVigencia('2028-02-29', '2027-08-31')).toBe('vigente');
  });
});

// Un prospecto ya armado, para probar el orden y los filtros sin pasar por
// groupProspects. Datos ficticios.
const prospecto = (over: Partial<Prospecto> = {}): Prospecto => ({
  codigo: '101',
  nombre: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
  nit: '900.000.001-1',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  contacto: '',
  telefono: '',
  correo: '',
  matrices: ['Agua'],
  metodos: ['SM 5520 B'],
  grupo: 'gravimetria',
  vigenciaMasProxima: '2027-04-21',
  ...over,
});

const nombres = (lista: Prospecto[]): string[] => lista.map((p) => p.nombre);

describe('sortProspects', () => {
  it('de la vigencia más cercana a la más lejana, y los sin fecha al final', () => {
    const ordenados = sortProspects([
      prospecto({ nombre: 'Alfa', vigenciaMasProxima: null }),
      prospecto({ nombre: 'Beta', vigenciaMasProxima: '2028-01-10' }),
      prospecto({ nombre: 'Gamma', vigenciaMasProxima: '2026-12-01' }),
    ]);
    expect(nombres(ordenados)).toEqual(['Gamma', 'Beta', 'Alfa']);
  });

  it('a igual fecha, por nombre en español', () => {
    const ordenados = sortProspects([
      prospecto({ nombre: 'Centro' }),
      prospecto({ nombre: 'BIOLAB' }),
      prospecto({ nombre: 'Álamo' }),
    ]);
    expect(nombres(ordenados)).toEqual(['Álamo', 'BIOLAB', 'Centro']);
  });

  it('los sin fecha también se ordenan por nombre', () => {
    const ordenados = sortProspects([
      prospecto({ nombre: 'Zeta', vigenciaMasProxima: null }),
      prospecto({ nombre: 'Delta', vigenciaMasProxima: null }),
    ]);
    expect(nombres(ordenados)).toEqual(['Delta', 'Zeta']);
  });

  it('no toca la lista recibida', () => {
    const lista = [prospecto({ nombre: 'Beta' }), prospecto({ nombre: 'Alfa' })];
    sortProspects(lista);
    expect(nombres(lista)).toEqual(['Beta', 'Alfa']);
  });
});

describe('filterProspects', () => {
  const LISTA = [
    prospecto({ codigo: '1', nombre: 'LABORATORIO QUÍMICO DEL VALLE', nit: '900.111.222-3', departamento: 'Valle del Cauca', grupo: 'infrarrojo' }),
    prospecto({ codigo: '2', nombre: 'Aguas de Antioquia', nit: '800.333.444-5', departamento: 'Antioquia', grupo: 'infrarrojo' }),
    prospecto({ codigo: '3', nombre: 'Laboratorio Ambiental 2', nit: '901.222.000-1', departamento: 'Antioquia', grupo: 'gravimetria' }),
  ];
  const codigos = (lista: Prospecto[]): string[] => lista.map((p) => p.codigo);
  const filtrar = (grupo: Prospecto['grupo'], departamento: string, busqueda: string) =>
    codigos(filterProspects(LISTA, { grupo, departamento, busqueda }));

  it('se queda con el grupo de la pestaña', () => {
    expect(filtrar('infrarrojo', '', '')).toEqual(['1', '2']);
    expect(filtrar('gravimetria', '', '')).toEqual(['3']);
  });

  it('departamento vacío son todos; con valor, solo ese', () => {
    expect(filtrar('infrarrojo', 'Antioquia', '')).toEqual(['2']);
  });

  it('busca por nombre sin distinguir mayúsculas ni tildes', () => {
    expect(filtrar('infrarrojo', '', 'quimico')).toEqual(['1']);
    expect(filtrar('infrarrojo', '', '  AGUAS de ANTIOQUÍA ')).toEqual(['2']);
  });

  it('busca por NIT, con o sin puntos ni guion', () => {
    expect(filtrar('infrarrojo', '', '800.333')).toEqual(['2']);
    expect(filtrar('infrarrojo', '', '800333444')).toEqual(['2']);
    expect(filtrar('infrarrojo', '', '800333444-5')).toEqual(['2']);
  });

  it('las cifras de un nombre no casan con un NIT', () => {
    // Los NIT de 1 y 2 llevan un 2, pero «ambiental 2» no es un NIT.
    expect(filtrar('infrarrojo', '', 'ambiental 2')).toEqual([]);
  });

  it('la búsqueda y el departamento se suman', () => {
    expect(filtrar('infrarrojo', 'Antioquia', 'quimico')).toEqual([]);
  });
});

describe('departamentosDe', () => {
  it('los departamentos distintos, sin vacíos y ordenados', () => {
    const lista = [
      prospecto({ departamento: 'Valle del Cauca' }),
      prospecto({ departamento: 'Antioquia' }),
      prospecto({ departamento: '' }),
      prospecto({ departamento: 'Antioquia' }),
      prospecto({ departamento: 'Atlántico' }),
    ];
    expect(departamentosDe(lista)).toEqual(['Antioquia', 'Atlántico', 'Valle del Cauca']);
  });
});
```

- [ ] **Paso 2: verla fallar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/prospects.test.ts`
Expected: FAIL — `Failed Tests 11`: `TypeError: sortProspects is not a function` (4), `TypeError: filterProspects is not a function` (6) y `TypeError: departamentosDe is not a function` (1); las 33 anteriores siguen en verde.

- [ ] **Paso 3: el código mínimo.** En `apps/laboratorios-ambientales/src/lib/prospects.ts`, sustituir:

```typescript
  if (fecha < sumarMeses(hoy, MESES_DE_AVISO)) return 'pronto';
  return 'vigente';
}
```

por:

```typescript
  if (fecha < sumarMeses(hoy, MESES_DE_AVISO)) return 'pronto';
  return 'vigente';
}

// De la vigencia más cercana a la más lejana, con los «sin fecha» al final. A
// igual fecha, por nombre. Devuelve una lista nueva: no toca la recibida.
export function sortProspects(prospectos: Prospecto[]): Prospecto[] {
  return [...prospectos].sort((a, b) => {
    if (a.vigenciaMasProxima !== b.vigenciaMasProxima) {
      if (a.vigenciaMasProxima === null) return 1;
      if (b.vigenciaMasProxima === null) return -1;
      return a.vigenciaMasProxima < b.vigenciaMasProxima ? -1 : 1;
    }
    return compararTexto(a.nombre, b.nombre);
  });
}

// Un NIT se encuentra también sin puntos ni guion («800333444» encuentra
// «800.333.444-5»), pero solo si lo tecleado son cifras y separadores: si no, las
// cifras de un nombre («Ambiental 2») casarían con cualquier NIT que las tenga.
const PARECE_NIT = /^[\d\s.-]+$/;
const soloCifras = (texto: string): string => texto.replace(/\D/g, '');

export function filterProspects(prospectos: Prospecto[], filtros: FiltrosProspectos): Prospecto[] {
  const busqueda = clave(filtros.busqueda);
  const cifras = PARECE_NIT.test(busqueda) ? soloCifras(busqueda) : '';
  return prospectos.filter((prospecto) => {
    if (prospecto.grupo !== filtros.grupo) return false;
    if (filtros.departamento && prospecto.departamento !== filtros.departamento) return false;
    if (!busqueda) return true;
    if (clave(prospecto.nombre).includes(busqueda) || clave(prospecto.nit).includes(busqueda)) return true;
    return cifras !== '' && soloCifras(prospecto.nit).includes(cifras);
  });
}

// Las opciones del desplegable de departamento: distintas, sin vacíos y ordenadas.
export function departamentosDe(prospectos: Prospecto[]): string[] {
  return distintos(prospectos.map((prospecto) => prospecto.departamento));
}
```

- [ ] **Paso 4: verla pasar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/prospects.test.ts`
Expected: PASS — `✓ src/lib/prospects.test.ts (44 tests)`.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 9 passed (9)` y `Tests 164 passed (164)`.

Run: `cd apps/laboratorios-ambientales && npm run build`
Expected: solo la cabecera del script (`> laboratorios-ambientales@0.0.0 build` / `> tsc -b`), sin errores: las pruebas también compilan.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/lib/prospects.ts apps/laboratorios-ambientales/src/lib/prospects.test.ts
git commit -F - <<'EOF'
feat(laboratorios): orden y filtros de los prospectos

Orden por vigencia más próxima, sin fecha al final y desempate por
nombre. Filtro por pestaña, departamento y búsqueda por nombre o NIT sin
mayúsculas ni tildes (el NIT también sin puntos ni guion). Las opciones
de departamento salen de todos los laboratorios.
EOF
```

---

## Tarea 7: la dependencia `xlsx` (SheetJS 0.20.3)

**Files:**
- Modify: `apps/laboratorios-ambientales/package.json:11-14`
- Modify: `package-lock.json:374-379` (bloque `"apps/laboratorios-ambientales"`; lo escribe `npm install`)

SheetJS 0.20.3 ya está en el `node_modules` de la raíz (lo usan ausencias, calibraciones, customer-valuation y hub-api, con el mismo tarball): `npm install` no descarga nada nuevo, solo apunta la dependencia en el lockfile. El `Dockerfile` copia este `package.json` antes de `npm ci` (línea 11), y `npm ci` falla si el lockfile no cuadra: por eso los dos van en el mismo commit.

- [ ] **Paso 1: añadir la dependencia.** En `apps/laboratorios-ambientales/package.json`, sustituir:

```json
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
```

por:

```json
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  },
```

- [ ] **Paso 2: actualizar el lockfile desde la raíz.**

Run: `npm install` (desde la raíz del repo, no desde la app)
Expected: termina con `up to date, audited … packages` (o `added 0 packages`) y sin errores. Un aviso `LF will be replaced by CRLF` de git más tarde es inofensivo.

- [ ] **Paso 3: comprobar que el lockfile solo cambia lo suyo.**

Run: `git diff --stat -- package-lock.json apps/laboratorios-ambientales/package.json`
Expected:

```
 apps/laboratorios-ambientales/package.json | 3 ++-
 package-lock.json                          | 3 ++-
 2 files changed, 4 insertions(+), 2 deletions(-)
```

Run: `git diff -- package-lock.json`
Expected: un solo tramo, dentro de `"apps/laboratorios-ambientales": {`: la coma tras `"react-dom": "^19.2.0"` y la línea `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`. **Si el diff toca algo más, no sigas:** deshaz solo lo que escribió npm con `git checkout -- package-lock.json` y avisa al orquestador.

Run: `npm ls xlsx --workspace=apps/laboratorios-ambientales`
Expected (formato comprobado con `apps/ausencias`):

```
ambientalia-suite@1.0.0 C:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07
`-- laboratorios-ambientales@0.0.0 -> .\apps\laboratorios-ambientales
  `-- xlsx@0.20.3
```

- [ ] **Paso 4: nada se rompe.**

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 9 passed (9)` y `Tests 164 passed (164)`.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/package.json package-lock.json
git commit -F - <<'EOF'
chore(laboratorios): SheetJS 0.20.3 para exportar los prospectos a Excel

El mismo tarball de cdn.sheetjs.com que ya usan las demás apps. El
lockfile va en el mismo commit porque npm ci del Dockerfile falla si no
cuadra con el package.json.
EOF
```

---

## Tarea 8: `exportProspects.ts` — las filas y el nombre del Excel

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/exportProspects.ts`
- Test: `apps/laboratorios-ambientales/src/lib/exportProspects.test.ts`

La prueba de la celda de texto importa SheetJS (Tarea 7): comprueba que las filas que da `filasExcel`, pasadas por `aoa_to_sheet` como hace la vista, no producen fórmulas.

- [ ] **Paso 1: escribir la prueba que falla.** Crea `apps/laboratorios-ambientales/src/lib/exportProspects.test.ts` con:

```typescript
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { Prospecto } from './prospects';
import { COLUMNAS_EXCEL, HOJA_EXCEL, filasExcel, nombreDeFichero } from './exportProspects';

// Hoy + 6 meses = 2027-05-26.
const HOY = '2026-11-26';

// Datos ficticios: el repo es público.
const prospecto = (over: Partial<Prospecto> = {}): Prospecto => ({
  codigo: '101',
  nombre: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
  nit: '900.000.001-1',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  contacto: 'Contacto Ficticio Uno',
  telefono: '6040000001',
  correo: 'lab.andino@example.com',
  matrices: ['Agua', 'Suelo'],
  metodos: ['SM 5520 B', 'SM 5520 C'],
  grupo: 'infrarrojo',
  vigenciaMasProxima: '2027-04-21',
  ...over,
});

describe('filasExcel', () => {
  it('la primera fila es la cabecera, con las trece columnas en su orden', () => {
    expect(filasExcel([], HOY)).toEqual([
      [
        'Laboratorio',
        'NIT',
        'Código',
        'Ciudad',
        'Departamento',
        'Grupo',
        'Matrices',
        'Métodos',
        'Vigencia más próxima',
        'Estado de la vigencia',
        'Contacto',
        'Teléfono',
        'Correo',
      ],
    ]);
  });

  it('una fila por laboratorio, con matrices y métodos separados por «; »', () => {
    expect(filasExcel([prospecto()], HOY)[1]).toEqual([
      'LABORATORIO ANDINO DE AGUAS S.A.S.',
      '900.000.001-1',
      '101',
      'Medellín',
      'Antioquia',
      'Usan infrarrojo',
      'Agua; Suelo',
      'SM 5520 B; SM 5520 C',
      '2027-04-21',
      'Vence en menos de 6 meses',
      'Contacto Ficticio Uno',
      '6040000001',
      'lab.andino@example.com',
    ]);
  });

  it('sin fecha, la vigencia va vacía y el estado dice «Sin fecha»', () => {
    const fila = filasExcel([prospecto({ grupo: 'gravimetria', vigenciaMasProxima: null })], HOY)[1];
    expect(fila[5]).toBe('Solo gravimetría');
    expect(fila[8]).toBe('');
    expect(fila[9]).toBe('Sin fecha');
  });

  it('respeta el orden recibido, que es el de la pantalla', () => {
    const filas = filasExcel([prospecto({ nombre: 'Zeta' }), prospecto({ nombre: 'Alfa' })], HOY);
    expect(filas.slice(1).map((fila) => fila[0])).toEqual(['Zeta', 'Alfa']);
  });

  it('cada fila tiene una celda por columna', () => {
    for (const fila of filasExcel([prospecto(), prospecto({ vigenciaMasProxima: null })], HOY)) {
      expect(fila).toHaveLength(COLUMNAS_EXCEL.length);
    }
  });

  it('en la hoja, un texto que empieza por «=» es una celda de texto y no una fórmula', () => {
    const hoja = XLSX.utils.aoa_to_sheet(filasExcel([prospecto({ nombre: '=HYPERLINK("x")' })], HOY));
    const celda = hoja['A2'] as XLSX.CellObject;
    expect(celda.t).toBe('s');
    expect(celda.f).toBeUndefined();
    expect(celda.v).toBe('=HYPERLINK("x")');
  });

  it('la hoja se llama «Prospectos»', () => {
    expect(HOJA_EXCEL).toBe('Prospectos');
  });
});

describe('nombreDeFichero', () => {
  it('lleva el grupo y la fecha', () => {
    expect(nombreDeFichero('infrarrojo', HOY)).toBe('prospectos-grasas-aceites-infrarrojo-2026-11-26.xlsx');
    expect(nombreDeFichero('gravimetria', HOY)).toBe('prospectos-grasas-aceites-gravimetria-2026-11-26.xlsx');
  });
});
```

- [ ] **Paso 2: verla fallar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/exportProspects.test.ts`
Expected: FAIL — `Error: Failed to load url ./exportProspects (resolved id: ./exportProspects) in …/src/lib/exportProspects.test.ts. Does the file exist?`

- [ ] **Paso 3: el código mínimo.** Crea `apps/laboratorios-ambientales/src/lib/exportProspects.ts` con:

```typescript
import type { GrupoProspecto, Prospecto } from './prospects';
import { ETIQUETA_GRUPO, ETIQUETA_VIGENCIA, estadoVigencia } from './prospects';

// La única hoja del libro.
export const HOJA_EXCEL = 'Prospectos';

// Las columnas del Excel, en su orden.
export const COLUMNAS_EXCEL = [
  'Laboratorio',
  'NIT',
  'Código',
  'Ciudad',
  'Departamento',
  'Grupo',
  'Matrices',
  'Métodos',
  'Vigencia más próxima',
  'Estado de la vigencia',
  'Contacto',
  'Teléfono',
  'Correo',
] as const;

const SEPARADOR = '; ';

// La cabecera y una fila por laboratorio, en el orden recibido, que es el de la
// pantalla. Todo es texto, y aoa_to_sheet escribe un texto como celda de texto:
// un nombre que empiece por «=» nunca sale como fórmula, y un NIT o un teléfono
// no pierden ceros ni se vuelven números.
export function filasExcel(prospectos: Prospecto[], hoy: string): string[][] {
  return [
    [...COLUMNAS_EXCEL],
    ...prospectos.map((prospecto) => [
      prospecto.nombre,
      prospecto.nit,
      prospecto.codigo,
      prospecto.ciudad,
      prospecto.departamento,
      ETIQUETA_GRUPO[prospecto.grupo],
      prospecto.matrices.join(SEPARADOR),
      prospecto.metodos.join(SEPARADOR),
      prospecto.vigenciaMasProxima ?? '',
      ETIQUETA_VIGENCIA[estadoVigencia(prospecto.vigenciaMasProxima, hoy)],
      prospecto.contacto,
      prospecto.telefono,
      prospecto.correo,
    ]),
  ];
}

export function nombreDeFichero(grupo: GrupoProspecto, hoy: string): string {
  return `prospectos-grasas-aceites-${grupo}-${hoy}.xlsx`;
}
```

- [ ] **Paso 4: verla pasar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/exportProspects.test.ts`
Expected: PASS — `✓ src/lib/exportProspects.test.ts (8 tests)`.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 10 passed (10)` y `Tests 172 passed (172)`.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/lib/exportProspects.ts apps/laboratorios-ambientales/src/lib/exportProspects.test.ts
git commit -F - <<'EOF'
feat(laboratorios): filas y nombre del Excel de prospectos

Una hoja «Prospectos» con trece columnas en su orden, matrices y métodos
separados por «; » y todo como texto: nada sale como fórmula y el NIT o
el teléfono no pierden ceros. El fichero lleva el grupo y la fecha. Lleva
los datos de contacto, como se aprobó (Ley 1581 de 2012).
EOF
```

---

## Tarea 9: `view.ts` — la vista se enlaza como `#prospectos`

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/view.ts:1-12`
- Test: `apps/laboratorios-ambientales/src/lib/view.test.ts:7` y `:23`

- [ ] **Paso 1: escribir la prueba que falla** — dos Edit.

(a) En `apps/laboratorios-ambientales/src/lib/view.test.ts`, sustituir:

```typescript
    expect(parseView('#marcas')).toBe('dashboard');
  });
```

por:

```typescript
    expect(parseView('#marcas')).toBe('dashboard');
    expect(parseView('#prospectos')).toBe('prospectos');
  });
```

(b) En el mismo fichero, sustituir:

```typescript
    for (const view of ['main', 'buscador', 'dashboard'] as const) {
```

por:

```typescript
    for (const view of ['main', 'buscador', 'dashboard', 'prospectos'] as const) {
```

- [ ] **Paso 2: verla fallar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/view.test.ts`
Expected: FAIL — `Failed Tests 2`: «reconoce cada vista por su hash» y «es el inverso de parseView», las dos con `expected 'main' to be 'prospectos'`.

- [ ] **Paso 3: el código mínimo.** En `apps/laboratorios-ambientales/src/lib/view.ts`, sustituir:

```typescript
// Cada vista vive en el hash de la URL (#buscador, #marcas) para poder enlazarla
// y para que el botón «atrás» del navegador funcione. Hash y no subrutas: la app
// no depende de react-router y arranca también suelta en `vite dev`, igual que
// hace Ausencias con su #bandeja.
export type View = 'main' | 'buscador' | 'dashboard';

// 'dashboard' se publica como #marcas: es el nombre que ve el usuario
// («Análisis de Marcas») y el que tendrá el enlace que comparta.
const HASHES: Record<Exclude<View, 'main'>, string> = {
  buscador: 'buscador',
  dashboard: 'marcas',
};
```

por:

```typescript
// Cada vista vive en el hash de la URL (#buscador, #marcas, #prospectos) para
// poder enlazarla y para que el botón «atrás» del navegador funcione. Hash y no
// subrutas: la app no depende de react-router y arranca también suelta en
// `vite dev`, igual que hace Ausencias con su #bandeja.
export type View = 'main' | 'buscador' | 'dashboard' | 'prospectos';

// 'dashboard' se publica como #marcas: es el nombre que ve el usuario
// («Análisis de Marcas») y el que tendrá el enlace que comparta.
const HASHES: Record<Exclude<View, 'main'>, string> = {
  buscador: 'buscador',
  dashboard: 'marcas',
  prospectos: 'prospectos',
};
```

- [ ] **Paso 4: verla pasar.**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/view.test.ts`
Expected: PASS — `✓ src/lib/view.test.ts (5 tests)`.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 10 passed (10)` y `Tests 172 passed (172)` (las dos aserciones nuevas van dentro de pruebas que ya existían).

Run: `cd apps/laboratorios-ambientales && npm run build`
Expected: sin errores. `App.tsx` aún no trata `'prospectos'`: un `#prospectos` abre el menú hasta la Tarea 11, y TypeScript no se queja porque esa rama cae en el `return` del menú.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/lib/view.ts apps/laboratorios-ambientales/src/lib/view.test.ts
git commit -F - <<'EOF'
feat(laboratorios): la vista de prospectos se enlaza como #prospectos
EOF
```

---

## Tarea 10: `Prospectos.tsx` — la vista

**Files:**
- Create: `apps/laboratorios-ambientales/src/pages/Prospectos.tsx`

Sin pruebas unitarias (no hay jsdom): se comprueba con lint, build y el `tsc -b` del portal. Reutiliza las clases de Buscador y Dashboard (botón de volver, tarjeta blanca de filtros, `SELECT_CLASS`, recuadro de ámbito, tabla dentro de `overflow-x-auto`, estado vacío). Cumple la accesibilidad mínima del diseño: `scope="col"` en las cabeceras, `aria-live="polite"` en el recuento, pestañas como botones con `aria-pressed` y el emoji con `aria-hidden`. Solo exporta el componente por defecto (la regla `react-refresh/only-export-components` lo pide).

- [ ] **Paso 1: escribir el componente.** Crea `apps/laboratorios-ambientales/src/pages/Prospectos.tsx` con:

```tsx
import { useMemo, useState } from 'react';
import type { Laboratorio } from '../types';
import type { EstadoVigencia, GrupoProspecto } from '../lib/prospects';
import {
  ETIQUETA_GRUPO,
  ETIQUETA_VIGENCIA,
  GRUPOS,
  departamentosDe,
  estadoVigencia,
  filterProspects,
  groupProspects,
  sortProspects,
} from '../lib/prospects';
import { HOJA_EXCEL, filasExcel, nombreDeFichero } from '../lib/exportProspects';
import { hoyLocal } from '../lib/fechas';

type Props = {
  data: Laboratorio[];
  onBack: () => void;
};

const SELECT_CLASS =
  'w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

const INSIGNIA_VIGENCIA: Record<EstadoVigencia, string> = {
  vencida: 'bg-red-100 text-red-800',
  pronto: 'bg-amber-100 text-amber-800',
  vigente: 'bg-emerald-100 text-emerald-800',
  'sin-fecha': 'bg-slate-100 text-slate-600',
};

export default function Prospectos({ data, onBack }: Props) {
  // El estado es local: al volver al menú se pierde. Si hiciera falta
  // conservarlo, se subiría a App, como los filtros del Buscador.
  const [grupo, setGrupo] = useState<GrupoProspecto>('infrarrojo');
  const [departamento, setDepartamento] = useState('');
  const [busqueda, setBusqueda] = useState('');
  // «Hoy» se fija al abrir la vista: las insignias y el Excel usan el mismo día.
  const [hoy] = useState(hoyLocal);
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState('');

  // Agrupar recorre los ~19 000 registros: solo se rehace si cambian los datos.
  const todos = useMemo(() => groupProspects(data), [data]);
  // Las opciones salen de todos los laboratorios y no de la pestaña abierta: así
  // el departamento elegido no desaparece de la lista al cambiar de pestaña.
  const departamentos = useMemo(() => departamentosDe(todos), [todos]);

  // El número de cada pestaña cuenta su grupo con el departamento y la búsqueda aplicados.
  const recuentos = useMemo<Record<GrupoProspecto, number>>(
    () => ({
      infrarrojo: filterProspects(todos, { grupo: 'infrarrojo', departamento, busqueda }).length,
      gravimetria: filterProspects(todos, { grupo: 'gravimetria', departamento, busqueda }).length,
    }),
    [todos, departamento, busqueda],
  );

  const visibles = useMemo(
    () => sortProspects(filterProspects(todos, { grupo, departamento, busqueda })),
    [todos, grupo, departamento, busqueda],
  );

  // SheetJS pesa unos 430 KB: se descarga al pulsar y no con la app. Si falla la
  // descarga del trozo o la escritura del libro, se avisa junto al botón y la
  // vista sigue funcionando.
  const exportar = async () => {
    setExportando(true);
    setErrorExportar('');
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasExcel(visibles, hoy)), HOJA_EXCEL);
      XLSX.writeFile(libro, nombreDeFichero(grupo, hoy));
    } catch {
      setErrorExportar('No se pudo generar el Excel. Vuelve a intentarlo.');
    } finally {
      setExportando(false);
    }
  };

  const limpiarFiltros = () => {
    setDepartamento('');
    setBusqueda('');
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <button
        onClick={onBack}
        className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors"
      >
        &larr; Volver al Menú Principal
      </button>

      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Prospectos de grasas y aceites</h1>
        <p className="mt-2 text-lg text-gray-600">
          Laboratorios con una acreditación activa en grasas y aceites, según usen o no un método por infrarrojo.
        </p>
      </div>

      {/* Sin este aviso, «Usan infrarrojo» se leería como «tienen un OCMA». */}
      <div className="bg-amber-50 ring-1 ring-amber-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-semibold text-amber-900 mb-1">Qué dice y qué no dice esta vista</p>
        <p className="text-xs text-amber-800">
          El grupo sale de la técnica o del método acreditado (infrarrojo: SM 5520 C, NTC 3362 C). El dataset no
          identifica el equipo: no dice quién tiene un OCMA ni de qué marca es su equipo de infrarrojo.
        </p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-md mb-8 ring-1 ring-slate-200">
        <div role="group" aria-label="Grupo de laboratorios" className="flex flex-wrap gap-2 mb-4">
          {GRUPOS.map((opcion) => (
            <button
              key={opcion}
              type="button"
              aria-pressed={grupo === opcion}
              onClick={() => setGrupo(opcion)}
              className={`px-4 py-2 font-semibold rounded-lg transition-colors ${
                grupo === opcion ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {ETIQUETA_GRUPO[opcion]} ({recuentos[opcion].toLocaleString('es-CO')})
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label htmlFor="busqueda-prospectos" className="block text-sm font-semibold text-gray-700 mb-1">
              Buscar por nombre o NIT
            </label>
            <input
              id="busqueda-prospectos"
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Ej: nombre del laboratorio o 900123456"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div>
            <label htmlFor="departamento-prospectos" className="block text-sm font-semibold text-gray-700 mb-1">
              Departamento
            </label>
            <select
              id="departamento-prospectos"
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              {departamentos.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {errorExportar !== '' && (
            <p role="alert" className="text-sm text-red-700">
              {errorExportar}
            </p>
          )}
          <button
            onClick={limpiarFiltros}
            className="px-6 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors"
          >
            Limpiar Filtros
          </button>
          <button
            type="button"
            onClick={() => void exportar()}
            disabled={exportando || visibles.length === 0}
            className="px-6 py-2 bg-emerald-700 text-white font-semibold rounded-lg shadow-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {exportando ? 'Exportando...' : 'Exportar a Excel'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2 mb-6">
        <h3 className="text-xl font-bold text-gray-800">{ETIQUETA_GRUPO[grupo]}</h3>
        <p className="text-sm text-gray-500" aria-live="polite">
          {visibles.length.toLocaleString('es-CO')} {visibles.length === 1 ? 'laboratorio' : 'laboratorios'}
        </p>
      </div>

      {visibles.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-slate-300" aria-hidden="true">
              🔍
            </span>
          </div>
          <p className="text-lg font-bold text-slate-400">Ningún laboratorio con estos filtros</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
          {/* Son 90 laboratorios como mucho: sin paginar. En móvil, que haga scroll la tabla y no la página. */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Laboratorio
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Ciudad
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Departamento
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Matrices
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Métodos
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Vigencia más próxima
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Contacto
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((prospecto) => {
                  const estado = estadoVigencia(prospecto.vigenciaMasProxima, hoy);
                  return (
                    <tr
                      key={`${prospecto.codigo}|${prospecto.nombre}`}
                      className="border-t border-slate-100 align-top hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800">{prospecto.nombre || 'Sin nombre'}</p>
                        <p className="text-xs text-slate-500">
                          NIT {prospecto.nit || '—'} &middot; Código {prospecto.codigo || '—'}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{prospecto.ciudad || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{prospecto.departamento || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{prospecto.matrices.join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {prospecto.metodos.length === 0
                          ? '—'
                          : prospecto.metodos.map((metodo) => (
                              <p key={metodo} className="whitespace-nowrap">
                                {metodo}
                              </p>
                            ))}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <p className="text-slate-700">{prospecto.vigenciaMasProxima ?? '—'}</p>
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${INSIGNIA_VIGENCIA[estado]}`}
                        >
                          {ETIQUETA_VIGENCIA[estado]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                        {prospecto.contacto && <p className="font-medium text-slate-700">{prospecto.contacto}</p>}
                        {prospecto.telefono && <p>{prospecto.telefono}</p>}
                        {prospecto.correo && <p className="break-words">{prospecto.correo}</p>}
                        {!prospecto.contacto && !prospecto.telefono && !prospecto.correo && '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Paso 2: lint.**

Run: `cd apps/laboratorios-ambientales && npm run lint`
Expected: solo la cabecera del script (`> laboratorios-ambientales@0.0.0 lint` / `> eslint .`), sin avisos ni errores.

- [ ] **Paso 3: build (typecheck).**

Run: `cd apps/laboratorios-ambientales && npm run build`
Expected: solo la cabecera del script (`> laboratorios-ambientales@0.0.0 build` / `> tsc -b`), sin errores. Aquí se comprueban `import('xlsx')`, los tipos de SheetJS y los nombres importados de `prospects.ts`, `exportProspects.ts` y `fechas.ts`.

- [ ] **Paso 4: el portal sigue compilando.**

Run: `cd apps/portal && npx tsc -b`
Expected: sin salida y código 0 (unos 25 s). La vista aún no la importa nadie: la comprobación de verdad del portal es la de la Tarea 11.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 10 passed (10)` y `Tests 172 passed (172)`.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/pages/Prospectos.tsx
git commit -F - <<'EOF'
feat(laboratorios): vista de prospectos de grasas y aceites

Pestañas «Usan infrarrojo» y «Solo gravimetría» con su recuento,
departamento, búsqueda por nombre o NIT, tabla ordenada por vigencia con
su insignia y exportación a Excel de lo que se ve. SheetJS se carga al
pulsar; si falla, el aviso sale junto al botón.
EOF
```

---

## Tarea 11: `App.tsx` — la tarjeta del menú y la vista

**Files:**
- Modify: `apps/laboratorios-ambientales/src/App.tsx:8` (import), `:98-104` (rama de la vista) y `:153-159` (tarjeta del menú)

Sin pruebas unitarias: lint, build y el `tsc -b` del portal, que es quien empaqueta esta app.

- [ ] **Paso 1: el import.** En `apps/laboratorios-ambientales/src/App.tsx`, sustituir:

```tsx
import Dashboard from './pages/Dashboard';
```

por:

```tsx
import Dashboard from './pages/Dashboard';
import Prospectos from './pages/Prospectos';
```

- [ ] **Paso 2: la rama de la vista.** En el mismo fichero, sustituir:

```tsx
        <Dashboard data={data} onBack={() => navegar('main')} />
      </div>
    );
  }
```

por:

```tsx
        <Dashboard data={data} onBack={() => navegar('main')} />
      </div>
    );
  }

  if (view === 'prospectos' && listos) {
    return (
      <div className="w-full flex-grow bg-[#F7F8FA]" style={{ minHeight: '100vh' }}>
        <Prospectos data={data} onBack={() => navegar('main')} />
      </div>
    );
  }
```

- [ ] **Paso 3: la tarjeta del menú.** En el mismo fichero, sustituir:

```tsx
                  Análisis de Marcas
                </a>
```

por:

```tsx
                  Análisis de Marcas
                </a>
                <a
                  href={hashFor('prospectos')}
                  onClick={(e) => abrirVista(e, 'prospectos')}
                  className="px-8 py-4 bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded-lg shadow-md text-lg transition-colors"
                >
                  Prospectos de grasas y aceites
                </a>
```

- [ ] **Paso 4: lint, build y portal.**

Run: `cd apps/laboratorios-ambientales && npm run lint`
Expected: solo la cabecera del script, sin avisos ni errores.

Run: `cd apps/laboratorios-ambientales && npm run build`
Expected: solo la cabecera del script, sin errores.

Run: `cd apps/portal && npx tsc -b`
Expected: sin salida y código 0. El portal importa `apps/laboratorios-ambientales/src/App.tsx`, así que ahora compila también `Prospectos.tsx` y resuelve `xlsx` desde el `node_modules` de la raíz.

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 10 passed (10)` y `Tests 172 passed (172)`.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/src/App.tsx
git commit -F - <<'EOF'
feat(laboratorios): la vista de prospectos en el menú

Una tarjeta más junto al Buscador y el Análisis de Marcas, enlazada como
#prospectos. Como las otras vistas, espera a que lleguen los datos.
EOF
```

---

## Tarea 12: README y verificación final

**Files:**
- Modify: `apps/laboratorios-ambientales/README.md:36-37` (tabla de estructura) y `:123-125` (sección nueva delante de «Mejoras pendientes» y una mejora pendiente)

- [ ] **Paso 1: la tabla de estructura.** En `apps/laboratorios-ambientales/README.md`, sustituir:

```markdown
| `src/lib/brands.ts` | Agrupación laboratorio→equipos del Análisis de Marcas. |
| `src/pages/` | Vistas: `Buscador` y `Dashboard` (Análisis de Marcas). |
```

por:

```markdown
| `src/lib/brands.ts` | Agrupación laboratorio→equipos del Análisis de Marcas. |
| `src/lib/prospects.ts` | Prospectos de grasas y aceites: qué acreditación cuenta, infrarrojo o gravimetría, agrupación por laboratorio, vigencia, orden y filtros. |
| `src/lib/exportProspects.ts` | Filas y nombre de fichero del Excel de prospectos. |
| `src/lib/fechas.ts` | Fecha local de hoy y suma de meses de calendario. |
| `src/lib/view.ts` | La vista abierta, en el hash de la URL (`#buscador`, `#marcas`, `#prospectos`). |
| `src/pages/` | Vistas: `Buscador`, `Dashboard` (Análisis de Marcas) y `Prospectos`. |
```

- [ ] **Paso 2: la sección de la vista.** En el mismo fichero, sustituir:

```markdown
## Mejoras pendientes

- El cache completo (~3 MB) va a `localStorage`, que comparte los ~5 MB del
```

por:

```markdown
## Prospectos de grasas y aceites

Vista `#prospectos`, para el estudio de mercado del Horiba OCMA-500 (cifras del
2026-11-26: 90 laboratorios, 85 NIT). Lista los laboratorios, por código de
laboratorio, con una acreditación **Activa** cuya variable contiene «grasa» y
«aceite» (sin tildes ni mayúsculas, en cualquier matriz), y los separa en dos
pestañas:

| Pestaña | Regla |
|---|---|
| Usan infrarrojo (26) | Alguna acreditación tiene una técnica con «fotometr» o «infrarroj»; o, si la técnica no informa nada (vacía, «---», «No Aplica»), un método `5520 C`, `NTC 3362 C` o `D7066`. |
| Solo gravimetría (64) | El resto. Hoy todos son gravimétricos (SM 5520 B y D, EPA 9071 B); si apareciera otra técnica, caería aquí y se vería en la columna de métodos. |

- **El dataset no identifica el equipo.** En grasas y aceites,
  `identificaci_n_de_equipo` vale siempre «No Aplica» y ningún método nombra
  OCMA ni Horiba: la vista no sabe quién tiene un OCMA. Eso lo dirían Zoho o
  Desk 2.0, que quedan fuera.
- **Vigencia más próxima:** la fecha `hasta` más temprana de sus acreditaciones
  de grasas y aceites («---» no cuenta). «Vence en menos de 6 meses» va de hoy a
  hoy + 6 meses de calendario, con el límite fuera; si ese día no existe, el
  límite es el último del mes (31 de agosto → 28 de febrero, o 29 en bisiesto).
- **Orden:** de la vigencia más cercana a la más lejana, los sin fecha al final;
  a igual fecha, por nombre.
- **Filtros:** departamento y búsqueda por nombre o NIT, sin mayúsculas ni
  tildes; el NIT también se encuentra sin puntos ni guion. El estado de la
  vista es local: se pierde al volver al menú.
- **Exportar a Excel** descarga lo que se ve (pestaña, filtros y orden) en
  `prospectos-grasas-aceites-<infrarrojo|gravimetria>-<AAAA-MM-DD>.xlsx`, con una
  hoja «Prospectos». SheetJS se carga al pulsar. Todas las celdas son texto.
  **El Excel lleva los datos de contacto**, que son datos personales (Ley 1581
  de 2012): se aprobó así.
- **En el Buscador,** «Aceites y Grasas» y «Grasas y Aceites» son una sola
  casilla: `variableKey` lleva un sinónimo explícito, solo para ese par.

## Mejoras pendientes

- Cruzar los prospectos con Zoho por NIT (cliente o no, si se le vendió un
  OCMA). La tabla admite una columna «Cliente» más sin rehacerse.
- El cache completo (~3 MB) va a `localStorage`, que comparte los ~5 MB del
```

- [ ] **Paso 3: releer el README.** Lee con Read `apps/laboratorios-ambientales/README.md` desde la línea 27 hasta el final de «Mejoras pendientes» y comprueba que las dos tablas se ven enteras (cabecera, separador y filas), que la sección nueva queda entre «Notas sobre los datos» y «Mejoras pendientes» y que no quedó ningún tramo duplicado.

- [ ] **Paso 4: verificación completa.**

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: `Test Files 10 passed (10)` y `Tests 172 passed (172)` (108 de partida + 7 de `fechas` + 5 de `filters` + 44 de `prospects` + 8 de `exportProspects`).

Run: `cd apps/laboratorios-ambientales && npm run lint`
Expected: solo la cabecera del script, sin avisos ni errores.

Run: `cd apps/laboratorios-ambientales && npm run build`
Expected: solo la cabecera del script, sin errores.

Run: `cd apps/portal && npx tsc -b`
Expected: sin salida y código 0.

Run: `git status --short`
Expected: solo `M apps/laboratorios-ambientales/README.md` además de lo que ya estaba al empezar y no es de este trabajo (`M .gitignore`, `?? .atl/`, `?? apps/WO-sales/prompts/`, `?? img/`, `?? openspec/`) y, si el orquestador aún no lo ha commiteado, este plan (`?? docs/superpowers/plans/2026-11-26-prospectos-grasas-aceites.md`). Nada más: ni `package-lock.json` ni ficheros de `src/` sin commitear.

- [ ] **Paso 5: commit.**

```bash
git add apps/laboratorios-ambientales/README.md
git commit -F - <<'EOF'
docs(laboratorios): la vista de prospectos de grasas y aceites en el README

Estructura con prospects, exportProspects, fechas y view; las reglas de
la vista, lo que el dataset no dice (el equipo), la exportación con datos
de contacto y el sinónimo del Buscador. El cruce con Zoho queda en
mejoras pendientes.
EOF
```

- [ ] **Paso 6: prueba en el navegador (quien tenga uno; no bloquea los commits).** Desde la raíz, `npm run dev` y abrir `/laboratorios-ambientales#prospectos` con sesión iniciada. Comprobar: la tarjeta «Prospectos de grasas y aceites» del menú abre la vista; la pestaña «Usan infrarrojo» sale marcada y las dos muestran su recuento (con los datos del 2026-11-26, 26 y 64 sin filtros); el departamento y la búsqueda («quimico» sin tilde, un NIT sin puntos) cambian la tabla y los dos recuentos; un filtro sin resultados enseña «Ningún laboratorio con estos filtros» y desactiva «Exportar a Excel»; «Exportar a Excel» descarga `prospectos-grasas-aceites-infrarrojo-<hoy>.xlsx` con una hoja «Prospectos» y las trece columnas; «atrás» del navegador vuelve al menú. En el Buscador, «Aceites y Grasas» sale una sola vez en las variables y al marcarla aparecen también las filas «Grasas y Aceites».

---

## Self-review

Hecho sobre el plan terminado, contra el diseño. Antes de escribirlo, todo el código de las Tareas 1-11 se aplicó en una copia de la app fuera del repo (con el `node_modules` de la raíz) y se comprobó etapa a etapa: las pruebas fallan como dice cada paso 2 y pasan como dice cada paso 4 (172 al final), y `tsc -b` y `eslint .` salen limpios en cada etapa, también en las intermedias (Tareas 3, 4, 5 y 6 sin los ficheros de las tareas siguientes).

### (a) Cada requisito del diseño, en su tarea

| Requisito del diseño | Tarea |
|---|---|
| Vista «Prospectos de grasas y aceites» | 10, 11 |
| Acreditación de grasas y aceites: `Activa`, «grasa» y «aceite» en minúsculas, sin tildes, espacios colapsados, cualquier matriz | 3 |
| Infrarrojo por técnica («fotometr», «infrarroj»); si no informa (vacía, «---», «no aplica»), por método (`5520 C`, `NTC 3362` + C con o sin «Método(s)», `D7066`); si no, no infrarrojo | 3 |
| Agrupar por `codigo`; vacío, por `nombreLaboratorio`; un NIT con dos códigos son dos | 4 |
| Ficha: primer valor no vacío de cada campo, en el orden del dataset | 4 |
| Matrices y métodos distintos con `localeCompare(…, 'es')` | 4 |
| Grupo: infrarrojo si alguna lo es; si no, gravimetría; pestaña «Solo gravimetría» | 3 (etiqueta), 4 |
| Vigencia más próxima (AAAA-MM-DD o `null`) | 4 |
| `estadoVigencia` con `hoy` como argumento, los cuatro estados, los dos bordes y + 6 meses de calendario al fin de mes | 1, 5 |
| Orden: fechas ascendentes, `sin-fecha` al final, desempate por nombre | 6 |
| Pestañas, la primera por defecto | 3 (`GRUPOS`), 10 |
| Departamento «Todos» por defecto con opciones de los 90 laboratorios | 6 (`departamentosDe`), 10 |
| Búsqueda por nombre o NIT sin mayúsculas ni tildes | 6 |
| Recuento de cada pestaña con departamento y búsqueda aplicados | 10 |
| «Ningún laboratorio con estos filtros» | 10 |
| Excel con lo que se ve (pestaña, filtros, orden) | 10 (pasa `visibles`), 8 (respeta el orden) |
| Hoja «Prospectos», nombre del fichero, las trece columnas, «; » y los datos de contacto | 8 |
| Buscador: sinónimo explícito solo para ese par; la casilla muestra la grafía más frecuente | 2 |
| `prospects.ts` con `esGrasasYAceites`, `esInfrarrojo`, `groupProspects`, `estadoVigencia`, `filterProspects`, `sortProspects` y `Prospecto` | 3-6 |
| `exportProspects.ts` con `filasExcel` y `nombreDeFichero` | 8 (firma de `filasExcel`: D1) |
| `view.ts` con `#prospectos` | 9 |
| `App.tsx`: tarjeta del menú y vista | 11 |
| `package.json` con el tarball de SheetJS 0.20.3 (y su lockfile) | 7 |
| `import('xlsx')` al pulsar «Exportar» | 10 |
| Estado local de `Prospectos.tsx` | 10 |
| Sin paginar, dentro de `overflow-x-auto` | 10 |
| `scope="col"`, `aria-live="polite"`, `aria-pressed`, emoji con `aria-hidden` | 10 |
| Aviso junto al botón si falla la exportación; la vista sigue | 10 |
| Todos los casos de la sección «Tests» del diseño | 2 (Buscador), 3 (grafías, «grasa» sin «aceite», `Suspendida`, «Fotometría», «Gravimetría», «---» con `NTC 3362 Métodos C, F` y con `SM 5520 B`), 4 (dos técnicas, NIT con dos códigos, código vacío, vigencia), 5 (estados y bordes), 6 (orden, filtros), 8 (filas y fichero) |
| `Prospectos.tsx` y `App.tsx` sin pruebas: `npm run build`, `tsc -b` del portal y navegador | 10, 11, 12 (paso 6) |
| No cambia la forma del cache ni su versión | Ninguna tarea toca `api.ts` ni `types/index.ts` |
| Fuera de alcance: columna «Cliente» preparada | `Prospecto` lleva el NIT y la tabla es una lista de columnas (D14); anotado en el README (12) |

**Huecos encontrados y arreglados al revisar:** (1) la columna «Estado de la vigencia» necesita `hoy` y la firma del diseño no lo lleva: se fijó `filasExcel(prospectos, hoy)` (D1). (2) Las opciones de departamento no tenían función: se añadió `departamentosDe`, con prueba (D5). (3) El quitador de tildes que la tarea suponía no existe: `clave()` privada (D4). (4) La prueba en el navegador que pide el diseño no tenía paso: Tarea 12, paso 6. No queda ningún requisito sin tarea.

### (b) Marcadores pendientes

Buscados en el plan «TBD», «TODO», «implement later», «fill in», «similar to», «parecido a», «como en la Tarea», «add error handling» y «manejo de errores»: ninguno. Cada paso que cambia código trae el código entero o el par exacto «sustituir … por …»; cada comando trae su salida esperada.

### (c) Nombres y firmas, iguales en todas las tareas

| Nombre | Definido en | Usado en |
|---|---|---|
| `hoyLocal(d?: Date): string` | 1 | 10 |
| `sumarMeses(fecha: string, meses: number): string` | 1 | 5 |
| `SINONIMOS_VARIABLE`, `variableKey` | 2 | 2 |
| `GrupoProspecto`, `EstadoVigencia`, `Prospecto`, `FiltrosProspectos` | 3 | 4, 5, 6, 8, 10 |
| `GRUPOS`, `ETIQUETA_GRUPO`, `MESES_DE_AVISO`, `ETIQUETA_VIGENCIA` | 3 | 5, 8, 10 |
| `clave` (privada) | 3 | 3, 6 |
| `esGrasasYAceites(registro)`, `esInfrarrojo(registro)` | 3 | 4 |
| `fechaDeHasta`, `compararTexto`, `distintos`, `aProspecto` (privadas) | 4 | 4, 6 |
| `groupProspects(data: Laboratorio[]): Prospecto[]` | 4 | 10 |
| `estadoVigencia(fecha: string \| null, hoy: string): EstadoVigencia` | 5 | 8, 10 |
| `sortProspects(prospectos): Prospecto[]`, `filterProspects(prospectos, filtros: FiltrosProspectos): Prospecto[]`, `departamentosDe(prospectos): string[]` | 6 | 10 |
| `HOJA_EXCEL`, `COLUMNAS_EXCEL`, `filasExcel(prospectos, hoy): string[][]`, `nombreDeFichero(grupo, hoy): string` | 8 | 10 |
| `View` con `'prospectos'`, `hashFor`, `parseView` | 9 | 11 |
| `Prospectos` (default de `pages/Prospectos.tsx`, props `data` y `onBack`) | 10 | 11 |

Los imports de cada `.test.ts` traen solo lo que usa esa etapa (si no, `tsc -b` fallaría por `noUnusedLocals`), y los anclajes de los «sustituir» de las Tareas 4-6 son el final del bloque que dejó la tarea anterior, con su texto exacto.
