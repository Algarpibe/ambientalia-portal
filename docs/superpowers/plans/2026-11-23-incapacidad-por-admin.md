# Incapacidad registrada por el administrador — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** que el administrador registre una incapacidad a nombre de cualquier empleado activo,
desde el Registro general, con los mismos efectos que si la informara la propia persona, y que quede
constancia (columna `registrada_por` y una etiqueta en la fila).

**Arquitectura:** una ruta propia del administrador, `POST /api/ausencias/solicitudes/incapacidad-ajena`
(`requireAuth, requireAdmin`), con su validación pura `validarIncapacidadAjena` (la de una incapacidad
del empleado sin el límite hacia atrás, compartida por un booleano con `validarNuevaSolicitud`) y su
servicio `registrarIncapacidadAjena`, que reutiliza el núcleo del alta: `darDeAlta` (tope del retiro,
estado, candado del empleado, `altaBajoCandado` con el solape, el INSERT, el adjunto, la cola y el
calendario, y el aviso a n8n). La migración 080 añade `registrada_por`; `repo/filas.ts` la lee en la
`Solicitud` (el acuse cambia el texto) y `repo/registro.ts` en el `Movimiento`. En el front,
`registrarIncapacidadAjena` con su propio lector de errores, un modal `RegistrarIncapacidad.tsx` y, en
`RegistroGeneral.tsx`, el botón (solo admin), el aviso verde, la recarga y la etiqueta.

**Stack:** hub-api (Express 4, TypeScript ESM con imports `.js`, SQL crudo, Vitest + supertest con un
doble en memoria, `*.db.test.ts` con testcontainers); apps/ausencias (React 19, Tailwind 3.4,
lucide-react, Vitest + jsdom + Testing Library con `fireEvent`).

**Spec:** `docs/superpowers/specs/2026-11-23-incapacidad-por-admin-design.md`.
**Rama:** `feat/incapacidad-por-admin` (ya creada, con la spec commiteada en `dc7af4f`).

---

## Reglas para quien implemente

- **TDD estricto:** cada test se ve en ROJO, y por la razón esperada, antes de escribir el código. La
  única excepción es la Task 5 (refactor sin cambio de comportamiento): allí la red son los tests que
  ya existen, en verde antes y después, más dos candados de caracterización que nacen en verde.
- **Editar solo con Edit/Write.** Nunca `Set-Content`, `sed -i` ni `perl -pi`: corrompen las tildes.
- **Commits:** en español, sin tildes, convencionales, sin ninguna línea de atribución, con rutas
  explícitas (`git add <ruta> <ruta>`, nunca `git add -A` ni `git add .`).
- **No tocar** `.gitignore` ni los ficheros sin seguimiento del usuario (`.atl/`, `img/`, `openspec/`,
  `apps/WO-sales/prompts/`). Nunca `git stash`.
- **Comentarios** en español con tildes, explicando el porqué. En los `*.db.test.ts` y en
  `router.test.ts`, sin tildes (es la convención de esos ficheros; los literales de texto sí las
  llevan cuando el dato las tiene).
- **No lanzar vitest desde la raíz del repo:** siempre desde `apps/hub-api` o `apps/ausencias`. Con
  `NO_COLOR=1` delante cuando la salida se filtre con `grep`.
  - hub-api unitarios: `cd apps/hub-api && npx vitest run <fichero> [-t "<nombre>"]`
  - hub-api BD: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts <fichero>`
  - hub-api typecheck: `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json`
  - front: `cd apps/ausencias && npx vitest run <fichero>`, y el portón `npm run typecheck`,
    `npm test` y `npm run build`.
- **Los tests de BD necesitan Docker.** Si no responde:
  `Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"` y esperar a que arranque.
- **Fechas de test:** sin festivos colombianos y relativas al reloj de cada fichero.
  `router.test.ts` congela el reloj en `2026-01-15`; `incapacidad-ajena.test.ts` usa `HOY =
  '2026-07-01'` como `service.test.ts`; los `*.db.test.ts` usan el reloj real (`hoyEnColombia()` y
  `sumarDias`), y no afirman días hábiles.
- **Node 22+:** los tests del front que pasan por `authHeaders` necesitan
  `vi.stubGlobal('localStorage', { getItem: () => null })`.
- **Los candados de identidad del alta del EMPLEADO no se tocan** y siguen en verde: la Task 6 los
  lanza por su nombre.

## Mapa de ficheros

| Fichero | Qué cambia |
|---|---|
| `apps/hub-api/src/users/migrations/080_ausencias_registrada_por.sql` | NUEVO: la columna |
| `apps/hub-api/src/db.ts` | + `'080_ausencias_registrada_por.sql'` al final de `MIGRATIONS` (L102) |
| `apps/hub-api/src/ausencias/registrada-por.migracion.test.ts` | NUEVO: la 080 sin BD (y la última) |
| `apps/hub-api/src/users/terms.migracion.test.ts` | la 079 deja de ser la última (L5, L15-17) |
| `apps/hub-api/src/db.roles.db.test.ts` | + `portal_app` lee y escribe la columna sin GRANT nuevo |
| `apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts` | NUEVO: columna, repo, alta del empleado y del admin contra Postgres |
| `apps/hub-api/src/ausencias/types.ts` | + `Solicitud.registradaPor` (L609); + `MovimientoBase.registradaPor` (L831) |
| `apps/hub-api/src/ausencias/repo/filas.ts` | `SELECT_SOLICITUD`, `FilaSolicitudDb` y `aSolicitud` leen `registrada_por` |
| `apps/hub-api/src/ausencias/repo/solicitudes.ts` | `DatosInsercion.registradaPor` y el INSERT (L29-97) |
| `apps/hub-api/src/test-db/harness.ts` | `DatosSiembra.registradaPor?` y `sembrarSolicitud` |
| `apps/hub-api/src/ausencias/repo.evento-calendario.db.test.ts` | el `DatosInsercion` a mano (L129-143) |
| `apps/hub-api/src/ausencias/notificaciones.test.ts`, `service.test.ts`, `types.test.ts` | fixtures de `Solicitud`; + tests del acuse |
| `apps/hub-api/src/ausencias/notificaciones.ts` | `acuseSolicitante` (L185-215) |
| `apps/hub-api/src/ausencias/service/validacion.ts` | `validarIncapacidadAjena` y `validarAlta` privada (L94-187) |
| `apps/hub-api/src/ausencias/incapacidad-ajena.test.ts` | NUEVO: unitarios de la validación |
| `apps/hub-api/src/ausencias/service/solicitudes.ts` | `darDeAlta` privada, `crearSolicitud` y `registrarIncapacidadAjena` (L169-335) |
| `apps/hub-api/src/ausencias/router.ts` | + `POST /ausencias/solicitudes/incapacidad-ajena` (después de L172) |
| `apps/hub-api/src/ausencias/router.test.ts` | + candado del alta del empleado; + `describe` de la ruta nueva (después de L2066) |
| `apps/hub-api/src/ausencias/repo/registro.ts` | el `Movimiento` lleva `registradaPor` |
| `apps/hub-api/src/ausencias/repo.test.ts` | fixture de `Movimiento` (L227-250) |
| `apps/hub-api/src/ausencias/repo.movimientos.db.test.ts` | + `describe` de `registradaPor` |
| `apps/ausencias/src/api/http.ts` | `mensajeDeSolape` con sujeto; + `errorDeIncapacidadAjena`; comentario «NO hay vía…» (L188-191) |
| `apps/ausencias/src/api/registro.ts` | + `IncapacidadAjena`, `registrarIncapacidadAjena`; `MovimientoBase.registradaPor` |
| `apps/ausencias/src/api/registro.test.ts` | NUEVO: el cliente con `fetch` simulado |
| `apps/ausencias/src/RegistrarIncapacidad.tsx` | NUEVO: el formulario (modal) |
| `apps/ausencias/src/RegistrarIncapacidad.test.tsx` | NUEVO: el formulario en jsdom |
| `apps/ausencias/src/RegistroGeneral.tsx` | botón solo admin, aviso verde, recarga y etiqueta |
| `apps/ausencias/src/RegistroGeneral.test.tsx` | NUEVO: la pantalla en jsdom |

**Barriles y doble:** `repo.ts`, `service.ts` y `api.ts` hacen `export *` sobre sus trozos y los
`barril.test.ts` comparan función a función. Todo lo nuevo va en trozos que ya existen
(`service/validacion.ts`, `service/solicitudes.ts`, `api/registro.ts`; `errorDeIncapacidadAjena` en
`api/http.ts`, que es INTERNO y `api.ts` no reexporta), así que **no se toca ningún barril ni
`TROZOS`**. `repo.ts` no gana ninguna función, así que **el doble de `router.test.ts` tampoco cambia**:
su `crearSolicitud` (al que delega `insertarSolicitud`) monta la fila con `...datos`
(router.test.ts:988), y `registradaPor` llega solo.

## Decisiones del plan (lo que la spec dejaba abierto)

1. **`empleadoId` vacío** (`''`) es `400 empleado_requerido`, igual que uno que no es cadena: es lo
   que manda la opción «— Elige una persona —».
2. **`empleadoId` sin forma de UUID → `404 empleado_no_encontrado`**, desde el validador. Sin esto,
   `repo.empleadoPorId` (`WHERE id = $1` sobre una columna UUID, migración 015) haría que Postgres
   lanzara 22P02 y la ruta contestara un 500. Mismo criterio y misma expresión que `validarEmpleadoId`
   en `service/notas.ts:54-59`.
3. **Un `tipo` en el cuerpo distinto de `incapacidad` → `400 tipo_invalido`**; `tipo: 'incapacidad'` se
   acepta. La spec dice que el tipo «no viaja»; aceptarlo e ignorarlo dejaría creer que por aquí se
   registran unas vacaciones (mismo criterio que `dias_no_aplica`).
4. **La exención de la ventana es un booleano, no una copia:** `validarNuevaSolicitud` pasa a envolver
   una privada `validarAlta(body, hoy, conVentanaHaciaAtras)`, y `validarIncapacidadAjena` la llama con
   `false` y el `tipo` fijado.
5. **El núcleo compartido es `darDeAlta(db, sesion, empleado, datos, registradaPor)`**, privada en
   `service/solicitudes.ts`. `altaBajoCandado` ya existía (L169-283) con el solape, el adjunto y el
   INSERT; lo que quedaba en `crearSolicitud` (tope del retiro, estado, candado y aviso a n8n) es lo
   que se mueve. `altaBajoCandado` gana el parámetro `registradaPor`.
6. **`registrada_por` se escribe con `lower($14)`** en el INSERT, además del `toLowerCase()` de
   `sesionDe`: la spec promete minúsculas, y es el patrón de `fijarJefe`.
7. **`DatosInsercion.registradaPor` es obligatorio** (`string | null`), por la convención de
   `horaInicio`; `DatosSiembra.registradaPor` del harness es opcional, como las horas.
8. **La `Solicitud` del front no gana el campo:** ninguna pantalla lo lee. Sí el `Movimiento`.
9. **`registradaPor` va en `MovimientoBase`** (hub-api y front), no solo en la rama de solicitud: la
   spec pide `null` en las modificaciones, que es el patrón de la franja horaria.
10. **El acuse decide con `esInc && Boolean(s.registradaPor)`**, no con `!== null`: un objeto montado a
    mano sin la clave daría `undefined !== null`.
11. **El lector de errores nuevo vive en `api/http.ts`** (`errorDeIncapacidadAjena`, exportado e
    interno), porque reutiliza `mensajeDeSolape` (que gana un segundo parámetro con valor por defecto)
    y cae en `errorDeAusencia`. La revisión código a código está en la Task 8.
12. **`registrarIncapacidadAjena` va en `api/registro.ts`**: es una acción de admin del Registro, como
    `editarSolicitud`. Sin módulo nuevo, sin `TROZOS`.
13. **El formulario es un modal** (`RegistrarIncapacidad.tsx`, molde de `EditarSolicitud` con
    `useFocoDeModal`) y **filtra las fichas inactivas**: `fetchEmpleados` → `listarEmpleados`
    (`repo/empleados.ts:238-241`) las trae todas. Guardar mira también que el inicio no sea futuro y
    que el fin no sea anterior (el `max` de un input se salta tecleando). Mientras guarda no se cierra
    por ninguna salida.
14. **La etiqueta va en la celda Estado**, debajo del chip, con `title` = el correo.
15. **El botón va en la barra de filtros, con la guarda `esAdmin && empleados.length > 0`.** La barra se
    pinta siempre que `!cargando` (`RegistroGeneral.tsx:438`), también cuando el `Promise.all` de la
    carga falla y deja `empleados` vacío; con la guarda, el desplegable del formulario nunca abre vacío.
16. **El aviso verde usa `empleadoNombre` de la respuesta** del servidor.
17. **El test de «la última migración» pasa a `ausencias/registrada-por.migracion.test.ts`**, y el de
    la 079 se relaja a «detrás de la 078» con `[,\]]`, igual que se hizo con la 078.
18. **El «sin GRANT nuevo» se prueba** con `has_column_privilege` en `db.roles.db.test.ts`.
19. **La ruta no escribe línea de log:** la constancia es la columna.
20. **Candado extra:** un admin que use la ruta del EMPLEADO con `empleadoId` y una fecha antigua sigue
    topando con `incapacidad_demasiado_antigua` (fija que la opción B no entró).
21. **Correo ficticio de admin en los tests de hub-api:** `admin@ambientalia.com.co`, el que ya usa
    `router.test.ts:5732`. En el front, `@ejemplo.test`.

---

### Task 1: migración 080

**Files:**
- Create: `apps/hub-api/src/users/migrations/080_ausencias_registrada_por.sql`
- Create: `apps/hub-api/src/ausencias/registrada-por.migracion.test.ts`
- Create: `apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts`
- Modify: `apps/hub-api/src/db.ts:102`
- Modify: `apps/hub-api/src/users/terms.migracion.test.ts:5,15-17`
- Modify: `apps/hub-api/src/db.roles.db.test.ts` (después del `it` de las aceptaciones de las condiciones)

- [ ] **Step 1: Escribir el test sin BD que falla**

Crear `apps/hub-api/src/ausencias/registrada-por.migracion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// La migración 080 sin base de datos: que está apuntada (y es la última), que
// solo añade la columna, nullable y con IF NOT EXISTS, y que no siembra ni toca
// permisos. Lo que hace contra Postgres lo vigila incapacidad-ajena.db.test.ts, y
// que portal_app la pueda escribir sin GRANT nuevo, db.roles.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL_080 = leer('../users/migrations/080_ausencias_registrada_por.sql');
// Sin comentarios: el texto explicativo nombra GRANT sin ser sentencia.
const SIN_COMENTARIOS = SQL_080.replace(/--.*$/gm, '');

describe('migración 080 (quién registró la incapacidad)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 079, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'079_terms_acceptances\.sql',\s*'080_ausencias_registrada_por\.sql'\];/);
  });

  it('añade la columna, nullable y con IF NOT EXISTS (se re-ejecuta en cada arranque)', () => {
    expect(SIN_COMENTARIOS).toMatch(
      /ALTER TABLE portal\.solicitudes_ausencia\s+ADD COLUMN IF NOT EXISTS registrada_por VARCHAR\(254\);/,
    );
    // NULL es el valor de toda la que registró la propia persona: ni NOT NULL
    // ni DEFAULT, o las filas que ya existen quedarían «registradas por» alguien.
    expect(SIN_COMENTARIOS).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it('no siembra, ni cambia, ni borra nada, y no toca permisos', () => {
    expect(SIN_COMENTARIOS).not.toMatch(/INSERT\s+INTO|UPDATE\s+portal|\b(DROP|TRUNCATE)\b|DELETE\s+FROM|\b(GRANT|REVOKE)\b/i);
  });
});
```

- [ ] **Step 2: Escribir los dos tests de BD que fallan**

Crear `apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar } from '../test-db/harness.js';

// La incapacidad que registra el administrador a nombre de otro, contra
// Postgres de verdad: la columna de la 080, su escritura y su lectura en el
// repo, y las dos puertas del alta (la del empleado y la del admin).

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
});

describe('migracion 080', () => {
  it('CANDADO: la columna registrada_por existe y admite NULL (o sea, la 080 esta en MIGRATIONS)', async () => {
    // Los casts no son estilo: las columnas de information_schema son dominios,
    // y el driver devuelve como texto lo que no reconoce.
    const { rows } = await db.query(
      `SELECT data_type::text AS tipo, character_maximum_length::int AS largo, is_nullable::text AS nulable
         FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'solicitudes_ausencia' AND column_name = 'registrada_por'`,
    );
    expect(rows).toEqual([{ tipo: 'character varying', largo: 254, nulable: 'YES' }]);
  });
});
```

En `apps/hub-api/src/db.roles.db.test.ts`, justo después del `it('las aceptaciones de las condiciones solo admiten leer e insertar tras otro arranque, …')` (el que termina con `expect(n[0].n).toBe(0);`), añadir:

```ts
  it('portal_app lee y escribe registrada_por sin GRANT nuevo: la 080 solo anade una columna', async () => {
    // Un permiso de TABLA (el de la 068) alcanza tambien a las columnas que se
    // anadan despues. Si alguien cambiara la 068 a permisos por columna, esta
    // columna se quedaria sin ellos y el alta daria un 42501.
    const { rows } = await migrador.query(
      `SELECT has_column_privilege('portal_app', 'portal.solicitudes_ausencia', 'registrada_por', 'SELECT') AS sel,
              has_column_privilege('portal_app', 'portal.solicitudes_ausencia', 'registrada_por', 'INSERT') AS ins,
              has_column_privilege('portal_app', 'portal.solicitudes_ausencia', 'registrada_por', 'UPDATE') AS upd`,
    );
    expect(rows[0]).toEqual({ sel: true, ins: true, upd: true });
  });
```

- [ ] **Step 3: Ver que fallan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/registrada-por.migracion.test.ts
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/incapacidad-ajena.db.test.ts src/db.roles.db.test.ts
```

Esperado: el primero cae entero al cargar, con `ENOENT: no such file or directory` sobre
`080_ausencias_registrada_por.sql`. En el segundo, el de la columna cae con `expected [] to deeply equal
[ { tipo: 'character varying', … } ]`, y el de `portal_app` con `column "registrada_por" of relation
"solicitudes_ausencia" does not exist`. El resto de `db.roles.db.test.ts` sigue en verde.

- [ ] **Step 4: Crear la migración**

Crear `apps/hub-api/src/users/migrations/080_ausencias_registrada_por.sql`:

```sql
-- Migración 080: quién registró una incapacidad, cuando no fue la propia persona
-- (spec docs/superpowers/specs/2026-11-23-incapacidad-por-admin-design.md).
--
-- Desde aquí el administrador puede registrar una incapacidad a nombre de
-- cualquier empleado activo, desde el Registro general. Esta columna deja la
-- constancia: NULL significa que la registró la propia persona (o que viene del
-- histórico de la hoja); con valor, es el correo, en minúsculas, del
-- administrador que la registró. NULL por defecto, así que ninguna solicitud
-- existente cambia.
--
-- VARCHAR(254), como el resto de correos del esquema (`empleados.correo`).
--
-- Sin GRANT: es una columna nueva de una tabla que portal_app ya tiene concedida
-- entera (la 068), y un permiso de tabla alcanza a sus columnas futuras. Lo
-- vigila db.roles.db.test.ts.
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque. No siembra nada.

ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS registrada_por VARCHAR(254);
```

- [ ] **Step 5: Apuntarla en `MIGRATIONS`**

En `apps/hub-api/src/db.ts` (L102), sustituir el final del array:

```ts
'078_equipos_responsable.sql', '079_terms_acceptances.sql'];
```

por:

```ts
'078_equipos_responsable.sql', '079_terms_acceptances.sql', '080_ausencias_registrada_por.sql'];
```

(El Dockerfile copia la carpeta `src/users/migrations` entera a `dist/`, L62: no hay que tocarlo.)

- [ ] **Step 6: Ver el test de la 079 en rojo**

```bash
cd apps/hub-api && npx vitest run src/ausencias/registrada-por.migracion.test.ts src/users/terms.migracion.test.ts
```

Esperado: los tres de la 080 en verde; cae `está apuntada en MIGRATIONS, detrás de la 078, y es la
última` de `terms.migracion.test.ts`, porque la 079 ya no cierra el array.

- [ ] **Step 7: Relevar el test de la 079**

En `apps/hub-api/src/users/terms.migracion.test.ts`, sustituir la L5:

```ts
// La migración 079 sin base de datos: que está apuntada (y es la última), que se
```

por:

```ts
// La migración 079 sin base de datos: que está apuntada, que se
```

y sustituir:

```ts
  it('está apuntada en MIGRATIONS, detrás de la 078, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'078_equipos_responsable\.sql',\s*'079_terms_acceptances\.sql'\];/);
  });
```

por:

```ts
  // Ya no es la última (la 080 de la incapacidad registrada por el administrador
  // va detrás): basta con que esté justo detrás de la 078. La última la vigila
  // ausencias/registrada-por.migracion.test.ts.
  it('está apuntada en MIGRATIONS, detrás de la 078', () => {
    expect(leer('../db.ts')).toMatch(/'078_equipos_responsable\.sql',\s*'079_terms_acceptances\.sql'[,\]]/);
  });
```

- [ ] **Step 8: Ver que todo pasa**

```bash
cd apps/hub-api && npx vitest run src/ausencias/registrada-por.migracion.test.ts src/users/terms.migracion.test.ts src/equipos/migracion.test.ts
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/incapacidad-ajena.db.test.ts src/db.roles.db.test.ts src/users/terms.db.test.ts
```

Esperado: todo en verde.

- [ ] **Step 9: Commit**

```bash
git add apps/hub-api/src/users/migrations/080_ausencias_registrada_por.sql apps/hub-api/src/db.ts apps/hub-api/src/ausencias/registrada-por.migracion.test.ts apps/hub-api/src/users/terms.migracion.test.ts apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts apps/hub-api/src/db.roles.db.test.ts
git commit -m "feat(ausencias): migracion 080 con la columna registrada_por"
```

---

### Task 2: la columna se escribe y se lee (`DatosInsercion` y `Solicitud`)

**Files:**
- Modify: `apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts`
- Modify: `apps/hub-api/src/ausencias/types.ts:609-610`
- Modify: `apps/hub-api/src/ausencias/repo/filas.ts:166-168,214-215,255-256`
- Modify: `apps/hub-api/src/ausencias/repo/solicitudes.ts:29-46,75-97`
- Modify: `apps/hub-api/src/test-db/harness.ts:243-288`
- Modify: `apps/hub-api/src/ausencias/service/solicitudes.ts:277-279`
- Modify: `apps/hub-api/src/ausencias/repo.evento-calendario.db.test.ts:141-143`
- Modify: `apps/hub-api/src/ausencias/notificaciones.test.ts:44-48`, `service.test.ts:78-80`, `types.test.ts:32-33`

- [ ] **Step 1: Escribir los tests de BD que fallan**

En `apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts`, sustituir la línea de import del harness:

```ts
import { poolDePrueba, limpiar } from '../test-db/harness.js';
```

por:

```ts
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';
```

añadir, justo después de `let db: Pool;`:

```ts

// Correos ficticios. ADMIN es el mismo que usa router.test.ts para un admin.
const CORREO = 'ana.ruiz@ambientalia.com.co';
const ADMIN = 'admin@ambientalia.com.co';

async function registradaPorEnBd(id: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT registrada_por FROM portal.solicitudes_ausencia WHERE id = $1`, [id]);
  return (rows[0] as { registrada_por: string | null }).registrada_por;
}
```

y al final del fichero:

```ts
describe('repo: registrada_por se escribe y se lee', () => {
  // Por `sembrarSolicitud`, que pasa por repo.crearSolicitud -> insertarSolicitud:
  // el mismo INSERT y el mismo SELECT_SOLICITUD que el alta del servidor.
  const incapacidad = (empleadoId: string, registradaPor?: string | null) =>
    sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'registrada',
      tipo: 'incapacidad',
      fechaInicio: '2025-03-03',
      fechaFin: '2025-03-05',
      segundoAprobadorCorreo: null,
      registradaPor,
    });

  it('con valor: queda en la columna y vuelve en la Solicitud', async () => {
    const s = await incapacidad(await sembrarEmpleado(db, CORREO), ADMIN);
    expect(await registradaPorEnBd(s.id)).toBe(ADMIN);
    expect(s.registradaPor).toBe(ADMIN);
  });

  it('lo guarda en minusculas aunque llegue con mayusculas', async () => {
    // La spec promete el correo en minusculas. sesionDe ya lo baja, y el INSERT
    // lo repite para que ninguna otra puerta futura pueda colarlo de otra forma.
    const s = await incapacidad(await sembrarEmpleado(db, CORREO), 'Admin@Ambientalia.com.co');
    expect(await registradaPorEnBd(s.id)).toBe(ADMIN);
  });

  it('sin valor: NULL en la columna y null (no undefined) en la Solicitud', async () => {
    const s = await incapacidad(await sembrarEmpleado(db, CORREO));
    expect(await registradaPorEnBd(s.id)).toBeNull();
    expect(s.registradaPor).toBeNull();
  });
});
```

- [ ] **Step 2: Ver que fallan**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/incapacidad-ajena.db.test.ts
```

Esperado: los tres nuevos FALLAN. Los dos primeros con `expected null to be 'admin@ambientalia.com.co'`
(el harness todavía no pasa la clave y el INSERT no escribe la columna); el tercero en
`expect(s.registradaPor).toBeNull()` con `expected undefined to be null` (el SELECT no la trae). El de
la migración sigue en verde.

- [ ] **Step 3: `Solicitud.registradaPor` en los tipos**

En `apps/hub-api/src/ausencias/types.ts`, sustituir el final de `Solicitud`:

```ts
   * el correo tiene que seguir pidiendo el ajuste a mano.
   */
  eventoCalendarioId: string | null;
}
```

por:

```ts
   * el correo tiene que seguir pidiendo el ajuste a mano.
   */
  eventoCalendarioId: string | null;
  /**
   * Quién la registró, si NO fue la propia persona: el correo, en minúsculas,
   * del administrador que la dio de alta a su nombre (migración 080). `null` =
   * la registró ella misma, o viene del histórico de la hoja.
   *
   * Lo lee el acuse (`acuseSolicitante`): con valor, el correo dice que la ha
   * registrado administración en vez de darle las gracias por reportarla.
   */
  registradaPor: string | null;
}
```

- [ ] **Step 4: Leerla en `repo/filas.ts`**

En `SELECT_SOLICITUD`, sustituir:

```ts
         -- Sin ::text: es TEXT en la base, no una fecha ni un numero.
         s.evento_calendario_id,
```

por:

```ts
         -- Sin ::text: es TEXT en la base, no una fecha ni un numero.
         s.evento_calendario_id,
         -- Quien la registro a nombre de la persona (080). NULL = ella misma.
         s.registrada_por,
```

En `FilaSolicitudDb`, sustituir:

```ts
  anulada_at: string | null;
  evento_calendario_id: string | null;
}
```

por:

```ts
  anulada_at: string | null;
  evento_calendario_id: string | null;
  registrada_por: string | null;
}
```

En `aSolicitud`, sustituir:

```ts
    anuladaAt: r.anulada_at,
    eventoCalendarioId: r.evento_calendario_id,
  };
}
```

por:

```ts
    anuladaAt: r.anulada_at,
    eventoCalendarioId: r.evento_calendario_id,
    registradaPor: r.registrada_por,
  };
}
```

- [ ] **Step 5: Escribirla en `repo/solicitudes.ts`**

En `DatosInsercion`, sustituir:

```ts
  /** Congelado por lo mismo que los firmantes: nace del árbol, no de un ajuste. */
  informadoCorreo: string | null;
}
```

por:

```ts
  /** Congelado por lo mismo que los firmantes: nace del árbol, no de un ajuste. */
  informadoCorreo: string | null;
  /**
   * Quién la registró a nombre de la persona: el correo del administrador de la
   * sesión, o `null` si la registra ella misma (migración 080). Obligatorio y no
   * opcional, por lo mismo que las horas: cada llamante tiene que decir cuál de
   * las dos es, no heredarlo por omisión.
   */
  registradaPor: string | null;
}
```

En `insertarSolicitud`, sustituir el INSERT entero:

```ts
  const { rows } = await client.query(
    `INSERT INTO portal.solicitudes_ausencia
       (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin,
        dias_habiles, comentarios, estado, aprobador_correo, segundo_aprobador_correo,
        informado_correo, hora_inicio, hora_fin)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12::time, $13::time)
     RETURNING id`,
    [
      datos.tipo,
      datos.empleadoId,
      datos.solicitanteEmail,
      datos.fechaInicio,
      datos.fechaFin,
      datos.diasHabiles,
      datos.comentarios,
      datos.estado,
      datos.aprobadorCorreo,
      datos.segundoAprobadorCorreo,
      datos.informadoCorreo,
      datos.horaInicio,
      datos.horaFin,
    ],
  );
```

por:

```ts
  const { rows } = await client.query(
    // lower() en registrada_por por lo mismo que fijarJefe con el aprobador: la
    // columna promete el correo en minusculas, y asi no depende de quien llame.
    `INSERT INTO portal.solicitudes_ausencia
       (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin,
        dias_habiles, comentarios, estado, aprobador_correo, segundo_aprobador_correo,
        informado_correo, hora_inicio, hora_fin, registrada_por)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12::time, $13::time, lower($14))
     RETURNING id`,
    [
      datos.tipo,
      datos.empleadoId,
      datos.solicitanteEmail,
      datos.fechaInicio,
      datos.fechaFin,
      datos.diasHabiles,
      datos.comentarios,
      datos.estado,
      datos.aprobadorCorreo,
      datos.segundoAprobadorCorreo,
      datos.informadoCorreo,
      datos.horaInicio,
      datos.horaFin,
      datos.registradaPor,
    ],
  );
```

- [ ] **Step 6: El harness**

En `apps/hub-api/src/test-db/harness.ts`, en `DatosSiembra`, sustituir:

```ts
  tipo?: TipoSolicitud;
}
```

por:

```ts
  tipo?: TipoSolicitud;
  /** Opcional, como las horas: solo lo pide quien prueba la constancia de la 080. */
  registradaPor?: string | null;
}
```

y en `sembrarSolicitud`, sustituir:

```ts
      segundoAprobadorCorreo: d.segundoAprobadorCorreo,
      informadoCorreo: null,
    },
```

por:

```ts
      segundoAprobadorCorreo: d.segundoAprobadorCorreo,
      informadoCorreo: null,
      registradaPor: d.registradaPor ?? null,
    },
```

- [ ] **Step 7: El alta del servidor, de momento con `null`**

En `apps/hub-api/src/ausencias/service/solicitudes.ts`, dentro de `altaBajoCandado`, sustituir:

```ts
      informadoCorreo: firmantes ? firmantes.informado : null,
    },
    adjunto,
```

por:

```ts
      informadoCorreo: firmantes ? firmantes.informado : null,
      // Hoy solo hay una puerta de alta, la de la propia persona: nadie la
      // registra a su nombre. Ver la migración 080.
      registradaPor: null,
    },
    adjunto,
```

- [ ] **Step 8: Los `DatosInsercion` y las `Solicitud` montados a mano**

En `apps/hub-api/src/ausencias/repo.evento-calendario.db.test.ts`, sustituir:

```ts
        segundoAprobadorCorreo: null,
        informadoCorreo: null,
      },
      null,
      ['registrada'],
```

por:

```ts
        segundoAprobadorCorreo: null,
        informadoCorreo: null,
        registradaPor: null,
      },
      null,
      ['registrada'],
```

En `apps/hub-api/src/ausencias/notificaciones.test.ts`, sustituir:

```ts
    // igual que ponen `estado: 'aprobada'`.
    eventoCalendarioId: null,
    ...over,
```

por:

```ts
    // igual que ponen `estado: 'aprobada'`.
    eventoCalendarioId: null,
    // La registra la propia persona: el caso de casi todas.
    registradaPor: null,
    ...over,
```

En `apps/hub-api/src/ausencias/service.test.ts`, sustituir:

```ts
    // Este fichero no llega a Google: una `pendiente` no tiene evento.
    eventoCalendarioId: null,
    ...over,
```

por:

```ts
    // Este fichero no llega a Google: una `pendiente` no tiene evento.
    eventoCalendarioId: null,
    registradaPor: null,
    ...over,
```

En `apps/hub-api/src/ausencias/types.test.ts`, sustituir:

```ts
    eventoCalendarioId: null,
    ...over,
```

por:

```ts
    eventoCalendarioId: null,
    registradaPor: null,
    ...over,
```

- [ ] **Step 9: Ver que pasa, y que no se rompe nada del alta**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/incapacidad-ajena.db.test.ts src/ausencias/repo.evento-calendario.db.test.ts src/ausencias/alta-concurrente.db.test.ts src/ausencias/repo.hora.db.test.ts src/db.roles.db.test.ts
cd apps/hub-api && npx vitest run src/ausencias
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
```

Esperado: todo en verde (el fichero nuevo, 4 tests); el `CANDADO: modela exactamente las funciones que
exporta repo.ts` de `router.test.ts` sigue en verde porque `repo.ts` no ganó ninguna función; typecheck
sin errores. `db.roles.db.test.ts` («lee, inserta, actualiza y borra filas en portal») ya inserta una
solicitud COMO `portal_app` con el INSERT nuevo: esa es la otra prueba de que no hace falta GRANT.

- [ ] **Step 10: Commit**

```bash
git add apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo/filas.ts apps/hub-api/src/ausencias/repo/solicitudes.ts apps/hub-api/src/test-db/harness.ts apps/hub-api/src/ausencias/service/solicitudes.ts apps/hub-api/src/ausencias/repo.evento-calendario.db.test.ts apps/hub-api/src/ausencias/notificaciones.test.ts apps/hub-api/src/ausencias/service.test.ts apps/hub-api/src/ausencias/types.test.ts
git commit -m "feat(ausencias): el alta guarda y relee quien registro la solicitud"
```

---

### Task 3: el acuse cuando la registra administración

**Files:**
- Modify: `apps/hub-api/src/ausencias/notificaciones.test.ts` (después del `it('el acuse de incapacidad va con copia a administración…')`, ~L225)
- Modify: `apps/hub-api/src/ausencias/notificaciones.ts:185-215`

- [ ] **Step 1: Escribir los tests que fallan**

En `apps/hub-api/src/ausencias/notificaciones.test.ts`, justo después de:

```ts
  it('el acuse de incapacidad va con copia a administración y desea recuperación', () => {
    const p = construirPayload(solicitud({ tipo: 'incapacidad', estado: 'registrada', adjunto: pdf }), 'registrada');
    expect(p.correo.para).toContain('administrativo@ambientalia.com.co');
    expect(p.correo.cuerpo).toContain('pronta recuperación');
  });
```

añadir:

```ts
  it('si la registró administración lo dice, y no le da las gracias por reportarla', () => {
    // No la reportó él: la registró administración a su nombre (migración 080).
    const p = construirPayload(
      solicitud({ tipo: 'incapacidad', estado: 'registrada', adjunto: pdf, registradaPor: 'admin@ambientalia.com.co' }),
      'registrada',
    );
    expect(p.correo.asunto).toBe('Administración ha registrado tu incapacidad');
    expect(p.correo.cuerpo).toContain('¡Hola Ana Ruiz!');
    expect(p.correo.cuerpo).toContain('Administración ha registrado tu incapacidad en el portal. Este es el resumen:');
    expect(p.correo.cuerpo).toContain('Esperamos tu pronta recuperación.');
    expect(p.correo.cuerpo).not.toMatch(/gracias|Tu reporte de incapacidad/i);
    // El resumen, los comentarios y el adjunto de siempre.
    expect(p.correo.cuerpo).toContain('📅 Fecha primer día de incapacidad: 2026-07-06');
    expect(p.correo.cuerpo).toContain('Comentarios: Viaje familiar');
    expect(p.correo.cuerpo).toContain('📎 Documento adjunto: Incapacidades_Ana_Ruiz_2026-07-06_1.pdf');
    expect(p.correo.cuerpo).not.toMatch(/undefined|null|\[object/);
  });

  it('CANDADO: registradaPor cambia el texto y NADA más: ni destinatarios, ni calendario, ni hoja', () => {
    const base = solicitud({ tipo: 'incapacidad', estado: 'registrada', adjunto: pdf });
    const propia = construirPayload(base, 'registrada');
    const ajena = construirPayload({ ...base, registradaPor: 'admin@ambientalia.com.co' }, 'registrada');
    expect(ajena.correo.para).toBe(propia.correo.para);
    expect(ajena.calendario).toEqual(propia.calendario);
    expect(ajena.hoja).toEqual(propia.hoja);
    expect(ajena.correo.asunto).not.toBe(propia.correo.asunto);
  });

  it('sin registradaPor, el acuse de la incapacidad sigue siendo el de siempre', () => {
    const p = construirPayload(solicitud({ tipo: 'incapacidad', estado: 'registrada', adjunto: pdf }), 'registrada');
    expect(p.correo.asunto).toBe('¡Reporte de incapacidad registrado exitosamente!');
    expect(p.correo.cuerpo).toContain('Muchas gracias por reportar tu incapacidad. Esperamos tu pronta recuperación.');
  });
```

- [ ] **Step 2: Ver que fallan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/notificaciones.test.ts -t "administración|registradaPor"
```

Esperado: FALLAN los dos primeros nuevos, con `expected '¡Reporte de incapacidad registrado
exitosamente!' to be 'Administración ha registrado tu incapacidad'` y `expected … not to be …` (el
asunto no cambia). Pasan ya el tercero nuevo (el candado de que lo de siempre no se mueve) y el que ya
existía, «…copia a administración y desea recuperación», que también casa con el filtro.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/ausencias/notificaciones.ts`, sustituir la función `acuseSolicitante` entera
(L185-215) por:

```ts
function acuseSolicitante(s: Solicitud) {
  const esInc = s.tipo === 'incapacidad';
  // La registró administración a su nombre (migración 080, la puerta de
  // `registrarIncapacidadAjena`). Cambia SOLO el texto: darle las gracias por
  // reportarla sería falso, porque no la reportó él. Destinatarios, calendario
  // y hoja siguen siendo los de siempre.
  //
  // `Boolean(...)` y no `!== null`: un objeto montado a mano sin la clave —los
  // dobles de los tests— daría `undefined !== null`, o sea `true`, y pondría el
  // texto de administración en una incapacidad que informó la propia persona.
  const porAdministracion = esInc && Boolean(s.registradaPor);
  // No hay correo de avance intermedio: el empleado recibe este acuse y el
  // veredicto, dos correos. Por eso el acuse anuncia el circuito de dos firmas
  // cuando lo hay, para que la espera no sorprenda.
  const cierre = porAdministracion
    ? 'Esperamos tu pronta recuperación.'
    : esInc
      ? 'Muchas gracias por reportar tu incapacidad. Esperamos tu pronta recuperación.'
      : s.segundoAprobadorCorreo
        ? 'Tu solicitud pasa por dos aprobaciones: primero tu jefe inmediato y después su superior. Te informaremos por este medio del resultado final.'
        : 'Te informaremos por este medio del estado de aprobación de la solicitud.';
  return {
    para: esInc ? destinatarios(s.solicitanteEmail, COPIA_INCAPACIDADES, s.copiaCorreo) : s.solicitanteEmail,
    asunto: porAdministracion
      ? 'Administración ha registrado tu incapacidad'
      : esInc
        ? '¡Reporte de incapacidad registrado exitosamente!'
        : `¡Solicitud ${PERIODO[s.tipo]} registrada exitosamente!`,
    cuerpo: [
      `¡Hola ${s.empleadoNombre}!`,
      '',
      porAdministracion
        ? 'Administración ha registrado tu incapacidad en el portal. Este es el resumen:'
        : esInc
          ? 'Tu reporte de incapacidad ha quedado registrado. Este es el resumen:'
          : `Tu solicitud ${PERIODO[s.tipo]} ha sido registrada. Este es el resumen:`,
      '',
      bloqueResumen(s),
      bloqueComentarios(s) + bloqueAdjunto(s),
      cierre,
      '',
      'Saludos,',
      FIRMA_EMPRESA,
    ].join('\n'),
  };
}
```

- [ ] **Step 4: Ver que pasan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/notificaciones.test.ts
```

Esperado: todo el fichero en verde (3 tests nuevos).

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/notificaciones.ts apps/hub-api/src/ausencias/notificaciones.test.ts
git commit -m "feat(ausencias): acuse adaptado cuando la incapacidad la registra administracion"
```

---

### Task 4: la validación pura `validarIncapacidadAjena`

**Files:**
- Create: `apps/hub-api/src/ausencias/incapacidad-ajena.test.ts`
- Modify: `apps/hub-api/src/ausencias/service/validacion.ts:94-100,163-166`

- [ ] **Step 1: Ver en verde, antes de tocar nada, la validación del empleado**

```bash
cd apps/hub-api && npx vitest run src/ausencias/service.test.ts -t "validarNuevaSolicitud"
```

Esperado: verde. Es la línea base: `validarNuevaSolicitud` se va a convertir en envoltorio y tiene que
seguir diciendo exactamente lo mismo.

- [ ] **Step 2: Escribir el test que falla**

Crear `apps/hub-api/src/ausencias/incapacidad-ajena.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validarIncapacidadAjena, validarNuevaSolicitud } from './service.js';

// La validación del alta que hace el administrador a nombre de otro: la de una
// incapacidad del empleado, salvo el límite hacia atrás. Pura, con el «hoy»
// inyectado, como `validarNuevaSolicitud`.

/** Un «hoy» fijo, el mismo que service.test.ts: con el reloj real, «hace un año» se movería solo. */
const HOY = '2026-07-01';
/** Un año antes de HOY, de martes a jueves y sin festivos: muy fuera de la ventana de dos días. */
const HACE_UN_ANO_DESDE = '2025-07-01';
const HACE_UN_ANO_HASTA = '2025-07-03';
const E1 = '11111111-1111-4111-8111-111111111111';
const PDF_BASE64 = Buffer.from('%PDF-1.4 fake').toString('base64');
const soporte = { nombreArchivo: 'baja.pdf', mime: 'application/pdf', contenidoBase64: PDF_BASE64 };

const cuerpo = (over: Record<string, unknown> = {}) => ({
  empleadoId: E1,
  fechaInicio: HACE_UN_ANO_DESDE,
  fechaFin: HACE_UN_ANO_HASTA,
  adjunto: soporte,
  ...over,
});

/** El error que lanza, o null si no lanza. */
function fallo(body: unknown): unknown {
  try {
    validarIncapacidadAjena(body, HOY);
  } catch (e) {
    return e;
  }
  return null;
}

describe('validarIncapacidadAjena', () => {
  it('acepta una incapacidad de hace un año: aquí no hay ventana hacia atrás', () => {
    const r = validarIncapacidadAjena(cuerpo(), HOY);
    expect(r.empleadoId).toBe(E1);
    expect(r.datos).toMatchObject({ tipo: 'incapacidad', fechaInicio: HACE_UN_ANO_DESDE, fechaFin: HACE_UN_ANO_HASTA });
    expect(r.datos.adjunto?.nombreArchivo).toBe('baja.pdf');
  });

  it('CANDADO: la misma fecha por la validación del EMPLEADO se sigue rechazando', () => {
    // La exención es de esta puerta y de ninguna otra: si alguien la moviera a la
    // validación compartida, el empleado podría volver a informar bajas de hace
    // un año por su cuenta.
    expect(() => validarNuevaSolicitud({ ...cuerpo(), tipo: 'incapacidad' }, HOY)).toThrow(
      expect.objectContaining({ code: 'incapacidad_demasiado_antigua' }),
    );
  });

  it('acepta que empiece hoy y acabe después: el médico firma hoy una baja que cubre los próximos días', () => {
    expect(validarIncapacidadAjena(cuerpo({ fechaInicio: HOY, fechaFin: '2026-07-06' }), HOY).datos.fechaInicio).toBe(HOY);
  });

  it('rechaza mañana: incapacidad_en_el_futuro', () => {
    expect(fallo(cuerpo({ fechaInicio: '2026-07-02', fechaFin: '2026-07-03' }))).toMatchObject({
      code: 'incapacidad_en_el_futuro',
      status: 400,
      field: 'fechaInicio',
    });
  });

  it('sigue exigiendo el PDF', () => {
    expect(fallo(cuerpo({ adjunto: undefined }))).toMatchObject({ code: 'adjunto_requerido', status: 400, field: 'adjunto' });
  });

  it('y lo valida igual que al empleado: un no-PDF se rechaza', () => {
    expect(fallo(cuerpo({ adjunto: { ...soporte, mime: 'image/png' } }))).toMatchObject({ code: 'adjunto_no_es_pdf' });
  });

  it('400 empleado_requerido si falta empleadoId o no es una cadena con algo', () => {
    for (const empleadoId of [undefined, null, 42, '', {}]) {
      expect(fallo(cuerpo({ empleadoId })), String(empleadoId)).toMatchObject({
        code: 'empleado_requerido',
        status: 400,
        field: 'empleadoId',
      });
    }
  });

  it('404 empleado_no_encontrado si no tiene forma de uuid: Postgres contestaría un 500', () => {
    expect(fallo(cuerpo({ empleadoId: 'basura' }))).toMatchObject({ code: 'empleado_no_encontrado', status: 404 });
  });

  it('rechaza los días, igual que en la incapacidad del empleado', () => {
    expect(fallo(cuerpo({ dias: 3 }))).toMatchObject({ code: 'dias_no_aplica', field: 'dias' });
  });

  it('rechaza las horas, igual que en la incapacidad del empleado', () => {
    expect(fallo(cuerpo({ horaInicio: '09:00', horaFin: '11:00' }))).toMatchObject({ code: 'hora_no_permitida' });
  });

  it('el tipo lo pone esto: si viaja otro, tipo_invalido; si viaja el mismo, pasa', () => {
    expect(fallo(cuerpo({ tipo: 'vacaciones' }))).toMatchObject({ code: 'tipo_invalido', status: 400, field: 'tipo' });
    expect(validarIncapacidadAjena(cuerpo({ tipo: 'incapacidad' }), HOY).datos.tipo).toBe('incapacidad');
  });

  it('las reglas comunes siguen: rango invertido, más de un año, comentarios demasiado largos', () => {
    expect(fallo(cuerpo({ fechaInicio: HACE_UN_ANO_HASTA, fechaFin: HACE_UN_ANO_DESDE }))).toMatchObject({ code: 'rango_invertido' });
    expect(fallo(cuerpo({ fechaInicio: '2024-07-01', fechaFin: '2026-06-30' }))).toMatchObject({ code: 'rango_demasiado_largo' });
    expect(fallo(cuerpo({ comentarios: 'x'.repeat(2001) }))).toMatchObject({ code: 'comentarios_demasiado_largos' });
  });

  it('limpia los comentarios igual que el alta del empleado', () => {
    expect(validarIncapacidadAjena(cuerpo({ comentarios: '  Avisó su hermana  ' }), HOY).datos.comentarios).toBe(
      'Avisó su hermana',
    );
  });
});
```

- [ ] **Step 3: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/ausencias/incapacidad-ajena.test.ts
```

Esperado: FALLAN todos salvo el CANDADO. Los que llaman directo, con `validarIncapacidadAjena is not a
function`; los que pasan por `fallo()`, en el `toMatchObject` (lo recibido es ese TypeError, que `fallo`
captura).

- [ ] **Step 4: Implementar — el envoltorio, la validación nueva y la privada**

En `apps/hub-api/src/ausencias/service/validacion.ts`, sustituir:

```ts
/**
 * Valida y normaliza lo que llega del cliente. Nada de `empleadoId` ni de
 * `diasHabiles`: el primero sale de la sesión y el segundo se calcula aquí, así
 * que ni suplantar a otro ni inflar los días es posible desde el navegador.
 */
export function validarNuevaSolicitud(body: unknown, hoy: string): NuevaSolicitud {
  const b = (body ?? {}) as Record<string, unknown>;
```

por:

```ts
/**
 * Valida y normaliza lo que llega del cliente. Nada de `empleadoId` ni de
 * `diasHabiles`: el primero sale de la sesión y el segundo se calcula aquí, así
 * que ni suplantar a otro ni inflar los días es posible desde el navegador.
 */
export function validarNuevaSolicitud(body: unknown, hoy: string): NuevaSolicitud {
  return validarAlta(body, hoy, true);
}

// Un id que no es un UUID haría que Postgres contestara con un error de tipo (un
// 500) al buscar la ficha. Mismo criterio y misma expresión que
// `validarEmpleadoId` en notas.ts: para quien llama es lo mismo que una ficha
// que no existe.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La validación del alta que hace un ADMINISTRADOR a nombre de otro: solo
 * incapacidades (spec 2026-11-23-incapacidad-por-admin).
 *
 * Es la de una incapacidad del empleado —formato de fechas, `rango_invertido`,
 * el tope del rango, los comentarios, el PDF obligatorio y validado igual, y el
 * rechazo de `dias` y de las horas— salvo el límite hacia atrás: la ventana de
 * dos días existe para que el empleado informe pronto, y esta puerta es justo la
 * que la ventana manda usar cuando se pasó. Hacia adelante sigue cerrada
 * (`incapacidad_en_el_futuro`): nadie sabe que va a enfermar.
 *
 * No copia la validación: la comparte con `validarNuevaSolicitud` por
 * `validarAlta`, y la diferencia es un solo booleano. Dos copias se habrían ido
 * separando con los meses.
 *
 * El `tipo` no viaja: lo fija esto. Si viaja otro, 400, por lo mismo que
 * `dias_no_aplica`: aceptarlo e ignorarlo dejaría creer que por aquí se pueden
 * registrar unas vacaciones.
 */
export function validarIncapacidadAjena(body: unknown, hoy: string): { empleadoId: string; datos: NuevaSolicitud } {
  const b = (body ?? {}) as Record<string, unknown>;
  const empleadoId = b.empleadoId;
  // El `''` es la opción «— Elige una persona —» del desplegable: no hay persona.
  if (typeof empleadoId !== 'string' || empleadoId === '') {
    throw new AusenciaError('empleado_requerido', 400, 'empleadoId');
  }
  if (!UUID.test(empleadoId)) throw new AusenciaError('empleado_no_encontrado', 404, 'empleadoId');
  if (b.tipo !== undefined && b.tipo !== 'incapacidad') throw new AusenciaError('tipo_invalido', 400, 'tipo');
  return { empleadoId, datos: validarAlta({ ...b, tipo: 'incapacidad' }, hoy, false) };
}

/**
 * El cuerpo común de las dos validaciones de un alta, la del empleado y la del
 * administrador. `conVentanaHaciaAtras` es lo único que las separa: la del
 * empleado acota la incapacidad a dos días atrás y la del administrador no.
 */
function validarAlta(body: unknown, hoy: string, conVentanaHaciaAtras: boolean): NuevaSolicitud {
  const b = (body ?? {}) as Record<string, unknown>;
```

- [ ] **Step 5: Implementar — la ventana, solo con el booleano**

En el mismo fichero, sustituir:

```ts
    // Y hacia atrás, poco: informarla es cosa de días, no de meses. Con la
    // ventana en dos días, una baja de la semana pasada ya no entra sola y hay
    // que pedírsela a administración, que sí puede corregir el registro.
    if (fechaInicio < limiteDeLaIncapacidad(hoy)) {
```

por:

```ts
    // Y hacia atrás, poco: informarla es cosa de días, no de meses. Con la
    // ventana en dos días, una baja de la semana pasada ya no entra sola y hay
    // que pedírsela a administración, que la registra por su propia puerta
    // (`validarIncapacidadAjena`): la única que llega aquí sin la ventana.
    if (conVentanaHaciaAtras && fechaInicio < limiteDeLaIncapacidad(hoy)) {
```

- [ ] **Step 6: Ver que pasa, y que la del empleado no se movió**

```bash
cd apps/hub-api && npx vitest run src/ausencias/incapacidad-ajena.test.ts src/ausencias/service.test.ts src/ausencias/service/barril.test.ts
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "POST /ausencias/solicitudes"
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
```

Esperado: todo en verde (13 tests nuevos); el barril sigue en verde porque `service.ts` hace
`export * from './service/validacion.js'`; typecheck sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/ausencias/service/validacion.ts apps/hub-api/src/ausencias/incapacidad-ajena.test.ts
git commit -m "feat(ausencias): validacion de la incapacidad registrada por el administrador"
```

---

### Task 5: el núcleo del alta, compartido (refactor sin cambio de comportamiento)

**Files:**
- Modify: `apps/hub-api/src/ausencias/service/solicitudes.ts:169-185,273-283,285-335`
- Modify: `apps/hub-api/src/ausencias/router.test.ts` (dentro de `describe('POST /ausencias/solicitudes', …)`, antes de su `});` final, ~L2065)
- Modify: `apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts`

Task de refactor: no hay rojo. La red son los tests del alta que ya existen, en verde antes y después,
más dos candados de caracterización que se escriben ANTES de tocar el código y nacen en verde (fijan
lo que el refactor no puede mover: el alta del empleado no deja `registrada_por`).

- [ ] **Step 1: Los dos candados de caracterización**

En `apps/hub-api/src/ausencias/router.test.ts`, dentro de `describe('POST /ausencias/solicitudes', …)`,
justo después del `it('el alta guarda la hora del permiso', …)`:

```ts
  it('CANDADO: el alta del empleado nace con registradaPor en null', async () => {
    // La registra la propia persona: la constancia de la 080 solo la pone la
    // puerta del administrador. Con el correo de la sesion aqui, todas las
    // incapacidades del portal saldrian como "registradas por administracion".
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ tipo: 'incapacidad', fechaInicio: INCAP_DESDE, fechaFin: INCAP_HASTA, adjunto: { nombreArchivo: 'i.pdf', mime: 'application/pdf', contenidoBase64: PDF } }))
      .expect(201);
    expect(r.body.registradaPor).toBeNull();
  });
```

En `apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts`, añadir a los imports:

```ts
import { crearSolicitud } from './service.js';
import { hoyEnColombia } from './saldo.js';
import { sumarDias } from './festivos.js';
```

añadir, justo después de `const ADMIN = …;`:

```ts
const PDF = Buffer.from('%PDF-1.4 prueba').toString('base64');
const soporte = { nombreArchivo: 'baja.pdf', mime: 'application/pdf', contenidoBase64: PDF };
const sesionEmpleado = { email: CORREO, userId: null, esAdmin: false };
```

y al final del fichero:

```ts
describe('el alta del empleado', () => {
  it('CANDADO: deja registrada_por en NULL', async () => {
    // Empieza hoy y acaba manana: dentro de su ventana con el reloj real.
    await sembrarEmpleado(db, CORREO);
    const hoy = hoyEnColombia();
    const s = await crearSolicitud(db, sesionEmpleado, {
      tipo: 'incapacidad',
      fechaInicio: hoy,
      fechaFin: sumarDias(hoy, 1),
      adjunto: soporte,
    });
    expect(await registradaPorEnBd(s.id)).toBeNull();
    expect(s.registradaPor).toBeNull();
  });
});
```

- [ ] **Step 2: Ver la línea base en verde**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts src/ausencias/service.test.ts
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/incapacidad-ajena.db.test.ts src/ausencias/alta-concurrente.db.test.ts src/ausencias/cambios-concurrentes.db.test.ts src/ausencias/repo.hora.db.test.ts
```

Esperado: todo en verde, los dos candados nuevos incluidos (el `null` lo puso la Task 2).

- [ ] **Step 3: `altaBajoCandado` recibe `registradaPor`**

En `apps/hub-api/src/ausencias/service/solicitudes.ts`, sustituir:

```ts
 * Es el cuerpo de `crearSolicitud` tal cual estaba, con `tx` donde ponía `db`:
 * se saca a una función propia para no tener que re-sangrarlo entero dentro
 * del callback del candado.
 */
async function altaBajoCandado(
  tx: repo.PoolClient,
  sesion: Sesion,
  empleado: Empleado,
  datos: NuevaSolicitud,
  aprueba: boolean,
  estado: EstadoSolicitud,
): Promise<Solicitud> {
```

por:

```ts
 * Es el cuerpo de `crearSolicitud` tal cual estaba, con `tx` donde ponía `db`:
 * se saca a una función propia para no tener que re-sangrarlo entero dentro
 * del callback del candado. `registradaPor` lo deja tal cual en la fila: lo
 * decide quien llama a `darDeAlta`.
 */
async function altaBajoCandado(
  tx: repo.PoolClient,
  sesion: Sesion,
  empleado: Empleado,
  datos: NuevaSolicitud,
  aprueba: boolean,
  estado: EstadoSolicitud,
  registradaPor: string | null,
): Promise<Solicitud> {
```

y sustituir:

```ts
      // Hoy solo hay una puerta de alta, la de la propia persona: nadie la
      // registra a su nombre. Ver la migración 080.
      registradaPor: null,
```

por:

```ts
      // `null` en el alta de la propia persona; el correo del administrador
      // cuando la registra él a su nombre (migración 080).
      registradaPor,
```

- [ ] **Step 4: `crearSolicitud` se parte en `darDeAlta` + lo que es solo suyo**

En el mismo fichero, sustituir la cabecera de `crearSolicitud`:

```ts
export async function crearSolicitud(db: Pool, sesion: Sesion, body: unknown): Promise<Solicitud> {
  const datos = validarNuevaSolicitud(body, hoyEnColombia());
  const empleado = await empleadoDeSesion(db, sesion);
  // La otra mitad del bloqueo de la baja: allí se impide fijar una fecha que
```

por:

```ts
/**
 * El alta, desde que ya se sabe QUIÉN y QUÉ: el tope del retiro, el estado con
 * el que nace y, bajo el candado del empleado, las comprobaciones y el INSERT
 * (`altaBajoCandado`); después, el aviso a n8n.
 *
 * La comparten las dos puertas del alta —la del empleado (`crearSolicitud`) y
 * la del administrador que registra una incapacidad a nombre de otro
 * (`registrarIncapacidadAjena`)— y es lo que hace que la segunda tenga
 * exactamente los mismos efectos que la primera: lo delicado se comparte, no
 * se copia. Lo que las distingue es de dónde sale la ficha y qué validación
 * pasa el cuerpo, y eso lo decide cada una antes de llamar aquí.
 *
 * `registradaPor`: `null` en el alta de la propia persona, y el correo del
 * administrador de la sesión en la otra (migración 080).
 */
async function darDeAlta(
  db: Pool,
  sesion: Sesion,
  empleado: Empleado,
  datos: NuevaSolicitud,
  registradaPor: string | null,
): Promise<Solicitud> {
  // La otra mitad del bloqueo de la baja: allí se impide fijar una fecha que
```

y sustituir el final de la función:

```ts
  const solicitud = await repo.conCandadoDelEmpleado(db, empleado.id, (tx) =>
    altaBajoCandado(tx, sesion, empleado, datos, aprueba, estado),
  );

  // Sin await: el aviso es un atajo para que el correo salga en un segundo en vez
  // de en unos minutos. La solicitud ya está guardada y encolada, así que esto no
  // puede fallar de forma que importe. Ver avisar.ts.
  void avisarN8n();
  return solicitud;
}
```

por:

```ts
  const solicitud = await repo.conCandadoDelEmpleado(db, empleado.id, (tx) =>
    altaBajoCandado(tx, sesion, empleado, datos, aprueba, estado, registradaPor),
  );

  // Sin await: el aviso es un atajo para que el correo salga en un segundo en vez
  // de en unos minutos. La solicitud ya está guardada y encolada, así que esto no
  // puede fallar de forma que importe. Ver avisar.ts.
  void avisarN8n();
  return solicitud;
}

export async function crearSolicitud(db: Pool, sesion: Sesion, body: unknown): Promise<Solicitud> {
  const datos = validarNuevaSolicitud(body, hoyEnColombia());
  // La identidad sale de la sesión y de ningún otro sitio. Para registrar a
  // nombre de otro está la puerta del administrador, `registrarIncapacidadAjena`;
  // por eso aquí `registradaPor` es `null` siempre.
  const empleado = await empleadoDeSesion(db, sesion);
  return darDeAlta(db, sesion, empleado, datos, null);
}
```

(Los comentarios largos del tope del retiro, del estado y del candado se quedan donde estaban: ahora
viven dentro de `darDeAlta`, que es donde está su código.)

- [ ] **Step 5: Ver la misma batería en verde después**

Los mismos comandos del Step 2, más el typecheck:

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts src/ausencias/service.test.ts
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/incapacidad-ajena.db.test.ts src/ausencias/alta-concurrente.db.test.ts src/ausencias/cambios-concurrentes.db.test.ts src/ausencias/repo.hora.db.test.ts
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
```

Esperado: exactamente lo mismo que en el Step 2, todo verde; typecheck sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/ausencias/service/solicitudes.ts apps/hub-api/src/ausencias/router.test.ts apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts
git commit -m "refactor(ausencias): nucleo del alta compartido, sin cambio de comportamiento"
```

---

### Task 6: `registrarIncapacidadAjena` y la ruta del administrador

**Files:**
- Modify: `apps/hub-api/src/ausencias/router.test.ts` (después del `});` de `describe('POST /ausencias/solicitudes', …)`, ~L2078)
- Modify: `apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts`
- Modify: `apps/hub-api/src/ausencias/service/solicitudes.ts:23` y después de `crearSolicitud`
- Modify: `apps/hub-api/src/ausencias/router.ts` (después de la ruta `POST /ausencias/solicitudes`, L172)

- [ ] **Step 1: Escribir los tests de la ruta que fallan**

En `apps/hub-api/src/ausencias/router.test.ts`, el ancla es el cierre del `describe` del alta, que
tras la Task 5 termina con su candado de `registradaPor`. Sustituir:

```ts
    expect(r.body.registradaPor).toBeNull();
  });
});

// ── El candado del solapamiento ────────────────────────────────────────────
```

por:

```ts
    expect(r.body.registradaPor).toBeNull();
  });
});

// ── La incapacidad que registra el administrador a nombre de otro ─────────

describe('POST /ausencias/solicitudes/incapacidad-ajena', () => {
  // Un admin con correo propio, distinto del de la sesion por defecto: es lo
  // unico que permite distinguir "el correo del empleado" de "el de quien la
  // registra".
  const ADMIN = 'admin@ambientalia.com.co';
  // Un ano antes del reloj congelado (2026-01-15): muy fuera de la ventana de
  // dos dias del alta del empleado. De martes a jueves y sin festivos.
  const HACE_UN_ANO_DESDE = '2025-01-14';
  const HACE_UN_ANO_HASTA = '2025-01-16';
  const soporte = { nombreArchivo: 'escaneo (1).pdf', mime: 'application/pdf', contenidoBase64: PDF };

  const cuerpo = (over: Record<string, unknown> = {}) => ({
    empleadoId: E1,
    fechaInicio: HACE_UN_ANO_DESDE,
    fechaFin: HACE_UN_ANO_HASTA,
    adjunto: soporte,
    ...over,
  });

  const registrar = (body: object, t = token({ sub: ADMIN, role: 'admin' })) =>
    request(app()).post('/api/ausencias/solicitudes/incapacidad-ajena').set('Authorization', `Bearer ${t}`).send(body);

  it('201: un admin la registra a nombre de otro, aunque empiece hace un ano', async () => {
    const r = await registrar(cuerpo()).expect(201);
    expect(r.body).toMatchObject({
      tipo: 'incapacidad',
      empleadoId: E1,
      estado: 'registrada',
      fechaInicio: HACE_UN_ANO_DESDE,
      fechaFin: HACE_UN_ANO_HASTA,
      // Sin aprobador, igual que la del empleado: si lo tuviera, apareceria en su bandeja.
      aprobadorCorreo: null,
    });
  });

  it('CANDADO: solicitanteEmail es el del EMPLEADO y registradaPor el del admin de la sesion', async () => {
    // Si el alta tomara el correo de la sesion, el empleado dejaria de poder
    // abrir su propio PDF, y su jefe con llave tambien: esos permisos miran
    // solicitante_email.
    const r = await registrar(cuerpo()).expect(201);
    expect(r.body.solicitanteEmail).toBe('ana.ruiz@ambientalia.com.co');
    expect(r.body.registradaPor).toBe(ADMIN);
  });

  it('renombra el PDF con el nombre del EMPLEADO', async () => {
    const r = await registrar(cuerpo()).expect(201);
    expect(r.body.adjunto.nombreArchivo).toBe(`Incapacidades_Ana_Ruiz_Molina_${HACE_UN_ANO_DESDE}_1.pdf`);
  });

  it('encola UN evento registrada, con el acuse de administracion, al empleado y con calendario', async () => {
    await registrar(cuerpo()).expect(201);
    expect(estado.eventos.map((e) => e.evento)).toEqual(['registrada']);
    const { correo, calendario } = estado.eventos[0].payload as {
      correo: { asunto: string; para: string };
      calendario: { accion: string } | null;
    };
    expect(correo.asunto).toBe('Administración ha registrado tu incapacidad');
    expect(correo.para).toContain('ana.ruiz@ambientalia.com.co');
    expect(calendario?.accion).toBe('crear');
  });

  it('acepta un PDF por encima de los 2mb del parser global: cuelga del prefijo de 12mb', async () => {
    // Regresion del orden de middleware, igual que en el alta del empleado: la
    // ruta nueva no monta parser propio, usa el de /api/ausencias/solicitudes.
    const grande = Buffer.alloc(3 * 1024 * 1024, 7).toString('base64');
    await registrar(cuerpo({ adjunto: { ...soporte, contenidoBase64: grande } })).expect(201);
  });

  it('403 a quien no es admin, y no deja rastro', async () => {
    await registrar(cuerpo(), token()).expect(403);
    expect(estado.solicitudes).toHaveLength(0);
    expect(estado.eventos).toHaveLength(0);
  });

  it('400 empleado_requerido si falta empleadoId', async () => {
    const r = await registrar(cuerpo({ empleadoId: undefined })).expect(400);
    expect(r.body).toEqual({ error: 'empleado_requerido', field: 'empleadoId' });
  });

  it('404 empleado_no_encontrado si la ficha no existe, o el id no es un uuid', async () => {
    for (const empleadoId of [E_FANTASMA, 'basura']) {
      const r = await registrar(cuerpo({ empleadoId })).expect(404);
      expect(r.body.error, empleadoId).toBe('empleado_no_encontrado');
    }
    expect(estado.solicitudes).toHaveLength(0);
  });

  it('404 si la ficha esta inactiva', async () => {
    estado.plantilla[0].activo = false;
    const r = await registrar(cuerpo()).expect(404);
    expect(r.body.error).toBe('empleado_no_encontrado');
    expect(estado.solicitudes).toHaveLength(0);
  });

  it('CANDADO: 400 incapacidad_en_el_futuro si empieza manana', async () => {
    const r = await registrar(cuerpo({ fechaInicio: '2026-01-16', fechaFin: '2026-01-16' })).expect(400);
    expect(r.body).toMatchObject({ error: 'incapacidad_en_el_futuro', field: 'fechaInicio' });
    expect(estado.eventos).toHaveLength(0);
  });

  it('CANDADO: empezar HOY y terminar mas adelante si vale', async () => {
    await registrar(cuerpo({ fechaInicio: '2026-01-15', fechaFin: '2026-01-20' })).expect(201);
  });

  it('400 adjunto_requerido sin el PDF', async () => {
    const r = await registrar(cuerpo({ adjunto: undefined })).expect(400);
    expect(r.body).toMatchObject({ error: 'adjunto_requerido', field: 'adjunto' });
  });

  it('400 si viajan los dias o un tipo: los pone el servidor', async () => {
    expect((await registrar(cuerpo({ dias: 3 })).expect(400)).body.error).toBe('dias_no_aplica');
    expect((await registrar(cuerpo({ tipo: 'vacaciones' })).expect(400)).body.error).toBe('tipo_invalido');
  });

  it('CANDADO: 409 rango_solapado, la regla de no solaparse sigue mordiendo', async () => {
    await registrar(cuerpo()).expect(201);
    const r = await registrar(cuerpo({ fechaInicio: '2025-01-15', fechaFin: '2025-01-17' })).expect(409);
    expect(r.body).toMatchObject({
      error: 'rango_solapado',
      field: 'fechaInicio',
      detalle: { tipo: 'incapacidad', estado: 'registrada', fechaInicio: HACE_UN_ANO_DESDE, fechaFin: HACE_UN_ANO_HASTA },
    });
    expect(estado.solicitudes).toHaveLength(1);
  });

  it('409 fecha_posterior_al_retiro si pasa del ultimo dia de esa persona', async () => {
    estado.plantilla[0].fechaRetiro = '2025-01-15';
    const r = await registrar(cuerpo()).expect(409);
    expect(r.body).toMatchObject({
      error: 'fecha_posterior_al_retiro',
      field: 'fechaFin',
      detalle: { fechaRetiro: '2025-01-15' },
    });
  });

  it('CANDADO: la ruta del EMPLEADO sigue con su ventana aunque llame un admin y mande empleadoId', async () => {
    // La exencion es de ESTA ruta y de ninguna otra (la opcion B que la spec
    // descarta): un admin que use la puerta del empleado sigue topando con la
    // ventana, y el empleadoId del cuerpo no cambia nada.
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token({ sub: ADMIN, role: 'admin' })}`)
      .send({ tipo: 'incapacidad', empleadoId: E2, fechaInicio: HACE_UN_ANO_DESDE, fechaFin: HACE_UN_ANO_HASTA, adjunto: soporte })
      .expect(400);
    expect(r.body.error).toBe('incapacidad_demasiado_antigua');
    expect(estado.solicitudes).toHaveLength(0);
  });
});

// ── El candado del solapamiento ────────────────────────────────────────────
```

- [ ] **Step 2: Escribir los tests de BD que fallan**

En `apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts`, sustituir el import del harness:

```ts
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';
```

por:

```ts
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from '../test-db/harness.js';
```

sustituir el del servicio:

```ts
import { crearSolicitud } from './service.js';
```

por:

```ts
import { crearSolicitud, registrarIncapacidadAjena } from './service.js';
```

añadir, justo después de `const sesionEmpleado = …;`:

```ts
// El admin no tiene ficha: la puerta nueva no la necesita (no pasa por
// empleadoDeSesion), y es el caso real del admin sin apps.
const sesionAdmin = { email: ADMIN, userId: null, esAdmin: true };

const incapacidadesEnBd = async () =>
  Number(
    (await db.query(`SELECT count(*)::int AS n FROM portal.solicitudes_ausencia WHERE tipo = 'incapacidad'`)).rows[0].n,
  );
```

y al final del fichero:

```ts
describe('service.registrarIncapacidadAjena contra la BD', () => {
  // Un ano atras con el reloj real: muy fuera de la ventana de dos dias del
  // alta del empleado. Aqui no se afirma ningun recuento de dias habiles, asi
  // que un festivo de por medio no cambia nada.
  const haceUnAno = () => sumarDias(hoyEnColombia(), -365);

  it('guarda registrada_por, el correo del EMPLEADO, registrada, el PDF, el evento y el calendario', async () => {
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const inicio = haceUnAno();
    const s = await registrarIncapacidadAjena(db, sesionAdmin, {
      empleadoId,
      fechaInicio: inicio,
      fechaFin: sumarDias(inicio, 2),
      adjunto: soporte,
    });

    const { rows } = await db.query(
      `SELECT registrada_por, solicitante_email, estado, tipo, aprobador_correo,
              evento_calendario_id IS NOT NULL AS con_evento
         FROM portal.solicitudes_ausencia WHERE id = $1`,
      [s.id],
    );
    expect(rows[0]).toEqual({
      registrada_por: ADMIN,
      solicitante_email: CORREO,
      estado: 'registrada',
      tipo: 'incapacidad',
      aprobador_correo: null,
      con_evento: true,
    });
    const { rows: adjuntos } = await db.query(
      `SELECT nombre_archivo, mime FROM portal.solicitud_adjuntos WHERE solicitud_id = $1`,
      [s.id],
    );
    // Renombrado con el nombre del EMPLEADO (sembrarEmpleado siembra "Ana Ruiz").
    expect(adjuntos).toEqual([{ nombre_archivo: `Incapacidades_Ana_Ruiz_${inicio}_1.pdf`, mime: 'application/pdf' }]);
    expect(await eventosDelOutbox(db)).toEqual(['registrada']);
  });

  it('el acuse que queda en la cola dice que la registro administracion, y va al empleado', async () => {
    // Prueba de punta a punta de que repo/filas.ts lee la columna ANTES de que
    // insertarSolicitud construya el payload: si no la leyera, el correo saldria
    // con el texto de siempre.
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const inicio = haceUnAno();
    await registrarIncapacidadAjena(db, sesionAdmin, { empleadoId, fechaInicio: inicio, fechaFin: inicio, adjunto: soporte });
    const { rows } = await db.query(`SELECT payload FROM portal.ausencias_outbox ORDER BY id`);
    const [{ payload }] = rows as { payload: { correo: { para: string; asunto: string } } }[];
    expect(payload.correo.asunto).toBe('Administración ha registrado tu incapacidad');
    expect(payload.correo.para).toContain(CORREO);
  });

  it('CANDADO: la regla de no solaparse sigue mordiendo', async () => {
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const inicio = haceUnAno();
    await sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'aprobada',
      fechaInicio: sumarDias(inicio, 1),
      fechaFin: sumarDias(inicio, 4),
      segundoAprobadorCorreo: null,
    });
    await expect(
      registrarIncapacidadAjena(db, sesionAdmin, { empleadoId, fechaInicio: inicio, fechaFin: sumarDias(inicio, 2), adjunto: soporte }),
    ).rejects.toMatchObject({ code: 'rango_solapado', status: 409 });
    expect(await incapacidadesEnBd()).toBe(0);
  });

  it('una ficha inactiva da 404 y no deja nada', async () => {
    const empleadoId = await sembrarEmpleado(db, CORREO);
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    const inicio = haceUnAno();
    await expect(
      registrarIncapacidadAjena(db, sesionAdmin, { empleadoId, fechaInicio: inicio, fechaFin: inicio, adjunto: soporte }),
    ).rejects.toMatchObject({ code: 'empleado_no_encontrado', status: 404 });
    expect(await incapacidadesEnBd()).toBe(0);
    expect(await eventosDelOutbox(db)).toEqual([]);
  });
});
```

- [ ] **Step 3: Ver que fallan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "incapacidad-ajena"
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/incapacidad-ajena.db.test.ts
```

Esperado: en el router FALLAN todos los del `describe` nuevo salvo el último `CANDADO` (la ruta del
empleado ya rechaza la fecha): la ruta no existe y Express contesta 404, así que cae cada `.expect(201)`,
`.expect(400)`, `.expect(403)` y `.expect(409)`; los de «404 … no existe» y «404 si la ficha esta
inactiva» pasan el `.expect(404)` contra el 404 del propio Express, pero caen en `body.error`
(`undefined`, no `empleado_no_encontrado`). En la BD caen los cuatro nuevos con
`registrarIncapacidadAjena is not a function`; los de las Tasks 1, 2 y 5 siguen en verde.

- [ ] **Step 4: Implementar el servicio**

En `apps/hub-api/src/ausencias/service/solicitudes.ts`, sustituir el import de la validación (L23):

```ts
import { MAX_ADJUNTO_BYTES, MAX_MOTIVO, nombreArchivoNormalizado, validarNuevaSolicitud } from './validacion.js';
```

por:

```ts
import {
  MAX_ADJUNTO_BYTES,
  MAX_MOTIVO,
  nombreArchivoNormalizado,
  validarIncapacidadAjena,
  validarNuevaSolicitud,
} from './validacion.js';
```

y justo después de `crearSolicitud` (la versión corta de la Task 5) añadir:

```ts
/**
 * El administrador registra una incapacidad a nombre de otro (spec
 * 2026-11-23-incapacidad-por-admin).
 *
 * Una puerta PROPIA y no un `empleadoId` aceptado en `crearSolicitud` cuando
 * llama un admin: aquella saca la identidad de la sesión, tiene tests que lo
 * fijan a propósito, y mezclar dos reglas en una puerta es como se cuela la
 * suplantación. Quién puede llamar a esto lo decide el router (`requireAdmin`),
 * y no se repite aquí: un candado duplicado esconde el día que el otro se rompe.
 *
 * Todo lo demás es el alta de siempre (`darDeAlta`): mismo candado, misma regla
 * de no solaparse, mismo tope del retiro, mismo PDF renombrado con el nombre
 * del EMPLEADO, mismos eventos y mismo calendario. Dos diferencias, y las dos a
 * propósito:
 *  - sin la ventana de dos días hacia atrás (`validarIncapacidadAjena`): para
 *    eso existe esta puerta;
 *  - `solicitante_email` sigue siendo el correo del EMPLEADO (lo pone
 *    `altaBajoCandado` desde la ficha), así que él ve su propio PDF y su jefe
 *    con llave también. Quién la registró queda en `registrada_por`, con el
 *    correo de la sesión.
 */
export async function registrarIncapacidadAjena(db: Pool, sesion: Sesion, body: unknown): Promise<Solicitud> {
  const { empleadoId, datos } = validarIncapacidadAjena(body, hoyEnColombia());
  // Solo fichas activas: a quien ya se fue no se le registra nada nuevo.
  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404, 'empleadoId');
  return darDeAlta(db, sesion, empleado, datos, sesion.email);
}
```

- [ ] **Step 5: Implementar la ruta**

En `apps/hub-api/src/ausencias/router.ts`, justo después de:

```ts
  router.post('/ausencias/solicitudes', ...gated, async (req: Request, res: Response) => {
    try {
      const solicitud = await service.crearSolicitud(db, sesionDe(req), req.body);
      res.status(201).json(solicitud);
    } catch (e) {
      sendError(res, e, 'ausencias_crear');
    }
  });
```

añadir:

```ts

  /**
   * El administrador registra una incapacidad a nombre de cualquier ficha
   * activa, desde el Registro general. Solo admin, y con los mismos efectos que
   * el alta del empleado: calendario, hoja de nómina y acuse por correo, que
   * dice que la ha registrado administración. Ver
   * `service.registrarIncapacidadAjena`.
   *
   * Cuelga del prefijo `/api/ausencias/solicitudes`, así que el PDF pasa por el
   * parser de 12 MB de index.ts: aquí NO se monta otro, y menos antes de la
   * autenticación. No choca con ninguna ruta: no existe un `POST
   * /ausencias/solicitudes/:id` (las que hay tienen un segmento más).
   */
  router.post('/ausencias/solicitudes/incapacidad-ajena', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const solicitud = await service.registrarIncapacidadAjena(db, sesionDe(req), req.body);
      res.status(201).json(solicitud);
    } catch (e) {
      sendError(res, e, 'ausencias_incapacidad_ajena');
    }
  });
```

- [ ] **Step 6: Ver que pasan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/incapacidad-ajena.db.test.ts
```

Esperado: `router.test.ts` entero en verde (16 tests nuevos en el `describe`); el fichero de BD entero
en verde (9 tests).

- [ ] **Step 7: Los candados de identidad del alta del empleado, por su nombre**

```bash
cd apps/hub-api && npx vitest run src/ausencias/service.test.ts -t "ignora cualquier empleadoId o diasHabiles que mande el cliente"
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "no abre la solicitud de otro|ni un admin lo pide en nombre de otro|el alta del empleado nace con registradaPor en null|la ruta del EMPLEADO sigue con su ventana"
```

Esperado: todos en verde, sin haber tocado ninguno de los que ya existían (los dos de `service.test.ts`
y los dos de modificaciones de `router.test.ts`).

- [ ] **Step 8: Typecheck de hub-api**

```bash
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
```

Esperado: sin errores.

- [ ] **Step 9: Commit**

```bash
git add apps/hub-api/src/ausencias/service/solicitudes.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts apps/hub-api/src/ausencias/incapacidad-ajena.db.test.ts
git commit -m "feat(ausencias): ruta para que el administrador registre una incapacidad ajena"
```

---

### Task 7: el Registro general trae `registradaPor`

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.movimientos.db.test.ts` (al final)
- Modify: `apps/hub-api/src/ausencias/types.ts:829-832`
- Modify: `apps/hub-api/src/ausencias/repo/registro.ts:197-232,279-280,324-337`
- Modify: `apps/hub-api/src/ausencias/repo.test.ts:246-250`

- [ ] **Step 1: Escribir los tests de BD que fallan**

Al final de `apps/hub-api/src/ausencias/repo.movimientos.db.test.ts`:

```ts
describe('registradaPor llega al registro', () => {
  const ADMIN = 'admin@ambientalia.com.co';
  const AJENA = 'ajena@ambientalia.com.co';

  it('CANDADO: una solicitud registrada por administracion lo trae; una propia, null', async () => {
    // Es lo que pinta la etiqueta "Registrada por administracion" del portal, y
    // lo que la pinta igual para el admin y para los jefes que ven esa fila.
    const id = await sembrarEmpleado(db, AJENA, JEFE);
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: AJENA,
      estado: 'registrada',
      tipo: 'incapacidad',
      fechaInicio: '2026-09-07',
      fechaFin: '2026-09-09',
      segundoAprobadorCorreo: null,
      registradaPor: ADMIN,
    });
    const ms = await movimientos(db, null);
    expect(ms.find((m) => m.solicitanteEmail === AJENA)?.registradaPor).toBe(ADMIN);
    // Las cuatro del beforeEach las registro su propia persona: null, no undefined.
    expect(ms.find((m) => m.solicitanteEmail === HIJO)?.registradaPor).toBeNull();
  });

  it('CANDADO: una MODIFICACION lo trae en null aunque su solicitud lo tenga', async () => {
    // Una anulacion o un cambio de fechas no se "registra a nombre de": la
    // constancia es de la solicitud, y heredarla haria pintar la etiqueta en una
    // fila que no la merece.
    const { solicitud, modificacion } = await sembrarConPropuesta('anulacion');
    await db.query(`UPDATE portal.solicitudes_ausencia SET registrada_por = $2 WHERE id = $1`, [solicitud.id, ADMIN]);
    await decidirModificacion(db, modificacion.id, true, null, null, payloadStub);

    const m = await movimientoDe(modificacion.id);
    if (!m) throw new Error('la anulacion aprobada no llego al registro');
    expect(m.registradaPor).toBeNull();
    const propia = (await movimientos(db, null)).find((x) => x.solicitudId === solicitud.id && x.clase === 'solicitud');
    expect(propia?.registradaPor).toBe(ADMIN);
  });
});
```

- [ ] **Step 2: Ver que fallan**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.movimientos.db.test.ts -t "registradaPor llega al registro"
```

Esperado: FALLAN los dos: el primero con `expected undefined to be 'admin@ambientalia.com.co'` (la
consulta no selecciona la columna) y el segundo con `expected undefined to be null` (el mapeador de la
modificación no la pone).

- [ ] **Step 3: El tipo**

En `apps/hub-api/src/ausencias/types.ts`, sustituir el final de `MovimientoBase`:

```ts
  createdAt: string;
  /** `comentarios` en una solicitud; `motivo` en una anulación o un cambio. */
  motivo: string | null;
}
```

por:

```ts
  createdAt: string;
  /** `comentarios` en una solicitud; `motivo` en una anulación o un cambio. */
  motivo: string | null;
  /**
   * Quién la registró, si fue un administrador a nombre de la persona: su
   * correo (migración 080). `null` si la registró ella misma, si viene de la
   * hoja, y SIEMPRE en una modificación: una anulación o un cambio de fechas no
   * se «registra a nombre de», así que su consulta ni selecciona la columna y su
   * mapeador la pone a `null` a mano.
   *
   * Aquí y no solo en la rama de solicitud, por lo mismo que la franja horaria:
   * la etiqueta del registro la pinta la misma celda para las tres clases, y una
   * propiedad que existiera en una rama y no en la otra la obligaría a
   * discriminar por clase para algo que no lo necesita.
   */
  registradaPor: string | null;
}
```

- [ ] **Step 4: La consulta y los dos mapeadores**

En `apps/hub-api/src/ausencias/repo/registro.ts`, en `FilaMovimientoSolicitudDb`, sustituir:

```ts
  /** Ya en `HH:MM`: el SELECT las saca con `to_char`, no con `::text`. */
  hora_inicio: string | null;
  hora_fin: string | null;
}
```

por:

```ts
  /** Ya en `HH:MM`: el SELECT las saca con `to_char`, no con `::text`. */
  hora_inicio: string | null;
  hora_fin: string | null;
  /** La constancia de la 080. Solo la selecciona ESTA consulta. */
  registrada_por: string | null;
}
```

En `comoMovimientoDeSolicitud`, sustituir:

```ts
    horaInicio: r.hora_inicio,
    horaFin: r.hora_fin,
  };
}
```

por:

```ts
    horaInicio: r.hora_inicio,
    horaFin: r.hora_fin,
    registradaPor: r.registrada_por,
  };
}
```

En `movimientosDeSolicitudes`, sustituir:

```ts
            to_char(s.hora_fin,    'HH24:MI') AS hora_fin,
```

por:

```ts
            to_char(s.hora_fin,    'HH24:MI') AS hora_fin,
            -- Quien la registro a nombre de la persona (080). Sin cast: ya es
            -- VARCHAR en la tabla.
            s.registrada_por,
```

En `comoMovimientoDeModificacion`, sustituir:

```ts
    horaInicio: null,
    horaFin: null,
  };
}
```

por:

```ts
    horaInicio: null,
    horaFin: null,
    // `null` EXPLÍCITO por lo mismo que la franja: una modificación no se
    // registra a nombre de nadie, y esta consulta ni selecciona la columna.
    registradaPor: null,
  };
}
```

- [ ] **Step 5: El fixture de `repo.test.ts`**

En `apps/hub-api/src/ausencias/repo.test.ts`, sustituir:

```ts
    observaciones: null,
    horaInicio: null,
    horaFin: null,
  };
}
```

por:

```ts
    observaciones: null,
    horaInicio: null,
    horaFin: null,
    registradaPor: null,
  };
}
```

- [ ] **Step 6: Ver que pasan**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.movimientos.db.test.ts
cd apps/hub-api && npx vitest run src/ausencias/repo.test.ts src/ausencias/router.test.ts -t "movimientos|porFechaDeCierre"
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
```

Esperado: todo en verde; typecheck sin errores (si faltara el fixture del Step 5, aquí lo diría).

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo/registro.ts apps/hub-api/src/ausencias/repo.test.ts apps/hub-api/src/ausencias/repo.movimientos.db.test.ts
git commit -m "feat(ausencias): el registro general trae quien registro la solicitud"
```

---

### Task 8: el cliente del front y su lector de errores

**Files:**
- Create: `apps/ausencias/src/api/registro.test.ts`
- Modify: `apps/ausencias/src/api/http.ts:92-103,188-191` y después de `errorDeAusencia` (L241)
- Modify: `apps/ausencias/src/api/registro.ts:3,6-8` y después de `editarSolicitud` (L178)

**Revisión de los códigos que puede contestar la ruta nueva** (spec §5.1). «Común» = sale por
`errorDeAusencia`, el lector del alta del empleado; «crudo» = `errorDeAusencia` no tiene frase y
`mensajeDeError` enseña el código, igual que hoy en el alta del empleado.

| Código | Quién lo da | Texto del alta del empleado | Aquí |
|---|---|---|---|
| `rango_solapado` (409) | servicio | «Esas fechas chocan con otra ausencia: …» (impersonal, pero no dice de quién) | NUEVO: «… con otra ausencia de esa persona: …», mismo detalle |
| `fecha_posterior_al_retiro` (409) | servicio | «Tu último día…» (2ª persona) | NUEVO |
| `empleado_no_encontrado` (404) | validador / servicio | — | NUEVO, solo si trae el código |
| `incapacidad_en_el_futuro` (400) | validador | «Si el médico te firmó…» (2ª persona) | NUEVO |
| `empleado_requerido` (400) | validador | — (no existía) | NUEVO |
| `hora_invalida`, `hora_no_permitida` (400) | validador | «Revisa el horario…», «quita las horas» | común: le habla a quien rellenó el formulario, que aquí es el admin |
| `tipo_invalido`, `fecha_invalida`, `rango_invertido`, `rango_demasiado_largo`, `comentarios_demasiado_largos`, `dias_no_aplica` (400) | validador | crudo | común (crudo, igual que hoy) |
| `adjunto_requerido`, `nombre_archivo_invalido`, `adjunto_no_es_pdf`, `adjunto_vacio`, `adjunto_demasiado_grande` (400) | validador / servicio | crudo | común (crudo, igual que hoy) |
| 401, 403, 404 sin código, 500 | auth / Express | `mensajeDeError` | común |

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/ausencias/src/api/registro.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatFecha, rangoFechas } from '../dominio';
import { registrarIncapacidadAjena, type IncapacidadAjena } from './registro';
import { crearSolicitud } from './solicitudes';

// El cliente de la incapacidad que registra el administrador a nombre de otro.
// Los mensajes del alta del empleado le hablan al empleado («Tu último día…»);
// este lector le habla al administrador, que está registrando la de otra persona.

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const responde = (res: Response) => {
  const fetchFalso = vi.fn(async () => res);
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
};

/** El error con el que rechaza, para poder mirar su texto. */
const errorDe = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => e,
  );

// Node 22+ trae un `localStorage` global que choca con el de jsdom; `authHeaders`
// lo lee al montar la petición.
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

const datos: IncapacidadAjena = {
  empleadoId: '11111111-1111-4111-8111-111111111111',
  fechaInicio: '2025-03-03',
  fechaFin: '2025-03-05',
  comentarios: 'Avisó su hermana',
  adjunto: { nombreArchivo: 'baja.pdf', mime: 'application/pdf', contenidoBase64: 'JVBERi0=' },
};

const CHOQUE = { tipo: 'vacaciones', estado: 'aprobada', fechaInicio: '2025-03-04', fechaFin: '2025-03-07' };

describe('registrarIncapacidadAjena', () => {
  it('manda un POST con los datos a la ruta del administrador y devuelve la solicitud', async () => {
    const fetchFalso = responde(json(201, { id: 's9', empleadoNombre: 'Ana Pérez' }));
    expect(await registrarIncapacidadAjena(datos)).toEqual({ id: 's9', empleadoNombre: 'Ana Pérez' });
    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/ausencias\/solicitudes\/incapacidad-ajena$/);
    expect(opciones.method).toBe('POST');
    expect(opciones.body).toBe(JSON.stringify(datos));
  });

  it('rango_solapado: habla de «esa persona», con el tipo, el estado y las fechas del choque', async () => {
    responde(json(409, { error: 'rango_solapado', field: 'fechaInicio', detalle: CHOQUE }));
    expect((await errorDe(registrarIncapacidadAjena(datos)))?.message).toBe(
      `Esas fechas chocan con otra ausencia de esa persona: Vacaciones (aprobada), ${rangoFechas('2025-03-04', '2025-03-07')}. ` +
        'Esos días ya están concedidos: no se liberan hasta que esa solicitud se cambie o se anule.',
    );
  });

  it('fecha_posterior_al_retiro: nombra el último día de ESA persona, sin «tu»', async () => {
    responde(json(409, { error: 'fecha_posterior_al_retiro', field: 'fechaFin', detalle: { fechaRetiro: '2025-03-04' } }));
    expect((await errorDe(registrarIncapacidadAjena(datos)))?.message).toBe(
      `El último día de esa persona en la compañía es el ${formatFecha('2025-03-04')} y estas fechas lo pasan.`,
    );
  });

  it('404 empleado_no_encontrado: la ficha ya no está activa', async () => {
    responde(json(404, { error: 'empleado_no_encontrado', field: 'empleadoId' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(new Error('Esa ficha ya no está activa. Recarga la lista.'));
  });

  it('un 404 SIN ese código (hub-api sin la ruta todavía) sale por el mensaje genérico', async () => {
    // Es lo que contestaría un hub-api antiguo si el portal se desplegara antes:
    // decir «la ficha no está activa» sería mentir.
    responde(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
    const error = await errorDe(registrarIncapacidadAjena(datos));
    expect(error?.message).not.toMatch(/ficha/);
    expect(error?.message).toMatch(/404/);
  });

  it('incapacidad_en_el_futuro: sin el «te firmó» del formulario del empleado', async () => {
    responde(json(400, { error: 'incapacidad_en_el_futuro', field: 'fechaInicio' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(new Error('La fecha de inicio no puede ser futura.'));
  });

  it('empleado_requerido: pide elegir a la persona', async () => {
    responde(json(400, { error: 'empleado_requerido', field: 'empleadoId' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(
      new Error('Elige la persona a la que pertenece la incapacidad.'),
    );
  });

  it('el resto sale por el lector del alta del empleado: un código con frase la conserva', async () => {
    responde(json(400, { error: 'hora_no_permitida', field: 'tipo' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(
      new Error('El horario solo se puede poner en un permiso de un único día. Si son varios días, quita las horas.'),
    );
  });

  it('y uno sin frase sale crudo, igual que en el alta del empleado', async () => {
    responde(json(400, { error: 'adjunto_no_es_pdf', field: 'adjunto' }));
    await expect(registrarIncapacidadAjena(datos)).rejects.toThrow(new Error('adjunto_no_es_pdf'));
  });
});

describe('el alta del EMPLEADO no cambia', () => {
  it('CANDADO: su choque sigue diciendo «otra ausencia», sin «de esa persona»', async () => {
    responde(json(409, { error: 'rango_solapado', field: 'fechaInicio', detalle: CHOQUE }));
    const error = await errorDe(crearSolicitud({ tipo: 'vacaciones', fechaInicio: '2025-03-03', fechaFin: '2025-03-05' }));
    expect(error?.message).toMatch(/^Esas fechas chocan con otra ausencia: Vacaciones \(aprobada\), /);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/ausencias && npx vitest run src/api/registro.test.ts
```

Esperado: FALLAN los nueve de `registrarIncapacidadAjena` con `registrarIncapacidadAjena is not a
function`. El `CANDADO` del alta del empleado pasa ya.

- [ ] **Step 3: `mensajeDeSolape` con sujeto**

En `apps/ausencias/src/api/http.ts`, sustituir:

```ts
 * un «…, 10 de jul de 2026 – 14 de jul de 2026, aprobada.» se lee un instante
 * como si «aprobada» calificara a la fecha de fin.
 */
function mensajeDeSolape(d: SolapeDetalle): string {
```

por:

```ts
 * un «…, 10 de jul de 2026 – 14 de jul de 2026, aprobada.» se lee un instante
 * como si «aprobada» calificara a la fecha de fin.
 *
 * `conQue` es contra qué se choca. Por defecto «otra ausencia», que vale para
 * los tres lectores de las cuatro puertas; el administrador que registra una
 * incapacidad a nombre de otro lee «otra ausencia de esa persona», porque la
 * ausencia que choca es de quien eligió en el desplegable y no suya.
 */
function mensajeDeSolape(d: SolapeDetalle, conQue = 'otra ausencia'): string {
```

y sustituir:

```ts
  if (!como) {
    return `Esas fechas chocan con otra ausencia: ${tipo}, ${cuando}. Esos días no se liberan hasta que esa solicitud se cambie o se anule.`;
  }
  return `Esas fechas chocan con otra ausencia: ${tipo} (${como.estado}), ${cuando}. ${como.salida}`;
}
```

por:

```ts
  if (!como) {
    return `Esas fechas chocan con ${conQue}: ${tipo}, ${cuando}. Esos días no se liberan hasta que esa solicitud se cambie o se anule.`;
  }
  return `Esas fechas chocan con ${conQue}: ${tipo} (${como.estado}), ${cuando}. ${como.salida}`;
}
```

- [ ] **Step 4: El comentario que deja de ser cierto**

En el mismo fichero, sustituir:

```ts
    // No promete que administración pueda crearla: NO hay vía para que un admin
    // dé de alta una incapacidad en nombre de otro —solo puede corregir una fila
    // que ya exista, o importarla del histórico—. Decir «que te la registren»
    // mandaría a la gente a pedir algo que hoy no se puede hacer de un clic.
```

por:

```ts
    // Promete algo que administración SÍ puede hacer: desde el Registro general
    // registra una incapacidad a nombre de cualquier ficha activa, sin esta
    // ventana y con los mismos efectos que esta puerta (`registrarIncapacidadAjena`,
    // `POST /api/ausencias/solicitudes/incapacidad-ajena`).
```

- [ ] **Step 5: El lector nuevo**

En el mismo fichero, el final de `errorDeAusencia` y el comentario que lo sigue:

```ts
  return errorGenerico(res);
}

/** Lo que manda el servidor con un `compensatorios_insuficientes`. */
```

se sustituyen por lo mismo con el lector nuevo en medio:

```ts
  return errorGenerico(res);
}

/**
 * El error del alta que hace el ADMINISTRADOR a nombre de otro
 * (`registrarIncapacidadAjena`), dicho para él.
 *
 * Los textos de `errorDeAusencia` le hablan al empleado de lo suyo («Tu último
 * día…», «si el médico te firmó…»), y aquí quien lee es el administrador, que
 * está registrando la de otra persona. Se reescriben los que hablan así, y solo
 * esos; el resto cae en `errorDeAusencia` tal cual.
 *
 * El 404 solo se traduce si trae `empleado_no_encontrado`: uno sin código es lo
 * que contesta un hub-api que aún no tiene la ruta (portal desplegado antes), y
 * decir ahí «la ficha ya no está activa» sería mentir.
 */
export async function errorDeIncapacidadAjena(res: Response): Promise<Error> {
  const cuerpo = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: string; detalle?: SolapeDetalle | RetiroDetalle } | null;
  if (cuerpo?.error === 'rango_solapado' && cuerpo.detalle) {
    return new Error(mensajeDeSolape(cuerpo.detalle as SolapeDetalle, 'otra ausencia de esa persona'));
  }
  // Nombra la fecha por lo mismo que la frase del empleado: sin ella, el aviso
  // no dice qué corregir.
  if (cuerpo?.error === 'fecha_posterior_al_retiro' && cuerpo.detalle) {
    const { fechaRetiro } = cuerpo.detalle as RetiroDetalle;
    return new Error(`El último día de esa persona en la compañía es el ${formatFecha(fechaRetiro)} y estas fechas lo pasan.`);
  }
  if (res.status === 404 && cuerpo?.error === 'empleado_no_encontrado') {
    return new Error('Esa ficha ya no está activa. Recarga la lista.');
  }
  const PARA_EL_ADMIN: Record<string, string> = {
    // La del empleado dice «si el médico te firmó una baja…»: aquí no hay «te».
    incapacidad_en_el_futuro: 'La fecha de inicio no puede ser futura.',
    // No tenía frase: el alta del empleado no manda persona. El formulario no
    // deja guardar sin ella, así que llegar aquí es haber entrado por otra vía.
    empleado_requerido: 'Elige la persona a la que pertenece la incapacidad.',
  };
  if (cuerpo?.error && PARA_EL_ADMIN[cuerpo.error]) return new Error(PARA_EL_ADMIN[cuerpo.error]);
  return errorDeAusencia(res);
}

/** Lo que manda el servidor con un `compensatorios_insuficientes`. */
```

- [ ] **Step 6: El cliente**

En `apps/ausencias/src/api/registro.ts`, sustituir la L3:

```ts
import { API_BASE, get, patch, patchSolapable } from './http';
```

por:

```ts
import { API_BASE, conCuerpo, errorDeIncapacidadAjena, get, patch, patchSolapable } from './http';
```

sustituir la cabecera (L6-8):

```ts
// ARQ-612 — el registro de movimientos y las correcciones de admin sobre él,
// sacados de api.ts tal cual: leerlo, y corregir o borrar una solicitud o una
// fila del registro. api.ts lo reexporta (lo vigila barril.test.ts).
```

por:

```ts
// ARQ-612 — el registro de movimientos y las correcciones de admin sobre él,
// sacados de api.ts tal cual: leerlo, corregir o borrar una solicitud o una
// fila del registro, y registrar una incapacidad a nombre de otro. api.ts lo
// reexporta (lo vigila barril.test.ts).
```

y justo después de `export const editarSolicitud = …;` añadir:

```ts

/**
 * Lo que manda el administrador al registrar una incapacidad a nombre de otro.
 * Sin `tipo`: lo fija el servidor. El PDF es obligatorio, como para el empleado.
 */
export interface IncapacidadAjena {
  empleadoId: string;
  fechaInicio: string;
  fechaFin: string;
  comentarios?: string;
  adjunto: { nombreArchivo: string; mime: string; contenidoBase64: string };
}

/**
 * Registra una incapacidad a nombre de otro (solo admin), con los mismos efectos
 * que si la informara la propia persona: calendario, hoja de nómina y acuse por
 * correo, que dice que la ha registrado administración. Sin la ventana de dos
 * días hacia atrás del formulario del empleado.
 *
 * Con su propio lector de errores (`errorDeIncapacidadAjena`): los del alta del
 * empleado le hablan al empleado, y aquí quien lee es el administrador.
 */
export const registrarIncapacidadAjena = (datos: IncapacidadAjena) =>
  conCuerpo<Solicitud>('POST', '/api/ausencias/solicitudes/incapacidad-ajena', datos, errorDeIncapacidadAjena);
```

- [ ] **Step 7: Ver que pasa**

```bash
cd apps/ausencias && npx vitest run src/api/registro.test.ts src/api/barril.test.ts
cd apps/ausencias && npm run typecheck
```

Esperado: todo en verde (10 tests nuevos); el barril sigue en verde (`api.ts` reexporta `registro.ts`
con `export *`, y NO reexporta `errorDeIncapacidadAjena`, que es de `http.ts`); typecheck sin errores.

- [ ] **Step 8: Commit**

```bash
git add apps/ausencias/src/api/http.ts apps/ausencias/src/api/registro.ts apps/ausencias/src/api/registro.test.ts
git commit -m "feat(ausencias): cliente para registrar una incapacidad ajena, con errores para el admin"
```

---

### Task 9: el formulario `RegistrarIncapacidad`

**Files:**
- Create: `apps/ausencias/src/RegistrarIncapacidad.test.tsx`
- Create: `apps/ausencias/src/RegistrarIncapacidad.tsx`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/ausencias/src/RegistrarIncapacidad.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Empleado, Solicitud } from './api';
import { hoyEnColombia } from './dominio';
import RegistrarIncapacidad from './RegistrarIncapacidad';

// El formulario con el que el administrador registra una incapacidad a nombre de
// otro. Se simula `./api` entero salvo lo que el formulario no toca, igual que
// PanelOrganigrama.test.tsx. `leerComoBase64` también: el FileReader de jsdom no
// es lo que se prueba aquí.

const api = vi.hoisted(() => ({
  registrarIncapacidadAjena: vi.fn(),
  leerComoBase64: vi.fn(),
}));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));

const ficha = (id: string, nombreCompleto: string, activo = true): Empleado => ({
  id,
  nombreCompleto,
  correo: `${id}@ejemplo.test`,
  cargo: null,
  credencial: null,
  aprobadorCorreo: 'jefe@ejemplo.test',
  copiaCorreo: null,
  veAdjuntos: false,
  exportaRegistro: false,
  veTodaLaEmpresa: false,
  veKpis: false,
  requiereSegundaFirma: true,
  userId: null,
  activo,
  fechaRetiro: null,
  retiradoPor: null,
  retiradoAt: null,
});

// En desorden a propósito, con una tilde inicial y una ficha inactiva: un
// `sort()` a secas dejaría «Álvaro» detrás de «Zoe».
const EMPLEADOS = [
  ficha('e3', 'Zoe Díaz'),
  ficha('e2', 'Beatriz Mora'),
  ficha('e1', 'Álvaro Gómez'),
  ficha('e4', 'Carlos Retirado', false),
];

const onRegistrada = vi.fn();
const onCerrar = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const montar = () =>
  render(<RegistrarIncapacidad empleados={EMPLEADOS} onRegistrada={onRegistrada} onCerrar={onCerrar} />);

const persona = () => screen.getByLabelText('Persona') as HTMLSelectElement;
const inicio = () => screen.getByLabelText('Primer día de la incapacidad') as HTMLInputElement;
const fin = () => screen.getByLabelText('Último día de la incapacidad') as HTMLInputElement;
const soporte = () => screen.getByLabelText(/Soporte médico en PDF/) as HTMLInputElement;
const comentarios = () => screen.getByLabelText('Comentarios (opcional)') as HTMLTextAreaElement;
const guardar = () => screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement;

const pdf = () => new File(['%PDF-1.4'], 'baja.pdf', { type: 'application/pdf' });

/** Todo lo obligatorio, con fechas pasadas (marzo de 2025, sin festivos). */
function rellenar() {
  fireEvent.change(persona(), { target: { value: 'e1' } });
  fireEvent.change(inicio(), { target: { value: '2025-03-03' } });
  fireEvent.change(fin(), { target: { value: '2025-03-05' } });
  fireEvent.change(soporte(), { target: { files: [pdf()] } });
}

describe('RegistrarIncapacidad', () => {
  it('el desplegable: «— Elige una persona —» primero, solo las activas y por orden alfabético en español', () => {
    montar();
    expect(Array.from(persona().options).map((o) => [o.value, o.textContent])).toEqual([
      ['', '— Elige una persona —'],
      ['e1', 'Álvaro Gómez'],
      ['e2', 'Beatriz Mora'],
      ['e3', 'Zoe Díaz'],
    ]);
    expect(persona().value).toBe('');
  });

  it('Guardar sigue apagado mientras falte algo obligatorio, y se enciende con todo', () => {
    montar();
    expect(guardar().disabled).toBe(true);
    fireEvent.change(persona(), { target: { value: 'e1' } });
    fireEvent.change(inicio(), { target: { value: '2025-03-03' } });
    fireEvent.change(fin(), { target: { value: '2025-03-05' } });
    // Sin el PDF todavía: es obligatorio.
    expect(guardar().disabled).toBe(true);
    fireEvent.change(soporte(), { target: { files: [pdf()] } });
    expect(guardar().disabled).toBe(false);
  });

  it('el PDF: un archivo que no lo es se rechaza, con su aviso, y Guardar sigue apagado', () => {
    montar();
    rellenar();
    fireEvent.change(soporte(), { target: { files: [new File(['x'], 'foto.png', { type: 'image/png' })] } });
    expect(screen.getByRole('alert').textContent).toContain('El soporte debe ser un archivo PDF.');
    expect(guardar().disabled).toBe(true);
  });

  it('el PDF: más de 8 MB se rechaza', () => {
    montar();
    rellenar();
    const grande = pdf();
    Object.defineProperty(grande, 'size', { value: 9 * 1024 * 1024 });
    fireEvent.change(soporte(), { target: { files: [grande] } });
    expect(screen.getByRole('alert').textContent).toContain('El archivo pesa 9.0 MB y el máximo son 8 MB.');
    expect(guardar().disabled).toBe(true);
  });

  it('el inicio: max = hoy y sin min; una fecha futura deja Guardar apagado', () => {
    montar();
    expect(inicio().max).toBe(hoyEnColombia());
    expect(inicio().hasAttribute('min')).toBe(false);
    rellenar();
    fireEvent.change(inicio(), { target: { value: '2999-01-04' } });
    fireEvent.change(fin(), { target: { value: '2999-01-05' } });
    expect(screen.getByText('La fecha de inicio no puede ser futura.')).toBeTruthy();
    expect(guardar().disabled).toBe(true);
  });

  it('el fin: no puede ser anterior al inicio', () => {
    montar();
    rellenar();
    expect(fin().min).toBe('2025-03-03');
    fireEvent.change(fin(), { target: { value: '2025-03-02' } });
    expect(screen.getByText('El último día no puede ser anterior al primero.')).toBeTruthy();
    expect(guardar().disabled).toBe(true);
  });

  it('guardar bien: manda los datos, con los comentarios recortados, y entrega la solicitud creada', async () => {
    const creada = { id: 's9', empleadoNombre: 'Álvaro Gómez' } as Solicitud;
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockResolvedValue(creada);
    montar();
    rellenar();
    fireEvent.change(comentarios(), { target: { value: '  Avisó su hermana  ' } });
    fireEvent.click(guardar());

    await waitFor(() => expect(onRegistrada).toHaveBeenCalledWith(creada));
    expect(api.registrarIncapacidadAjena).toHaveBeenCalledWith({
      empleadoId: 'e1',
      fechaInicio: '2025-03-03',
      fechaFin: '2025-03-05',
      comentarios: 'Avisó su hermana',
      adjunto: { nombreArchivo: 'baja.pdf', mime: 'application/pdf', contenidoBase64: 'JVBERi0=' },
    });
  });

  it('si falla: el mensaje del lector, y el formulario sigue abierto con lo rellenado', async () => {
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockRejectedValue(new Error('Esa ficha ya no está activa. Recarga la lista.'));
    montar();
    rellenar();
    fireEvent.click(guardar());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Esa ficha ya no está activa. Recarga la lista.'));
    expect(persona().value).toBe('e1');
    expect(inicio().value).toBe('2025-03-03');
    expect(fin().value).toBe('2025-03-05');
    expect(guardar().disabled).toBe(false);
    expect(onRegistrada).not.toHaveBeenCalled();
    expect(onCerrar).not.toHaveBeenCalled();
  });

  it('Cancelar cierra sin llamar al servidor', () => {
    montar();
    rellenar();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(api.registrarIncapacidadAjena).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/ausencias && npx vitest run src/RegistrarIncapacidad.test.tsx
```

Esperado: FALLA al cargar, con `Failed to resolve import "./RegistrarIncapacidad"`.

- [ ] **Step 3: Implementar**

Crear `apps/ausencias/src/RegistrarIncapacidad.tsx`:

```tsx
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Loader2, Paperclip, X } from 'lucide-react';
import { leerComoBase64, registrarIncapacidadAjena, type Empleado, type Solicitud } from './api';
import { hoyEnColombia } from './dominio';
import { useFocoDeModal } from './focoDeModal';

// El administrador registra una incapacidad a nombre de otro, desde el Registro
// general (spec 2026-11-23-incapacidad-por-admin). Es un componente propio y no
// `FormularioSolicitud`: aquel es el del empleado —elige el tipo, enseña su
// saldo, le habla en segunda persona y acota la incapacidad a dos días atrás—,
// y aquí hay un solo tipo, una persona que elegir y ninguna ventana hacia atrás.
//
// Las reglas de verdad las pone el servidor (`validarIncapacidadAjena`). Lo de
// aquí es ayuda para no mandar algo que va a rebotar: el `max` de un input se
// salta tecleando, y por eso Guardar mira también las fechas.

/** El tope del PDF: el mismo que el formulario del empleado y que `MAX_ADJUNTO_BYTES` en hub-api. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

const CAMPO =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none';
const ROTULO = 'mb-1 block text-sm font-medium text-gray-700';

interface Props {
  /** Las fichas que carga el Registro. Trae también las inactivas: aquí se filtran. */
  empleados: Empleado[];
  onRegistrada: (s: Solicitud) => void;
  onCerrar: () => void;
}

export default function RegistrarIncapacidad({ empleados, onRegistrada, onCerrar }: Props) {
  const [empleadoId, setEmpleadoId] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [comentarios, setComentarios] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const id = useId();

  // Mientras se guarda no se cierra por ninguna salida (aspa, Cancelar, Escape
  // o clic fuera): cerrar a mitad dejaría al administrador sin saber si la
  // incapacidad —y el correo que la acompaña— salió o no.
  const cerrar = () => {
    if (!guardando) onCerrar();
  };
  const dialogo = useFocoDeModal<HTMLFormElement>(cerrar);

  const hoy = hoyEnColombia();

  // Solo fichas activas —el servidor contesta 404 a una inactiva— y por orden
  // alfabético en español, como en FormularioNota: «Álvaro» va con la A y no
  // detrás de la Z, que es donde lo dejaría un `sort()` a secas.
  const opciones = useMemo(
    () => empleados.filter((e) => e.activo).sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es')),
    [empleados],
  );

  const inicioFuturo = fechaInicio !== '' && fechaInicio > hoy;
  const finAntes = fechaInicio !== '' && fechaFin !== '' && fechaFin < fechaInicio;
  const puedeGuardar =
    empleadoId !== '' &&
    fechaInicio !== '' &&
    fechaFin !== '' &&
    !inicioFuturo &&
    !finAntes &&
    archivo !== null &&
    !guardando;

  function limpiarArchivo() {
    setArchivo(null);
    if (inputArchivo.current) inputArchivo.current.value = '';
  }

  // Las mismas dos comprobaciones que el formulario del empleado, con las mismas
  // frases: el `accept` del input no impide elegir otra cosa.
  function elegirArchivo(f: File | null) {
    setError(null);
    if (!f) return void limpiarArchivo();
    if (f.type !== 'application/pdf') {
      setError('El soporte debe ser un archivo PDF.');
      return void limpiarArchivo();
    }
    if (f.size > MAX_PDF_BYTES) {
      setError(`El archivo pesa ${(f.size / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB.`);
      return void limpiarArchivo();
    }
    setArchivo(f);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!puedeGuardar || !archivo) return;
    setGuardando(true);
    setError(null);
    try {
      onRegistrada(
        await registrarIncapacidadAjena({
          empleadoId,
          fechaInicio,
          fechaFin,
          comentarios: comentarios.trim() || undefined,
          adjunto: { nombreArchivo: archivo.name, mime: archivo.type, contenidoBase64: await leerComoBase64(archivo) },
        }),
      );
    } catch (err) {
      // El formulario se queda abierto y con todo lo rellenado: el mensaje dice
      // qué corregir, y volver a elegirlo todo sería castigarlo por ello.
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={cerrar}
      role="presentation"
    >
      <form
        ref={dialogo}
        onSubmit={guardar}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Registrar incapacidad"
        // `-1`: enfocable a mano al abrir, pero fuera del ciclo de tabulación.
        tabIndex={-1}
        className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Registrar incapacidad</h3>
            <p className="text-sm text-gray-500">
              A nombre de la persona que elijas, con los mismos efectos que si la informara ella: el calendario, la
              hoja de nómina y el acuse por correo, con copia a administración.
            </p>
          </div>
          <button
            type="button"
            onClick={cerrar}
            disabled={guardando}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4">
          <label htmlFor={`${id}-persona`} className={ROTULO}>
            Persona
          </label>
          <select id={`${id}-persona`} className={CAMPO} value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}>
            <option value="">— Elige una persona —</option>
            {opciones.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombreCompleto}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-inicio`} className={ROTULO}>
              Primer día de la incapacidad
            </label>
            {/* `max` y sin `min`: hacia atrás no hay ventana —para eso existe
                esta puerta— y hacia adelante sí, porque nadie sabe que va a
                enfermar. */}
            <input
              id={`${id}-inicio`}
              type="date"
              className={CAMPO}
              value={fechaInicio}
              max={hoy}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${id}-fin`} className={ROTULO}>
              Último día de la incapacidad
            </label>
            {/* Sin `max`: el médico firma hoy una baja que cubre los próximos
                días, igual que para el empleado. */}
            <input
              id={`${id}-fin`}
              type="date"
              className={CAMPO}
              value={fechaFin}
              min={fechaInicio || undefined}
              onChange={(e) => setFechaFin(e.target.value)}
            />
          </div>
        </div>
        {inicioFuturo && <p className="mb-2 text-sm text-red-600">La fecha de inicio no puede ser futura.</p>}
        {finAntes && <p className="mb-2 text-sm text-red-600">El último día no puede ser anterior al primero.</p>}

        <div className="mb-4 mt-2">
          <label htmlFor={`${id}-pdf`} className={ROTULO}>
            Soporte médico en PDF<span className="text-red-500"> *</span>
          </label>
          <input
            id={`${id}-pdf`}
            ref={inputArchivo}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-xl file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
          />
          {archivo && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
              <Paperclip className="h-3.5 w-3.5" />
              {archivo.name} ({(archivo.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>

        <div className="mb-5">
          <label htmlFor={`${id}-com`} className={ROTULO}>
            Comentarios (opcional)
          </label>
          <textarea
            id={`${id}-com`}
            rows={2}
            maxLength={2000}
            className={CAMPO}
            value={comentarios}
            onChange={(e) => setComentarios(e.target.value)}
          />
        </div>

        {/* `role="alert"` por lo mismo que en EditarSolicitud: el aviso sale
            DESPUÉS de pulsar y sin mover el foco, y el modal sigue abierto. */}
        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cerrar}
            disabled={guardando}
            className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!puedeGuardar}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/ausencias && npx vitest run src/RegistrarIncapacidad.test.tsx
cd apps/ausencias && npm run typecheck
```

Esperado: 9 tests en verde; typecheck sin errores (el componente aún no lo monta nadie).

- [ ] **Step 5: Commit**

```bash
git add apps/ausencias/src/RegistrarIncapacidad.tsx apps/ausencias/src/RegistrarIncapacidad.test.tsx
git commit -m "feat(ausencias): formulario para registrar una incapacidad a nombre de otro"
```

---

### Task 10: el botón, el aviso y la etiqueta en el Registro general

**Files:**
- Create: `apps/ausencias/src/RegistroGeneral.test.tsx`
- Modify: `apps/ausencias/src/api/registro.ts` (`MovimientoBase`, L84-86)
- Modify: `apps/ausencias/src/RegistroGeneral.tsx:2,27-28,188-189,265,398-402,487-501,587-590,714-731`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/ausencias/src/RegistroGeneral.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { Empleado, Movimiento } from './api';
import RegistroGeneral from './RegistroGeneral';

// El Registro general del administrador que registra una incapacidad a nombre
// de otro, y la etiqueta que deja esa constancia en la fila. Se simula `./api`
// entero salvo lo que la pantalla no toca, igual que PanelOrganigrama.test.tsx.

const api = vi.hoisted(() => ({
  fetchMovimientos: vi.fn(),
  fetchEmpleados: vi.fn(),
  registrarIncapacidadAjena: vi.fn(),
  leerComoBase64: vi.fn(),
}));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));

type MovimientoDeSolicitud = Extract<Movimiento, { clase: 'solicitud' }>;

const ADMIN = 'admin@ejemplo.test';

const fila = (over: Partial<MovimientoDeSolicitud> = {}): MovimientoDeSolicitud => ({
  clase: 'solicitud',
  estado: 'registrada',
  id: 's1',
  solicitudId: 's1',
  empleadoNombre: 'Ana Pérez',
  empleadoCargo: null,
  solicitanteEmail: 'ana@ejemplo.test',
  tipo: 'incapacidad',
  fechaInicio: '2025-03-03',
  fechaFin: '2025-03-05',
  horaInicio: null,
  horaFin: null,
  diasHabiles: 3,
  decididaAt: null,
  decididaPor: null,
  createdAt: '2025-03-06T10:00:00Z',
  motivo: null,
  anuladaAt: null,
  observaciones: null,
  registradaPor: null,
  ...over,
});

const ana: Empleado = {
  id: 'e1',
  nombreCompleto: 'Ana Pérez',
  correo: 'ana@ejemplo.test',
  cargo: null,
  credencial: null,
  aprobadorCorreo: 'jefe@ejemplo.test',
  copiaCorreo: null,
  veAdjuntos: false,
  exportaRegistro: false,
  veTodaLaEmpresa: false,
  veKpis: false,
  requiereSegundaFirma: true,
  userId: null,
  activo: true,
  fechaRetiro: null,
  retiradoPor: null,
  retiradoAt: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function montar(esAdmin: boolean, movimientos: Movimiento[] = [fila()]) {
  api.fetchMovimientos.mockResolvedValue(movimientos);
  api.fetchEmpleados.mockResolvedValue([ana]);
  render(<RegistroGeneral recargarToken={0} festivos={new Set()} esAdmin={esAdmin} puedeExportar={false} />);
  await waitFor(() => expect(screen.queryByText('Cargando…')).toBeNull());
}

const boton = () => screen.queryByRole('button', { name: 'Registrar incapacidad' });

/** Abre el formulario y lo rellena entero. Dentro del diálogo: la barra de filtros tiene otro «Persona». */
function abrirYRellenar(): HTMLElement {
  fireEvent.click(boton()!);
  const dialogo = screen.getByRole('dialog', { name: 'Registrar incapacidad' });
  const w = within(dialogo);
  fireEvent.change(w.getByLabelText('Persona'), { target: { value: 'e1' } });
  fireEvent.change(w.getByLabelText('Primer día de la incapacidad'), { target: { value: '2025-03-03' } });
  fireEvent.change(w.getByLabelText('Último día de la incapacidad'), { target: { value: '2025-03-05' } });
  fireEvent.change(w.getByLabelText(/Soporte médico en PDF/), {
    target: { files: [new File(['%PDF-1.4'], 'baja.pdf', { type: 'application/pdf' })] },
  });
  return dialogo;
}

describe('Registrar incapacidad desde el Registro general', () => {
  it('quien no es admin no ve el botón (ni se le piden las fichas)', async () => {
    await montar(false);
    expect(boton()).toBeNull();
    expect(api.fetchEmpleados).not.toHaveBeenCalled();
  });

  it('si las fichas no cargan, tampoco hay botón: el desplegable abriría vacío', async () => {
    // La barra de filtros se pinta igual tras una carga fallida (basta
    // `!cargando`), y `empleados` se queda en []. Es lo que muerde la guarda
    // `empleados.length > 0`: quitar `esAdmin` no lo vería ningún test, porque a
    // quien no es admin nunca se le piden las fichas.
    api.fetchMovimientos.mockResolvedValue([fila()]);
    api.fetchEmpleados.mockRejectedValue(new Error('No se pudieron cargar los datos (error 500).'));
    render(<RegistroGeneral recargarToken={0} festivos={new Set()} esAdmin puedeExportar={false} />);
    await waitFor(() => expect(screen.getByText(/error 500/)).toBeTruthy());
    expect(boton()).toBeNull();
  });

  it('el admin lo ve, y abre el formulario', async () => {
    await montar(true);
    fireEvent.click(boton()!);
    expect(screen.getByRole('dialog', { name: 'Registrar incapacidad' })).toBeTruthy();
  });

  it('Cancelar cierra sin guardar', async () => {
    await montar(true);
    const dialogo = abrirYRellenar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.registrarIncapacidadAjena).not.toHaveBeenCalled();
  });

  it('al guardar bien: cierra, avisa en verde con el nombre y recarga el registro', async () => {
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockResolvedValue({ id: 's9', empleadoNombre: 'Ana Pérez' });
    await montar(true);
    const dialogo = abrirYRellenar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(screen.getByText('Incapacidad de Ana Pérez registrada. Le hemos enviado el acuse por correo.')).toBeTruthy(),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    // La recarga sale de un efecto (`recargaLocal` en sus dependencias): se
    // espera, no se da por hecha en el mismo tick que el aviso.
    await waitFor(() => expect(api.fetchMovimientos).toHaveBeenCalledTimes(2));
  });

  it('si falla: el mensaje, el formulario sigue abierto con lo rellenado, y no recarga', async () => {
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockRejectedValue(new Error('Esa ficha ya no está activa. Recarga la lista.'));
    await montar(true);
    const dialogo = abrirYRellenar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(within(dialogo).getByRole('alert').textContent).toContain('Esa ficha ya no está activa.'));
    expect(screen.getByRole('dialog')).toBe(dialogo);
    expect((within(dialogo).getByLabelText('Persona') as HTMLSelectElement).value).toBe('e1');
    expect(screen.queryByText(/Le hemos enviado el acuse/)).toBeNull();
    expect(api.fetchMovimientos).toHaveBeenCalledTimes(1);
  });
});

describe('la etiqueta «Registrada por administración»', () => {
  const movimientos = [
    fila({ id: 's1', solicitudId: 's1', registradaPor: ADMIN }),
    fila({ id: 's2', solicitudId: 's2', empleadoNombre: 'Luis Gómez', registradaPor: null }),
  ];

  it.each([true, false])('sale solo en la fila que la lleva, con el correo en el title (esAdmin=%s)', async (esAdmin) => {
    // Igual para el admin y para los jefes que ven esa fila.
    await montar(esAdmin, movimientos);
    const etiquetas = screen.getAllByText('Registrada por administración');
    expect(etiquetas).toHaveLength(1);
    expect(etiquetas[0].getAttribute('title')).toBe(ADMIN);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/ausencias && npx vitest run src/RegistroGeneral.test.tsx
```

Esperado: FALLAN todos salvo «quien no es admin no ve el botón» y «si las fichas no cargan, tampoco hay
botón», que pasan ya porque el botón todavía no existe: los cuatro del formulario porque
`boton()` es `null` y `fireEvent.click` lo rechaza (`Unable to fire a "click" event - please provide a
DOM element`), y los dos de la etiqueta con `Unable to find an element with the text: Registrada por
administración`.

- [ ] **Step 3: El tipo del front**

En `apps/ausencias/src/api/registro.ts`, sustituir el final de `MovimientoBase`:

```ts
  /** `comentarios` en una solicitud; `motivo` en una anulación o un cambio. */
  motivo: string | null;
}
```

por:

```ts
  /** `comentarios` en una solicitud; `motivo` en una anulación o un cambio. */
  motivo: string | null;
  /**
   * El correo del administrador que la registró a nombre de la persona
   * (migración 080), o `null` si la registró ella misma o viene de la hoja.
   * SIEMPRE `null` en una modificación. Espejo de `MovimientoBase` en hub-api.
   */
  registradaPor: string | null;
}
```

- [ ] **Step 4: `RegistroGeneral.tsx` — imports, props y estado**

Sustituir el import de iconos (L2):

```tsx
import { AlertTriangle, Download, Loader2, Pencil, Trash2 } from 'lucide-react';
```

por:

```tsx
import { AlertTriangle, CheckCircle2, Download, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
```

sustituir:

```tsx
import EditarModificacion from './EditarModificacion';
```

por:

```tsx
import EditarModificacion from './EditarModificacion';
import RegistrarIncapacidad from './RegistrarIncapacidad';
```

sustituir, en `Props`:

```tsx
  /** Editar y borrar son solo suyos. También decide qué alcance anuncia el subtítulo. */
  esAdmin: boolean;
```

por:

```tsx
  /**
   * Editar, borrar y registrar una incapacidad a nombre de otro son solo suyos.
   * También decide qué alcance anuncia el subtítulo.
   */
  esAdmin: boolean;
```

y justo después de `const [recargaLocal, setRecargaLocal] = useState(0);` añadir:

```tsx
  // El formulario de «Registrar incapacidad» abierto, y el aviso verde de la
  // última registrada. El aviso vive fuera del modal porque el modal se cierra
  // al guardar bien, y lo que hay que ver justo entonces es que salió.
  const [registrando, setRegistrando] = useState(false);
  const [exito, setExito] = useState<string | null>(null);
```

- [ ] **Step 5: `RegistroGeneral.tsx` — el aviso verde**

Sustituir:

```tsx
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {avisoPropuesta && (
```

por:

```tsx
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {exito && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {exito}
        </div>
      )}

      {avisoPropuesta && (
```

- [ ] **Step 6: `RegistroGeneral.tsx` — el botón**

Sustituir:

```tsx
                <Download className="h-4 w-4" /> Exportar CSV
              </button>
            )}
          </div>
```

por:

```tsx
                <Download className="h-4 w-4" /> Exportar CSV
              </button>
            )}
            {/* Solo admin: la ruta va detrás de `requireAdmin`, y a un jefe este
                botón solo le devolvería un 403. Y solo con fichas cargadas: esta
                barra se pinta también cuando la carga falla (basta `!cargando`),
                y entonces `empleados` está vacío. Con la guarda, el desplegable
                de personas del formulario nunca abre vacío. */}
            {esAdmin && empleados.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setExito(null);
                  setRegistrando(true);
                }}
                className="flex items-center gap-1.5 rounded-xl border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100"
              >
                <Plus className="h-4 w-4" /> Registrar incapacidad
              </button>
            )}
          </div>
```

- [ ] **Step 7: `RegistroGeneral.tsx` — la etiqueta**

Sustituir:

```tsx
                        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.clase}`}>
                          {chip.label}
                        </span>
                      </td>
```

por:

```tsx
                        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.clase}`}>
                          {chip.label}
                        </span>
                        {/* La constancia de la 080: esta fila no la registró la
                            propia persona. Quién fue va en el `title`, y se ve
                            igual para el admin que para los jefes. */}
                        {m.registradaPor && (
                          <div className="mt-1">
                            <span
                              title={m.registradaPor}
                              className="inline-block rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800"
                            >
                              Registrada por administración
                            </span>
                          </div>
                        )}
                      </td>
```

- [ ] **Step 8: `RegistroGeneral.tsx` — el modal**

Sustituir el final del componente:

```tsx
            setRecargaLocal((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
```

por:

```tsx
            setRecargaLocal((n) => n + 1);
          }}
        />
      )}

      {registrando && (
        <RegistrarIncapacidad
          empleados={empleados}
          onCerrar={() => setRegistrando(false)}
          onRegistrada={(s) => {
            setRegistrando(false);
            setExito(`Incapacidad de ${s.empleadoNombre} registrada. Le hemos enviado el acuse por correo.`);
            // Por el MISMO camino que la carga inicial, igual que tras corregir:
            // el movimiento nuevo trae campos que la respuesta del alta no trae
            // (`decididaPor`, la etiqueta), y reconstruirlo aquí sería otro mapeo.
            setRecargaLocal((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Ver que pasa**

```bash
cd apps/ausencias && npx vitest run src/RegistroGeneral.test.tsx src/RegistrarIncapacidad.test.tsx src/registroCsv.test.ts
```

Esperado: todo en verde (8 tests nuevos en `RegistroGeneral.test.tsx`).

- [ ] **Step 10: Portón del front**

```bash
cd apps/ausencias && npm run typecheck
cd apps/ausencias && npm test
cd apps/ausencias && npm run build
```

Esperado: typecheck sin errores; todos los tests en verde; build correcto.

- [ ] **Step 11: Commit**

```bash
git add apps/ausencias/src/api/registro.ts apps/ausencias/src/RegistroGeneral.tsx apps/ausencias/src/RegistroGeneral.test.tsx
git commit -m "feat(ausencias): boton y etiqueta de incapacidad registrada en el registro general"
```

---

### Task 11: verificación final (la hace el controlador, no un implementador)

- [ ] **Step 1: Mutaciones.** Cada una se aplica con Edit, se lanza el test indicado, se comprueba
  que cae, y se revierte con Edit. **Nunca con `sed`, `Set-Content` ni `perl`.**

| # | Mutación (rompiendo el código de verdad) | Debe caer |
|---|---|---|
| 1 | Quitar `requireAdmin` de la ruta `incapacidad-ajena` en `router.ts` | `router.test.ts` «403 a quien no es admin, y no deja rastro» |
| 2 | En `validarIncapacidadAjena`, `validarAlta(…, false)` → `validarAlta(…, true)` | `incapacidad-ajena.test.ts` «acepta una incapacidad de hace un año» y `router.test.ts` «201: un admin la registra…» |
| 3 | En `validarNuevaSolicitud`, `validarAlta(body, hoy, true)` → `false` | `incapacidad-ajena.test.ts` «CANDADO: la misma fecha por la validación del EMPLEADO…», `service.test.ts` «CANDADO: una incapacidad de antes de su ventana se rechaza» y `router.test.ts` «CANDADO: la ruta del EMPLEADO sigue con su ventana…» |
| 4 | En `altaBajoCandado`, `solicitanteEmail: empleado.correo` → `solicitanteEmail: sesion.email` | `router.test.ts` «CANDADO: solicitanteEmail es el del EMPLEADO…» y `incapacidad-ajena.db.test.ts` «guarda registrada_por, el correo del EMPLEADO…» |
| 5 | En `registrarIncapacidadAjena`, `sesion.email` → `null` | `router.test.ts` «CANDADO: solicitanteEmail es el del EMPLEADO y registradaPor…» y `incapacidad-ajena.db.test.ts` «guarda registrada_por…» |
| 6 | En `crearSolicitud`, `darDeAlta(…, null)` → `darDeAlta(…, sesion.email)` | `router.test.ts` «CANDADO: el alta del empleado nace con registradaPor en null» e `incapacidad-ajena.db.test.ts` «CANDADO: deja registrada_por en NULL» |
| 7 | Comentar la llamada a `exigirSinSolape` en `altaBajoCandado` | `router.test.ts` «CANDADO: 409 rango_solapado…» e `incapacidad-ajena.db.test.ts` «CANDADO: la regla de no solaparse sigue mordiendo» |
| 8 | En `insertarSolicitud`, en el array de parámetros, `datos.registradaPor,` → `null,` (deja `lower($14)` tal cual) | `incapacidad-ajena.db.test.ts` «con valor: queda en la columna y vuelve en la Solicitud» |
| 9 | En `aSolicitud`, `registradaPor: r.registrada_por` → `registradaPor: null` | `incapacidad-ajena.db.test.ts` «con valor…» y «el acuse que queda en la cola dice que la registro administracion…» |
| 10 | En `acuseSolicitante`, `esInc && Boolean(s.registradaPor)` → `false` | `notificaciones.test.ts` «si la registró administración lo dice…» y «CANDADO: registradaPor cambia el texto…» |
| 11 | En `acuseSolicitante`, `para: esInc ? …` → `para: porAdministracion ? s.solicitanteEmail : esInc ? …` | `notificaciones.test.ts` «CANDADO: registradaPor cambia el texto y NADA más…» |
| 12 | En `comoMovimientoDeSolicitud`, `registradaPor: r.registrada_por` → `registradaPor: null` | `repo.movimientos.db.test.ts` «CANDADO: una solicitud registrada por administracion lo trae…» |
| 13 | En `validarIncapacidadAjena`, borrar la línea `if (!UUID.test(empleadoId)) …` | `incapacidad-ajena.test.ts` «404 empleado_no_encontrado si no tiene forma de uuid» (el doble del router no modela el `::uuid`, así que allí no muerde) |
| 14 | En `validarIncapacidadAjena`, `\|\| empleadoId === ''` → borrar | `incapacidad-ajena.test.ts` «400 empleado_requerido si falta empleadoId…» |
| 15 | En `errorDeIncapacidadAjena`, quitar `&& cuerpo?.error === 'empleado_no_encontrado'` | `api/registro.test.ts` «un 404 SIN ese código…» |
| 16 | En `errorDeIncapacidadAjena`, `'otra ausencia de esa persona'` → quitar el argumento | `api/registro.test.ts` «rango_solapado: habla de «esa persona»…» |
| 17 | En `RegistrarIncapacidad.tsx`, quitar `archivo !== null &&` de `puedeGuardar` | `RegistrarIncapacidad.test.tsx` «Guardar sigue apagado…» y los dos «el PDF: …» |
| 18 | En `RegistrarIncapacidad.tsx`, quitar `!inicioFuturo &&` de `puedeGuardar` | `RegistrarIncapacidad.test.tsx` «el inicio: max = hoy y sin min…» |
| 19 | En `RegistrarIncapacidad.tsx`, `.filter((e) => e.activo)` → borrar | `RegistrarIncapacidad.test.tsx` «el desplegable…» |
| 20 | En `RegistrarIncapacidad.tsx`, el `localeCompare(…, 'es')` → `(a.nombreCompleto < b.nombreCompleto ? -1 : 1)` | `RegistrarIncapacidad.test.tsx` «el desplegable…» |
| 21 | En `RegistroGeneral.tsx`, `{esAdmin && empleados.length > 0 && (` del botón → `{esAdmin && (` | `RegistroGeneral.test.tsx` «si las fichas no cargan, tampoco hay botón…» |
| 22 | En `RegistroGeneral.tsx`, quitar `setRecargaLocal((n) => n + 1);` de `onRegistrada` | `RegistroGeneral.test.tsx` «al guardar bien…» |
| 23 | En `RegistroGeneral.tsx`, `title={m.registradaPor}` → borrar el atributo | `RegistroGeneral.test.tsx` «sale solo en la fila que la lleva…» |

Si alguna NO cae, el test correspondiente no protege nada: se arregla el test antes de seguir.

Mutación equivalente, que NO va en la tabla: quitar `esAdmin &&` de esa misma guarda no la ve ningún
test, porque a quien no es admin nunca se le piden las fichas (`RegistroGeneral.tsx:275`) y
`empleados.length > 0` ya lo deja sin botón. La guarda se deja explícita igual: dice a quién es el
botón aunque un día cambie quién carga las fichas.

- [ ] **Step 2: Baterías completas de hub-api**

```bash
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
cd apps/hub-api && npx vitest run --coverage --exclude "scripts/**"
cd apps/hub-api && npm run test:db
```

Esperado: typecheck sin errores; todo en verde y los umbrales de cobertura de
`src/ausencias/{!(repo).ts,service/*.ts}` cumplidos (lo nuevo de `service/` lo cubren
`incapacidad-ajena.test.ts` y `router.test.ts`).

- [ ] **Step 3: Portón del front** (los mismos comandos que la Task 10, Step 10).

- [ ] **Step 4: Los candados de identidad del alta del empleado, otra vez por su nombre** (los
  comandos de la Task 6, Step 7). Esperado: verdes, y `git diff main -- apps/hub-api/src/ausencias/service.test.ts`
  solo enseña la línea del fixture (`registradaPor: null`).

- [ ] **Step 5: Privacidad, en un comando APARTE y leyendo el resultado antes de mezclar**

```bash
git diff main --stat
git diff main | grep -niE "@[a-z0-9.-]+\.(com|co)\b" | grep -viE "ambientalia\.com\.co|ejemplo\.test"
```

Esperado: el segundo comando no imprime nada. Los correos de `@ambientalia.com.co` que aparezcan deben
ser los ficticios de los tests (`ana.ruiz@`, `admin@`, `ajena@`, `jefe1@`); revisarlos a ojo.

- [ ] **Step 6: Merge y push** (sin tocar el `.gitignore` modificado ni los ficheros sin seguimiento
  del usuario; nada de `git stash`)

```bash
git checkout main
git merge --no-ff feat/incapacidad-por-admin -m "merge: incapacidad registrada por el administrador"
git push origin main
```

- [ ] **Step 7: Despliegue (lo hace el usuario a mano en EasyPanel):** **hub-api primero** (aplica la
  migración 080 al arrancar) y **el portal después**. Si el portal llegara antes, el botón fallaría con
  el mensaje genérico del 404 («No se pudieron cargar los datos (error 404)…») y nada más se rompería.
  Prueba en producción: registrarla a nombre de una ficha propia de prueba; el acuse sale DE VERDAD a
  esa ficha con copia a administración, y se crea el evento en Staff y la fila en la hoja de nómina.
  Borrarla después desde el Registro encola el borrado del evento; la fila de la hoja hay que quitarla
  a mano.

---

## Cobertura de la spec (autorrevisión)

| Spec | Task |
|---|---|
| §2 solo incapacidades; fechas pasadas sí, futuras no; fin puede pasar de hoy | 4, 6, 9 |
| §2 PDF obligatorio | 4, 6, 9 |
| §2 mismos efectos, correo adaptado; constancia y etiqueta; botón solo admin | 3, 6, 7, 10 |
| §3 la ruta del empleado no cambia; sus candados siguen; núcleo compartido | 5, 6 (Step 7), 11 (Step 4) |
| §4.1 migración 080, `IF NOT EXISTS`, sin GRANT (verificado), relevo del test de la última | 1 |
| §4.2 ruta, `requireAuth, requireAdmin`, parser de 12 MB, cuerpo, 201 | 6 |
| §4.3 `empleado_requerido`, reglas comunes, `incapacidad_en_el_futuro`, sin ventana, adjunto, nombre del EMPLEADO, `dias` y horas | 4, 6 |
| §4.4 ficha activa o 404; tope del retiro; `registrada` sin aprobadores con el correo del empleado; `registrada_por`; candado, solape, inserción, adjunto, cola, calendario, n8n | 5, 6 |
| §4.5 asunto y cuerpo; destinatarios, calendario y hoja sin cambios; `registradaPor` en la `Solicitud` | 2, 3 |
| §4.6 filas del Registro con `registradaPor`, modificaciones `null` | 7 |
| §5.1 cliente y lector propio; los cuatro mensajes; 404 sin código; revisión código a código | 8 |
| §5.2 formulario propio; desplegable; fechas; PDF; comentarios; Guardar y Cancelar; éxito y error | 9, 10 |
| §5.3 etiqueta con `title`, igual para admin y jefes | 10 |
| §5.4 comentario «NO hay vía…» actualizado; `incapacidad_demasiado_antigua` se queda | 8 |
| §6 verificación (BD, unitarios, ruta, front, candados, mutaciones) | 1-10, 11 |
| §7 despliegue: hub-api primero | 11 (Step 7) |
