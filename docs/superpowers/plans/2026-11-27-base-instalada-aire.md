# Base instalada de aire — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** añadir a la app de Laboratorios ambientales la vista «Base instalada de aire»: una fila por equipo de aire acreditado (código de laboratorio + número de serie) del dataset `2waz-acaa`, con la marca y el modelo deducidos del código EPA, la columna «Cliente» del cruce con Zoho, filtros y Excel.

**Architecture:** todo va en `apps/laboratorios-ambientales`; hub-api no cambia. `mapRecord` conserva la estación y la serie, y el cache pasa a v3. La lógica vive en funciones puras con pruebas: `lib/baseInstalada.ts` (qué entra, agrupado, orden, filtros, opciones y recuento), `lib/exportBaseInstalada.ts` (Excel) y la tabla `EQUIPMENT_MAP`, ampliada con la lista de la EPA. El cruce con Zoho sale de `pages/Prospectos.tsx` a `hooks/useCruceZoho.ts`, que usan las dos vistas. La página `pages/BaseInstalada.tsx` solo orquesta y pinta.

**Tech Stack:** React 19 + TypeScript 5.9 (Vite; el build es `tsc -b`), Vitest 2 en entorno `node` (sin jsdom ni React Testing Library), ESLint 9 con `react-hooks` 7 y `react-refresh`, SheetJS (`xlsx`) cargado al pulsar.

---

**Diseño aprobado:** `docs/superpowers/specs/2026-11-27-base-instalada-aire-design.md`. Léelo entero antes de empezar: es el contrato.

**Código comprobado:** todo el código de este plan se ejecutó tarea a tarea en una copia de la app antes de escribirlo. Tras cada tarea, las pruebas, `tsc -b` y `eslint .` quedaron en verde, con los recuentos que dice cada paso.

## Convenciones de ejecución (obligatorias)

- **Raíz del repo:** `C:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07` (en Git Bash: `/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07`). Todos los comandos parten de ahí. Si tu shell no conserva el directorio entre llamadas, empieza cada una con `cd /c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07 &&`.
- **Rama:** `feat/laboratorios-base-instalada-aire`. Ya existe y lleva el diseño (`10d6605`) y este plan. **Este plan no hace push ni merge**: los hace el orquestador.
- **Una tarea por subagente.** El usuario revisa cada tarea antes de la siguiente. Cada tarea deja las pruebas en verde y hace su commit.
- **La Tarea 9 solo se hace con el visto bueno del usuario.** Corrige entradas que ya están en la tabla. Ninguna otra tarea depende de ella.
- **Ficheros:** se crean y se cambian SOLO con las herramientas Write y Edit.
  - Nunca con `Set-Content`, `Out-File`, `sed`, `perl` ni redirecciones: PowerShell 5.1 destroza las tildes del fichero entero.
  - Nunca hagas sustituciones de un carácter en todo un fichero.
  - **Finales de línea:** en el índice de Git son LF; en la copia de trabajo salen CRLF porque `core.autocrlf=true`. No los conviertas: Edit casa el texto igual y Git los normaliza al commitear.
  - Cada «sustituir» de este plan cita un texto que aparece una sola vez en su fichero; se comprobó con un script. Si alguno no casa, lee ese tramo con Read y copia el texto de ahí.
- **Git:**
  - Con la herramienta **Bash (Git Bash)**, desde la raíz.
  - Mensajes con `git commit -F - <<'EOF' … EOF`: conventional commits en español, **sin línea «Co-Authored-By» ni ninguna atribución**.
  - Se añaden rutas explícitas. Nunca `git add -A` ni `git add .`; nunca `git stash`.
  - No se tocan `.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/` ni `openspec/`: son del usuario.
- **Repo público:** laboratorios, NIT, contactos, estaciones y series de las pruebas son **ficticios** (`900.000.001-7`, `@example.com`, `SN-0001`…). Nunca un dato del dataset real. Los nombres de marcas y modelos de la EPA son públicos y valen.
- **TDD estricto** en `src/lib/` y `src/services/`: prueba que falla, verla fallar, código mínimo, verla pasar, commit. El hook y las páginas no tienen pruebas (no hay jsdom): se comprueban con `eslint`, `tsc -b` de la app y del portal, y la suite.
- **Pruebas de la app:**
  - Una sola: `cd apps/laboratorios-ambientales && npx vitest run src/lib/<fichero>.test.ts`.
  - La suite: `cd apps/laboratorios-ambientales && npm test`. Punto de partida: **12 ficheros, 206 pruebas, en verde** (comprobado el 2026-11-27).
- **`tsc -b` de la app también compila las pruebas** (`noUnusedLocals`): un import que sobra en un `.test.ts` rompe el build.
- **Build del portal:** `cd apps/portal && npx tsc -b` (tarda unos 25 s). El portal monta la app y compila su Tailwind.

## Decisiones tomadas en el plan

| # | Silencio, ambigüedad o choque del diseño con el código | Opción del plan |
|---|---|---|
| 1 | El filtro «Marca» y las marcas con varios fabricantes («Tisch Environmental / New Star Environmental»): ¿la opción es el texto entero o cada fabricante? | Cada fabricante por separado (`marcasDe` parte por « / »). Un equipo pasa si alguno de sus pares lo nombra. La tabla y el Excel enseñan el texto entero. El Análisis de Marcas no cambia: sigue usando el texto entero. |
| 2 | `filtrarEquipos(equipos, filtros, cruce)` no recibe `hoy`, pero el estado del cliente lo necesita (`estadoCliente`). | Cuarto parámetro `hoy`, como `filtrarPorCliente`. |
| 3 | El dataset escribe 7 veces un código con espacios: «EQPM 0311-195», «RFPS- 0202-141», «RFPS 0498-116»… `extractEquipment` busca el código como subcadena y no los reconocería. | `normalizarCodigosEpa` los pasa a guiones antes de llamar a `extractEquipment`, solo en la base instalada. `extractEquipment` no cambia. |
| 4 | `RFNA-1289-070`: en el dataset está escrito «RFNA-1289-0704». | La expresión de `codigosEpa` no lleva `\b` al final, así que lo lee como `RFNA-1289-070`: así salen los 74 códigos del diseño. Queda sin identificar y aparece en «Códigos EPA». Hay una prueba con las dos grafías. |
| 5 | «El primer valor no vacío, como en Prospectos»: Prospectos solo recorta. | En la base instalada se usa `esValorVacio`: un «No aplica» en una fila no tapa el dato de otra. Prospectos no cambia. |
| 6 | `separarSeries` descarta «los vacíos». | Los que lo son según `esValorVacio`, no solo los «»: una «SN-0001, ---» da una serie. |
| 7 | El diseño habla de 44 códigos existentes; `EQUIPMENT_MAP` tiene 46 claves. | Son 44 de la EPA y las dos grafías de la norma UNE-EN 16450. La prueba del recuento pasa de 46 a 82. |
| 8 | Cómo se escribe la marca de los 36 códigos nuevos. | Fabricantes del título y del texto de la designación, unidos con « / ». Las empresas que cambiaron de nombre van juntas, como el «Ecotech / Acoem» que ya hay («Environnement S.A. / ENVEA», «Thermo Andersen / Thermo Scientific»). Se unifican las grafías de una misma empresa: «Thermo Fisher Scientific» es «Thermo Scientific»; «Teledyne Advanced Pollution Instrumentation», «Teledyne API»; «Rupprecht and Patashnick», «Rupprecht & Patashnick». El Grimm EDM 180 usa la marca y el modelo que ya tiene la tabla (`'Grimm'`, `'EDM180'`). |
| 9 | Contaminante. | El vocabulario de siempre. `brands.ts` y el Análisis de Marcas solo lo enseñan, pero las 44 entradas usan «Partículas» para PM10 y PM2.5, y una etiqueta más fina las descuadraría. Los analizadores químicos de NOx van en `'NOx'`, como los que ya hay. Los de olores (H₂S, TRS, NH₃) llevan el contaminante de su designación (SO₂ o NOx). |
| 10 | Las entradas existentes que no cuadran con la lista de la EPA. | Tarea 9, aparte y solo con el visto bueno del usuario. Ninguna prueba de las demás tareas usa esos códigos. |
| 11 | `estacion?` y `serie?` son opcionales, y `primero` de `lib/prospects.ts` hace `fila[campo].trim()` con `campo: keyof Laboratorio`: deja de compilar (TS2532). | El tipo pasa a `Exclude<keyof Laboratorio, 'estacion' \| 'serie'>`. Prospectos se comporta igual. |
| 12 | `esValorVacio` vive en `lib/baseInstalada.ts`, como dice el diseño, y `services/api.ts` la necesita. | `api.ts` la importa de ahí. No hay ciclo: `baseInstalada.ts` no importa `services/`. |
| 13 | El Excel con varios pares de marca y modelo. | «Marca» y «Modelo» van en el mismo orden: la marca n.º i es la del modelo n.º i. Sin pares, «Sin identificar» y el modelo vacío. Sin estación, «Sin estación». |
| 14 | ~1.200 filas en una tabla sin paginar. | Sin paginar, como pide el diseño. La tabla se pinta con `useDeferredValue` para que escribir no se trabe. Si en el navegador va lenta, se pagina con `lib/pagination.ts` (mejora aparte). |
| 15 | Los colores de la insignia de vigencia están en `Prospectos.tsx`. | Se repiten en `BaseInstalada.tsx`: `react-refresh` no deja exportar constantes de un fichero de vista. |
| 16 | «Sin identificar» en el desplegable de marca. | Solo si algún equipo no tiene marca («las marcas presentes»). |
| 17 | La búsqueda «con la misma normalización que Prospectos». | `lib/prospects.ts` exporta `clave` y una función nueva, `nitCoincide`, con la regla del NIT sin puntos ni guion. `filterProspects` pasa a usarla y hace lo mismo que hoy. Se exporta también `distintos`. |
| 18 | Laboratorio sin código. | Como en Prospectos: el equipo se agrupa por el nombre. |

## Mapa de ficheros

| Fichero | Tarea | Responsabilidad |
|---|---|---|
| `apps/laboratorios-ambientales/src/lib/baseInstalada.ts` (nuevo) | 1, 4, 5 | `esValorVacio`, `separarSeries`; qué registro entra, códigos EPA, agrupado y orden; filtros, opciones y recuento. |
| `apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts` (nuevo) | 1, 4, 5 | Sus pruebas. |
| `apps/laboratorios-ambientales/src/types/index.ts` | 1 | `estacion?` y `serie?` en `Laboratorio`. |
| `apps/laboratorios-ambientales/src/services/api.ts` (+ test) | 1 | `mapRecord` con estación y serie; cache v3 y borrado de la v2. |
| `apps/laboratorios-ambientales/src/lib/prospects.ts` (+ test) | 1, 3 | Tipo de `primero`; `fechaDeHasta` sale a `fechas.ts`; exporta `clave`, `distintos` y `nitCoincide`. |
| `apps/laboratorios-ambientales/src/lib/equipment.ts` (+ test) | 2, 9 | Los 36 códigos nuevos y la fuente; las correcciones. |
| `apps/laboratorios-ambientales/src/lib/fechas.ts` (+ test) | 3 | `fechaDeHasta`. |
| `apps/laboratorios-ambientales/src/lib/clientes.ts` (+ test) | 3 | `nitsParaConsultar` y `filtrarPorCliente`, genéricas sobre `{ nit: string }`. |
| `apps/laboratorios-ambientales/src/lib/exportBaseInstalada.ts` (+ test, nuevos) | 6 | Columnas, filas, hoja y nombre del Excel. |
| `apps/laboratorios-ambientales/src/hooks/useCruceZoho.ts` (nuevo) | 7 | La consulta del cruce con Zoho de una vista. |
| `apps/laboratorios-ambientales/src/pages/Prospectos.tsx` | 7 | Usa `useCruceZoho`. |
| `apps/laboratorios-ambientales/src/components/CeldaCliente.tsx` | 7 | Opción `conOcma`. |
| `apps/laboratorios-ambientales/src/lib/view.ts` (+ test) | 8 | Vista `'base-aire'`, hash `#base-aire`. |
| `apps/laboratorios-ambientales/src/pages/BaseInstalada.tsx` (nuevo) | 8 | La vista. |
| `apps/laboratorios-ambientales/src/App.tsx` | 8 | Cuarta tarjeta del menú y la ruta. |
| `apps/laboratorios-ambientales/README.md`, `docs/PRIVACY-RETENTION.md` | 10 | Documentación. |

---

### Task 1: Datos — valor vacío, series, estación y serie, cache v3

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/baseInstalada.ts`
- Create: `apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts`
- Modify: `apps/laboratorios-ambientales/src/types/index.ts`
- Modify: `apps/laboratorios-ambientales/src/services/api.ts`
- Modify: `apps/laboratorios-ambientales/src/lib/prospects.ts` (solo el tipo de `primero`)
- Test: `apps/laboratorios-ambientales/src/services/api.test.ts`

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { esValorVacio, separarSeries } from './baseInstalada';

describe('esValorVacio', () => {
  it('en blanco o solo espacios', () => {
    expect(esValorVacio('')).toBe(true);
    expect(esValorVacio('   ')).toBe(true);
  });

  it('solo guiones', () => {
    for (const valor of ['-', '---', ' -- ', '–', '—']) expect(esValorVacio(valor), valor).toBe(true);
  });

  it('«No aplica», «N/A» y «NA», sin distinguir mayúsculas', () => {
    for (const valor of ['No aplica', 'NO APLICA', 'No  Aplica', ' no aplica ', 'N/A', 'n/a', 'NA', 'na']) {
      expect(esValorVacio(valor), valor).toBe(true);
    }
  });

  it('un valor real no está vacío', () => {
    for (const valor of ['SN-0001', '0', 'NA-0001', 'Estación Ficticia Centro', '-12']) {
      expect(esValorVacio(valor), valor).toBe(false);
    }
  });
});

describe('separarSeries', () => {
  it('una sola serie, recortada', () => {
    expect(separarSeries('  SN-0001 ')).toEqual(['SN-0001']);
  });

  it('parte por comas, puntos y comas y saltos de línea', () => {
    expect(separarSeries('SN-0001, SN-0002;SN-0003\nSN-0004\r\nSN-0005')).toEqual([
      'SN-0001',
      'SN-0002',
      'SN-0003',
      'SN-0004',
      'SN-0005',
    ]);
  });

  it('no parte por «/» ni por espacios', () => {
    expect(separarSeries('XY-12345-678/2')).toEqual(['XY-12345-678/2']);
    expect(separarSeries('AB 1234')).toEqual(['AB 1234']);
  });

  it('descarta los trozos vacíos', () => {
    expect(separarSeries('SN-0001,, ;\n')).toEqual(['SN-0001']);
    expect(separarSeries('SN-0001, ---, No aplica')).toEqual(['SN-0001']);
    expect(separarSeries('')).toEqual([]);
  });
});
```

En `apps/laboratorios-ambientales/src/services/api.test.ts`, sustituye:

```ts
  it('convierte los campos ausentes en cadena vacía, no undefined', () => {
    const lab = mapRecord({ variable: 'pH' });
    expect(lab.nombreLaboratorio).toBe('');
    expect(lab.metodo).toBe('');
    expect(lab.estado).toBe('');
  });
});
```

por:

```ts
  it('convierte los campos ausentes en cadena vacía, no undefined', () => {
    const lab = mapRecord({ variable: 'pH' });
    expect(lab.nombreLaboratorio).toBe('');
    expect(lab.metodo).toBe('');
    expect(lab.estado).toBe('');
  });

  // Estación y serie ficticias: el repo es público.
  it('pone estacion y serie cuando el dataset trae valor, recortadas', () => {
    const lab = mapRecord({
      ...RAW,
      nombre_de_la_estaci_n: ' Estación Ficticia Centro ',
      identificaci_n_de_equipo: 'SN-0001 ',
    });
    expect(lab.estacion).toBe('Estación Ficticia Centro');
    expect(lab.serie).toBe('SN-0001');
  });

  // Sin la clave, el cache no crece en los ~18 000 registros que no traen equipo.
  it('sin valor, con «No aplica» o con «---», estacion y serie no existen', () => {
    for (const vacio of ['', '   ', 'No aplica', 'NO APLICA', '---', 'N/A']) {
      const lab = mapRecord({ ...RAW, nombre_de_la_estaci_n: vacio, identificaci_n_de_equipo: vacio });
      expect('estacion' in lab, vacio).toBe(false);
      expect('serie' in lab, vacio).toBe(false);
    }
    expect('serie' in mapRecord(RAW)).toBe(false);
  });
});
```

Sustituye:

```ts
  // La clave lleva versión: el esquema de Laboratorio cambió y un cache escrito
  // por la versión anterior no debe leerse con el nuevo. Ver el describe de
  // «migración del cache v1» más abajo.
  const CACHE_KEY_DATA = 'labs_cache_v2_data';
  const CACHE_KEY_TIMESTAMP = 'labs_cache_v2_timestamp';
```

por:

```ts
  // La clave lleva versión: el esquema de Laboratorio cambió y un cache escrito
  // por una versión anterior no debe leerse con el nuevo. Ver los describe de
  // «migración del cache v1» y «v2» más abajo.
  const CACHE_KEY_DATA = 'labs_cache_v3_data';
  const CACHE_KEY_TIMESTAMP = 'labs_cache_v3_timestamp';
```

Sustituye:

```ts
    it('borra la v1 aunque el cache v2 esté fresco y no se toque la red', async () => {
```

por:

```ts
    it('borra la v1 aunque el cache v3 esté fresco y no se toque la red', async () => {
```

Sustituye:

```ts
      await fetchLaboratorios();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(store.has(V1_KEY_DATA)).toBe(false);
      expect(store.has(V1_KEY_TIMESTAMP)).toBe(false);
    });
  });
});
```

por:

```ts
      await fetchLaboratorios();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(store.has(V1_KEY_DATA)).toBe(false);
      expect(store.has(V1_KEY_TIMESTAMP)).toBe(false);
    });
  });

  // La v2 no traía estacion ni serie: leída con el esquema nuevo, la Base
  // instalada de aire saldría vacía durante 24 h. Y sus ~3 MB impedirían
  // escribir la v3 por cuota.
  describe('migración del cache v2', () => {
    const V2_KEY_DATA = 'labs_cache_v2_data';
    const V2_KEY_TIMESTAMP = 'labs_cache_v2_timestamp';
    const cacheV2 = () => ({
      [V2_KEY_DATA]: JSON.stringify([mapRecord(RAW)]),
      [V2_KEY_TIMESTAMP]: String(Date.now()),
    });

    it('ignora un cache v2 fresco, descarga y borra sus claves', async () => {
      const { store } = stubLocalStorage(cacheV2());
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => page(2) });
      vi.stubGlobal('fetch', fetchMock);

      const data = await fetchLaboratorios();

      expect(fetchMock).toHaveBeenCalled();
      expect(data).toHaveLength(2);
      expect(store.has(V2_KEY_DATA)).toBe(false);
      expect(store.has(V2_KEY_TIMESTAMP)).toBe(false);
    });

    it('borra la v2 aunque el cache v3 esté fresco y no se toque la red', async () => {
      const { store } = stubLocalStorage({ ...cacheDe([mapRecord(RAW)]), ...cacheV2() });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await fetchLaboratorios();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(store.has(V2_KEY_DATA)).toBe(false);
      expect(store.has(V2_KEY_TIMESTAMP)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Ejecuta y comprueba que fallan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/baseInstalada.test.ts src/services/api.test.ts`
Expected: FAIL.
- `baseInstalada.test.ts` no encuentra el módulo `./baseInstalada`.
- `api.test.ts`: 12 pruebas fallan. Son la de «pone estacion y serie…», las del cache (que ahora buscan las claves v3) y las dos de la migración v2. Una de ellas, «si el refresco en segundo plano falla…», acaba por tiempo a los 5 s: es normal.

- [ ] **Step 3: Escribe la implementación mínima**

Crea `apps/laboratorios-ambientales/src/lib/baseInstalada.ts`:

```ts
// Base instalada de aire: un equipo por código de laboratorio + número de serie,
// sacado del dataset 2waz-acaa. Ver
// docs/superpowers/specs/2026-11-27-base-instalada-aire-design.md.

// Los rellenos que el dataset escribe cuando no hay dato.
const RELLENOS = new Set(['no aplica', 'n/a', 'na']);

/**
 * ¿Es un valor vacío? Tras recortarlo: en blanco, solo guiones, o «No aplica»,
 * «N/A» o «NA» sin distinguir mayúsculas. Lo usan mapRecord (para no guardar
 * estacion ni serie vacías) y la agrupación de equipos.
 */
export function esValorVacio(texto: string): boolean {
  const limpio = texto.trim().toLowerCase().replace(/\s+/g, ' ');
  return limpio === '' || /^[-–—]+$/.test(limpio) || RELLENOS.has(limpio);
}

/**
 * Las series de un campo de equipo: una fila puede listar varias (una red con
 * 30 muestreadores). Se parte por comas, puntos y comas y saltos de línea; no
 * por «/» ni por espacios, porque hay series como «XY-12345-678/2». Los trozos
 * vacíos (según esValorVacio) se descartan.
 */
export function separarSeries(campo: string): string[] {
  return campo
    .split(/[,;\r\n]/)
    .map((trozo) => trozo.trim())
    .filter((trozo) => !esValorVacio(trozo));
}
```

En `apps/laboratorios-ambientales/src/types/index.ts`, sustituye:

```ts
  desde: string;
  hasta: string;
};
```

por:

```ts
  desde: string;
  hasta: string;
  // Solo existen si el dataset trae valor (esValorVacio, en lib/baseInstalada.ts).
  // Los usa la Base instalada de aire.
  estacion?: string;
  serie?: string;
};
```

En `apps/laboratorios-ambientales/src/services/api.ts`, sustituye:

```ts
import { normalizeActividad, normalizeComponente, normalizeEstado, normalizeMatriz } from '../lib/normalize';
```

por:

```ts
import { normalizeActividad, normalizeComponente, normalizeEstado, normalizeMatriz } from '../lib/normalize';
import { esValorVacio } from '../lib/baseInstalada';
```

Sustituye:

```ts
const CACHE_VERSION = 'v2';
```

por:

```ts
const CACHE_VERSION = 'v3';
```

Sustituye:

```ts
// v1 (hasta 2026-07-15): esquema con nombre_laboratorio/parametro/estado 'VIGENTE'.
const LEGACY_CACHE_KEYS = ['labs_cache_data', 'labs_cache_timestamp'];
```

por:

```ts
// v1 (hasta 2026-07-15): esquema con nombre_laboratorio/parametro/estado 'VIGENTE'.
// v2 (hasta 2026-11-27): sin estacion ni serie; la Base instalada saldría vacía.
const LEGACY_CACHE_KEYS = [
  'labs_cache_data',
  'labs_cache_timestamp',
  'labs_cache_v2_data',
  'labs_cache_v2_timestamp',
];
```

Sustituye:

```ts
export function mapRecord(record: Record<string, string | undefined>): Laboratorio {
  return {
    codigo: record.c_digo_de_laboratorio ?? '',
```

por:

```ts
export function mapRecord(record: Record<string, string | undefined>): Laboratorio {
  // estacion y serie solo se guardan si traen valor (esValorVacio): así el cache
  // crece solo en los ~1.000 registros de aire que los traen.
  const estacion = (record.nombre_de_la_estaci_n ?? '').trim();
  const serie = (record.identificaci_n_de_equipo ?? '').trim();
  return {
    codigo: record.c_digo_de_laboratorio ?? '',
```

Sustituye:

```ts
    hasta: record.hasta ?? '',
  };
}
```

por:

```ts
    hasta: record.hasta ?? '',
    ...(esValorVacio(estacion) ? {} : { estacion }),
    ...(esValorVacio(serie) ? {} : { serie }),
  };
}
```

En `apps/laboratorios-ambientales/src/lib/prospects.ts`, sustituye:

```ts
  // El primer valor no vacío en el orden del dataset: el contacto o el teléfono
  // faltan a menudo en una fila y están en otra del mismo laboratorio.
  const primero = (campo: keyof Laboratorio): string => {
```

por:

```ts
  // El primer valor no vacío en el orden del dataset: el contacto o el teléfono
  // faltan a menudo en una fila y están en otra del mismo laboratorio. estacion
  // y serie quedan fuera: son opcionales y aquí no hacen falta.
  const primero = (campo: Exclude<keyof Laboratorio, 'estacion' | 'serie'>): string => {
```

(El cambio de `prospects.ts` no cambia nada de lo que hace. Sin él, `tsc -b` da `TS2532: Object is possibly 'undefined'` en `primero`: `keyof Laboratorio` ahora incluye los dos campos opcionales.)

- [ ] **Step 4: Ejecuta y comprueba que pasan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/baseInstalada.test.ts src/services/api.test.ts`
Expected: PASS, 2 ficheros, 38 pruebas (8 + 30).

Run: `cd apps/laboratorios-ambientales && npx tsc -b && npm test`
Expected: sin errores de tipos. Suite: 13 ficheros, 218 pruebas, en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/baseInstalada.ts apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts apps/laboratorios-ambientales/src/types/index.ts apps/laboratorios-ambientales/src/services/api.ts apps/laboratorios-ambientales/src/services/api.test.ts apps/laboratorios-ambientales/src/lib/prospects.ts
git commit -F - <<'EOF'
feat(laboratorios): estación y número de serie en los registros del dataset

mapRecord guarda estacion y serie solo cuando traen valor (esValorVacio: en
blanco, guiones, «No aplica», «N/A» o «NA»). separarSeries parte el campo de
equipo por comas, puntos y comas y saltos de línea. El cache pasa a v3 y
borra las claves de la v2, que no traían esos campos.
EOF
```

---

### Task 2: Tabla de códigos — los 36 códigos EPA que faltaban

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/equipment.ts`
- Test: `apps/laboratorios-ambientales/src/lib/equipment.test.ts`

Fuente: la «List of Designated Reference and Equivalent Methods» de la EPA, emitida el 28 de julio de 2026 (`https://www.epa.gov/system/files/documents/2026-07/amtic-list-july-2026_508-compliant.pdf`). Cada entrada de abajo se sacó de su designación («Manual Reference Method: …», «Automated Equivalent Method: …»), con las reglas de la decisión 8. No las cambies sin volver a la lista.

- [ ] **Step 1: Escribe las pruebas que fallan**

En `apps/laboratorios-ambientales/src/lib/equipment.test.ts`, sustituye:

```ts
  it('conserva los 46 equipos del catálogo original', () => {
    expect(Object.keys(EQUIPMENT_MAP)).toHaveLength(46);
  });
```

por:

```ts
  it('son 82 códigos: los 46 del catálogo original y 36 de la lista de la EPA', () => {
    expect(Object.keys(EQUIPMENT_MAP)).toHaveLength(82);
  });
```

Sustituye:

```ts
      expect(equipo.pollutant, `${code} sin contaminante`).toBeTruthy();
    }
  });
});
```

por:

```ts
      expect(equipo.pollutant, `${code} sin contaminante`).toBeTruthy();
    }
  });

  // Una errata al copiar un código nuevo lo dejaría sin reconocer en silencio.
  it('cada código EPA tiene la forma XXXX-0000-000', () => {
    for (const code of Object.keys(EQUIPMENT_MAP)) {
      if (code.startsWith('UNE')) continue;
      expect(code).toMatch(/^(RF|EQ)[A-Z]{2}-\d{4}-\d{3}$/);
    }
  });
});
```

Sustituye:

```ts
  it('ignora un método que no cita ningún código', () => {
    expect(extractEquipment('Método interno basado en la norma ASTM D1739')).toBeNull();
  });
});
```

por:

```ts
  it('ignora un método que no cita ningún código', () => {
    expect(extractEquipment('Método interno basado en la norma ASTM D1739')).toBeNull();
  });

  it('reconoce un muestreador de PM de la lista de la EPA', () => {
    expect(extractEquipment('Método de Referencia Manual RFPS-1014-219')).toEqual({
      code: 'RFPS-1014-219',
      brand: 'Tisch Environmental',
      model: 'TE-Wilbur2.5',
      pollutant: 'Partículas',
    });
  });

  // Los analizadores de olores (H₂S, TRS) se acreditan con su designación de SO₂.
  it('reconoce un analizador que se acredita para olores', () => {
    expect(extractEquipment('Método Equivalente Automatizado EQSA-0802-149')).toEqual({
      code: 'EQSA-0802-149',
      brand: 'Environnement S.A. / ENVEA',
      model: 'AF22M / AF22e',
      pollutant: 'SO₂',
    });
  });

  it('un código con dos fabricantes trae los dos en la marca', () => {
    const eq = extractEquipment('Método de Referencia Manual RFPS-0202-141');
    expect(eq?.brand).toBe('Tisch Environmental / New Star Environmental');
    expect(eq?.model).toBe('TE-6070 / NS-6070');
  });

  // El dataset lo escribe «RFNA-1289-0704»: no está en la lista de la EPA.
  it('RFNA-1289-070 no está en la lista de la EPA y no se reconoce', () => {
    expect(EQUIPMENT_MAP['RFNA-1289-070']).toBeUndefined();
    expect(extractEquipment('Método de Referencia Automatizado RFNA-1289-070')).toBeNull();
    expect(extractEquipment('Método de Referencia Automatizado RFNA-1289-0704')).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecuta y comprueba que fallan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/equipment.test.ts`
Expected: FAIL, 4 pruebas: la del recuento (46 en vez de 82) y las tres de códigos nuevos. La de `RFNA-1289-070` y la del formato ya pasan: son guardas.

- [ ] **Step 3: Escribe la implementación mínima**

En `apps/laboratorios-ambientales/src/lib/equipment.ts`, sustituye:

```ts
// Catálogo de equipos de calidad del aire acreditados, portado del prototipo.
// La clave es el código de designación (US EPA / UNE-EN) que aparece embebido en
// el texto libre del campo «método» del dataset.
```

por:

```ts
// Catálogo de equipos de calidad del aire acreditados, portado del prototipo.
// La clave es el código de designación (US EPA / UNE-EN) que aparece embebido en
// el texto libre del campo «método» del dataset.
//
// Fuente de los códigos EPA: la «List of Designated Reference and Equivalent
// Methods» de la EPA, emitida el 28 de julio de 2026:
// https://www.epa.gov/system/files/documents/2026-07/amtic-list-july-2026_508-compliant.pdf
// Marca, modelo y contaminante salen del texto de cada designación. Si un código
// cubre varios fabricantes o modelos, van unidos con « / » («Ecotech / Acoem»),
// también cuando una empresa cambió de nombre («Environnement S.A. / ENVEA»).
// PM10, PM2.5 y PM10-2.5 son «Partículas», como en el catálogo original.
```

Sustituye:

```ts
  'EQPM-0715-266': { brand: 'Met One Instruments, Inc.', model: 'BAM-1022', pollutant: 'Partículas' },
};
```

por:

```ts
  'EQPM-0715-266': { brand: 'Met One Instruments, Inc.', model: 'BAM-1022', pollutant: 'Partículas' },
  // Añadidos el 2026-11-27: los 36 códigos que cita el dataset de aire y faltaban.
  'EQOA-0193-091': {
    brand: 'Teledyne Monitor Labs / Casella / Ecotech / Acoem / Aeris / Wedding & Associates',
    model: 'ML9810 / CM2010 / EC9810 / AE2010 / AE9810 / 1010 Series',
    pollutant: 'O₃',
  },
  'EQOA-0206-148': { brand: 'Environnement S.A. / ENVEA', model: 'O3 42M', pollutant: 'O₃' },
  'EQOA-0410-190': { brand: '2B Technologies', model: '202 / 205', pollutant: 'O₃' },
  'EQOA-0515-225': { brand: 'Environnement S.A. / ENVEA', model: 'O3 42e', pollutant: 'O₃' },
  'EQPM-0311-195': { brand: 'Grimm', model: 'EDM180', pollutant: 'Partículas' },
  'EQPM-0325-269': { brand: 'Focused Photonics Inc.', model: 'BPM-200 PM2.5 Monitor', pollutant: 'Partículas' },
  'EQPM-0404-151': { brand: 'Environnement S.A. / ENVEA', model: 'MP101M', pollutant: 'Partículas' },
  'EQPM-0516-238': { brand: 'Teledyne API', model: 'T640 (640X)', pollutant: 'Partículas' },
  'EQPM-0516-239': { brand: 'Teledyne API', model: 'T640 (640X)', pollutant: 'Partículas' },
  'EQPM-0609-183': { brand: 'Thermo Scientific', model: '5014i / 5014iQ / 5028i / FH62C14-DHS', pollutant: 'Partículas' },
  'EQPM-1013-211': { brand: 'Environnement S.A. / ENVEA', model: 'MP101M', pollutant: 'Partículas' },
  'EQPM-1102-150': {
    brand: 'Thermo Andersen / Thermo Scientific',
    model: 'FH 62 C14 / 5014i / 5014iQ / 5028i',
    pollutant: 'Partículas',
  },
  'EQPS-0311-197': { brand: 'Thermo Scientific', model: 'Partisol 2000-D / 2000i-D', pollutant: 'Partículas' },
  'EQPS-0509-177': { brand: 'Thermo Scientific', model: 'Partisol 2000-D / 2000i-D', pollutant: 'Partículas' },
  'EQSA-0193-092': {
    brand: 'Teledyne Monitor Labs / Casella / Ecotech / Acoem / Aeris / Wedding & Associates',
    model: 'ML9850 / CM2050 / EC9850 / EC9850T / AE9850 / AE2050 / 1040 Series',
    pollutant: 'SO₂',
  },
  'EQSA-0802-149': { brand: 'Environnement S.A. / ENVEA', model: 'AF22M / AF22e', pollutant: 'SO₂' },
  'RFCA-0206-147': { brand: 'Environnement S.A. / ENVEA', model: 'CO12M', pollutant: 'CO' },
  'RFCA-0915-228': { brand: 'Environnement S.A. / ENVEA', model: 'CO12e', pollutant: 'CO' },
  'RFNA-0118-249': { brand: 'Environnement S.A. / ENVEA', model: 'AC32e', pollutant: 'NOx' },
  'RFNA-0202-146': { brand: 'Environnement S.A. / ENVEA', model: 'AC32M', pollutant: 'NOx' },
  'RFNA-0418-250': { brand: 'Sabio', model: '6040 NOx Analyzer', pollutant: 'NOx' },
  'RFPS-0202-141': {
    brand: 'Tisch Environmental / New Star Environmental',
    model: 'TE-6070 / NS-6070',
    pollutant: 'Partículas',
  },
  'RFPS-0216-231': {
    brand: 'Met One Instruments, Inc.',
    model: 'E-FRM-PM10 / E-FRM-DC-PM10',
    pollutant: 'Partículas',
  },
  'RFPS-0315-221': {
    brand: 'Met One Instruments, Inc.',
    model: 'E-FRM-PM2.5 / E-FRM-DC-PM2.5',
    pollutant: 'Partículas',
  },
  'RFPS-0498-116': { brand: 'BGI Inc. / Mesa Laboratories Inc.', model: 'PQ200 / PQ200A', pollutant: 'Partículas' },
  'RFPS-0498-117': {
    brand: 'Thermo Scientific / Rupprecht & Patashnick',
    model: 'Partisol 2000-FRM / 2000i PM2.5',
    pollutant: 'Partículas',
  },
  'RFPS-0498-118': {
    brand: 'Thermo Scientific / Rupprecht & Patashnick',
    model: 'Partisol-Plus 2025 / 2025i PM2.5',
    pollutant: 'Partículas',
  },
  'RFPS-0694-098': { brand: 'Thermo Scientific / Rupprecht & Patashnick', model: 'Partisol 2000', pollutant: 'Partículas' },
  'RFPS-0714-216': { brand: 'Tisch Environmental', model: 'TE-Wilbur10', pollutant: 'Partículas' },
  'RFPS-1014-219': { brand: 'Tisch Environmental', model: 'TE-Wilbur2.5', pollutant: 'Partículas' },
  'RFPS-1087-062': { brand: 'Wedding & Associates / Thermo Environmental', model: '600', pollutant: 'Partículas' },
  'RFPS-1287-063': {
    brand: 'Graseby Andersen / Sierra-Andersen / General Metal Works',
    model: '1200',
    pollutant: 'Partículas',
  },
  'RFPS-1298-124': { brand: 'BGI Inc. / Mesa Laboratories Inc.', model: 'PQ100', pollutant: 'Partículas' },
  'RFPS-1298-125': { brand: 'BGI Inc. / Mesa Laboratories Inc.', model: 'PQ200', pollutant: 'Partículas' },
  'RFPS-1298-126': {
    brand: 'Thermo Scientific / Rupprecht & Patashnick',
    model: 'Partisol 2000-FRM / 2000i PM10',
    pollutant: 'Partículas',
  },
  'RFPS-1298-127': {
    brand: 'Thermo Scientific / Rupprecht & Patashnick',
    model: 'Partisol-Plus 2025 / 2025i PM10',
    pollutant: 'Partículas',
  },
};
```

- [ ] **Step 4: Ejecuta y comprueba que pasan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/equipment.test.ts`
Expected: PASS, 15 pruebas.

Run: `cd apps/laboratorios-ambientales && grep -cE "^  '[A-Z]{4}-[0-9]{4}-[0-9]{3}'" src/lib/equipment.ts`
Expected: `80` (44 + 36 códigos EPA; las dos claves UNE-EN no cuentan aquí).

Run: `cd apps/laboratorios-ambientales && npx tsc -b && npm test`
Expected: sin errores. Suite: 13 ficheros, 223 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/equipment.ts apps/laboratorios-ambientales/src/lib/equipment.test.ts
git commit -F - <<'EOF'
feat(laboratorios): 36 códigos EPA más en la tabla de equipos

Los que cita el dataset de aire y faltaban, sacados de la lista de métodos
designados de la EPA del 28 de julio de 2026. Un código con varios
fabricantes los trae unidos con « / ». RFNA-1289-070 no está en la lista y
sigue sin reconocerse.
EOF
```

---

### Task 3: Piezas compartidas — `fechaDeHasta`, búsqueda y cruce genérico

Prospectos tiene que hacer exactamente lo mismo que hoy. Aquí no se mueve ninguna prueba existente: solo se añaden.

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/fechas.ts`
- Modify: `apps/laboratorios-ambientales/src/lib/prospects.ts`
- Modify: `apps/laboratorios-ambientales/src/lib/clientes.ts`
- Test: `apps/laboratorios-ambientales/src/lib/fechas.test.ts`, `src/lib/prospects.test.ts`, `src/lib/clientes.test.ts`

- [ ] **Step 1: Escribe las pruebas que fallan**

En `apps/laboratorios-ambientales/src/lib/fechas.test.ts`, sustituye:

```ts
import { hoyLocal, sumarMeses } from './fechas';
```

por:

```ts
import { fechaDeHasta, hoyLocal, sumarMeses } from './fechas';
```

Sustituye:

```ts
  it('y el 29 de febrero en un año bisiesto', () => {
    expect(sumarMeses('2027-08-31', 6)).toBe('2028-02-29');
  });
});
```

por:

```ts
  it('y el 29 de febrero en un año bisiesto', () => {
    expect(sumarMeses('2027-08-31', 6)).toBe('2028-02-29');
  });
});

// Los casos que Prospectos prueba a través de groupProspects, ahora directos.
describe('fechaDeHasta', () => {
  it('saca la fecha AAAA-MM-DD del formato del dataset', () => {
    expect(fechaDeHasta('2027-04-21T00:00:00.000')).toBe('2027-04-21');
  });

  it('«---» no es una fecha', () => {
    expect(fechaDeHasta('---')).toBeNull();
  });

  it('recorta los espacios', () => {
    expect(fechaDeHasta('  2027-04-21T00:00:00.000 ')).toBe('2027-04-21');
  });

  it('un formato raro o vacío no es una fecha', () => {
    expect(fechaDeHasta('21/04/2027')).toBeNull();
    expect(fechaDeHasta('')).toBeNull();
  });
});
```

En `apps/laboratorios-ambientales/src/lib/prospects.test.ts`, sustituye:

```ts
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

por:

```ts
import {
  clave,
  departamentosDe,
  esGrasasYAceites,
  esInfrarrojo,
  estadoVigencia,
  filterProspects,
  groupProspects,
  nitCoincide,
  sortProspects,
} from './prospects';
```

Sustituye:

```ts
    expect(departamentosDe(lista)).toEqual(['Antioquia', 'Atlántico', 'Valle del Cauca']);
  });
});
```

por:

```ts
    expect(departamentosDe(lista)).toEqual(['Antioquia', 'Atlántico', 'Valle del Cauca']);
  });
});

// clave y nitCoincide los usa también la búsqueda de la Base instalada de aire.
describe('clave', () => {
  it('quita tildes y mayúsculas y colapsa los espacios', () => {
    expect(clave('  Estación   NÓRTE ')).toBe('estacion norte');
  });
});

describe('nitCoincide', () => {
  // `busqueda` llega ya pasada por clave, como en filterProspects.
  it('encuentra el NIT con su formato', () => {
    expect(nitCoincide('900.000.001-7', '900.000')).toBe(true);
  });

  it('y sin puntos ni guion', () => {
    expect(nitCoincide('900.000.001-7', '900000001')).toBe(true);
    expect(nitCoincide('900.000.001-7', '9000000017')).toBe(true);
  });

  it('las cifras dentro de un texto no son un NIT', () => {
    expect(nitCoincide('900.000.001-7', 'ambiental 1')).toBe(false);
    expect(nitCoincide('900.000.001-7', '900111')).toBe(false);
  });
});
```

En `apps/laboratorios-ambientales/src/lib/clientes.test.ts`, sustituye:

```ts
const cruce = (entradas: Record<string, HechosZoho>): CruceZoho => new Map(Object.entries(entradas));
```

por:

```ts
const cruce = (entradas: Record<string, HechosZoho>): CruceZoho => new Map(Object.entries(entradas));

// Cualquier elemento con NIT: así las usa también la Base instalada de aire.
type ConNit = { nit: string; serie: string };
const equipos: ConNit[] = [
  { nit: '900.000.003-1', serie: 'SN-0001' },
  { nit: '900.000.003-1', serie: 'SN-0002' },
  { nit: '', serie: 'SN-0003' },
];
```

Sustituye:

```ts
      prospecto({ nit: '900.000.001-7' }),
    ]);
    expect(nits).toEqual(['900000001']);
  });
});
```

por:

```ts
      prospecto({ nit: '900.000.001-7' }),
    ]);
    expect(nits).toEqual(['900000001']);
  });

  it('acepta cualquier lista de elementos con nit', () => {
    expect(nitsParaConsultar(equipos)).toEqual(['900000003']);
  });
});
```

Sustituye:

```ts
    expect(filtrarPorCliente(lista, 'sin-nit', c, HOY).map((p) => p.nombre)).toEqual(['B']);
  });
});
```

por:

```ts
    expect(filtrarPorCliente(lista, 'sin-nit', c, HOY).map((p) => p.nombre)).toEqual(['B']);
  });

  it('acepta cualquier elemento con nit y devuelve el mismo tipo', () => {
    const cruceEquipos = cruce({ '900000003': hechos({ ultimaFactura: '2026-10-01' }) });
    const activos: ConNit[] = filtrarPorCliente(equipos, 'activo', cruceEquipos, HOY);
    expect(activos.map((e) => e.serie)).toEqual(['SN-0001', 'SN-0002']);
  });
});
```

- [ ] **Step 2: Ejecuta y comprueba que fallan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/fechas.test.ts src/lib/prospects.test.ts src/lib/clientes.test.ts`
Expected: FAIL, 8 pruebas: las cuatro de `fechaDeHasta`, la de `clave` y las tres de `nitCoincide` (no se exportan todavía).

Las dos de `clientes.test.ts` pasan en vitest, porque en JavaScript las funciones ya solo miran `nit`. Lo que falla es el tipo:

Run: `cd apps/laboratorios-ambientales && npx tsc -b`
Expected: errores `TS2345` y `TS2322` en `src/lib/clientes.test.ts`: `ConNit[]` no es `Prospecto[]`.

- [ ] **Step 3: Escribe la implementación mínima**

En `apps/laboratorios-ambientales/src/lib/fechas.ts`, sustituye:

```ts
  const ultimoDia = new Date(Date.UTC(anioFinal, mesFinal + 1, 0)).getUTCDate();
  return `${anioFinal}-${dos(mesFinal + 1)}-${dos(Math.min(dia, ultimoDia))}`;
}
```

por:

```ts
  const ultimoDia = new Date(Date.UTC(anioFinal, mesFinal + 1, 0)).getUTCDate();
  return `${anioFinal}-${dos(mesFinal + 1)}-${dos(Math.min(dia, ultimoDia))}`;
}

// `hasta` llega como «2027-04-21T00:00:00.000» o como «---»; otra cosa no es una
// fecha. La usan Prospectos y la Base instalada de aire.
const FECHA_ISO = /^(\d{4}-\d{2}-\d{2})/;

export function fechaDeHasta(hasta: string): string | null {
  const encontrada = FECHA_ISO.exec(hasta.trim());
  return encontrada ? encontrada[1] : null;
}
```

En `apps/laboratorios-ambientales/src/lib/prospects.ts`, sustituye:

```ts
import { sumarMeses } from './fechas';
```

por:

```ts
import { fechaDeHasta, sumarMeses } from './fechas';
```

Sustituye:

```ts
// Minúsculas, sin tildes y con los espacios colapsados: el dataset es de captura
// manual y la misma palabra llega con varias grafías.
function clave(texto: string): string {
```

por:

```ts
// Minúsculas, sin tildes y con los espacios colapsados: el dataset es de captura
// manual y la misma palabra llega con varias grafías. También la usa la búsqueda
// de la Base instalada de aire.
export function clave(texto: string): string {
```

Sustituye:

```ts
// `hasta` llega como «2027-04-21T00:00:00.000» o como «---».
const FECHA_ISO = /^(\d{4}-\d{2}-\d{2})/;

function fechaDeHasta(hasta: string): string | null {
  const encontrada = FECHA_ISO.exec(hasta.trim());
  return encontrada ? encontrada[1] : null;
}

const compararTexto = (a: string, b: string): number => a.localeCompare(b, 'es');

function distintos(valores: string[]): string[] {
```

por:

```ts
const compararTexto = (a: string, b: string): number => a.localeCompare(b, 'es');

// Distintos, recortados, sin vacíos y ordenados en español.
export function distintos(valores: string[]): string[] {
```

Sustituye:

```ts
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
```

por:

```ts
const PARECE_NIT = /^[\d\s.-]+$/;
const soloCifras = (texto: string): string => texto.replace(/\D/g, '');

// ¿Casa el NIT con lo buscado? `busqueda` ya pasó por clave; vacía, casa con
// todo. La usan Prospectos y la Base instalada de aire.
export function nitCoincide(nit: string, busqueda: string): boolean {
  if (clave(nit).includes(busqueda)) return true;
  const cifras = PARECE_NIT.test(busqueda) ? soloCifras(busqueda) : '';
  return cifras !== '' && soloCifras(nit).includes(cifras);
}

export function filterProspects(prospectos: Prospecto[], filtros: FiltrosProspectos): Prospecto[] {
  const busqueda = clave(filtros.busqueda);
  return prospectos.filter((prospecto) => {
    if (prospecto.grupo !== filtros.grupo) return false;
    if (filtros.departamento && prospecto.departamento !== filtros.departamento) return false;
    if (!busqueda) return true;
    return clave(prospecto.nombre).includes(busqueda) || nitCoincide(prospecto.nit, busqueda);
  });
}
```

En `apps/laboratorios-ambientales/src/lib/clientes.ts`, sustituye:

```ts
import type { Prospecto } from './prospects';
import { sumarMeses } from './fechas';
```

por:

```ts
import { sumarMeses } from './fechas';
```

Sustituye:

```ts
/** Los NIT base que se envían a hub-api: sin repetir y ordenados. */
export function nitsParaConsultar(prospectos: Prospecto[]): string[] {
  const nits = new Set<string>();
  for (const prospecto of prospectos) {
    const base = nitBase(prospecto.nit);
    if (base !== null) nits.add(base);
  }
  return [...nits].sort();
}

/** Sin estado elegido, o sin cruce (cargando o con error), no filtra. */
export function filtrarPorCliente(
  prospectos: Prospecto[],
  estado: EstadoCliente | '',
  cruce: CruceZoho | null,
  hoy: string,
): Prospecto[] {
  if (estado === '' || cruce === null) return prospectos;
  return prospectos.filter((prospecto) => estadoCliente(prospecto.nit, cruce, hoy) === estado);
}
```

por:

```ts
/**
 * Los NIT base que se envían a hub-api: sin repetir y ordenados. Vale para
 * cualquier lista con `nit`: prospectos o equipos de la base instalada.
 */
export function nitsParaConsultar(elementos: readonly { nit: string }[]): string[] {
  const nits = new Set<string>();
  for (const elemento of elementos) {
    const base = nitBase(elemento.nit);
    if (base !== null) nits.add(base);
  }
  return [...nits].sort();
}

/**
 * Sin estado elegido, o sin cruce (cargando o con error), no filtra y devuelve
 * la misma lista. Vale para cualquier elemento con `nit` y devuelve su tipo.
 */
export function filtrarPorCliente<T extends { nit: string }>(
  elementos: T[],
  estado: EstadoCliente | '',
  cruce: CruceZoho | null,
  hoy: string,
): T[] {
  if (estado === '' || cruce === null) return elementos;
  return elementos.filter((elemento) => estadoCliente(elemento.nit, cruce, hoy) === estado);
}
```

- [ ] **Step 4: Ejecuta y comprueba que pasan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/fechas.test.ts src/lib/prospects.test.ts src/lib/clientes.test.ts`
Expected: PASS, 83 pruebas (11 + 48 + 24).

Run: `cd apps/laboratorios-ambientales && npx tsc -b && npm test`
Expected: sin errores. Suite: 13 ficheros, 233 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/fechas.ts apps/laboratorios-ambientales/src/lib/fechas.test.ts apps/laboratorios-ambientales/src/lib/prospects.ts apps/laboratorios-ambientales/src/lib/prospects.test.ts apps/laboratorios-ambientales/src/lib/clientes.ts apps/laboratorios-ambientales/src/lib/clientes.test.ts
git commit -F - <<'EOF'
refactor(laboratorios): piezas compartidas para la base instalada de aire

fechaDeHasta pasa a lib/fechas.ts. lib/prospects.ts exporta clave, distintos
y nitCoincide (la regla del NIT sin puntos ni guion, que ahora usa también
filterProspects). nitsParaConsultar y filtrarPorCliente aceptan cualquier
lista con nit. Prospectos hace lo mismo que antes.
EOF
```

---

### Task 4: Base instalada — qué entra, agrupado por equipo y orden

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/baseInstalada.ts`
- Test: `apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts`

Las pruebas usan códigos que la Tarea 9 no toca (`RFPS-0202-141`, `EQPM-0311-195`, `RFNA-1194-099`): pasan se haga o no esa tarea.

- [ ] **Step 1: Escribe las pruebas que fallan**

En `apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts`, sustituye:

```ts
import { describe, it, expect } from 'vitest';
import { esValorVacio, separarSeries } from './baseInstalada';
```

por:

```ts
import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { mapRecord } from '../services/api';
import type { EquipoInstalado } from './baseInstalada';
import {
  agruparEquipos,
  codigosEpa,
  esRegistroDeEquipoAire,
  esValorVacio,
  ordenarEquipos,
  separarSeries,
} from './baseInstalada';
```

Sustituye:

```ts
  it('descarta los trozos vacíos', () => {
    expect(separarSeries('SN-0001,, ;\n')).toEqual(['SN-0001']);
    expect(separarSeries('SN-0001, ---, No aplica')).toEqual(['SN-0001']);
    expect(separarSeries('')).toEqual([]);
  });
});
```

por:

```ts
  it('descarta los trozos vacíos', () => {
    expect(separarSeries('SN-0001,, ;\n')).toEqual(['SN-0001']);
    expect(separarSeries('SN-0001, ---, No aplica')).toEqual(['SN-0001']);
    expect(separarSeries('')).toEqual([]);
  });
});

// Una fila con la forma real del dataset, pasada por mapRecord como en la app.
// El método cita un código real (RFPS-0202-141, Tisch / New Star); laboratorio,
// NIT, contacto, estación y serie son ficticios: el repo es público.
const RAW_AIRE = {
  c_digo_de_laboratorio: '201',
  estado_de_la_acreditaci_n: 'Activa',
  matriz: 'Aire',
  componente: 'Calidad del Aire',
  actividad: 'Muestreo',
  grupo: 'Contaminantes Criterio',
  variable: 'Material Particulado Menor a 10 micras',
  t_cnica: 'Gravimetría',
  m_todo: 'U.S. EPA CFR, Título 40, Parte 50, Apéndice J. Método de Referencia Manual RFPS-0202-141',
  rango_de_trabajo: '',
  nombre_del_laboratorio: 'LABORATORIO DE AIRE DEL NORTE S.A.S.',
  nit: '900.000.001-7',
  contacto: 'Contacto Ficticio Uno',
  ciudad: 'Bucaramanga',
  departamento: 'Santander',
  direcci_n: 'Calle 1 # 2-3',
  tel_fono: '6070000001',
  correo: 'aire.norte@example.com',
  actos_administrativos_que: '0001 del 2 de enero de 2023',
  desde: '2023-01-15T00:00:00.000',
  hasta: '2027-04-21T00:00:00.000',
  nombre_de_la_estaci_n: 'Estación Ficticia Centro',
  identificaci_n_de_equipo: 'SN-0001',
};

const fila = (over: Record<string, string> = {}): Laboratorio => mapRecord({ ...RAW_AIRE, ...over });

const TISCH = { marca: 'Tisch Environmental / New Star Environmental', modelo: 'TE-6070 / NS-6070' };
const GRIMM = { marca: 'Grimm', modelo: 'EDM180' };

// Un equipo ya armado, para probar el orden y los filtros sin pasar por
// agruparEquipos. Datos ficticios.
const equipo = (over: Partial<EquipoInstalado> = {}): EquipoInstalado => ({
  codigo: '201',
  laboratorio: 'LABORATORIO DE AIRE DEL NORTE S.A.S.',
  nit: '900.000.001-7',
  ciudad: 'Bucaramanga',
  departamento: 'Santander',
  contacto: '',
  telefono: '',
  correo: '',
  serie: 'SN-0001',
  estaciones: ['Estación Ficticia Centro'],
  marcasYModelos: [TISCH],
  codigosEpa: ['RFPS-0202-141'],
  variables: ['Material Particulado Menor a 10 micras'],
  vigenciaMasProxima: '2027-04-21',
  ...over,
});

const series = (lista: EquipoInstalado[]): string[] => lista.map((e) => e.serie);

describe('esRegistroDeEquipoAire', () => {
  it('entran calidad del aire y olores ofensivos, con cualquier grafía del dataset', () => {
    for (const componente of ['Calidad del Aire', 'Calidad de aire', 'Calidad del aire', 'Olores Ofensivos', 'Olores ofensivos']) {
      expect(esRegistroDeEquipoAire(fila({ componente })), componente).toBe(true);
    }
  });

  it('otros componentes del aire y otras matrices no entran', () => {
    for (const componente of ['Fuentes Fijas', 'Ruido Ambiental', 'Vibraciones']) {
      expect(esRegistroDeEquipoAire(fila({ componente })), componente).toBe(false);
    }
    expect(esRegistroDeEquipoAire(fila({ matriz: 'Agua' }))).toBe(false);
  });

  it('una acreditación suspendida no entra', () => {
    expect(esRegistroDeEquipoAire(fila({ estado_de_la_acreditaci_n: 'Suspendida' }))).toBe(false);
  });

  it('sin número de serie no entra', () => {
    for (const serie of ['', 'No aplica', 'N/A', '---', ' , ; ']) {
      expect(esRegistroDeEquipoAire(fila({ identificaci_n_de_equipo: serie })), serie).toBe(false);
    }
  });
});

describe('codigosEpa', () => {
  it('saca los códigos del método, sin repetir', () => {
    expect(codigosEpa('Método RFPS-0498-116 o RFPS-0498-117; ver RFPS-0498-116')).toEqual([
      'RFPS-0498-116',
      'RFPS-0498-117',
    ]);
  });

  it('los escribe con guiones aunque el dataset ponga espacios', () => {
    expect(codigosEpa('Apéndice L. EQPM 0311-195')).toEqual(['EQPM-0311-195']);
    expect(codigosEpa('Método de Referencia Manual\nRFPS- 0202-141')).toEqual(['RFPS-0202-141']);
    expect(codigosEpa('Manual:RFPS 0498-116')).toEqual(['RFPS-0498-116']);
  });

  it('la errata «RFNA-1289-0704» cuenta como RFNA-1289-070', () => {
    expect(codigosEpa('Apéndice F. RFNA-1289-0704')).toEqual(['RFNA-1289-070']);
  });

  it('un método sin código EPA no da ninguno', () => {
    expect(codigosEpa('SM 2320 B')).toEqual([]);
    expect(codigosEpa('Norma UNE-EN 16450')).toEqual([]);
    expect(codigosEpa('')).toEqual([]);
  });
});

describe('agruparEquipos', () => {
  it('arma la ficha de un equipo a partir de su fila', () => {
    expect(agruparEquipos([fila()])).toEqual([
      {
        codigo: '201',
        laboratorio: 'LABORATORIO DE AIRE DEL NORTE S.A.S.',
        nit: '900.000.001-7',
        ciudad: 'Bucaramanga',
        departamento: 'Santander',
        contacto: 'Contacto Ficticio Uno',
        telefono: '6070000001',
        correo: 'aire.norte@example.com',
        serie: 'SN-0001',
        estaciones: ['Estación Ficticia Centro'],
        marcasYModelos: [TISCH],
        codigosEpa: ['RFPS-0202-141'],
        variables: ['Material Particulado Menor a 10 micras'],
        vigenciaMasProxima: '2027-04-21',
      },
    ]);
  });

  it('un analizador repetido en tres filas es un equipo con tres variables', () => {
    const metodo = 'Método de Referencia Automatizado RFNA-1194-099';
    const equipos = agruparEquipos([
      fila({ m_todo: metodo, identificaci_n_de_equipo: 'AN-0100', variable: 'Óxidos de Nitrógeno' }),
      fila({ m_todo: metodo, identificaci_n_de_equipo: 'AN-0100', variable: 'Dióxido de Nitrógeno' }),
      fila({ m_todo: metodo, identificaci_n_de_equipo: 'AN-0100', variable: 'Monóxido de Nitrógeno' }),
    ]);
    expect(equipos).toHaveLength(1);
    expect(equipos[0].variables).toEqual(['Dióxido de Nitrógeno', 'Monóxido de Nitrógeno', 'Óxidos de Nitrógeno']);
    expect(equipos[0].marcasYModelos).toEqual([{ marca: 'Teledyne API', modelo: '200E / T200 / N200 Series' }]);
  });

  it('la misma serie en dos laboratorios son dos equipos', () => {
    const equipos = agruparEquipos([
      fila({ c_digo_de_laboratorio: '201' }),
      fila({ c_digo_de_laboratorio: '202', nombre_del_laboratorio: 'LABORATORIO DEL SUR LTDA.' }),
    ]);
    expect(equipos.map((e) => [e.codigo, e.serie])).toEqual([
      ['201', 'SN-0001'],
      ['202', 'SN-0001'],
    ]);
  });

  it('una fila con varias series da un equipo por serie', () => {
    const equipos = agruparEquipos([fila({ identificaci_n_de_equipo: 'SN-0001, SN-0002;SN-0003\nSN-0004' })]);
    expect(series(equipos)).toEqual(['SN-0001', 'SN-0002', 'SN-0003', 'SN-0004']);
  });

  it('la serie se compara en mayúsculas y se queda con la primera grafía', () => {
    const equipos = agruparEquipos([
      fila({ identificaci_n_de_equipo: 'sn-0001' }),
      fila({ identificaci_n_de_equipo: 'SN-0001', variable: 'Partículas Suspendidas Totales' }),
    ]);
    expect(equipos).toHaveLength(1);
    expect(equipos[0].serie).toBe('sn-0001');
    expect(equipos[0].variables).toEqual(['Material Particulado Menor a 10 micras', 'Partículas Suspendidas Totales']);
  });

  it('las estaciones, distintas y ordenadas; sin ninguna, la lista va vacía («Sin estación»)', () => {
    const [conEstaciones, sinEstacion] = agruparEquipos([
      fila({ nombre_de_la_estaci_n: 'Estación Ficticia Sur' }),
      fila({ nombre_de_la_estaci_n: 'Estación Ficticia Centro' }),
      fila({ nombre_de_la_estaci_n: 'No aplica' }),
      fila({ identificaci_n_de_equipo: 'SN-0002', nombre_de_la_estaci_n: '---' }),
    ]);
    expect(conEstaciones.estaciones).toEqual(['Estación Ficticia Centro', 'Estación Ficticia Sur']);
    expect(sinEstacion.estaciones).toEqual([]);
  });

  it('un método sin código conocido deja el equipo sin marca («Sin identificar»), con su código EPA', () => {
    const [sinMarca] = agruparEquipos([fila({ m_todo: 'Método de Referencia Automatizado RFNA-1289-0704' })]);
    expect(sinMarca.marcasYModelos).toEqual([]);
    expect(sinMarca.codigosEpa).toEqual(['RFNA-1289-070']);
  });

  it('junta los pares distintos de marca y modelo, ordenados, y sus códigos', () => {
    const [conDosPares] = agruparEquipos([
      fila(),
      fila({ m_todo: 'Método Equivalente Automatizado EQPM-0311-195', variable: 'Material Particulado Menor a 2,5 micras' }),
      fila({ variable: 'Partículas Suspendidas Totales' }),
    ]);
    expect(conDosPares.marcasYModelos).toEqual([GRIMM, TISCH]);
    expect(conDosPares.codigosEpa).toEqual(['EQPM-0311-195', 'RFPS-0202-141']);
  });

  it('un código escrito con espacios también se identifica', () => {
    const [conEspacios] = agruparEquipos([fila({ m_todo: 'Método Equivalente Automatizado EQPM 0311-195' })]);
    expect(conEspacios.marcasYModelos).toEqual([GRIMM]);
    expect(conEspacios.codigosEpa).toEqual(['EQPM-0311-195']);
  });

  it('la vigencia más próxima es la fecha «hasta» más temprana; «---» no cuenta', () => {
    const [conFechas] = agruparEquipos([
      fila({ hasta: '2027-04-21T00:00:00.000' }),
      fila({ hasta: '2026-12-01T00:00:00.000' }),
      fila({ hasta: '---' }),
    ]);
    expect(conFechas.vigenciaMasProxima).toBe('2026-12-01');
    expect(agruparEquipos([fila({ hasta: '---' })])[0].vigenciaMasProxima).toBeNull();
  });

  it('cada dato de la ficha es el primero con valor: un «No aplica» no tapa el de otra fila', () => {
    const [ficha] = agruparEquipos([
      fila({ contacto: 'No aplica', tel_fono: '---' }),
      fila({ contacto: 'Contacto Ficticio Dos', tel_fono: '6070000002' }),
    ]);
    expect(ficha.contacto).toBe('Contacto Ficticio Dos');
    expect(ficha.telefono).toBe('6070000002');
  });

  it('deja fuera lo que no es un equipo de aire', () => {
    expect(
      agruparEquipos([
        fila({ estado_de_la_acreditaci_n: 'Suspendida' }),
        fila({ componente: 'Fuentes Fijas' }),
        fila({ identificaci_n_de_equipo: 'No aplica' }),
      ]),
    ).toEqual([]);
  });
});

describe('ordenarEquipos', () => {
  it('por departamento, ciudad, laboratorio, estación y serie', () => {
    const ordenados = ordenarEquipos([
      equipo({ serie: 'F', laboratorio: 'Beta', estaciones: ['Norte'] }),
      equipo({ serie: 'D', laboratorio: 'Beta', estaciones: ['Centro'] }),
      equipo({ serie: 'E', laboratorio: 'Beta', estaciones: ['Norte'] }),
      equipo({ serie: 'C', laboratorio: 'Alfa' }),
      equipo({ serie: 'B', ciudad: 'Barrancabermeja' }),
      equipo({ serie: 'A', departamento: 'Antioquia', ciudad: 'Medellín' }),
    ]);
    expect(series(ordenados)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('«Sin estación» va al final de su laboratorio', () => {
    const ordenados = ordenarEquipos([
      equipo({ serie: 'X', estaciones: [] }),
      equipo({ serie: 'Y', estaciones: ['Zona Industrial'] }),
    ]);
    expect(series(ordenados)).toEqual(['Y', 'X']);
  });

  it('no toca la lista recibida', () => {
    const lista = [equipo({ serie: 'B' }), equipo({ serie: 'A' })];
    ordenarEquipos(lista);
    expect(series(lista)).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Ejecuta y comprueba que fallan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/baseInstalada.test.ts`
Expected: FAIL, las 23 pruebas nuevas (`TypeError: esRegistroDeEquipoAire is not a function` y parecidos). Las 8 de la Tarea 1 siguen pasando.

- [ ] **Step 3: Escribe la implementación mínima**

En `apps/laboratorios-ambientales/src/lib/baseInstalada.ts`, sustituye:

```ts
// Base instalada de aire: un equipo por código de laboratorio + número de serie,
// sacado del dataset 2waz-acaa. Ver
// docs/superpowers/specs/2026-11-27-base-instalada-aire-design.md.
```

por:

```ts
// Base instalada de aire: un equipo por código de laboratorio + número de serie,
// sacado del dataset 2waz-acaa. Ver
// docs/superpowers/specs/2026-11-27-base-instalada-aire-design.md.
import type { Laboratorio } from '../types';
import { extractEquipment } from './equipment';
import { fechaDeHasta } from './fechas';
import { distintos } from './prospects';
```

Sustituye:

```ts
    .filter((trozo) => !esValorVacio(trozo));
}
```

por:

```ts
    .filter((trozo) => !esValorVacio(trozo));
}

// Los dos componentes del aire que traen equipos con número de serie: los
// literales que da normalizeComponente para cualquier grafía del dataset.
const COMPONENTES_CON_EQUIPOS = new Set(['Calidad del Aire', 'Olores Ofensivos']);

export const SIN_ESTACION = 'Sin estación';
export const SIN_IDENTIFICAR = 'Sin identificar';

export type MarcaModelo = { marca: string; modelo: string };

// Un equipo: la pareja código de laboratorio + serie, con todas sus filas.
export type EquipoInstalado = {
  codigo: string;
  laboratorio: string;
  nit: string;
  ciudad: string;
  departamento: string;
  contacto: string;
  telefono: string;
  correo: string;
  // Tal como aparece la primera vez.
  serie: string;
  // Distintas y ordenadas; vacía = «Sin estación».
  estaciones: string[];
  // Los pares distintos que reconoce extractEquipment, ordenados; vacía = «Sin identificar».
  marcasYModelos: MarcaModelo[];
  // Los códigos EPA distintos que citan sus métodos, reconocidos o no, ordenados.
  codigosEpa: string[];
  // Distintas y ordenadas.
  variables: string[];
  // AAAA-MM-DD, o null si ninguna fila trae una fecha válida.
  vigenciaMasProxima: string | null;
};

export function esRegistroDeEquipoAire(
  registro: Pick<Laboratorio, 'estado' | 'matriz' | 'componente' | 'serie'>,
): boolean {
  return (
    registro.estado === 'Activa' &&
    registro.matriz === 'Aire' &&
    COMPONENTES_CON_EQUIPOS.has(registro.componente) &&
    separarSeries(registro.serie ?? '').length > 0
  );
}

// Un código de designación EPA: casi siempre «RFPS-0202-141», a veces con
// espacios en vez de guiones («EQPM 0311-195», «RFPS- 0202-141»). Sin \b al
// final a propósito: el dataset escribe una vez «RFNA-1289-0704», que así cuenta
// como RFNA-1289-070, un código que no está en la lista de la EPA.
const CODIGO_EPA = /\b(RF|EQ)([A-Z]{2})[\s-]*(\d{4})[\s-]*(\d{3})/g;

// El método con sus códigos EPA escritos con guiones: extractEquipment busca el
// código como subcadena y, si no, no reconocería «EQPM 0311-195».
export function normalizarCodigosEpa(metodo: string): string {
  return metodo.replace(CODIGO_EPA, '$1$2-$3-$4');
}

// Los códigos EPA que cita un método, con guiones y sin repetir.
export function codigosEpa(metodo: string): string[] {
  return [...new Set(normalizarCodigosEpa(metodo).match(CODIGO_EPA) ?? [])];
}

const compararTexto = (a: string, b: string): number => a.localeCompare(b, 'es');

// Sin código de laboratorio, por nombre, como en Prospectos. Los prefijos
// impiden que un nombre choque con un código.
function idLaboratorio(codigo: string, nombre: string): string {
  return codigo ? `codigo:${codigo}` : `nombre:${nombre}`;
}

// Los datos de la ficha que salen de la primera fila con valor.
type CampoDeFicha = 'codigo' | 'nombreLaboratorio' | 'nit' | 'ciudad' | 'departamento' | 'contacto' | 'telefono' | 'correo';

function aEquipo(filas: Laboratorio[], serie: string): EquipoInstalado {
  // El primer valor no vacío en el orden del dataset, como en Prospectos, pero
  // con esValorVacio: un «No aplica» en una fila no tapa el dato de otra.
  const primero = (campo: CampoDeFicha): string => {
    for (const fila of filas) {
      const valor = fila[campo].trim();
      if (!esValorVacio(valor)) return valor;
    }
    return '';
  };

  const pares = new Map<string, MarcaModelo>();
  const codigos = new Set<string>();
  for (const fila of filas) {
    const identificado = extractEquipment(normalizarCodigosEpa(fila.metodo));
    if (identificado) {
      pares.set(`${identificado.brand}\n${identificado.model}`, {
        marca: identificado.brand,
        modelo: identificado.model,
      });
    }
    for (const codigo of codigosEpa(fila.metodo)) codigos.add(codigo);
  }

  // AAAA-MM-DD se ordena bien como texto: tras el sort, la primera es la más temprana.
  const fechas = filas
    .map((fila) => fechaDeHasta(fila.hasta))
    .filter((fecha): fecha is string => fecha !== null)
    .sort();

  return {
    codigo: primero('codigo'),
    laboratorio: primero('nombreLaboratorio'),
    nit: primero('nit'),
    ciudad: primero('ciudad'),
    departamento: primero('departamento'),
    contacto: primero('contacto'),
    telefono: primero('telefono'),
    correo: primero('correo'),
    serie,
    estaciones: distintos(filas.map((fila) => fila.estacion ?? '')),
    marcasYModelos: [...pares.values()].sort(
      (a, b) => compararTexto(a.marca, b.marca) || compararTexto(a.modelo, b.modelo),
    ),
    codigosEpa: [...codigos].sort(),
    variables: distintos(filas.map((fila) => fila.variable)),
    vigenciaMasProxima: fechas[0] ?? null,
  };
}

/**
 * Un equipo por pareja código de laboratorio + serie (la serie, en mayúsculas
 * para comparar). Solo entran los registros de esRegistroDeEquipoAire. El Map
 * conserva el orden del dataset: el de la pantalla lo pone ordenarEquipos.
 */
export function agruparEquipos(data: Laboratorio[]): EquipoInstalado[] {
  const grupos = new Map<string, { filas: Laboratorio[]; serie: string }>();
  for (const registro of data) {
    if (!esRegistroDeEquipoAire(registro)) continue;
    const laboratorio = idLaboratorio(registro.codigo.trim(), registro.nombreLaboratorio.trim());
    for (const serie of separarSeries(registro.serie ?? '')) {
      // Un salto de línea nunca va dentro de una serie: separarSeries parte por él.
      const id = `${laboratorio}\n${serie.toUpperCase()}`;
      const grupo = grupos.get(id);
      if (grupo) grupo.filas.push(registro);
      else grupos.set(id, { filas: [registro], serie });
    }
  }
  return [...grupos.values()].map(({ filas, serie }) => aEquipo(filas, serie));
}

// «Sin estación» va al final de su laboratorio.
function compararEstacion(a: EquipoInstalado, b: EquipoInstalado): number {
  const sinA = a.estaciones.length === 0;
  const sinB = b.estaciones.length === 0;
  if (sinA || sinB) return Number(sinA) - Number(sinB);
  return compararTexto(a.estaciones[0], b.estaciones[0]);
}

/** Por departamento, ciudad, laboratorio, estación y serie. Devuelve una lista nueva. */
export function ordenarEquipos(equipos: EquipoInstalado[]): EquipoInstalado[] {
  return [...equipos].sort(
    (a, b) =>
      compararTexto(a.departamento, b.departamento) ||
      compararTexto(a.ciudad, b.ciudad) ||
      compararTexto(a.laboratorio, b.laboratorio) ||
      compararEstacion(a, b) ||
      compararTexto(a.serie, b.serie),
  );
}
```

- [ ] **Step 4: Ejecuta y comprueba que pasan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/baseInstalada.test.ts`
Expected: PASS, 31 pruebas.

Run: `cd apps/laboratorios-ambientales && npx tsc -b && npx eslint src/lib/baseInstalada.ts src/lib/baseInstalada.test.ts && npm test`
Expected: sin errores. Suite: 13 ficheros, 256 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/baseInstalada.ts apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts
git commit -F - <<'EOF'
feat(laboratorios): agrupación de la base instalada de aire por equipo

Un equipo por código de laboratorio + serie, con las filas activas de
calidad del aire y olores ofensivos que traen serie. Junta estaciones,
pares de marca y modelo, códigos EPA (también los escritos con espacios),
variables y la vigencia más próxima. Orden por departamento, ciudad,
laboratorio, estación y serie.
EOF
```

---

### Task 5: Base instalada — filtros, opciones y recuento

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/baseInstalada.ts`
- Test: `apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts`

- [ ] **Step 1: Escribe las pruebas que fallan**

En `apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts`, sustituye:

```ts
import type { EquipoInstalado } from './baseInstalada';
import {
  agruparEquipos,
  codigosEpa,
  esRegistroDeEquipoAire,
  esValorVacio,
  ordenarEquipos,
  separarSeries,
} from './baseInstalada';
```

por:

```ts
import type { CruceZoho } from './clientes';
import type { EquipoInstalado, FiltrosEquipos } from './baseInstalada';
import {
  FILTROS_VACIOS,
  SIN_IDENTIFICAR,
  agruparEquipos,
  codigosEpa,
  esRegistroDeEquipoAire,
  esValorVacio,
  filtrarEquipos,
  marcasDe,
  opcionesDeFiltro,
  ordenarEquipos,
  separarSeries,
  textoRecuento,
} from './baseInstalada';
```

Sustituye:

```ts
  it('no toca la lista recibida', () => {
    const lista = [equipo({ serie: 'B' }), equipo({ serie: 'A' })];
    ordenarEquipos(lista);
    expect(series(lista)).toEqual(['B', 'A']);
  });
});
```

por:

```ts
  it('no toca la lista recibida', () => {
    const lista = [equipo({ serie: 'B' }), equipo({ serie: 'A' })];
    ordenarEquipos(lista);
    expect(series(lista)).toEqual(['B', 'A']);
  });
});

const HOY = '2026-11-27';

// Tres equipos ya armados: uno en el Valle con marca Teledyne; dos de un mismo
// NIT en Antioquia (dos sedes), uno sin marca ni estación. Datos ficticios.
const LISTA = [
  equipo({
    codigo: '1',
    serie: 'S1',
    laboratorio: 'LABORATORIO QUÍMICO DEL VALLE',
    nit: '900.111.222-3',
    departamento: 'Valle del Cauca',
    ciudad: 'Cali',
    estaciones: ['Estación Ficticia Norte'],
    marcasYModelos: [{ marca: 'Teledyne API', modelo: '100 Series' }],
  }),
  equipo({
    codigo: '2',
    serie: 'S2',
    laboratorio: 'Aire de Antioquia',
    nit: '800.333.444-5',
    departamento: 'Antioquia',
    ciudad: 'Medellín',
    estaciones: [],
    marcasYModelos: [],
  }),
  equipo({
    codigo: '3',
    serie: 'AB-778',
    laboratorio: 'Aire de Antioquia',
    nit: '800.333.444-5',
    departamento: 'Antioquia',
    ciudad: 'Rionegro',
    estaciones: ['Estación Ficticia Sur'],
  }),
];

const filtrar = (cambios: Partial<FiltrosEquipos>, cruce: CruceZoho | null = null): string[] =>
  series(filtrarEquipos(LISTA, { ...FILTROS_VACIOS, ...cambios }, cruce, HOY));

describe('filtrarEquipos', () => {
  it('sin filtros, todos, en el orden recibido', () => {
    expect(filtrar({})).toEqual(['S1', 'S2', 'AB-778']);
  });

  it('busca por nombre sin distinguir mayúsculas ni tildes', () => {
    expect(filtrar({ busqueda: 'quimico' })).toEqual(['S1']);
    expect(filtrar({ busqueda: '  AIRE de ANTIOQUÍA ' })).toEqual(['S2', 'AB-778']);
  });

  it('busca por NIT, con o sin puntos ni guion', () => {
    expect(filtrar({ busqueda: '900.111' })).toEqual(['S1']);
    expect(filtrar({ busqueda: '800333444' })).toEqual(['S2', 'AB-778']);
  });

  it('busca por estación', () => {
    expect(filtrar({ busqueda: 'ficticia sur' })).toEqual(['AB-778']);
  });

  it('busca por serie', () => {
    expect(filtrar({ busqueda: 'ab-778' })).toEqual(['AB-778']);
  });

  it('departamento y ciudad', () => {
    expect(filtrar({ departamento: 'Antioquia' })).toEqual(['S2', 'AB-778']);
    expect(filtrar({ departamento: 'Antioquia', ciudad: 'Rionegro' })).toEqual(['AB-778']);
  });

  it('marca: pasa si alguno de sus pares la tiene, también dentro de una marca con varios fabricantes', () => {
    expect(filtrar({ marca: 'Teledyne API' })).toEqual(['S1']);
    expect(filtrar({ marca: 'New Star Environmental' })).toEqual(['AB-778']);
  });

  it('marca «Sin identificar»: los que no tienen ningún par', () => {
    expect(filtrar({ marca: SIN_IDENTIFICAR })).toEqual(['S2']);
  });

  it('cliente: con el cruce filtra por estado; sin cruce no filtra', () => {
    const cruce: CruceZoho = new Map([
      ['900111222', { ultimaFactura: '2026-10-01', ocmaVendido: null, ultimosRepuestos: null }],
    ]);
    expect(filtrar({ cliente: 'activo' }, cruce)).toEqual(['S1']);
    expect(filtrar({ cliente: 'no-en-zoho' }, cruce)).toEqual(['S2', 'AB-778']);
    expect(filtrar({ cliente: 'activo' }, null)).toEqual(['S1', 'S2', 'AB-778']);
  });

  it('los filtros se suman', () => {
    expect(filtrar({ departamento: 'Antioquia', marca: SIN_IDENTIFICAR, busqueda: 'aire' })).toEqual(['S2']);
    expect(filtrar({ departamento: 'Valle del Cauca', busqueda: 'aire' })).toEqual([]);
  });
});

describe('marcasDe', () => {
  it('parte una marca con varios fabricantes; una sola queda igual', () => {
    expect(marcasDe('Tisch Environmental / New Star Environmental')).toEqual([
      'Tisch Environmental',
      'New Star Environmental',
    ]);
    expect(marcasDe('Met One Instruments, Inc.')).toEqual(['Met One Instruments, Inc.']);
  });
});

describe('opcionesDeFiltro', () => {
  it('los departamentos de todos los equipos, distintos y ordenados', () => {
    expect(opcionesDeFiltro(LISTA, '').departamentos).toEqual(['Antioquia', 'Valle del Cauca']);
  });

  it('sin departamento, todas las ciudades; con uno, solo las suyas', () => {
    expect(opcionesDeFiltro(LISTA, '').ciudades).toEqual(['Cali', 'Medellín', 'Rionegro']);
    expect(opcionesDeFiltro(LISTA, 'Antioquia').ciudades).toEqual(['Medellín', 'Rionegro']);
  });

  it('las marcas presentes, partidas y ordenadas, con «Sin identificar» al final', () => {
    expect(opcionesDeFiltro(LISTA, '').marcas).toEqual([
      'New Star Environmental',
      'Teledyne API',
      'Tisch Environmental',
      'Sin identificar',
    ]);
  });

  it('si todos los equipos tienen marca, no ofrece «Sin identificar»', () => {
    expect(opcionesDeFiltro([LISTA[0]], '').marcas).toEqual(['Teledyne API']);
  });
});

describe('textoRecuento', () => {
  it('singular y plural', () => {
    expect(textoRecuento([])).toBe('0 equipos de 0 laboratorios');
    expect(textoRecuento([equipo()])).toBe('1 equipo de 1 laboratorio');
  });

  it('cuenta los laboratorios por código, no los equipos', () => {
    expect(textoRecuento([equipo({ serie: 'A' }), equipo({ serie: 'B' }), equipo({ codigo: '202', serie: 'C' })])).toBe(
      '3 equipos de 2 laboratorios',
    );
  });
});
```

- [ ] **Step 2: Ejecuta y comprueba que fallan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/baseInstalada.test.ts`
Expected: FAIL, las 17 pruebas nuevas (`filtrarEquipos`, `marcasDe`, `opcionesDeFiltro` y `textoRecuento` no existen todavía). Las 31 anteriores pasan.

- [ ] **Step 3: Escribe la implementación mínima**

En `apps/laboratorios-ambientales/src/lib/baseInstalada.ts`, sustituye:

```ts
import type { Laboratorio } from '../types';
import { extractEquipment } from './equipment';
import { fechaDeHasta } from './fechas';
import { distintos } from './prospects';
```

por:

```ts
import type { Laboratorio } from '../types';
import type { CruceZoho, EstadoCliente } from './clientes';
import { filtrarPorCliente } from './clientes';
import { extractEquipment } from './equipment';
import { fechaDeHasta } from './fechas';
import { clave, distintos, nitCoincide } from './prospects';
```

Sustituye:

```ts
      compararEstacion(a, b) ||
      compararTexto(a.serie, b.serie),
  );
}
```

por:

```ts
      compararEstacion(a, b) ||
      compararTexto(a.serie, b.serie),
  );
}

export type FiltrosEquipos = {
  busqueda: string;
  // '' = todos los departamentos.
  departamento: string;
  // '' = todas las ciudades.
  ciudad: string;
  // '' = todas; SIN_IDENTIFICAR = los que no tienen marca.
  marca: string;
  // '' = todos.
  cliente: EstadoCliente | '';
};

export const FILTROS_VACIOS: FiltrosEquipos = { busqueda: '', departamento: '', ciudad: '', marca: '', cliente: '' };

export type OpcionesDeFiltro = { departamentos: string[]; ciudades: string[]; marcas: string[] };

// Las marcas de un texto de marca: un código con varios fabricantes los trae
// unidos con « / » («Tisch Environmental / New Star Environmental»).
export function marcasDe(marca: string): string[] {
  return marca
    .split(' / ')
    .map((parte) => parte.trim())
    .filter(Boolean);
}

function tieneMarca(equipo: EquipoInstalado, marca: string): boolean {
  if (marca === SIN_IDENTIFICAR) return equipo.marcasYModelos.length === 0;
  return equipo.marcasYModelos.some((par) => marcasDe(par.marca).includes(marca));
}

// `busqueda` ya pasó por clave: la misma normalización que en Prospectos.
function coincideBusqueda(equipo: EquipoInstalado, busqueda: string): boolean {
  return (
    clave(equipo.laboratorio).includes(busqueda) ||
    nitCoincide(equipo.nit, busqueda) ||
    equipo.estaciones.some((estacion) => clave(estacion).includes(busqueda)) ||
    clave(equipo.serie).includes(busqueda)
  );
}

/**
 * Los filtros se suman y se conserva el orden recibido. Sin cruce (consultando
 * o con error), el de cliente no cuenta. `hoy` va en AAAA-MM-DD: lo necesita
 * estadoCliente para saber si un cliente es activo.
 */
export function filtrarEquipos(
  equipos: EquipoInstalado[],
  filtros: FiltrosEquipos,
  cruce: CruceZoho | null,
  hoy: string,
): EquipoInstalado[] {
  const busqueda = clave(filtros.busqueda);
  const filtrados = equipos.filter((equipo) => {
    if (filtros.departamento && equipo.departamento !== filtros.departamento) return false;
    if (filtros.ciudad && equipo.ciudad !== filtros.ciudad) return false;
    if (filtros.marca && !tieneMarca(equipo, filtros.marca)) return false;
    return busqueda === '' || coincideBusqueda(equipo, busqueda);
  });
  return filtrarPorCliente(filtrados, filtros.cliente, cruce, hoy);
}

/**
 * Las opciones de los desplegables, de todos los equipos y no de los filtrados:
 * así lo elegido no desaparece de su lista. Las ciudades, solo las del
 * departamento elegido. Las marcas, cada fabricante por separado (marcasDe), y
 * «Sin identificar» al final si hay algún equipo así.
 */
export function opcionesDeFiltro(equipos: EquipoInstalado[], departamento: string): OpcionesDeFiltro {
  const delDepartamento = departamento ? equipos.filter((equipo) => equipo.departamento === departamento) : equipos;
  const marcas = distintos(equipos.flatMap((equipo) => equipo.marcasYModelos.flatMap((par) => marcasDe(par.marca))));
  const haySinIdentificar = equipos.some((equipo) => equipo.marcasYModelos.length === 0);
  return {
    departamentos: distintos(equipos.map((equipo) => equipo.departamento)),
    ciudades: distintos(delDepartamento.map((equipo) => equipo.ciudad)),
    marcas: haySinIdentificar ? [...marcas, SIN_IDENTIFICAR] : marcas,
  };
}

/** «N equipos de M laboratorios», con los laboratorios contados por código. */
export function textoRecuento(equipos: EquipoInstalado[]): string {
  const laboratorios = new Set(equipos.map((equipo) => idLaboratorio(equipo.codigo, equipo.laboratorio))).size;
  const cifra = (n: number): string => n.toLocaleString('es-CO');
  const equiposTexto = `${cifra(equipos.length)} ${equipos.length === 1 ? 'equipo' : 'equipos'}`;
  const laboratoriosTexto = `${cifra(laboratorios)} ${laboratorios === 1 ? 'laboratorio' : 'laboratorios'}`;
  return `${equiposTexto} de ${laboratoriosTexto}`;
}
```

- [ ] **Step 4: Ejecuta y comprueba que pasan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/baseInstalada.test.ts`
Expected: PASS, 48 pruebas.

Run: `cd apps/laboratorios-ambientales && npx tsc -b && npx eslint src/lib/baseInstalada.ts src/lib/baseInstalada.test.ts && npm test`
Expected: sin errores. Suite: 13 ficheros, 273 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/baseInstalada.ts apps/laboratorios-ambientales/src/lib/baseInstalada.test.ts
git commit -F - <<'EOF'
feat(laboratorios): filtros, opciones y recuento de la base instalada

Búsqueda por laboratorio, NIT, estación o serie con la normalización de
Prospectos; departamento, ciudad del departamento elegido, marca (cada
fabricante por separado, y «Sin identificar») y cliente. Recuento «N equipos
de M laboratorios».
EOF
```

---

### Task 6: Excel de la base instalada

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/exportBaseInstalada.ts`
- Create: `apps/laboratorios-ambientales/src/lib/exportBaseInstalada.test.ts`

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `apps/laboratorios-ambientales/src/lib/exportBaseInstalada.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { EquipoInstalado } from './baseInstalada';
import type { CruceZoho } from './clientes';
import { COLUMNAS_EXCEL, HOJA_EXCEL, filasExcel, nombreDeFichero } from './exportBaseInstalada';

// Hoy + 6 meses = 2027-05-27.
const HOY = '2026-11-27';

// Datos ficticios: el repo es público. Las marcas y los códigos son reales.
const equipo = (over: Partial<EquipoInstalado> = {}): EquipoInstalado => ({
  codigo: '201',
  laboratorio: 'LABORATORIO DE AIRE DEL NORTE S.A.S.',
  nit: '900.000.001-7',
  ciudad: 'Bucaramanga',
  departamento: 'Santander',
  contacto: 'Contacto Ficticio Uno',
  telefono: '6070000001',
  correo: 'aire.norte@example.com',
  serie: 'SN-0001',
  estaciones: ['Estación Ficticia Centro', 'Estación Ficticia Sur'],
  marcasYModelos: [
    { marca: 'Grimm', modelo: 'EDM180' },
    { marca: 'Tisch Environmental / New Star Environmental', modelo: 'TE-6070 / NS-6070' },
  ],
  codigosEpa: ['EQPM-0311-195', 'RFPS-0202-141'],
  variables: ['Material Particulado Menor a 10 micras', 'Partículas Suspendidas Totales'],
  vigenciaMasProxima: '2027-04-21',
  ...over,
});

describe('filasExcel', () => {
  it('la primera fila es la cabecera, con las dieciocho columnas en su orden', () => {
    expect(filasExcel([], HOY)).toEqual([
      [
        'Laboratorio',
        'NIT',
        'Código',
        'Ciudad',
        'Departamento',
        'Estación',
        'Marca',
        'Modelo',
        'Códigos EPA',
        'Variables',
        'Serie',
        'Vigencia más próxima',
        'Estado de la vigencia',
        'Contacto',
        'Teléfono',
        'Correo',
        'Cliente',
        'Última factura',
      ],
    ]);
  });

  it('una fila por equipo; las listas, unidas por «; », y cada marca con su modelo en el mismo orden', () => {
    expect(filasExcel([equipo()], HOY)[1]).toEqual([
      'LABORATORIO DE AIRE DEL NORTE S.A.S.',
      '900.000.001-7',
      '201',
      'Bucaramanga',
      'Santander',
      'Estación Ficticia Centro; Estación Ficticia Sur',
      'Grimm; Tisch Environmental / New Star Environmental',
      'EDM180; TE-6070 / NS-6070',
      'EQPM-0311-195; RFPS-0202-141',
      'Material Particulado Menor a 10 micras; Partículas Suspendidas Totales',
      'SN-0001',
      '2027-04-21',
      'Vence en menos de 6 meses',
      'Contacto Ficticio Uno',
      '6070000001',
      'aire.norte@example.com',
      '',
      '',
    ]);
  });

  it('sin estación ni marca: «Sin estación», «Sin identificar» y el modelo vacío', () => {
    const fila = filasExcel([equipo({ estaciones: [], marcasYModelos: [], codigosEpa: ['RFNA-1289-070'] })], HOY)[1];
    expect(fila[5]).toBe('Sin estación');
    expect(fila[6]).toBe('Sin identificar');
    expect(fila[7]).toBe('');
    expect(fila[8]).toBe('RFNA-1289-070');
  });

  it('sin fecha, la vigencia va vacía y el estado dice «Sin fecha»', () => {
    const fila = filasExcel([equipo({ vigenciaMasProxima: null })], HOY)[1];
    expect(fila[11]).toBe('');
    expect(fila[12]).toBe('Sin fecha');
  });

  it('con el cruce, las dos últimas columnas llevan el estado y la última factura', () => {
    const cruce: CruceZoho = new Map([
      ['900000001', { ultimaFactura: '2026-03-10', ocmaVendido: '2024-05-02', ultimosRepuestos: null }],
    ]);
    expect(filasExcel([equipo()], HOY, cruce)[1].slice(-2)).toEqual(['Cliente activo', '2026-03-10']);
  });

  it('con el cruce, un laboratorio que no está en Zoho lo dice y deja la fecha vacía', () => {
    expect(filasExcel([equipo()], HOY, new Map())[1].slice(-2)).toEqual(['No está en Zoho', '']);
  });

  it('sin cruce (consultando o con error), las dos columnas van vacías', () => {
    expect(filasExcel([equipo()], HOY, null)[1].slice(-2)).toEqual(['', '']);
  });

  it('respeta el orden recibido, que es el de la pantalla', () => {
    const filas = filasExcel([equipo({ serie: 'Z-1' }), equipo({ serie: 'A-1' })], HOY);
    expect(filas.slice(1).map((fila) => fila[10])).toEqual(['Z-1', 'A-1']);
  });

  it('cada fila tiene una celda por columna', () => {
    const sinNada = equipo({ estaciones: [], marcasYModelos: [], codigosEpa: [], vigenciaMasProxima: null });
    for (const fila of filasExcel([equipo(), sinNada], HOY, new Map())) {
      expect(fila).toHaveLength(COLUMNAS_EXCEL.length);
    }
  });

  it('en la hoja, un texto que empieza por «=» es una celda de texto y no una fórmula', () => {
    const hoja = XLSX.utils.aoa_to_sheet(filasExcel([equipo({ laboratorio: '=HYPERLINK("x")' })], HOY));
    const celda = hoja['A2'] as XLSX.CellObject;
    expect(celda.t).toBe('s');
    expect(celda.f).toBeUndefined();
    expect(celda.v).toBe('=HYPERLINK("x")');
  });

  it('la hoja se llama «Base instalada de aire»', () => {
    expect(HOJA_EXCEL).toBe('Base instalada de aire');
  });
});

describe('nombreDeFichero', () => {
  it('lleva la fecha', () => {
    expect(nombreDeFichero(HOY)).toBe('base-instalada-aire-2026-11-27.xlsx');
  });
});
```

- [ ] **Step 2: Ejecuta y comprueba que fallan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/exportBaseInstalada.test.ts`
Expected: FAIL, porque no se encuentra el módulo `./exportBaseInstalada`.

- [ ] **Step 3: Escribe la implementación mínima**

Crea `apps/laboratorios-ambientales/src/lib/exportBaseInstalada.ts`:

```ts
import type { EquipoInstalado } from './baseInstalada';
import { SIN_ESTACION, SIN_IDENTIFICAR } from './baseInstalada';
import { ETIQUETA_VIGENCIA, estadoVigencia } from './prospects';
import type { CruceZoho } from './clientes';
import { ETIQUETA_ESTADO_CLIENTE, estadoCliente, hechosDe } from './clientes';

// La única hoja del libro (Excel admite como mucho 31 caracteres).
export const HOJA_EXCEL = 'Base instalada de aire';

// Las columnas del Excel, en su orden.
export const COLUMNAS_EXCEL = [
  'Laboratorio',
  'NIT',
  'Código',
  'Ciudad',
  'Departamento',
  'Estación',
  'Marca',
  'Modelo',
  'Códigos EPA',
  'Variables',
  'Serie',
  'Vigencia más próxima',
  'Estado de la vigencia',
  'Contacto',
  'Teléfono',
  'Correo',
  'Cliente',
  'Última factura',
] as const;

const SEPARADOR = '; ';

// Las dos columnas del cruce con Zoho. Sin cruce (consultando o con error) van
// vacías: un «No está en Zoho» sin haber preguntado sería falso.
function celdasCliente(equipo: EquipoInstalado, hoy: string, cruce: CruceZoho | null): string[] {
  if (cruce === null) return ['', ''];
  return [ETIQUETA_ESTADO_CLIENTE[estadoCliente(equipo.nit, cruce, hoy)], hechosDe(equipo.nit, cruce)?.ultimaFactura ?? ''];
}

// La cabecera y una fila por equipo, en el orden recibido, que es el de la
// pantalla. Marca y Modelo van en el mismo orden: la marca n.º i es la del
// modelo n.º i. Todo es texto, y aoa_to_sheet escribe un texto como celda de
// texto: nada sale como fórmula y un NIT o una serie no pierden ceros.
export function filasExcel(equipos: EquipoInstalado[], hoy: string, cruce: CruceZoho | null = null): string[][] {
  return [
    [...COLUMNAS_EXCEL],
    ...equipos.map((equipo) => [
      equipo.laboratorio,
      equipo.nit,
      equipo.codigo,
      equipo.ciudad,
      equipo.departamento,
      equipo.estaciones.length === 0 ? SIN_ESTACION : equipo.estaciones.join(SEPARADOR),
      equipo.marcasYModelos.length === 0
        ? SIN_IDENTIFICAR
        : equipo.marcasYModelos.map((par) => par.marca).join(SEPARADOR),
      equipo.marcasYModelos.map((par) => par.modelo).join(SEPARADOR),
      equipo.codigosEpa.join(SEPARADOR),
      equipo.variables.join(SEPARADOR),
      equipo.serie,
      equipo.vigenciaMasProxima ?? '',
      ETIQUETA_VIGENCIA[estadoVigencia(equipo.vigenciaMasProxima, hoy)],
      equipo.contacto,
      equipo.telefono,
      equipo.correo,
      ...celdasCliente(equipo, hoy, cruce),
    ]),
  ];
}

export function nombreDeFichero(hoy: string): string {
  return `base-instalada-aire-${hoy}.xlsx`;
}
```

- [ ] **Step 4: Ejecuta y comprueba que pasan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/exportBaseInstalada.test.ts`
Expected: PASS, 12 pruebas.

Run: `cd apps/laboratorios-ambientales && npx tsc -b && npm test`
Expected: sin errores. Suite: 14 ficheros, 285 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/exportBaseInstalada.ts apps/laboratorios-ambientales/src/lib/exportBaseInstalada.test.ts
git commit -F - <<'EOF'
feat(laboratorios): Excel de la base instalada de aire

Dieciocho columnas, con las listas unidas por «; » y cada marca en el mismo
orden que su modelo. Cliente y Última factura van vacías mientras no hay
cruce con Zoho.
EOF
```

---

### Task 7: El cruce con Zoho sale a `useCruceZoho`

Prospectos tiene que comportarse igual que hoy. El cuerpo del hook es el código que hoy está en `Prospectos.tsx`, movido sin cambios. Sin pruebas (no hay jsdom): se comprueba con lint, tipos de la app y del portal, y la suite.

**Files:**
- Create: `apps/laboratorios-ambientales/src/hooks/useCruceZoho.ts`
- Modify: `apps/laboratorios-ambientales/src/pages/Prospectos.tsx`
- Modify: `apps/laboratorios-ambientales/src/components/CeldaCliente.tsx`

- [ ] **Step 1: Crea el hook**

Crea `apps/laboratorios-ambientales/src/hooks/useCruceZoho.ts`:

```ts
import { useEffect, useState } from 'react';
import type { CruceZoho, EstadoCruce, ResultadoCruce } from '../lib/clientes';
import { estadoDelCruce } from '../lib/clientes';
import { fetchClientesZoho } from '../services/clientesZoho';

export type CruceDeLaVista = {
  // El cruce, solo cuando está listo; null mientras se consulta o si falló.
  cruce: CruceZoho | null;
  estadoCruce: EstadoCruce;
  // Repite la consulta: es lo que hace el botón «Reintentar».
  reintentar: () => void;
};

/**
 * El cruce con Zoho de una lista de NIT base, para una vista. Salió de
 * Prospectos el 2026-11-27 para que lo use también la Base instalada de aire.
 * - La dependencia es el texto de los NIT y no la lista: si los datos se
 *   refrescan con los mismos NIT, no se repite la consulta.
 * - La petición se cancela al cerrar la vista o al cambiar los NIT.
 * - Cada resultado lleva la clave de su consulta: si cambian los NIT o se
 *   reintenta, el viejo deja de valer y la vista vuelve a «Consultando…»
 *   (estadoDelCruce). Nunca se enseña un cruce viejo como actual.
 */
export function useCruceZoho(nits: readonly string[]): CruceDeLaVista {
  const [resultado, setResultado] = useState<ResultadoCruce | null>(null);
  // Subirlo repite la consulta: es lo que hace «Reintentar».
  const [intento, setIntento] = useState(0);

  const claveNits = nits.join(',');
  const clave = `${claveNits}#${intento}`;
  // El efecto guarda el resultado con esa misma `clave` (no la rehace): si las
  // dos se escribieran por separado y se separaran, la vista se quedaría en
  // «Consultando…» para siempre. `intento` entra a través de `clave`.
  useEffect(() => {
    const controller = new AbortController();
    fetchClientesZoho(claveNits === '' ? [] : claveNits.split(','), controller.signal).then(
      (cruce) => {
        if (!controller.signal.aborted) setResultado({ clave, cruce });
      },
      (error: unknown) => {
        // Al cerrar la vista se aborta: eso no es un error que haya que enseñar.
        if (controller.signal.aborted) return;
        console.warn('No se pudo consultar Zoho', error);
        setResultado({ clave, cruce: null });
      },
    );
    return () => controller.abort();
  }, [claveNits, clave]);

  const estadoCruce = estadoDelCruce(resultado, clave);
  return {
    cruce: estadoCruce === 'listo' ? (resultado?.cruce ?? null) : null,
    estadoCruce,
    reintentar: () => setIntento((n) => n + 1),
  };
}
```

- [ ] **Step 2: Prospectos usa el hook**

En `apps/laboratorios-ambientales/src/pages/Prospectos.tsx`, sustituye:

```tsx
import { useEffect, useMemo, useState } from 'react';
```

por:

```tsx
import { useMemo, useState } from 'react';
```

Sustituye:

```tsx
import type { EstadoCliente, ResultadoCruce } from '../lib/clientes';
import {
  ESTADOS_CLIENTE,
  ETIQUETA_ESTADO_CLIENTE,
  estadoDelCruce,
  filtrarPorCliente,
  nitsParaConsultar,
} from '../lib/clientes';
import { fetchClientesZoho } from '../services/clientesZoho';
import CeldaCliente from '../components/CeldaCliente';
```

por:

```tsx
import type { EstadoCliente } from '../lib/clientes';
import { ESTADOS_CLIENTE, ETIQUETA_ESTADO_CLIENTE, filtrarPorCliente, nitsParaConsultar } from '../lib/clientes';
import { useCruceZoho } from '../hooks/useCruceZoho';
import CeldaCliente from '../components/CeldaCliente';
```

Sustituye:

```tsx
  const [filtroCliente, setFiltroCliente] = useState<EstadoCliente | ''>('');
  const [resultado, setResultado] = useState<ResultadoCruce | null>(null);
  // Subirlo repite la consulta: es lo que hace «Reintentar».
  const [intento, setIntento] = useState(0);
```

por:

```tsx
  const [filtroCliente, setFiltroCliente] = useState<EstadoCliente | ''>('');
```

Sustituye:

```tsx
  // Una sola consulta con los NIT de las dos pestañas. La dependencia es el texto
  // y no la lista: si los datos se refrescan con los mismos NIT, no se repite.
  const claveNits = useMemo(() => nitsParaConsultar(todos).join(','), [todos]);
  // Cada resultado lleva la clave de su consulta: si cambian los NIT o se
  // reintenta, el viejo deja de valer y la vista vuelve a «Consultando…».
  const clave = `${claveNits}#${intento}`;
  // El efecto guarda el resultado con esa misma `clave` (no la rehace): si las
  // dos se escribieran por separado y se separaran, la vista se quedaría en
  // «Consultando…» para siempre. `intento` entra a través de `clave`.
  useEffect(() => {
    const controller = new AbortController();
    fetchClientesZoho(claveNits === '' ? [] : claveNits.split(','), controller.signal).then(
      (cruce) => {
        if (!controller.signal.aborted) setResultado({ clave, cruce });
      },
      (error: unknown) => {
        // Al cerrar la vista se aborta: eso no es un error que haya que enseñar.
        if (controller.signal.aborted) return;
        console.warn('No se pudo consultar Zoho', error);
        setResultado({ clave, cruce: null });
      },
    );
    return () => controller.abort();
  }, [claveNits, clave]);

  const estadoCruce = estadoDelCruce(resultado, clave);
  const reintentar = () => setIntento((n) => n + 1);

  // Mientras no hay cruce, el filtro «Cliente» no cuenta y el Excel sale sin él.
  const cruceListo = estadoCruce === 'listo' ? (resultado?.cruce ?? null) : null;
  const clienteElegido = cruceListo === null ? '' : filtroCliente;
```

por:

```tsx
  // Una sola consulta con los NIT de las dos pestañas (ver useCruceZoho). El
  // cruce llega solo cuando está listo; mientras, es null.
  const nits = useMemo(() => nitsParaConsultar(todos), [todos]);
  const { cruce: cruceListo, estadoCruce, reintentar } = useCruceZoho(nits);

  // Mientras no hay cruce, el filtro «Cliente» no cuenta y el Excel sale sin él.
  const clienteElegido = cruceListo === null ? '' : filtroCliente;
```

El resto de `Prospectos.tsx` no cambia: sigue usando `cruceListo`, `estadoCruce` y `reintentar` con los mismos nombres.

- [ ] **Step 3: La opción `conOcma` de la celda**

En `apps/laboratorios-ambientales/src/components/CeldaCliente.tsx`, sustituye:

```tsx
type Props = {
  nit: string;
  cruce: CruceZoho | null;
  estadoCruce: EstadoCruce;
  hoy: string;
};
```

por:

```tsx
type Props = {
  nit: string;
  cruce: CruceZoho | null;
  estadoCruce: EstadoCruce;
  hoy: string;
  // Las fechas del OCMA solo tienen sentido en Prospectos: la Base instalada de
  // aire pasa false y enseña solo el estado y la última factura.
  conOcma?: boolean;
};
```

Sustituye:

```tsx
export default function CeldaCliente({ nit, cruce, estadoCruce, hoy }: Props) {
```

por:

```tsx
export default function CeldaCliente({ nit, cruce, estadoCruce, hoy, conOcma = true }: Props) {
```

Sustituye:

```tsx
      {hechos?.ocmaVendido && <p className="text-xs text-slate-600 whitespace-nowrap">OCMA vendido {hechos.ocmaVendido}</p>}
      {hechos?.ultimosRepuestos && (
```

por:

```tsx
      {conOcma && hechos?.ocmaVendido && (
        <p className="text-xs text-slate-600 whitespace-nowrap">OCMA vendido {hechos.ocmaVendido}</p>
      )}
      {conOcma && hechos?.ultimosRepuestos && (
```

- [ ] **Step 4: Lint, tipos y suite**

Run: `cd apps/laboratorios-ambientales && npx eslint src/hooks/useCruceZoho.ts src/pages/Prospectos.tsx src/components/CeldaCliente.tsx`
Expected: sin errores. Si `react-hooks/set-state-in-effect` se queja, revisa que en el efecto solo se llame a `setResultado` dentro de los `.then`, nunca de forma síncrona.

Run: `cd apps/laboratorios-ambientales && npx tsc -b && npm test`
Expected: sin errores. Suite: 14 ficheros, 285 pruebas.

Run: `cd apps/portal && npx tsc -b`
Expected: sin errores (tarda unos 25 s).

Run: `git status --short apps/laboratorios-ambientales`
Expected: ` M …/Prospectos.tsx`, ` M …/CeldaCliente.tsx` y `?? …/src/hooks/`. Nada más.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/hooks/useCruceZoho.ts apps/laboratorios-ambientales/src/pages/Prospectos.tsx apps/laboratorios-ambientales/src/components/CeldaCliente.tsx
git commit -F - <<'EOF'
refactor(laboratorios): el cruce con Zoho sale a useCruceZoho

El hook conserva lo que hacía Prospectos: la petición cancelable, el
resultado con la clave de su consulta para no enseñar nunca un cruce viejo,
«Reintentar» y el aviso en consola. Prospectos se comporta igual.
CeldaCliente gana la opción conOcma (por defecto, true).
EOF
```

---

### Task 8: La vista «Base instalada de aire»

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/view.ts`
- Test: `apps/laboratorios-ambientales/src/lib/view.test.ts`
- Create: `apps/laboratorios-ambientales/src/pages/BaseInstalada.tsx`
- Modify: `apps/laboratorios-ambientales/src/App.tsx`

- [ ] **Step 1: Escribe las pruebas que fallan**

En `apps/laboratorios-ambientales/src/lib/view.test.ts`, sustituye:

```ts
    expect(parseView('#prospectos')).toBe('prospectos');
  });
```

por:

```ts
    expect(parseView('#prospectos')).toBe('prospectos');
    expect(parseView('#base-aire')).toBe('base-aire');
  });
```

Sustituye:

```ts
    for (const view of ['main', 'buscador', 'dashboard', 'prospectos'] as const) {
```

por:

```ts
    for (const view of ['main', 'buscador', 'dashboard', 'prospectos', 'base-aire'] as const) {
```

- [ ] **Step 2: Ejecuta y comprueba que fallan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/view.test.ts`
Expected: FAIL, 2 pruebas: `#base-aire` abre el menú y `hashFor('base-aire')` no da su hash.

- [ ] **Step 3: La vista en el hash**

En `apps/laboratorios-ambientales/src/lib/view.ts`, sustituye:

```ts
// Cada vista vive en el hash de la URL (#buscador, #marcas, #prospectos) para
// poder enlazarla y para que el botón «atrás» del navegador funcione. Hash y no
// subrutas: la app no depende de react-router y arranca también suelta en
// `vite dev`, igual que hace Ausencias con su #bandeja.
export type View = 'main' | 'buscador' | 'dashboard' | 'prospectos';
```

por:

```ts
// Cada vista vive en el hash de la URL (#buscador, #marcas, #prospectos,
// #base-aire) para poder enlazarla y para que el botón «atrás» del navegador
// funcione. Hash y no subrutas: la app no depende de react-router y arranca
// también suelta en `vite dev`, igual que hace Ausencias con su #bandeja.
export type View = 'main' | 'buscador' | 'dashboard' | 'prospectos' | 'base-aire';
```

Sustituye:

```ts
  prospectos: 'prospectos',
};
```

por:

```ts
  prospectos: 'prospectos',
  'base-aire': 'base-aire',
};
```

- [ ] **Step 4: Ejecuta y comprueba que pasan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/view.test.ts`
Expected: PASS, 5 pruebas.

- [ ] **Step 5: Crea la página**

Crea `apps/laboratorios-ambientales/src/pages/BaseInstalada.tsx`:

```tsx
import { useDeferredValue, useMemo, useState } from 'react';
import type { Laboratorio } from '../types';
import type { EstadoVigencia } from '../lib/prospects';
import { ETIQUETA_VIGENCIA, estadoVigencia } from '../lib/prospects';
import type { FiltrosEquipos } from '../lib/baseInstalada';
import {
  FILTROS_VACIOS,
  SIN_ESTACION,
  SIN_IDENTIFICAR,
  agruparEquipos,
  filtrarEquipos,
  opcionesDeFiltro,
  ordenarEquipos,
  textoRecuento,
} from '../lib/baseInstalada';
import { HOJA_EXCEL, filasExcel, nombreDeFichero } from '../lib/exportBaseInstalada';
import { hoyLocal } from '../lib/fechas';
import type { EstadoCliente } from '../lib/clientes';
import { ESTADOS_CLIENTE, ETIQUETA_ESTADO_CLIENTE, nitsParaConsultar } from '../lib/clientes';
import { useCruceZoho } from '../hooks/useCruceZoho';
import CeldaCliente from '../components/CeldaCliente';

type Props = {
  data: Laboratorio[];
  onBack: () => void;
};

const SELECT_CLASS =
  'w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

// Los mismos colores que en Prospectos. No se comparten: un fichero de vista
// solo exporta su componente (react-refresh).
const INSIGNIA_VIGENCIA: Record<EstadoVigencia, string> = {
  vencida: 'bg-red-100 text-red-800',
  pronto: 'bg-amber-100 text-amber-800',
  vigente: 'bg-emerald-100 text-emerald-800',
  'sin-fecha': 'bg-slate-100 text-slate-600',
};

const COLUMNAS_TABLA = [
  'Laboratorio',
  'Cliente',
  'Ciudad',
  'Departamento',
  'Estación',
  'Marca y modelo',
  'Serie',
  'Variables',
  'Vigencia más próxima',
  'Contacto',
] as const;

export default function BaseInstalada({ data, onBack }: Props) {
  // El estado es local, como en Prospectos: al volver al menú se pierde.
  const [filtros, setFiltros] = useState<FiltrosEquipos>(FILTROS_VACIOS);
  // «Hoy» se fija al abrir la vista: las insignias y el Excel usan el mismo día.
  const [hoy] = useState(hoyLocal);
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState('');

  // Agrupar recorre los ~18 000 registros: solo se rehace si cambian los datos.
  const todos = useMemo(() => ordenarEquipos(agruparEquipos(data)), [data]);
  const opciones = useMemo(() => opcionesDeFiltro(todos, filtros.departamento), [todos, filtros.departamento]);

  // Una sola consulta con los NIT de todos los equipos (ver useCruceZoho). El
  // cruce llega solo cuando está listo; mientras, es null.
  const nits = useMemo(() => nitsParaConsultar(todos), [todos]);
  const { cruce, estadoCruce, reintentar } = useCruceZoho(nits);

  const visibles = useMemo(() => filtrarEquipos(todos, filtros, cruce, hoy), [todos, filtros, cruce, hoy]);
  // Son ~1.200 filas sin paginar: la tabla se pinta con el valor diferido para
  // que escribir en la búsqueda no se trabe. El recuento y el Excel usan `visibles`.
  const filas = useDeferredValue(visibles);

  const cambiar = (cambio: Partial<FiltrosEquipos>) => setFiltros((previos) => ({ ...previos, ...cambio }));
  // Mientras no hay cruce, el filtro «Cliente» se ve en «Todos» y no cuenta.
  const clienteElegido = cruce === null ? '' : filtros.cliente;

  // SheetJS pesa unos 430 KB: se descarga al pulsar y no con la app. Si falla la
  // descarga del trozo o la escritura del libro, se avisa junto al botón.
  const exportar = async () => {
    setExportando(true);
    setErrorExportar('');
    try {
      const XLSX = await import('xlsx');
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasExcel(visibles, hoy, cruce)), HOJA_EXCEL);
      XLSX.writeFile(libro, nombreDeFichero(hoy));
    } catch {
      setErrorExportar('No se pudo generar el Excel. Vuelve a intentarlo.');
    } finally {
      setExportando(false);
    }
  };

  return (
    // Todo el ancho: la tabla tiene 10 columnas.
    <div className="w-full p-6">
      <button
        onClick={onBack}
        className="mb-4 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors"
      >
        &larr; Volver al Menú Principal
      </button>

      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Base instalada de aire</h1>
        <p className="mt-2 text-lg text-gray-600">
          Cada equipo de calidad del aire u olores acreditado ante el IDEAM: dueño, dónde está, marca y número de serie.
        </p>
      </div>

      {/* Sin este aviso, una marca con varios fabricantes se leería como un dato seguro. */}
      <div className="bg-amber-50 ring-1 ring-amber-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-semibold text-amber-900 mb-1">Qué dice y qué no dice esta vista</p>
        <p className="text-xs text-amber-800">
          La marca y el modelo salen del código EPA que cita el método acreditado. Un código puede cubrir a varios
          fabricantes, y entonces salen juntos: el dataset no dice cuál de ellos es. «Sin identificar» quiere decir que
          el método no cita un código conocido. La columna Cliente sale de Zoho.
        </p>
      </div>

      {estadoCruce === 'error' && (
        <div
          role="alert"
          className="bg-amber-50 ring-1 ring-amber-200 rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-amber-900">No se pudo consultar Zoho; la columna Cliente queda vacía.</p>
          <button
            type="button"
            onClick={reintentar}
            className="px-4 py-2 bg-amber-700 text-white font-semibold rounded-lg hover:bg-amber-800 transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}

      <div className="bg-white p-6 rounded-xl shadow-md mb-8 ring-1 ring-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="md:col-span-3 lg:col-span-2">
            <label htmlFor="busqueda-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Buscar por laboratorio, NIT, estación o serie
            </label>
            <input
              id="busqueda-base-aire"
              type="text"
              value={filtros.busqueda}
              onChange={(e) => cambiar({ busqueda: e.target.value })}
              placeholder="Ej: nombre del laboratorio, 900123456 o una serie"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div>
            <label htmlFor="departamento-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Departamento
            </label>
            {/* Al cambiar de departamento, la ciudad elegida puede no ser suya: se vacía. */}
            <select
              id="departamento-base-aire"
              value={filtros.departamento}
              onChange={(e) => cambiar({ departamento: e.target.value, ciudad: '' })}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              {opciones.departamentos.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ciudad-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Ciudad
            </label>
            <select
              id="ciudad-base-aire"
              value={filtros.ciudad}
              onChange={(e) => cambiar({ ciudad: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Todas</option>
              {opciones.ciudades.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="marca-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Marca
            </label>
            <select
              id="marca-base-aire"
              value={filtros.marca}
              onChange={(e) => cambiar({ marca: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Todas</option>
              {opciones.marcas.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="cliente-base-aire" className="block text-sm font-semibold text-gray-700 mb-1">
              Cliente
            </label>
            <select
              id="cliente-base-aire"
              value={clienteElegido}
              onChange={(e) => cambiar({ cliente: e.target.value as EstadoCliente | '' })}
              disabled={estadoCruce !== 'listo'}
              className={`${SELECT_CLASS} disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed`}
            >
              <option value="">Todos</option>
              {ESTADOS_CLIENTE.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {ETIQUETA_ESTADO_CLIENTE[opcion]}
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
            onClick={() => setFiltros(FILTROS_VACIOS)}
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
        <h3 className="text-xl font-bold text-gray-800">Equipos</h3>
        <p className="text-sm text-gray-500" aria-live="polite">
          {textoRecuento(visibles)}
          {estadoCruce === 'cargando' && ' · Consultando Zoho…'}
        </p>
      </div>

      {filas.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl shadow-sm border border-dashed border-slate-300">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-slate-300" aria-hidden="true">
              🔍
            </span>
          </div>
          <p className="text-lg font-bold text-slate-400">Ningún equipo con estos filtros</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
          {/* En móvil, que haga scroll la tabla y no la página. */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  {COLUMNAS_TABLA.map((columna) => (
                    <th key={columna} scope="col" className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                      {columna}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((equipo) => {
                  const estado = estadoVigencia(equipo.vigenciaMasProxima, hoy);
                  return (
                    <tr
                      key={`${equipo.codigo}|${equipo.laboratorio}|${equipo.serie}`}
                      className="border-t border-slate-100 align-top hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800">{equipo.laboratorio || 'Sin nombre'}</p>
                        <p className="text-xs text-slate-500">
                          NIT {equipo.nit || '—'} &middot; Código {equipo.codigo || '—'}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <CeldaCliente
                          nit={equipo.nit}
                          cruce={cruce}
                          estadoCruce={estadoCruce}
                          hoy={hoy}
                          conOcma={false}
                        />
                      </td>
                      <td className="px-3 py-2 text-slate-600">{equipo.ciudad || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{equipo.departamento || '—'}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {equipo.estaciones.length === 0 ? (
                          <span className="text-slate-400">{SIN_ESTACION}</span>
                        ) : (
                          equipo.estaciones.map((estacion) => <p key={estacion}>{estacion}</p>)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {equipo.marcasYModelos.length === 0 ? (
                          <p className="text-slate-500">{SIN_IDENTIFICAR}</p>
                        ) : (
                          equipo.marcasYModelos.map((par) => (
                            <p key={`${par.marca}|${par.modelo}`}>
                              <span className="font-medium text-slate-800">{par.marca}</span>{' '}
                              <span className="text-slate-600">{par.modelo}</span>
                            </p>
                          ))
                        )}
                        {equipo.codigosEpa.length > 0 && (
                          <p className="mt-1 text-xs text-slate-400 whitespace-nowrap">{equipo.codigosEpa.join(', ')}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">{equipo.serie}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{equipo.variables.join(', ') || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <p className="text-slate-700">{equipo.vigenciaMasProxima ?? '—'}</p>
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${INSIGNIA_VIGENCIA[estado]}`}
                        >
                          {ETIQUETA_VIGENCIA[estado]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                        {equipo.contacto && <p className="font-medium text-slate-700">{equipo.contacto}</p>}
                        {equipo.telefono && <p>{equipo.telefono}</p>}
                        {equipo.correo && <p className="break-words">{equipo.correo}</p>}
                        {!equipo.contacto && !equipo.telefono && !equipo.correo && '—'}
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

- [ ] **Step 6: La ruta y la cuarta tarjeta del menú**

En `apps/laboratorios-ambientales/src/App.tsx`, sustituye:

```tsx
import Prospectos from './pages/Prospectos';
```

por:

```tsx
import Prospectos from './pages/Prospectos';
import BaseInstalada from './pages/BaseInstalada';
```

Sustituye:

```tsx
        <Prospectos data={data} onBack={() => navegar('main')} />
      </div>
    );
  }
```

por:

```tsx
        <Prospectos data={data} onBack={() => navegar('main')} />
      </div>
    );
  }

  if (view === 'base-aire' && listos) {
    return (
      <div className="w-full flex-grow bg-[#F7F8FA]" style={{ minHeight: '100vh' }}>
        <BaseInstalada data={data} onBack={() => navegar('main')} />
      </div>
    );
  }
```

Sustituye:

```tsx
                  Prospectos de grasas y aceites
                </a>
```

por:

```tsx
                  Prospectos de grasas y aceites
                </a>
                <a
                  href={hashFor('base-aire')}
                  onClick={(e) => abrirVista(e, 'base-aire')}
                  className="px-8 py-4 bg-sky-700 hover:bg-sky-800 text-white font-semibold rounded-lg shadow-md text-lg transition-colors"
                >
                  Base instalada de aire
                </a>
```

- [ ] **Step 7: Lint, tipos y suite**

Run: `cd apps/laboratorios-ambientales && npx eslint . && npx tsc -b && npm test`
Expected: sin errores. Suite: 14 ficheros, 285 pruebas.

Run: `cd apps/portal && npx tsc -b`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/view.ts apps/laboratorios-ambientales/src/lib/view.test.ts apps/laboratorios-ambientales/src/pages/BaseInstalada.tsx apps/laboratorios-ambientales/src/App.tsx
git commit -F - <<'EOF'
feat(laboratorios): vista «Base instalada de aire»

Cuarta tarjeta del menú, en #base-aire. Una fila por equipo de aire con su
dueño, la columna Cliente del cruce con Zoho, ciudad, departamento,
estación, marca y modelo, serie, variables, vigencia y contacto. Filtros,
recuento, Excel y el mismo aviso con «Reintentar» que Prospectos.
EOF
```

---

### Task 9: Correcciones de la tabla contra la lista de la EPA (solo con el visto bueno del usuario)

> **Paso de corrección, marcado aparte.** Cambia entradas que ya estaban en `EQUIPMENT_MAP` y que hoy usa también el Análisis de Marcas. El orquestador enseña al usuario las dos tablas de abajo y **solo sigue si el usuario lo aprueba**, entero o por filas. Si lo rechaza, la tarea se salta, sin commit, y la Tarea 10 no añade el punto de las correcciones al README. Ninguna otra tarea depende de esta.

Las 44 entradas EPA existentes se cotejaron una a una con la lista del 28 de julio de 2026. **Se reescriben** las que tienen la marca o el modelo de otro código, y las que no nombran a Horiba cuando la designación lo incluye (Ambientalia vende Horiba). Cuando una entrada se reescribe, lleva todos los fabricantes y modelos de su designación.

| Código | Hoy en la tabla | Lo que dice la lista de la EPA | Propuesta |
|---|---|---|---|
| `EQPM-0308-170` | Teledyne API · 602 BetaPlus | Met One BAM-1020 (PM2.5 FEM), Horiba APDA-371 o Ecotech/Acoem Spirant BAM1100. El 602 BetaPLUS es EQPM-0912-204, -205 y -206. | Met One Instruments, Inc. / Horiba / Ecotech / Acoem · BAM-1020 / APDA-371 / Spirant BAM1100 |
| `EQPM-0715-266` | Met One · BAM-1022 | Met One BAM-1020 (PM2.5 FEM con ciclón URG) o Ecotech/Acoem Spirant BAM1100. El BAM-1022 es EQPM-1013-209. | Met One Instruments, Inc. / Ecotech / Acoem · BAM-1020 / Spirant BAM1100 |
| `RFSA-0616-237` | Thermo Scientific · 43i-TLE SO2 Analyzer | Sutron o Sabio Model 6020. El 43i-TLE está en EQSA-0486-060. | Sutron / Sabio · 6020 SO2 Analyzer |
| `EQPM-0923-262` | Vasthi Instruments · PM Monitor | Vasthi Instruments Vair-9009 PM10. | Vasthi Instruments · Vair-9009 |
| `EQPM-0798-122` | Met One · BAM 1020 | Met One o Sibata BAM/GBAM 1020 (y 1020-1), Horiba APDA-371 o Ecotech/Acoem Spirant BAM1000. | Met One Instruments, Inc. / Sibata / Horiba / Ecotech / Acoem · BAM 1020 / GBAM 1020 / APDA-371 / Spirant BAM1000 |
| `EQSA-0506-159` | Horiba · APSA-370 | APSA-370 o APSA-380. | Horiba · APSA-370 / 380 |
| `EQOA-0506-160` | Horiba · APOA-370 | APOA-370 o APOA-380. | Horiba · APOA-370 / 380 |
| `RFCA-0506-158` | Horiba · APMA-370 | APMA-370 o APMA-380. | Horiba · APMA-370 / 380 |
| `RFNA-0506-157` | Horiba · APNA-370 | APNA-370 o APNA-380. | Horiba · APNA-370 / 380 |

**No se corrigen** (se anotan). Son marcas blancas: el mismo equipo vendido con otro nombre. Añadirlas haría que, con el filtro de marca de la decisión 1, una Serinus saliera al filtrar «Met One» o «Teledyne».

| Código | Lo que la tabla no nombra |
|---|---|
| `EQSA-0495-100`, `RFNA-1194-099`, `RFCA-1093-093`, `EQOA-0992-087` | Los modelos de Teledyne Analytical Instruments y Teledyne Monitor Labs (TML-xx), y los módulos de recordum airpointer. |
| `RFNA-0809-186`, `EQSA-0809-188`, `EQOA-0809-187`, `RFCA-0509-174` | Las Serinus también se venden como Opsis OPSxx, Tisch TE x.0 y Met One GAS-10xx, y algunas como Teledyne Analytical Instruments (9110E, 6400E, GFC7001E). |
| `EQNA-0217-242` | Met One GAS-1060. |
| `EQOA-0415-222` | Sutron (la lista dice «Sutron Corporation or Sabio»). |
| `EQPM-1013-209` | El BAM-1022-PLUS. |
| `EQOA-0880-047`, `RFCA-0981-054` | Solo el nombre: la lista dice «Thermo Electron / Thermo Environmental Instruments» y la tabla, «Thermo Scientific». Es la misma empresa. |

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/equipment.ts`
- Test: `apps/laboratorios-ambientales/src/lib/equipment.test.ts`

- [ ] **Step 1: Cambia las pruebas existentes y añade la nueva (que fallan)**

En `apps/laboratorios-ambientales/src/lib/equipment.test.ts`, sustituye:

```ts
  it('reconoce un código de equipo dentro del texto del método', () => {
    const eq = extractEquipment('Método de referencia EQPM-0798-122 según protocolo');
    expect(eq?.brand).toBe('Met One Instruments, Inc.');
    expect(eq?.model).toBe('BAM 1020');
    expect(eq?.pollutant).toBe('Partículas');
  });
```

por:

```ts
  it('reconoce un código de equipo dentro del texto del método', () => {
    const eq = extractEquipment('Método de referencia EQPM-0798-122 según protocolo');
    expect(eq?.brand).toBe('Met One Instruments, Inc. / Sibata / Horiba / Ecotech / Acoem');
    expect(eq?.model).toBe('BAM 1020 / GBAM 1020 / APDA-371 / Spirant BAM1000');
    expect(eq?.pollutant).toBe('Partículas');
  });
```

Sustituye:

```ts
    expect(listModels('Horiba')).toEqual(['APMA-370', 'APNA-370', 'APOA-370', 'APSA-370']);
```

por:

```ts
    expect(listModels('Horiba')).toEqual(['APMA-370 / 380', 'APNA-370 / 380', 'APOA-370 / 380', 'APSA-370 / 380']);
```

Sustituye:

```ts
  // Una errata al copiar un código nuevo lo dejaría sin reconocer en silencio.
```

por:

```ts
  // Revisadas contra la lista de la EPA del 28 de julio de 2026.
  it('las entradas del prototipo que no cuadraban con la lista de la EPA, corregidas', () => {
    expect(EQUIPMENT_MAP['EQPM-0308-170'].model).toBe('BAM-1020 / APDA-371 / Spirant BAM1100');
    expect(EQUIPMENT_MAP['EQPM-0715-266'].model).toBe('BAM-1020 / Spirant BAM1100');
    expect(EQUIPMENT_MAP['RFSA-0616-237']).toEqual({ brand: 'Sutron / Sabio', model: '6020 SO2 Analyzer', pollutant: 'SO₂' });
    expect(EQUIPMENT_MAP['EQPM-0923-262'].model).toBe('Vair-9009');
    expect(EQUIPMENT_MAP['EQPM-0798-122'].brand).toContain('Horiba');
  });

  // Una errata al copiar un código nuevo lo dejaría sin reconocer en silencio.
```

- [ ] **Step 2: Ejecuta y comprueba que fallan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/equipment.test.ts`
Expected: FAIL, 3 pruebas: «reconoce un código…», «lista los modelos de una marca» y la nueva de las corregidas.

- [ ] **Step 3: Escribe las correcciones**

En `apps/laboratorios-ambientales/src/lib/equipment.ts`, sustituye:

```ts
// PM10, PM2.5 y PM10-2.5 son «Partículas», como en el catálogo original.
```

por:

```ts
// PM10, PM2.5 y PM10-2.5 son «Partículas», como en el catálogo original.
// El 2026-11-27 se corrigieron nueve entradas del prototipo que no cuadraban con
// la lista (marca o modelo de otro código, o les faltaba Horiba o su -380).
```

Sustituye:

```ts
  'EQPM-0798-122': { brand: 'Met One Instruments, Inc.', model: 'BAM 1020', pollutant: 'Partículas' },
  'EQPM-0308-170': { brand: 'Teledyne API', model: '602 BetaPlus', pollutant: 'Partículas' },
```

por:

```ts
  'EQPM-0798-122': {
    brand: 'Met One Instruments, Inc. / Sibata / Horiba / Ecotech / Acoem',
    model: 'BAM 1020 / GBAM 1020 / APDA-371 / Spirant BAM1000',
    pollutant: 'Partículas',
  },
  'EQPM-0308-170': {
    brand: 'Met One Instruments, Inc. / Horiba / Ecotech / Acoem',
    model: 'BAM-1020 / APDA-371 / Spirant BAM1100',
    pollutant: 'Partículas',
  },
```

Sustituye:

```ts
  'EQSA-0506-159': { brand: 'Horiba', model: 'APSA-370', pollutant: 'SO₂' },
  'EQOA-0506-160': { brand: 'Horiba', model: 'APOA-370', pollutant: 'O₃' },
  'RFCA-0506-158': { brand: 'Horiba', model: 'APMA-370', pollutant: 'CO' },
  'RFNA-0506-157': { brand: 'Horiba', model: 'APNA-370', pollutant: 'NOx' },
```

por:

```ts
  'EQSA-0506-159': { brand: 'Horiba', model: 'APSA-370 / 380', pollutant: 'SO₂' },
  'EQOA-0506-160': { brand: 'Horiba', model: 'APOA-370 / 380', pollutant: 'O₃' },
  'RFCA-0506-158': { brand: 'Horiba', model: 'APMA-370 / 380', pollutant: 'CO' },
  'RFNA-0506-157': { brand: 'Horiba', model: 'APNA-370 / 380', pollutant: 'NOx' },
```

Sustituye:

```ts
  'RFSA-0616-237': { brand: 'Thermo Scientific', model: '43i-TLE SO2 Analyzer', pollutant: 'SO₂' },
```

por:

```ts
  'RFSA-0616-237': { brand: 'Sutron / Sabio', model: '6020 SO2 Analyzer', pollutant: 'SO₂' },
```

Sustituye:

```ts
  'EQPM-0923-262': { brand: 'Vasthi Instruments', model: 'PM Monitor', pollutant: 'Partículas' },
```

por:

```ts
  'EQPM-0923-262': { brand: 'Vasthi Instruments', model: 'Vair-9009', pollutant: 'Partículas' },
```

Sustituye:

```ts
  'EQPM-0715-266': { brand: 'Met One Instruments, Inc.', model: 'BAM-1022', pollutant: 'Partículas' },
```

por:

```ts
  'EQPM-0715-266': {
    brand: 'Met One Instruments, Inc. / Ecotech / Acoem',
    model: 'BAM-1020 / Spirant BAM1100',
    pollutant: 'Partículas',
  },
```

- [ ] **Step 4: Ejecuta y comprueba que pasan**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/equipment.test.ts src/lib/brands.test.ts`
Expected: PASS, 25 pruebas (16 + 9). Las de `brands.test.ts` siguen pasando: filtran por la marca exacta y `'Horiba'` no es igual a `'Met One Instruments, Inc. / Sibata / Horiba / Ecotech / Acoem'`.

Run: `cd apps/laboratorios-ambientales && npx tsc -b && npm test`
Expected: sin errores. Suite: 14 ficheros, 286 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/equipment.ts apps/laboratorios-ambientales/src/lib/equipment.test.ts
git commit -F - <<'EOF'
fix(laboratorios): entradas de la tabla de equipos que no cuadraban con la EPA

EQPM-0308-170, EQPM-0715-266, RFSA-0616-237 y EQPM-0923-262 tenían la marca
o el modelo de otro código. EQPM-0798-122 nombra a todos sus fabricantes,
Horiba entre ellos, y los cuatro Horiba de la serie 370 suman el 380.
Cotejado con la lista de la EPA del 28 de julio de 2026.
EOF
```

---

### Task 10: Documentación y verificación final

**Files:**
- Modify: `apps/laboratorios-ambientales/README.md`
- Modify: `docs/PRIVACY-RETENTION.md`

- [ ] **Step 1: README de la app**

En `apps/laboratorios-ambientales/README.md`, sustituye:

```md
de datos.gov.co (~19.000 acreditaciones). La vista de prospectos cruza además
cada laboratorio con Zoho Books por NIT, a través de hub-api.
```

por:

```md
de datos.gov.co (~19.000 acreditaciones). Las vistas de prospectos y de base
instalada de aire cruzan además cada laboratorio con Zoho Books por NIT, a
través de hub-api.
```

Sustituye:

```md
| `src/lib/equipment.ts` | Catálogo de 46 equipos de calidad del aire. |
```

por:

```md
| `src/lib/equipment.ts` | Catálogo de 82 códigos de equipos de calidad del aire (ver «El catálogo de equipos se mantiene a mano»). |
```

Sustituye:

```md
| `src/lib/fechas.ts` | Fecha local de hoy y suma de meses de calendario. |
| `src/lib/view.ts` | La vista abierta, en el hash de la URL (`#buscador`, `#marcas`, `#prospectos`). |
| `src/pages/` | Vistas: `Buscador`, `Dashboard` (Análisis de Marcas) y `Prospectos`. |
| `src/components/` | Piezas de vista: `CeldaCliente`, la celda de la columna «Cliente». |
```

por:

```md
| `src/lib/baseInstalada.ts` | Base instalada de aire: valor vacío, series, qué registro entra, agrupación por equipo, códigos EPA, orden, filtros, opciones y recuento. |
| `src/lib/exportBaseInstalada.ts` | Filas y nombre de fichero del Excel de la base instalada. |
| `src/lib/fechas.ts` | Fecha local de hoy, suma de meses de calendario y la fecha de `hasta` (`fechaDeHasta`). |
| `src/lib/view.ts` | La vista abierta, en el hash de la URL (`#buscador`, `#marcas`, `#prospectos`, `#base-aire`). |
| `src/hooks/useCruceZoho.ts` | La consulta del cruce con Zoho de una vista: cancelable, con «Reintentar» y sin enseñar nunca un cruce viejo como actual. |
| `src/pages/` | Vistas: `Buscador`, `Dashboard` (Análisis de Marcas), `Prospectos` y `BaseInstalada`. |
| `src/components/` | Piezas de vista: `CeldaCliente`, la celda de la columna «Cliente» (con o sin las fechas del OCMA). |
```

Sustituye:

```md
La lógica pura vive en `src/lib/` con tests unitarios; los componentes de
`src/pages/` y `src/components/` solo la orquestan y la pintan.
```

por:

```md
La lógica pura vive en `src/lib/` con tests unitarios; `src/hooks/`,
`src/pages/` y `src/components/` solo la orquestan y la pintan.
```

Sustituye:

```md
  «datos.gov.co no respondió en 60 s» en vez de dejar el spinner girando sin
  botón de Reintentar.
```

por:

```md
  «datos.gov.co no respondió en 60 s» en vez de dejar el spinner girando sin
  botón de Reintentar.
- **La clave va versionada (`labs_cache_v3_*`).** Al cambiar la forma de
  `Laboratorio` se sube `CACHE_VERSION` y las claves viejas se borran
  activamente (`LEGACY_CACHE_KEYS`): sus ~3 MB impedirían escribir las nuevas.
  La v3 (2026-11-27) añadió `estacion` y `serie`. Al desplegarla, cada usuario
  vuelve a descargar el dataset entero una vez.
```

Sustituye:

```md
`equipment.ts` mapea códigos de designación (US EPA / UNE-EN) a marca/modelo/
contaminante. Esos códigos se buscan como subcadena dentro del texto libre del
campo «método». Estado real: **38 de los 46 códigos aparecen** en el dataset, y
**432 de los 1.306 registros** de calidad del aire (33%) citan alguno — el resto
usa normas internas sin código. Si el IDEAM acredita un equipo nuevo, hay que
añadirlo aquí o no aparecerá en el Análisis de Marcas.
```

por:

```md
`equipment.ts` mapea códigos de designación (US EPA / UNE-EN) a marca/modelo/
contaminante. Esos códigos se buscan como subcadena dentro del texto libre del
campo «método». Si el IDEAM acredita un equipo nuevo, hay que añadirlo aquí o
no aparecerá en el Análisis de Marcas ni tendrá marca en la Base instalada.

- **Fuente:** la «List of Designated Reference and Equivalent Methods» de la
  EPA, emitida el 28 de julio de 2026
  ([PDF](https://www.epa.gov/system/files/documents/2026-07/amtic-list-july-2026_508-compliant.pdf)).
  Se pasa a texto con `pdftotext -layout`. Marca, modelo y contaminante salen
  del texto de cada designación.
- **Estado (2026-11-27):** 82 códigos: los 46 del prototipo (dos son la norma
  UNE-EN 16450) y 36 que cita el dataset de aire y faltaban. Las filas de aire
  citan 74 códigos EPA distintos y 73 están en la tabla. El otro, que el
  dataset escribe «RFNA-1289-0704», no está en la lista de la EPA y sale «Sin
  identificar».
- **Varios fabricantes:** un código que cubre varios los trae unidos con « / »
  («Tisch Environmental / New Star Environmental»). Las empresas que cambiaron
  de nombre también van juntas («Environnement S.A. / ENVEA», «Ecotech /
  Acoem»).
- **Contaminante:** PM10, PM2.5 y PM10-2.5 son «Partículas». Los analizadores
  de olores (H₂S, TRS, NH₃) se acreditan con su designación de SO₂ o de NOx, y
  así salen.
- **Marcas blancas sin recoger:** varias designaciones incluyen versiones de
  otros fabricantes que la tabla no nombra. Por ejemplo, las Serinus de Ecotech
  también las venden Opsis, Tisch, Met One y Teledyne, y los Teledyne también
  salen como recordum airpointer. Están en la Tarea 9 del plan
  `docs/superpowers/plans/2026-11-27-base-instalada-aire.md`.
```

Sustituye:

```md
  dígito de verificación pegado (10 dígitos) y no cruza hasta que se corrija
  en Zoho.

## Mejoras pendientes
```

por:

```md
  dígito de verificación pegado (10 dígitos) y no cruza hasta que se corrija
  en Zoho.

## Base instalada de aire

Vista `#base-aire`: una fila por equipo de aire acreditado (cifras del
2026-11-27: unos 1.234 equipos de 64 laboratorios en 14 departamentos). Sirve
para conocer la base instalada de la competencia, encontrar equipos Horiba y
planificar visitas por región.

- **Qué entra:** registros `Activa`, matriz `Aire`, componente «Calidad del
  Aire» u «Olores Ofensivos» (cualquier grafía, tras `normalizeComponente`) y
  con número de serie. Fuentes fijas, ruido y vibraciones no traen equipos.
- **Valor vacío:** en blanco, solo guiones, o «No aplica», «N/A» o «NA», sin
  distinguir mayúsculas (`esValorVacio`). `mapRecord` solo guarda `estacion` y
  `serie` cuando traen valor.
- **Un equipo** es la pareja código de laboratorio + serie, con la serie en
  mayúsculas para comparar. El campo de equipo se parte por comas, puntos y
  comas y saltos de línea, porque una fila puede listar 30 muestreadores. No se
  parte por «/» ni por espacios.
- **Ficha:** cada dato es el primero con valor entre sus filas. Las
  estaciones, las variables y los códigos EPA van sin repetir; la vigencia más
  próxima es la fecha `hasta` más temprana.
- **Marca y modelo** salen del código EPA que cita el método. Un código escrito
  con espacios («EQPM 0311-195») también vale. Si un código cubre varios
  fabricantes, salen juntos, porque el dataset no dice cuál es. Sin código
  conocido, «Sin identificar»; el código queda en la columna «Códigos EPA» del
  Excel.
- **Filtros:**
  - búsqueda por laboratorio, NIT, estación o serie, sin tildes ni mayúsculas;
  - departamento y ciudad (solo las del departamento elegido);
  - marca: cada fabricante por separado, también los que comparten código, y
    «Sin identificar»;
  - cliente.
- **Orden:** departamento, ciudad, laboratorio, estación («Sin estación» al
  final) y serie.
- **Columna «Cliente»:** el mismo cruce con Zoho que Prospectos
  (`useCruceZoho`), sin las fechas del OCMA. Si falla, sale el aviso con
  «Reintentar» y la vista sigue funcionando.
- **Excel:**
  - lo que se ve, en `base-instalada-aire-<AAAA-MM-DD>.xlsx`, con una hoja
    «Base instalada de aire» de 18 columnas;
  - las listas van unidas con «; », y la marca n.º i va con el modelo n.º i;
  - lleva los datos de contacto, como el de Prospectos.
- **Sin paginar:** son ~1.200 filas. La tabla se pinta con `useDeferredValue`
  para que escribir no se trabe. Si se nota lenta, se pagina con
  `lib/pagination.ts`.

## Mejoras pendientes
```

Sustituye:

```md
  - Cada vez que se abre `#prospectos` se hace una consulta: ir y volver entre
    el Buscador y Prospectos seis veces en un minuto da 429. Sale el aviso
```

por:

```md
  - Cada vez que se abre `#prospectos` o `#base-aire` se hace una consulta: ir
    y volver entre las vistas seis veces en un minuto da 429. Sale el aviso
```

Sustituye:

```md
  `new Function`). Si se retoma, debe ir tras un proxy en `hub-api` con la key
  server-side y sin ejecutar código generado.
```

por:

```md
  `new Function`). Si se retoma, debe ir tras un proxy en `hub-api` con la key
  server-side y sin ejecutar código generado.
- Base instalada de aire:
  - Fase 2, el mapa de estaciones. Necesita mapear `latitud` y `longitud`,
    Leaflet, autorizar las teselas de OpenStreetMap en la CSP del portal
    (`img-src` en `apps/portal/nginx.conf`) y aceptar peticiones a un servicio
    externo.
  - No se cruza la serie con el maestro de equipos de Desk 2.0, ni se deduce
    la marca del formato de la serie.
```

- [ ] **Step 2: Solo si se hizo la Tarea 9, el punto de las correcciones**

Si la Tarea 9 se saltó, sáltate este paso.

En `apps/laboratorios-ambientales/README.md`, sustituye:

```md
  salen como recordum airpointer. Están en la Tarea 9 del plan
  `docs/superpowers/plans/2026-11-27-base-instalada-aire.md`.
```

por:

```md
  salen como recordum airpointer. Están en la Tarea 9 del plan
  `docs/superpowers/plans/2026-11-27-base-instalada-aire.md`.
- **Corregidas el 2026-11-27:** nueve entradas del prototipo no cuadraban con
  la lista. EQPM-0308-170, EQPM-0715-266, RFSA-0616-237 y EQPM-0923-262 tenían
  la marca o el modelo de otro código. A EQPM-0798-122 le faltaban Horiba y los
  demás fabricantes, y a los cuatro Horiba, su modelo -380.
```

- [ ] **Step 3: Registro de privacidad**

En `docs/PRIVACY-RETENTION.md`, sustituye:

```md
- **Si un NIT es cliente**, en **Laboratorios ambientales**
  (`POST /api/laboratorios/clientes`). La app envía NIT que ya son públicos (el
```

por:

```md
- **Si un NIT es cliente**, en **Laboratorios ambientales**
  (`POST /api/laboratorios/clientes`), desde dos vistas con la misma petición:
  Prospectos de grasas y aceites y Base instalada de aire. La app envía NIT que
  ya son públicos (el
```

Sustituye:

```md
compra y si tiene un OCMA. Base legal: el interés legítimo de Ambientalia en
```

por:

```md
compra y si tiene un OCMA. La Base instalada de aire tiene la misma finalidad
con los dueños de equipos de aire: enseña el estado y la fecha de la última
factura, sin las del OCMA. Base legal: el interés legítimo de Ambientalia en
```

- [ ] **Step 4: Verificación general**

Run: `cd apps/laboratorios-ambientales && npm test`
Expected: 14 ficheros, 286 pruebas, en verde (285 si se saltó la Tarea 9).

Run: `cd apps/laboratorios-ambientales && npm run build && npm run lint`
Expected: sin errores.

Run: `cd apps/portal && npx tsc -b`
Expected: sin errores (unos 25 s).

Run: `git status --short`
Expected: solo los dos ficheros de documentación, más lo del usuario que ya estaba (`.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/`, `openspec/`).

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/README.md docs/PRIVACY-RETENTION.md
git commit -F - <<'EOF'
docs(laboratorios): la base instalada de aire

README de la app con la vista nueva, sus reglas, el cache v3 y la tabla de
códigos ampliada con la lista de la EPA. El registro de privacidad dice que
el cruce con Zoho se usa también en esta vista, con la misma finalidad.
EOF
```

---

## Cierre (orquestador)

1. Revisión final de toda la rama (`git diff main...feat/laboratorios-base-instalada-aire`) contra el diseño.
2. Comprobación de privacidad en un comando aparte, antes del push. Nada de esto debe salir de las pruebas nuevas:
   - un correo que no sea `@example.com`: `git diff main...HEAD -- apps/laboratorios-ambientales | grep -nE '^\+.*@' | grep -v 'example\.com'` no debe dar ninguna línea;
   - un NIT, nombre, estación o serie del dataset real. Los de las pruebas son `900.000.001-7`, `900.000.003-1`, `900.111.222-3` y `800.333.444-5`, «Estación Ficticia …» y `SN-000x`, `AN-0100`, `AB-778`.
3. Merge `--no-ff` a `main` con un mensaje `merge: …`, push y seguimiento del CI.
4. Al usuario:
   - **Despliegue:** solo el portal; no hay migraciones, variables de entorno ni cambios en hub-api.
   - **Primera carga:** por el cache v3, cada usuario vuelve a descargar el dataset entero una vez (hasta 60 s por página).
   - **Prueba en el navegador:**
     - la tarjeta y `#base-aire`;
     - el recuento «N equipos de M laboratorios»;
     - la ciudad que se vacía al cambiar de departamento;
     - una marca con varios fabricantes, y «Sin identificar»;
     - el filtro «Cliente» desactivado hasta que llega el cruce;
     - el Excel;
     - que escribir en la búsqueda no se trabe;
     - y que Prospectos sigue igual.
