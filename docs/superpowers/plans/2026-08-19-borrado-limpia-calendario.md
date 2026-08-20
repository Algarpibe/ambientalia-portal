# Borrar una solicitud limpia su calendario — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que borrar una solicitud desde *Registro general* encole el borrado de su evento del Google Calendar en vez de abandonarlo.

**Architecture:** La clave ajena `ausencias_outbox.solicitud_id` pasa de `ON DELETE CASCADE` a `ON DELETE SET NULL`, para que una fila del outbox pueda sobrevivir a su solicitud. `repo.borrarSolicitud` pasa a ser transaccional y hace tres pasos en orden: limpiar lo pendiente, encolar el `borrado_admin`, borrar la fila. El payload lo inyecta el router, como en el resto del fichero.

**Tech Stack:** TypeScript ESM (imports con `.js`), Express 4, SQL crudo sobre PostgreSQL 17, Vitest 2.1.9.

**Spec:** `docs/superpowers/specs/2026-08-19-borrado-limpia-calendario-design.md` — leerlo antes de empezar.

**Convenciones del repo:**
- Código y comentarios **en español**. JSDoc de `repo.ts`, `router.ts`, `types.ts` y `notificaciones.ts` **con tildes**; comentarios dentro de los `.db.test.ts` y del SQL, **sin** tildes. Mimetiza cada sitio.
- Los comentarios explican el **porqué**.
- Commits en español **sin tildes**.
- **Nunca `git add -A`**: hay un `apps/WO-sales/prompts/` ajeno sin trackear.
- `.ts` en **CRLF**, salvo `router.ts` que es **LF**. Ediciones quirúrgicas.
- Rama `feat/borrado-limpia-calendario`, ya creada.

**Comandos:**
- Portón rápido: `npm run test --workspace=apps/hub-api` (hoy 792)
- Cuarto portón (necesita Docker): `npm run test:db --workspace=apps/hub-api` (hoy 50)
- Build: `npm run build --workspace=apps/hub-api`

---

## Estructura de ficheros

| Fichero | Qué hace |
|---|---|
| `apps/hub-api/src/users/migrations/028_ausencias_outbox_huerfano.sql` | **Crear.** Nulabilidad, clave ajena y CHECK |
| `apps/hub-api/src/db.ts` | **Modificar.** Añadir la 028 al array |
| `apps/hub-api/src/ausencias/types.ts` | **Modificar.** `EVENTOS_BORRADO` y `EventoPendiente.solicitudId` nulable |
| `apps/hub-api/src/ausencias/notificaciones.ts` | **Modificar.** El correo y `construirPayloadBorrado` |
| `apps/hub-api/src/ausencias/notificaciones.test.ts` | **Modificar.** Tests del payload |
| `apps/hub-api/src/ausencias/repo.ts` | **Modificar.** `borrarSolicitud` transaccional |
| `apps/hub-api/src/ausencias/router.ts` | **Modificar.** Pasar admin y constructor |
| `apps/hub-api/src/ausencias/router.test.ts` | **Modificar.** El doble, para la firma nueva |
| `apps/hub-api/src/ausencias/repo.borrado.db.test.ts` | **Crear.** Los candados contra Postgres |
| `docs/dev/app-ausencias.md` | **Modificar.** Sección nueva |

---

## Task 1: Migración 028 — el outbox admite huérfanos

**Files:**
- Create: `apps/hub-api/src/users/migrations/028_ausencias_outbox_huerfano.sql`
- Modify: `apps/hub-api/src/db.ts:24`

Va la primera porque sin ella el `INSERT` del paso 2 rebota contra el CHECK, y el `DELETE` del paso 3 se lleva la fila por delante.

- [ ] **Step 1: Escribir la migración**

Crear `apps/hub-api/src/users/migrations/028_ausencias_outbox_huerfano.sql`:

```sql
-- Migración 028: una fila del outbox puede sobrevivir a su solicitud.
--
-- Borrar una solicitud desde *Registro general* tiene que poder dejar dicho el
-- borrado de su evento del Google Calendar. Con `ON DELETE CASCADE` eso era
-- imposible por construcción: el DELETE de la solicitud se llevaba por delante
-- la fila que acababa de encolar el borrado, y el evento se quedaba huérfano en
-- el calendario de Staff para siempre.
--
-- Que el huérfano funcione no es una apuesta: `eventosPendientes` NO hace JOIN
-- con `solicitudes_ausencia` —lee solo del outbox y devuelve `payload`, que es
-- autocontenido— y `/ausencias/n8n/confirmado` confirma por el `id` del outbox,
-- no por `solicitud_id`. Nadie usa esa columna para entregar ni para confirmar.
--
-- `SET NULL` y no quitar la clave ajena: asi el NULL SIGNIFICA algo legible en el
-- dato —«su solicitud ya no existe»— y el INSERT sigue validando que el id
-- exista. Lo unico que se relaja es que pasa al borrar.
--
-- El ancho de `evento` no hace falta tocarlo: la 025 lo dejo en VARCHAR(40) y
-- `borrado_admin` mide 13. Se dice explicito porque esa fue la mitad que se
-- olvido en la 024.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- ── 1. `solicitud_id` deja de ser NOT NULL ─────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'portal'
       AND table_name   = 'ausencias_outbox'
       AND column_name  = 'solicitud_id'
       AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE portal.ausencias_outbox ALTER COLUMN solicitud_id DROP NOT NULL;
  END IF;
END $$;

-- ── 2. La clave ajena pasa de CASCADE a SET NULL ───────────────────────────
--
-- La guarda mira `confdeltype`, que es el COMPORTAMIENTO al borrar ('c' =
-- cascade, 'n' = set null), y no el nombre del constraint. El nombre lo puso
-- Postgres solo (`ausencias_outbox_solicitud_id_fkey`) y darlo por bueno es la
-- misma trampa que documenta la 024: una guarda por un nombre que no es el real
-- deja el bloque sin ejecutarse y no avisa.
--
-- El bucle se acota a la clave ajena de ESTA columna via `conkey`, no a todas
-- las de la tabla: hoy solo hay una, pero borrar por tipo cualquier clave ajena
-- futura seria un efecto que nadie ha pedido.
DO $$
DECLARE
  vieja text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid    = 'portal.ausencias_outbox'::regclass
       AND contype     = 'f'
       AND confdeltype = 'n'
  ) THEN
    FOR vieja IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = 'portal.ausencias_outbox'::regclass
         AND con.contype  = 'f'
         AND con.conkey   = ARRAY[(SELECT a.attnum
                                     FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname  = 'solicitud_id')]::int2[]
    LOOP
      EXECUTE format('ALTER TABLE portal.ausencias_outbox DROP CONSTRAINT %I', vieja);
    END LOOP;

    ALTER TABLE portal.ausencias_outbox
      ADD CONSTRAINT ausencias_outbox_solicitud_fk
      FOREIGN KEY (solicitud_id) REFERENCES portal.solicitudes_ausencia(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. El CHECK de `evento` admite `borrado_admin` ─────────────────────────
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.ausencias_outbox'::regclass
       AND conname  = 'outbox_evento_check'
       AND pg_get_constraintdef(oid) LIKE '%borrado_admin%'
  ) THEN
    FOR viejo IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = 'portal.ausencias_outbox'::regclass
         AND con.contype  = 'c'
         AND con.conkey   = ARRAY[(SELECT a.attnum
                                     FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname  = 'evento')]::int2[]
    LOOP
      EXECUTE format('ALTER TABLE portal.ausencias_outbox DROP CONSTRAINT %I', viejo);
    END LOOP;

    ALTER TABLE portal.ausencias_outbox
      ADD CONSTRAINT outbox_evento_check
      CHECK (evento IN ('creada', 'aprobacion', 'aprobacion_2', 'aprobada', 'rechazada', 'registrada',
                        'modificacion_solicitada', 'modificacion_aprobada', 'modificacion_rechazada',
                        'correccion_admin', 'borrado_admin'));
  END IF;
END $$;
```

- [ ] **Step 2: Añadirla al array `MIGRATIONS`**

En `apps/hub-api/src/db.ts:24`, añadir `'028_ausencias_outbox_huerfano.sql'` al final, tras `'027_ausencias_correccion_admin.sql'`.

⚠️ Olvidarlo **no da ningún error**: la migración no se aplica nunca y el fallo aparece en la primera petición real de producción.

- [ ] **Step 3: Verificar que aplica limpia y es idempotente**

Run: `npm run test:db --workspace=apps/hub-api`
Expected: PASS, 50 tests. El `globalSetup` aplica el mismo array, y `db.migraciones.db.test.ts` las re-ejecuta sobre una base ya migrada.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/users/migrations/028_ausencias_outbox_huerfano.sql
git commit -m "feat(ausencias): una fila del outbox puede sobrevivir a su solicitud" -- apps/hub-api/src/users/migrations/028_ausencias_outbox_huerfano.sql apps/hub-api/src/db.ts
```

---

## Task 2: El evento `borrado_admin` y el `solicitudId` nulable

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts` (junto a `EVENTOS_CORRECCION`, y la interfaz `EventoPendiente`)

- [ ] **Step 1: Añadir el grupo de eventos**

En `apps/hub-api/src/ausencias/types.ts`, justo después de `EVENTOS_CORRECCION` y antes de la declaración de `EVENTOS`:

```ts
/**
 * El borrado de una solicitud desde *Registro general*.
 *
 * Grupo propio y no un `EVENTO_CORRECCION` más, por el mismo criterio que separa
 * a los de modificación de los de solicitud: su constructor de payload recibe UNA
 * solicitud —la que se va a borrar—, mientras que el de corrección recibe dos, la
 * de antes y la de después. Firmas distintas, grupos distintos.
 *
 * ⚠️ El valor viaja al CHECK `outbox_evento_check`, que amplía la migración 028.
 */
export const EVENTOS_BORRADO = ['borrado_admin'] as const;
export type EventoBorrado = (typeof EVENTOS_BORRADO)[number];
```

Y cambiar la declaración de `EVENTOS`:

```ts
export const EVENTOS = [
  ...EVENTOS_SOLICITUD,
  ...EVENTOS_MODIFICACION,
  ...EVENTOS_CORRECCION,
  ...EVENTOS_BORRADO,
] as const;
```

- [ ] **Step 2: Hacer `solicitudId` nulable**

En la interfaz `EventoPendiente` (`types.ts:452`):

```ts
/** Un evento listo para que n8n lo ejecute. `payload` lleva todo lo que los
 *  nodos de Gmail/Calendar/Sheets necesitan, ya resuelto por hub-api. */
export interface EventoPendiente {
  id: number;
  evento: EventoOutbox;
  /**
   * `null` cuando su solicitud ya se borró: desde la migración 028 la clave
   * ajena es `ON DELETE SET NULL`, para que el borrado de un evento del
   * calendario pueda sobrevivir a la solicitud que lo pidió.
   *
   * Es informativo y nada más. n8n no lo usa: entrega leyendo `payload`, que es
   * autocontenido, y confirma por el `id` de esta fila.
   */
  solicitudId: string | null;
  intentos: number;
  payload: PayloadEvento;
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run build --workspace=apps/hub-api`
Expected: PASS. Si `tsc` se queja en algún sitio, ahí hay un consumidor de `solicitudId` que el spec no encontró — **para y dilo**, no lo tapes con un `!` ni con un `?? ''`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ausencias): el tipo del outbox conoce el borrado y admite huerfanos" -- apps/hub-api/src/ausencias/types.ts
```

---

## Task 3: El correo del borrado

**Files:**
- Modify: `apps/hub-api/src/ausencias/notificaciones.ts` (al final, junto al bloque de la corrección)
- Test: `apps/hub-api/src/ausencias/notificaciones.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `notificaciones.test.ts`. Reutiliza el helper `solicitud()` del fichero; añade `construirPayloadBorrado` al import de `./notificaciones.js`. Comentarios **con tildes**, como el resto del fichero.

```ts
describe('el payload del borrado de una solicitud', () => {
  const ADMIN = 'comercial@ambientalia.com.co';
  const EVENT_ID = '2993c29668a94bf38708574110cde669';

  it('borra el evento cuando la solicitud tiene uno localizable', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    const p = construirPayloadBorrado(borrada, ADMIN);

    expect(p.calendario).toMatchObject({
      calendarId: CALENDARIO_STAFF,
      eventId: EVENT_ID,
      accion: 'borrar',
    });
    expect(p.correo.asunto).toContain('⚠️ Ajustar la hoja —');
    expect(p.correo.cuerpo).toContain('ya se ha borrado solo');
  });

  // CANDADO. Las aprobadas anteriores a la migración 026 llevan en Google un id
  // que inventó Google y que nadie apuntó: existen, pero no se pueden localizar.
  it('CANDADO: sin id no se borra nada y el aviso pide las dos cosas a mano', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: null });
    const p = construirPayloadBorrado(borrada, ADMIN);

    expect(p.calendario).toBeNull();
    expect(p.correo.asunto).toContain('⚠️ Ajustar calendario y hoja —');
    expect(p.correo.cuerpo).not.toContain('ya se ha borrado solo');
  });

  // CANDADO. El verbo importa: en una corrección la fila de la hoja se AJUSTA, y
  // aquí hay que BORRARLA. Reutilizar el texto de la corrección mandaría a
  // administración a ajustar a unas fechas nuevas una fila que ya no existe.
  it('CANDADO: el aviso dice borrar la fila de la hoja, no ajustarla', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    const cuerpo = construirPayloadBorrado(borrada, ADMIN).correo.cuerpo;

    expect(cuerpo).toContain('borrarla a mano');
    expect(cuerpo).not.toContain('ajustarla a mano');
  });

  it('la hoja va a null SIEMPRE: n8n hace append y a esa fila no se puede volver', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    expect(construirPayloadBorrado(borrada, ADMIN).hoja).toBeNull();
  });

  it('el correo va a la copia de la ficha y nombra al admin que lo borró', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    const p = construirPayloadBorrado(borrada, ADMIN);

    expect(p.correo.para).toBe('administrativo@ambientalia.com.co');
    expect(p.correo.cuerpo).toContain(ADMIN);
  });

  // CANDADO. Único correo de la app con una sola fuente de destinatario: en los
  // demás la cadena de firmas rellena la lista. Un `para` vacío no degrada el
  // aviso, deja una fila que n8n reintenta cada diez minutos para siempre.
  it('CANDADO: una ficha sin copia cae en el valor por defecto, nunca en vacío', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID, copiaCorreo: null });
    const p = construirPayloadBorrado(borrada, ADMIN).correo;

    expect(p.para).toBe(COPIA_POR_DEFECTO);
    expect(p.para).not.toBe('');
  });

  it('el cuerpo enseña qué se borró: tipo, fechas, recuento y estado', () => {
    const borrada = solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID });
    const cuerpo = construirPayloadBorrado(borrada, ADMIN).correo.cuerpo;

    expect(cuerpo).toContain('2026-07-06 a 2026-07-10');
    expect(cuerpo).toContain('aprobada');
    expect(cuerpo).toContain('Ana Ruiz');
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test --workspace=apps/hub-api -- notificaciones.test.ts`
Expected: FAIL, `construirPayloadBorrado` no existe.

- [ ] **Step 3: Escribir el correo y el payload**

Al final de `notificaciones.ts`, después del bloque de la corrección y antes de `eventosDeAlta`:

```ts
// ── El borrado de una solicitud desde Registro general ─────────────────────

/**
 * En qué queda el evento del calendario al borrar la solicitud.
 *
 * Dos situaciones y no las cuatro de la corrección: un borrado siempre cambia
 * algo, así que no existe el caso «el calendario no cambia».
 *
 * Tiene nombre propio por la misma razón que `situacionDelCalendario`: el
 * payload y los dos textos del correo necesitan la misma respuesta, y la primera
 * versión de aquel diseño la calculaba tres veces en paralelo con un JSDoc que
 * afirmaba ser fuente única. Aquí se decide una vez.
 */
type SituacionDelBorrado = 'borrado' | 'a_mano';

const situacionDelBorrado = (borrada: Solicitud): SituacionDelBorrado =>
  // Sin id, el evento existe pero lleva el que inventó Google y nadie apuntó:
  // no se puede localizar, así que hay que ir a buscarlo a mano.
  borrada.eventoCalendarioId === null ? 'a_mano' : 'borrado';

/** El borrado del evento, o `null` si no sabemos dónde está. */
function borradoDelCalendario(borrada: Solicitud, situacion: SituacionDelBorrado): EventoCalendario | null {
  const eventId = borrada.eventoCalendarioId;
  // Se vuelve a preguntar por el id en vez de darlo por bueno con un `!`: la
  // garantía vive en `situacionDelBorrado`, y un `!` la convertiría en un
  // `eventId: null` que n8n mandaría a Google el día que alguien la relaje.
  if (situacion === 'a_mano' || eventId === null) return null;
  // Las fechas describen el evento tal como está justo antes de desaparecer.
  return { ...calendario(borrada), eventId, accion: 'borrar' };
}

/**
 * El párrafo de qué queda por hacer a mano.
 *
 * ⚠️ Textos NUEVOS, no los de la corrección con otra situación. El verbo cambia:
 * allí la fila de la hoja se **ajusta** a unas fechas nuevas; aquí hay que
 * **borrarla**, porque la solicitud ya no existe. Reutilizar aquellos mandaría a
 * administración a ajustar una fila a unas fechas que ya no son de nadie.
 */
const AVISO_DEL_BORRADO: Record<SituacionDelBorrado, string> = {
  borrado:
    '⚠️ Administración: el evento del calendario ya se ha borrado solo. La fila de la hoja no: hay que borrarla a mano.',
  a_mano:
    '⚠️ Administración: esta ausencia estaba en el calendario y en la hoja, y no se borran solas: hay que borrar a mano el evento del calendario y la fila de la hoja.',
};

const prefijoDelBorrado = (situacion: SituacionDelBorrado): string =>
  situacion === 'a_mano' ? '⚠️ Ajustar calendario y hoja — ' : '⚠️ Ajustar la hoja — ';

/**
 * El aviso de que un admin borró una solicitud del registro.
 *
 * Va SOLO a la copia de la ficha —administración—, nunca al trabajador ni a la
 * cadena de firmas: el borrado es una vía de mantener el registro, no de decidir
 * sobre la ausencia de nadie. Mismo criterio que la corrección.
 *
 * ⚠️ El `??` no es paranoia: es el único correo de la app con una sola fuente de
 * destinatario. `copiaCorreo` es nulable y `destinatarios` salta los nulos, así
 * que una ficha con la copia vaciada daría un `sendTo` vacío — una fila que Gmail
 * rechaza y n8n reintenta cada diez minutos para siempre.
 */
function correoBorrado(borrada: Solicitud, adminEmail: string, situacion: SituacionDelBorrado): CorreoEvento {
  return {
    para: destinatarios(borrada.copiaCorreo ?? COPIA_POR_DEFECTO),
    asunto: `${prefijoDelBorrado(situacion)}Borrada del registro: solicitud ${PERIODO[borrada.tipo]} de ${borrada.empleadoNombre}`,
    cuerpo: [
      '¡Hola!',
      '',
      `${adminEmail} ha borrado desde *Registro general* una solicitud ${PERIODO[borrada.tipo]} de ${borrada.empleadoNombre} que ya estaba en el calendario y en la hoja.`,
      '',
      `📅 Borrada: ${fotoDe(borrada)}`,
      '',
      AVISO_DEL_BORRADO[situacion],
      '',
      'Saludos,',
      FIRMA_GERENCIA,
    ].join('\n'),
  };
}

/**
 * El payload del borrado de una solicitud.
 *
 * `hoja` va a `null` SIEMPRE, por lo mismo que en la corrección: n8n hace
 * `append` y no queda constancia de en qué fila cayó, así que a esa fila no se
 * puede volver. Por eso el ⚠️ la nombra en los dos textos.
 *
 * **Precondición:** solo debe llamarse cuando `estaEnElCalendario(borrada.estado)`
 * es `true`. El cuerpo afirma «que ya estaba en el calendario y en la hoja» como
 * un hecho, así que llamarla sobre una `pendiente` mandaría a administración un
 * aviso falso. Quien lo garantiza es `repo.borrarSolicitud`; no se duplica aquí
 * como comprobación defensiva, porque serían dos sitios decidiendo lo mismo.
 */
export function construirPayloadBorrado(borrada: Solicitud, adminEmail: string): PayloadEvento {
  const situacion = situacionDelBorrado(borrada);
  return {
    tipo: borrada.tipo,
    tipoEtiqueta: ETIQUETA_TIPO[borrada.tipo],
    estado: borrada.estado,
    empleadoNombre: borrada.empleadoNombre,
    correo: correoBorrado(borrada, adminEmail, situacion),
    calendario: borradoDelCalendario(borrada, situacion),
    hoja: null,
  };
}
```

`fotoDe`, `destinatarios`, `calendario`, `PERIODO`, `ETIQUETA_TIPO`, `FIRMA_GERENCIA` y `COPIA_POR_DEFECTO` ya existen en el fichero — no los redefinas.

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test --workspace=apps/hub-api -- notificaciones.test.ts`
Expected: PASS.

- [ ] **Step 5: FALSAR el candado del verbo (obligatorio)**

Cambia temporalmente `AVISO_DEL_BORRADO.borrado` por el texto de la corrección (`'…La fila de la hoja no: hay que ajustarla a mano a lo nuevo.'`). Ejecuta.
Expected: FAIL en `CANDADO: el aviso dice borrar la fila de la hoja, no ajustarla`.
**Deshaz** y vuelve a ejecutar: PASS. Pega las dos salidas.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ausencias): el correo del borrado dice que se fue solo y que hay que borrar a mano" -- apps/hub-api/src/ausencias/notificaciones.ts apps/hub-api/src/ausencias/notificaciones.test.ts
```

---

## Task 4: `borrarSolicitud` limpia el calendario

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts:800`
- Modify: `apps/hub-api/src/ausencias/router.ts:425`
- Modify: `apps/hub-api/src/ausencias/router.test.ts` (el doble)
- Create: `apps/hub-api/src/ausencias/repo.borrado.db.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/hub-api/src/ausencias/repo.borrado.db.test.ts`. Comentarios **sin tildes**:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { borrarSolicitud, decidirSolicitud, solicitudPorId } from './repo.js';
import { construirPayload, construirPayloadBorrado } from './notificaciones.js';
import { transicionAlDecidir, type Solicitud } from './types.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from '../test-db/harness.js';

// Que borrar una solicitud deje de abandonar su evento en el Google Calendar.
//
// Todo esto va contra Postgres de verdad porque de lo que trata es de una CLAVE
// AJENA y de una transaccion: el doble in-memory de `router.test.ts` no tiene ni
// una cosa ni la otra, asi que ninguno de estos candados es cazable ahi.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const ADMIN = 'comercial@ambientalia.com.co';

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

async function sembrarPendiente(): Promise<Solicitud> {
  const empleadoId = await sembrarEmpleado(db, CORREO);
  return sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado: 'pendiente',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo: null,
  });
}

/** Aprobada por la via real, para que tenga su id de evento. */
async function aprobadaConEvento(): Promise<Solicitud> {
  const s = await sembrarPendiente();
  const t = transicionAlDecidir(s, true);
  if (!t) throw new Error('una pendiente siempre tiene transicion');
  const aprobada = await decidirSolicitud(db, s.id, s.estado, t, null, null, construirPayload);
  if (!aprobada) throw new Error('no se pudo aprobar');
  return aprobada;
}

const borrar = (s: Solicitud) => borrarSolicitud(db, s.id, ADMIN, construirPayloadBorrado);

/** Las filas del outbox con su solicitud_id, para ver quien sobrevive. */
async function filasDelOutbox(): Promise<{ evento: string; solicitud_id: string | null }[]> {
  const { rows } = await db.query('SELECT evento, solicitud_id FROM portal.ausencias_outbox ORDER BY id');
  return rows as { evento: string; solicitud_id: string | null }[];
}

describe('borrar una solicitud desde el registro general', () => {
  // ESTE es el que distingue esta forma de las dos que se descartaron: la fila
  // sobrevive a su solicitud, y su `solicitud_id` queda a NULL diciendolo.
  it('CANDADO: el borrado del evento SOBREVIVE a la solicitud, con solicitud_id NULL', async () => {
    const s = await aprobadaConEvento();
    await borrar(s);

    expect(await solicitudPorId(db, s.id)).toBeNull();
    expect(await filasDelOutbox()).toEqual([{ evento: 'borrado_admin', solicitud_id: null }]);
  });

  it('el evento encolado es un borrar contra el id que impusimos', async () => {
    const s = await aprobadaConEvento();
    await borrar(s);

    const { rows } = await db.query('SELECT payload FROM portal.ausencias_outbox ORDER BY id DESC LIMIT 1');
    const payload = (rows[0] as { payload: { calendario: { accion: string; eventId: string } } }).payload;
    expect(payload.calendario).toMatchObject({ accion: 'borrar', eventId: s.eventoCalendarioId });
  });

  // CANDADO. Lo que hoy hace la cascada, ahora a proposito. Al relajar la clave
  // ajena esa supresion desaparece sola, y empezarian a entregarse correos
  // anunciando una solicitud que ya no existe.
  it('CANDADO: borrar se lleva los correos que seguian sin servirse', async () => {
    const s = await aprobadaConEvento();
    // El `aprobada` de la decision sigue pendiente: n8n no ha pasado.
    expect(await eventosDelOutbox(db)).toEqual(['aprobada']);

    await borrar(s);

    // Solo queda el borrado. El `aprobada` murio con su solicitud.
    expect(await eventosDelOutbox(db)).toEqual(['borrado_admin']);
  });

  // CANDADO. Una `pendiente` nunca llego a Google, asi que no hay nada que
  // avisar — y el cuerpo del correo afirma que si estaba.
  it('CANDADO: borrar una pendiente no encola NADA', async () => {
    const s = await sembrarPendiente();
    await borrar(s);

    expect(await eventosDelOutbox(db)).toEqual([]);
    expect(await solicitudPorId(db, s.id)).toBeNull();
  });

  it('sobre una solicitud que no existe devuelve null y no encola nada', async () => {
    const fantasma = '00000000-0000-4000-8000-000000000000';
    expect(await borrarSolicitud(db, fantasma, ADMIN, construirPayloadBorrado)).toBeNull();
    expect(await eventosDelOutbox(db)).toEqual([]);
  });

  // CANDADO. Los tres pasos y el DELETE de la solicitud van juntos o no van: un
  // fallo del payload no puede dejar el correo dicho ni la fila borrada.
  it('CANDADO: si el aviso revienta, la solicitud NO se queda borrada', async () => {
    const s = await aprobadaConEvento();
    const revienta = () => {
      throw new Error('el constructor del payload ha fallado');
    };

    await expect(borrarSolicitud(db, s.id, ADMIN, revienta)).rejects.toThrow();

    expect(await solicitudPorId(db, s.id)).not.toBeNull();
    expect(await eventosDelOutbox(db)).toEqual(['aprobada']);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test:db --workspace=apps/hub-api -- repo.borrado.db.test.ts`
Expected: FAIL — `borrarSolicitud` recibe 2 argumentos, no 4.

- [ ] **Step 3: Cambiar `borrarSolicitud`**

Sustituir la función entera en `apps/hub-api/src/ausencias/repo.ts:800`:

```ts
/**
 * Borra una solicitud y devuelve lo que había, o null si no existía.
 *
 * Es irreversible y toca el registro de la compañía, así que **encola el borrado
 * de su evento del Google Calendar** antes de irse: hasta el 2026-08-19 hacía un
 * `DELETE` pelado y dejaba el evento huérfano en el calendario de Staff, donde
 * nadie iba a relacionarlo con nada.
 *
 * Tres pasos, y el orden de los dos primeros NO es indiferente:
 *
 *  1. Se lleva las filas del outbox de esa solicitud que sigan **sin servirse**.
 *     Es lo que hacía la cascada de la clave ajena hasta la migración 028, ahora
 *     escrito a propósito: sin esto se entregarían correos anunciando una
 *     solicitud que ya no existe.
 *  2. Encola el `borrado_admin` **si la fila estaba en Google**. Va DESPUÉS del
 *     paso 1 —invertidos, el paso 1 se lleva por delante lo que el 2 acaba de
 *     encolar— y ANTES del paso 3, porque la clave ajena valida en el `INSERT`.
 *  3. Borra la solicitud. La clave ajena, ya `ON DELETE SET NULL`, deja la fila
 *     del paso 2 viva con su `solicitud_id` a `null`.
 *
 * La condición del paso 2 es `estaEnElCalendario`, NO «hay `eventoCalendarioId`»:
 * cada fila del outbox es exactamente un correo, así que esa condición decide si
 * se avisa. Una aprobada anterior a la 026 no tiene id —su `calendario` irá a
 * `null` y el ⚠️ pedirá hacerlo a mano— pero sí hay que avisar de ella, que es
 * justo el caso donde nadie más va a darse cuenta.
 *
 * La transacción da que un fallo del payload no deje ni la solicitud borrada ni
 * el correo dicho. Lo que **no** da es cerrar ninguna ventana de carrera: `BEGIN`
 * pelado, READ COMMITTED, como el resto del fichero.
 *
 * ⚠️ **Aprobar y borrar dentro de los diez minutos es un caso decidido, no un
 * descuido.** El paso 1 se lleva el evento `aprobada` que todavía no se había
 * servido —el que iba a CREAR el evento en Google— y el paso 2 encola el borrado
 * de algo que Google nunca llegó a crear, así que contesta 404. Es uno de los
 * tres códigos que el IF «¿El fallo es esperable?» del workflow ya tolera a
 * propósito, así que sale ruido en el historial de n8n y nada más. La
 * alternativa —conservar el `aprobada` pendiente para que se cree y se borre en
 * orden— entregaría un correo anunciando la aprobación de una solicitud ya
 * borrada, que es peor. Ningún test lo cubre: haría falta Google de verdad.
 */
export async function borrarSolicitud(
  db: Pool,
  id: string,
  adminEmail: string,
  construirPayload: (borrada: Solicitud, adminEmail: string) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const previa = await solicitudPorId(client, id);
    if (previa === null) return null;

    // PASO 1. `enviado_at IS NULL` y no `servido_at IS NULL`: una fila que n8n ya
    // tiene en la mano pero no ha confirmado tambien muere aqui, igual que moria
    // con la cascada. n8n la procesara y su confirmacion no encontrara fila, que
    // es un no-op.
    await client.query(`DELETE FROM portal.ausencias_outbox WHERE solicitud_id = $1 AND enviado_at IS NULL`, [id]);

    // PASO 2.
    if (estaEnElCalendario(previa.estado)) {
      // Anotado y no un literal suelto: el valor viaja al CHECK de la 028, y una
      // errata compilaria y reventaria DENTRO de esta transaccion.
      const evento: EventoBorrado = 'borrado_admin';
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [id, evento, JSON.stringify(construirPayload(previa, adminEmail))],
      );
    }

    // PASO 3.
    await client.query('DELETE FROM portal.solicitudes_ausencia WHERE id = $1', [id]);
    return previa;
  });
}
```

Añadir a los imports de `repo.ts` desde `./types.js`, si no están: `estaEnElCalendario` y el tipo `EventoBorrado`.

- [ ] **Step 4: Cambiar el router**

En `apps/hub-api/src/ausencias/router.ts:425`:

```ts
      const borrada = await repo.borrarSolicitud(
        db,
        req.params.id,
        // Quien lo borro, para que el correo lo diga. El log de abajo ya lo
        // tenia; el aviso a administracion sin nombre vale mucho menos.
        sesionDe(req).email,
        construirPayloadBorrado,
      );
```

Y añadir `construirPayloadBorrado` al import que `router.ts` ya hace de `./notificaciones.js`.

Actualizar además el JSDoc de esa ruta: hoy dice que es irreversible y que queda constancia en el log. Sigue siendo cierto; hay que añadir que ahora encola el borrado del evento de Google y avisa a administración cuando la solicitud estaba allí.

- [ ] **Step 5: Arreglar el doble de `router.test.ts`**

Localízalo con `grep -n "borrarSolicitud" apps/hub-api/src/ausencias/router.test.ts`. El doble tiene que **aceptar los dos parámetros nuevos e ignorarlos**.

⚠️ **NO reimplementes ahí los tres pasos.** Ese fichero no tiene transacción ni clave ajena, así que no puede probarlos, y una reimplementación es lo que hizo que la regla de solapes pasara 531/531 con el SQL roto.

- [ ] **Step 6: Ejecutar los dos portones**

Run: `npm run test:db --workspace=apps/hub-api` → PASS, 56 tests (50 + los 6 nuevos).
Run: `npm run test --workspace=apps/hub-api` → PASS, 792 + los 7 de la tarea 3.

- [ ] **Step 7: FALSAR tres candados (obligatorio)**

a) **Invertir los pasos 1 y 2** (encolar antes de limpiar lo pendiente). Ejecuta `test:db`.
   Expected: FAIL en `CANDADO: el borrado del evento SOBREVIVE a la solicitud`, porque el paso 1 se lo lleva.

b) Restaura, y **quita el paso 1** entero. Ejecuta `test:db`.
   Expected: FAIL en `CANDADO: borrar se lleva los correos que seguian sin servirse`.

c) Restaura, y **cambia `estaEnElCalendario(previa.estado)` por `previa.eventoCalendarioId !== null`**. Ejecuta `test:db`.
   Expected: los tests siguen verdes. **Eso es esperado y hay que decirlo en el informe**: ningún test de este fichero distingue las dos condiciones, porque toda solicitud aprobada por la vía real tiene id. El caso que las separa —una aprobada anterior a la 026— lo cubre el candado `CANDADO: sin id no se borra nada` de `notificaciones.test.ts`, pero solo a nivel de payload, no de si se encola.

**Deshaz las tres** y vuelve a ejecutar: PASS. Pega las cuatro salidas.

- [ ] **Step 8: Cerrar el hueco que (c) destapa**

Añade a `repo.borrado.db.test.ts` el test que falta:

```ts
  // CANDADO. Separa `estaEnElCalendario` de «hay id». Una aprobada anterior a la
  // migracion 026 no tiene id, y su evento y su fila de la hoja siguen ahi: hay
  // que avisar aunque no se pueda borrar solo. Guardar el paso 2 detras del id
  // dejaria sin aviso justo el caso donde nadie mas va a darse cuenta.
  it('CANDADO: una aprobada SIN id encola el aviso igual, sin accion de calendario', async () => {
    const s = await aprobadaConEvento();
    // Se simula una fila anterior a la 026: aprobada y en Google, pero con un id
    // que nunca apuntamos.
    await db.query('UPDATE portal.solicitudes_ausencia SET evento_calendario_id = NULL WHERE id = $1', [s.id]);

    await borrar((await solicitudPorId(db, s.id))!);

    expect(await eventosDelOutbox(db)).toEqual(['borrado_admin']);
    const { rows } = await db.query('SELECT payload FROM portal.ausencias_outbox ORDER BY id DESC LIMIT 1');
    expect((rows[0] as { payload: { calendario: unknown } }).payload.calendario).toBeNull();
  });
```

Vuelve a hacer la mutación (c) y comprueba que **ahora sí** se pone rojo. Deshaz. Pega las dos salidas.

- [ ] **Step 9: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.borrado.db.test.ts
git commit -m "feat(ausencias): borrar una solicitud encola el borrado de su evento de Google" -- apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts apps/hub-api/src/ausencias/repo.borrado.db.test.ts
```

---

## Task 5: Documentación

**Files:**
- Modify: `docs/dev/app-ausencias.md`

- [ ] **Step 1: Buscar y arreglar lo que dejó de ser cierto**

⚠️ Es la mitad del valor de esta tarea. Busca con:

```bash
grep -n "borrar\|borrado\|papelera\|DELETE" docs/dev/app-ausencias.md
```

Cualquier pasaje que diga que el borrado no avisa a nadie o no toca Google **hay que reescribirlo**. Informa de cuáles encontraste y qué decían.

- [ ] **Step 2: Escribir la sección**

Añádela justo después de «Corregir desde el registro no deja Google desincronizado», titulada **«Borrar una solicitud limpia su calendario»**. Tiene que cubrir, en este orden:

1. Qué hace ahora el borrado y qué sigue sin hacer (no toca la hoja; sigue siendo irreversible y sin confirmación).
2. **Los tres pasos y por qué en ese orden**, con lo que se rompe al invertir 1 y 2.
3. **Que el paso 1 es lo que antes hacía la cascada**, ahora explícito, y por qué hubo que escribirlo.
4. **Que la clave ajena pasó a `ON DELETE SET NULL`** (migración 028), qué significa `solicitud_id IS NULL`, y por qué no rompe a n8n: `eventosPendientes` no hace `JOIN` y `/confirmado` confirma por el `id` del outbox.
5. **Que la condición del paso 2 es `estaEnElCalendario` y no «hay id»**, con el caso de las aprobadas anteriores a la 026.
6. El caso límite de aprobar y borrar dentro de los diez minutos, con el 404 tolerado.
7. **El riesgo aceptado**: el outbox deja de vaciarse solo y crece de forma monótona. Sin purga en esta feature; si algún día molesta, el criterio es `enviado_at` antiguo, no `solicitud_id IS NULL`.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(ausencias): el borrado limpia el calendario y el outbox admite huerfanos" -- docs/dev/app-ausencias.md
```

---

## Cierre

- [ ] **Step 1: Los cinco portones**

```bash
npm run build --workspace=apps/hub-api
npm run test --workspace=apps/hub-api
npm run test:db --workspace=apps/hub-api
npm run build --workspace=apps/ausencias
npm run build --workspace=apps/portal
```

- [ ] **Step 2: Revisar el diff entero**

```bash
git diff main...feat/borrado-limpia-calendario
```

Buscar: comentarios que prometan algo que el código no hace, condiciones duplicadas en vez de decididas una vez, y cualquier `!` cuya garantía viva en otra función.

- [ ] **Step 3: Mezclar**

```bash
git checkout main
git merge --no-ff feat/borrado-limpia-calendario
```

⚠️ **`git push` ES el despliegue.** EasyPanel construye y sirve al empujar a `origin/main`. Esta feature **no cambia n8n** y no tiene orden que respetar, pero conviene saber que a partir del push las 14 solicitudes de prueba pendientes de borrar mandarán un correo cada una que tenga estado `aprobada`.
