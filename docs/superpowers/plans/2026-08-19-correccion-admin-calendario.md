# Corregir el calendario desde el registro general — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `PATCH /ausencias/solicitudes/:id` corrija solo el evento del Google Calendar y avise a administración de lo que queda a mano, en vez de dejar el registro y Google contando historias distintas.

**Architecture:** Un evento nuevo del outbox, `correccion_admin`, emitido dentro de la transacción de `repo.actualizarSolicitud`. Tres predicados puros en `types.ts` deciden qué pasa: `estaEnElCalendario` (¿esta fila está en Google?), `cambiaElCalendario` y `cambiaLaHoja` (¿la corrección desajusta algo?). El payload lo construye `notificaciones.ts`, inyectado como parámetro para que `repo.ts` no dependa de él. n8n **no se toca**: ningún nodo lee el nombre del evento.

**Tech Stack:** TypeScript ESM (imports con `.js`), Express 4, SQL crudo con `$1` sobre PostgreSQL 17, Vitest 2.1.9. Sin ORM y sin zod.

**Spec:** `docs/superpowers/specs/2026-08-19-correccion-admin-calendario-design.md` — leerlo antes de empezar.

**Convenciones del repo que hay que respetar:**
- Código y comentarios **en español**. Los JSDoc de `repo.ts` y las migraciones llevan tildes; los comentarios dentro del SQL, no. Mimetiza cada sitio.
- Los comentarios explican **por qué**, no qué.
- Mensajes de commit en español **sin tildes**.
- **Nunca `git add -A`**: hay un `apps/WO-sales/prompts/` ajeno sin trackear. Commitear siempre con rutas explícitas.
- Los `.ts` del repo son **CRLF**; `router.ts` es LF. No reescribir ficheros enteros con otra terminación.
- Trabajar en la rama `feat/correccion-admin-calendario`, ya creada.

**Comandos de verificación:**
- Portón rápido: `npm run test --workspace=apps/hub-api`
- Cuarto portón (Postgres real, necesita Docker): `npm run test:db --workspace=apps/hub-api`
- Build: `npm run build --workspace=apps/hub-api`

---

## Estructura de ficheros

| Fichero | Qué hace en este plan |
|---|---|
| `apps/hub-api/src/users/migrations/027_ausencias_correccion_admin.sql` | **Crear.** Amplía el CHECK `outbox_evento_check` con el evento nuevo |
| `apps/hub-api/src/db.ts` | **Modificar.** Añadir la 027 al array `MIGRATIONS` |
| `apps/hub-api/src/ausencias/types.ts` | **Modificar.** Los tres predicados puros y el grupo `EVENTOS_CORRECCION` |
| `apps/hub-api/src/ausencias/notificaciones.ts` | **Modificar.** Borrar `tocaGoogle`, añadir el correo y `construirPayloadCorreccion` |
| `apps/hub-api/src/ausencias/repo.ts` | **Modificar.** `anotarEventoDeCalendario` vacía en `borrar`; `actualizarSolicitud` emite el evento |
| `apps/hub-api/src/ausencias/router.ts` | **Modificar.** Pasar el correo del admin y el constructor de payload |
| `apps/hub-api/src/ausencias/types.test.ts` | **Crear.** Tests de los tres predicados |
| `apps/hub-api/src/ausencias/notificaciones.test.ts` | **Modificar.** Tests del payload y de los cuatro textos del ⚠️ |
| `apps/hub-api/src/ausencias/repo.correccion-admin.db.test.ts` | **Crear.** Los candados, contra Postgres real |
| `apps/hub-api/src/ausencias/repo.evento-calendario.db.test.ts` | **Modificar.** El vaciado del id al borrar |
| `apps/hub-api/src/ausencias/router.test.ts` | **Modificar.** Ajustar el doble a la firma nueva |
| `docs/dev/app-ausencias.md` | **Modificar.** Sección nueva |

---

## Task 1: Migración 027 — el CHECK admite `correccion_admin`

**Files:**
- Create: `apps/hub-api/src/users/migrations/027_ausencias_correccion_admin.sql`
- Modify: `apps/hub-api/src/db.ts:24`

Va la primera porque **todas** las tareas siguientes que inserten en el outbox rebotarían contra el CHECK viejo, y ese rebote ocurre DENTRO de una transacción: el ROLLBACK se llevaría la corrección entera y el admin vería un 500.

- [ ] **Step 1: Escribir la migración**

Crear `apps/hub-api/src/users/migrations/027_ausencias_correccion_admin.sql`:

```sql
-- Migración 027: el CHECK de `evento` admite la corrección del registro general.
--
-- El evento `correccion_admin` lo emite `repo.actualizarSolicitud` cuando un
-- admin corrige desde *Registro general* una solicitud que ya estaba en Google.
-- Sin esta migración, ese INSERT rebota contra el CHECK DENTRO de la transacción
-- de la corrección, y el ROLLBACK se lleva también el UPDATE: el admin ve un 500
-- y su corrección no se guarda. Es exactamente lo que pasó con la 024/025.
--
-- El ANCHO no hace falta tocarlo, y se dice explícito porque esa fue la mitad
-- que se olvidó en la 024: la 025 dejó la columna en VARCHAR(40) y
-- `correccion_admin` mide 16. CHECK y ancho son dos restricciones distintas.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- La guarda mira el CONTENIDO del constraint, no su nombre, por lo mismo que
-- documenta la 024: el constraint ya existe con ese nombre desde la 018, así que
-- preguntar por el nombre daría siempre verdad y el bloque no se ejecutaría
-- nunca. Sería un no-op silencioso que solo se descubriría al reventar el primer
-- INSERT real, dentro de una transacción.
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.ausencias_outbox'::regclass
       AND conname  = 'outbox_evento_check'
       AND pg_get_constraintdef(oid) LIKE '%correccion_admin%'
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
                        'correccion_admin'));
  END IF;
END $$;
```

- [ ] **Step 2: Añadirla al array `MIGRATIONS`**

En `apps/hub-api/src/db.ts:24`, añadir `'027_ausencias_correccion_admin.sql'` al final del array, después de `'026_ausencias_evento_calendario.sql'`.

⚠️ Olvidar este paso **no da ningún error**: la migración simplemente no se aplica nunca, y el fallo aparece al primer INSERT real en producción.

- [ ] **Step 3: Verificar que aplica limpia y es idempotente**

Run: `npm run test:db --workspace=apps/hub-api`
Expected: PASS. El `globalSetup` (`src/test-db/contenedor.ts`) llama a `aplicarMigraciones` con **este mismo array**, así que si la 027 tiene un error de sintaxis, la suite entera falla en el arranque del contenedor.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/users/migrations/027_ausencias_correccion_admin.sql
git commit -m "feat(ausencias): el outbox admite el evento de correccion del registro" -- apps/hub-api/src/users/migrations/027_ausencias_correccion_admin.sql apps/hub-api/src/db.ts
```

---

## Task 2: Los tres predicados puros

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts` (junto a `requiereAprobacion`, sobre la línea 67)
- Modify: `apps/hub-api/src/ausencias/repo.ts` (el JSDoc de `ocupaAgenda`, línea 1943)
- Test: `apps/hub-api/src/ausencias/types.test.ts` (crear)

Van en `types.ts` y no en `repo.ts` junto a `ocupaAgenda` por una razón dura: los usan **`repo.ts` y `notificaciones.ts`**, y `repo.ts` no puede importar `notificaciones.ts` — la inyección de `construirPayload` como parámetro existe justo para evitar esa dependencia.

> **Enmienda del 2026-08-19, tras la revisión de calidad.** El bloque de tests de
> abajo se quedó corto: no cubría que **la hoja tiene dos formas**. Hay que
> añadirle además estos cuatro casos, y el `cambiaLaHoja` de más abajo ya lleva la
> corrección:
>
> 1. En una incapacidad `registrada`, corregir solo los comentarios → `false`
>    (esa pestaña no tiene columna «Comentarios»).
> 2. En una no-incapacidad, `aprobada → registrada` → `cambiaLaHoja` `true` y
>    `cambiaElCalendario` `false`. Es el par que separa a los dos predicados.
> 3. Una línea base de `cambiaLaHoja` sin ningún cambio → `false`.
> 4. El test «una incapacidad registrada SÍ está en el calendario» era un
>    duplicado exacto de la aserción de tres líneas más arriba y no podía fallar
>    solo: hay que bajarlo a `cambiaElCalendario` con una `previa` de tipo
>    incapacidad, o borrarlo.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/hub-api/src/ausencias/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { estaEnElCalendario, cambiaElCalendario, cambiaLaHoja, type Solicitud } from './types.js';

function solicitud(over: Partial<Solicitud> = {}): Solicitud {
  return {
    id: 's1',
    tipo: 'vacaciones',
    empleadoId: 'e1',
    empleadoNombre: 'Ana Ruiz',
    empleadoCargo: 'Analista',
    solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    diasHabiles: 5,
    comentarios: 'Viaje familiar',
    observaciones: null,
    origen: 'portal',
    estado: 'aprobada',
    aprobadorCorreo: 'comercial@ambientalia.com.co',
    segundoAprobadorCorreo: null,
    informadoCorreo: null,
    primeraFirmaAt: null,
    decididaAt: null,
    motivoRechazo: null,
    createdAt: '2026-06-01T10:00:00Z',
    adjunto: null,
    copiaCorreo: 'administrativo@ambientalia.com.co',
    modificacionPendiente: null,
    anuladaAt: null,
    eventoCalendarioId: null,
    ...over,
  };
}

describe('estaEnElCalendario', () => {
  it('los dos estados que dejan un evento en Google', () => {
    expect(estaEnElCalendario('aprobada')).toBe(true);
    expect(estaEnElCalendario('registrada')).toBe(true);
  });

  it('los tres que no', () => {
    expect(estaEnElCalendario('pendiente')).toBe(false);
    expect(estaEnElCalendario('pendiente_2')).toBe(false);
    expect(estaEnElCalendario('rechazada')).toBe(false);
  });

  // CANDADO. `ocupaAgenda` excluye las incapacidades porque contesta a la regla
  // de solapamiento; esta las incluye porque contesta a que hay en Google. Si
  // alguien "unifica" las dos, este test cae.
  it('CANDADO: una incapacidad registrada SI esta en el calendario', () => {
    expect(estaEnElCalendario('registrada')).toBe(true);
  });
});

describe('cambiaElCalendario', () => {
  const previa = solicitud();

  it('las fechas', () => {
    expect(cambiaElCalendario(previa, solicitud({ fechaInicio: '2026-07-07' }))).toBe(true);
    expect(cambiaElCalendario(previa, solicitud({ fechaFin: '2026-07-13' }))).toBe(true);
  });

  it('el resumen: tipo y empleado', () => {
    expect(cambiaElCalendario(previa, solicitud({ tipo: 'permiso' }))).toBe(true);
    expect(cambiaElCalendario(previa, solicitud({ empleadoId: 'e2' }))).toBe(true);
  });

  it('la presencia: salir del calendario cuenta', () => {
    expect(cambiaElCalendario(previa, solicitud({ estado: 'rechazada' }))).toBe(true);
  });

  // CANDADO. Es el caso mas corriente del historico importado, donde el Excel
  // anoto recuentos que no cuadran. Sin este `false`, corregirlo manda a Google
  // un update identico y un correo diciendo que se corrigio algo.
  it('CANDADO: los dias NO cambian el evento de Google', () => {
    expect(cambiaElCalendario(previa, solicitud({ diasHabiles: 4 }))).toBe(false);
  });

  it('CANDADO: los comentarios y las observaciones tampoco', () => {
    expect(cambiaElCalendario(previa, solicitud({ comentarios: 'otro' }))).toBe(false);
    expect(cambiaElCalendario(previa, solicitud({ observaciones: 'nota' }))).toBe(false);
  });

  it('una correccion que no toca nada de Google', () => {
    expect(cambiaElCalendario(previa, solicitud())).toBe(false);
  });
});

describe('cambiaLaHoja', () => {
  const previa = solicitud();

  it('los dias y los comentarios SI, que la hoja los enseña', () => {
    expect(cambiaLaHoja(previa, solicitud({ diasHabiles: 4 }))).toBe(true);
    expect(cambiaLaHoja(previa, solicitud({ comentarios: 'otro' }))).toBe(true);
  });

  it('las observaciones no: son una nota interna que no viaja a ningun sitio', () => {
    expect(cambiaLaHoja(previa, solicitud({ observaciones: 'nota' }))).toBe(false);
  });

  // CANDADO ESTRUCTURAL. `cambiaLaHoja` es el porton unico de "hay algo que
  // ajustar": si dejara de contener a `cambiaElCalendario`, habria correcciones
  // de calendario que no se emitirian nunca.
  it('CANDADO: contiene a cambiaElCalendario en los cinco campos', () => {
    const cambios: Partial<Solicitud>[] = [
      { fechaInicio: '2026-07-07' },
      { fechaFin: '2026-07-13' },
      { tipo: 'permiso' },
      { empleadoId: 'e2' },
      { estado: 'rechazada' },
    ];
    for (const c of cambios) {
      const actual = solicitud(c);
      expect(cambiaElCalendario(previa, actual)).toBe(true);
      expect(cambiaLaHoja(previa, actual)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test --workspace=apps/hub-api -- types.test.ts`
Expected: FAIL con `estaEnElCalendario is not exported` (o el equivalente de vitest para un import que no existe).

- [ ] **Step 3: Escribir los predicados**

En `apps/hub-api/src/ausencias/types.ts`, justo debajo de `requiereAprobacion` (línea 69):

```ts
/**
 * Si una fila con este estado tiene un evento en el calendario de Google.
 *
 * ⚠️ **NO es `ocupaAgenda`** (`repo.ts`), aunque las dos digan «sí» sobre casi
 * las mismas filas. `ocupaAgenda` contesta a la regla de solapamiento y
 * **excluye las incapacidades**; esta contesta a qué hay en Google, y una
 * incapacidad `registrada` **sí** tiene evento —`construirPayload` le da
 * `calendario` y `hoja`—. Son dos preguntas distintas sobre la misma fila, y
 * contestar una con la otra es la forma exacta que tuvo el bug de la cuarta
 * puerta del solapamiento. La advertencia va repetida en `ocupaAgenda` porque
 * las dos funciones no son vecinas: nadie las va a ver juntas por casualidad.
 *
 * Va por ESTADO y no por tipo porque el estado es lo que la fila conserva:
 * `aprobada` y `registrada` son justo los dos estados que dejan los dos únicos
 * eventos que emiten una acción `crear`.
 *
 * `registrada` está aquí desde el 2026-08-19 y ya no es una rama muerta. Antes
 * esta pregunta la hacía `tocaGoogle` en `notificaciones.ts`, que lo excluía a
 * propósito: por el flujo de modificaciones es inalcanzable
 * (`estadoAdmiteModificacion` lo impide), así que contemplarlo habría hecho
 * creer que el caso estaba cubierto. **El `PATCH` del registro general sí lo
 * alcanza** —admite cualquier tipo con cualquier estado—, y una incapacidad
 * editada por un admin tiene evento en Google. Para el flujo de modificaciones
 * el comportamiento no cambia: allí `registrada` sigue sin poder darse.
 */
export function estaEnElCalendario(estado: EstadoSolicitud): boolean {
  return estado === 'aprobada' || estado === 'registrada';
}

/**
 * Si una corrección cambia algo que el EVENTO del calendario enseña.
 *
 * El evento solo enseña tres cosas: que existe, sus fechas y su `resumen`
 * —`${ETIQUETA_TIPO[tipo]} ${empleadoNombre}`, ver `calendario()` en
 * `notificaciones.ts`—. Por eso `dias`, `comentarios` y `observaciones` quedan
 * fuera, y no por descuido: corregir el recuento de días de una aprobada —el
 * caso más corriente del histórico importado, donde el Excel anotó recuentos
 * que no cuadran— mandaría a Google un `actualizar` idéntico al evento que ya
 * hay, y con él un correo diciendo que algo se corrigió solo. Un ⚠️ que avisa
 * de lo que no ha pasado es cómo se enseña a la gente a no leerlos.
 *
 * El empleado va por `empleadoId` y no por `empleadoNombre`: el nombre es un
 * campo desnormalizado que viene del JOIN, y reasignar la solicitud a otra
 * persona es justo lo que hay que detectar.
 */
export function cambiaElCalendario(previa: Solicitud, actual: Solicitud): boolean {
  return (
    estaEnElCalendario(previa.estado) !== estaEnElCalendario(actual.estado) ||
    previa.fechaInicio !== actual.fechaInicio ||
    previa.fechaFin !== actual.fechaFin ||
    previa.tipo !== actual.tipo ||
    previa.empleadoId !== actual.empleadoId
  );
}

/**
 * Si una corrección cambia algo que la FILA DE LA HOJA enseña.
 *
 * ⚠️ La hoja tiene DOS formas, no una —ver `hoja()` en `notificaciones.ts`—: la
 * pestaña de incapacidades lleva «Adjunto?» y NO tiene «Comentarios» ni
 * «¿Aprobado?»; las otras tres es al revés. Por eso este predicado mira el tipo.
 *
 * Solo `observaciones` queda fuera de los dos predicados: es una nota interna
 * que no viaja a ningún sitio.
 *
 * ⚠️ **Esta función CONTIENE a `cambiaElCalendario`**, y de eso depende que no
 * se pierda ninguna corrección: es el portón único de «hay algo que ajustar»
 * —cuando `actualizarSolicitud` lo consuma, no emitirá nada si devuelve
 * `false`—, así que si dejara de contenerla habría acciones de calendario que no
 * se emitirían nunca. Lo garantiza la delegación de la primera línea, no una
 * lista de campos que haya que revisar a mano.
 */
export function cambiaLaHoja(previa: Solicitud, actual: Solicitud): boolean {
  if (cambiaElCalendario(previa, actual) || previa.diasHabiles !== actual.diasHabiles) return true;
  // Las otras dos columnas solo existen en las pestañas que NO son de
  // incapacidad, y el adjunto —lo único propio de la suya— no se puede corregir
  // desde el registro (`validarEdicionSolicitud` no lo admite), así que ahí no
  // queda nada más que mirar. Basta el tipo de la fila corregida: si el tipo
  // CAMBIÓ, `cambiaElCalendario` ya ha dicho que sí más arriba.
  if (actual.tipo === 'incapacidad') return false;
  // El estado ENTERO y no `estaEnElCalendario`: la celda «¿Aprobado?» tiene TRES
  // valores («Sí», «No» y vacío) y aquel predicado solo distingue dos, así que
  // `aprobada → registrada` cambiaría la celda sin que nadie lo viera.
  return previa.comentarios !== actual.comentarios || previa.estado !== actual.estado;
}
```

⚠️ `estaEnElCalendario` usa `EstadoSolicitud` y `cambiaElCalendario` usa `Solicitud`; las dos interfaces se declaran **más abajo** en `types.ts`. En TypeScript eso da igual para tipos, pero el orden de lectura sí importa: si molesta, poner el bloque después de la interfaz `Solicitud` en vez de junto a `requiereAprobacion`.

- [ ] **Step 4: Añadir el aviso cruzado en `ocupaAgenda`**

En `apps/hub-api/src/ausencias/repo.ts`, en el JSDoc de `ocupaAgenda` (línea 1943), añadir al final:

```
 * ⚠️ NO confundir con `estaEnElCalendario` (`types.ts`). Esta pregunta si la fila
 * RESERVA días —y por eso excluye las incapacidades, que se informan y no se
 * conceden—; aquella pregunta si la fila tiene evento en Google, y ahí las
 * incapacidades SÍ cuentan. Casi las mismas filas, dos respuestas distintas.
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm run test --workspace=apps/hub-api -- types.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Falsar el candado de los días**

Cambiar temporalmente `cambiaElCalendario` para que compare también `previa.diasHabiles !== actual.diasHabiles`. Ejecutar los tests.
Expected: FAIL en `CANDADO: los dias NO cambian el evento de Google`.
**Deshacer el cambio** y volver a ejecutar: PASS.

Si el test NO se pone rojo, el candado no vale y hay que arreglarlo antes de seguir.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/ausencias/types.test.ts
git commit -m "feat(ausencias): tres predicados dicen que hay en Google y que desajusta una correccion" -- apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/types.test.ts
```

---

## Task 3: `tocaGoogle` desaparece dentro de `estaEnElCalendario`

**Files:**
- Modify: `apps/hub-api/src/ausencias/notificaciones.ts:437` (borrar `tocaGoogle`), y sus tres usos
- Test: `apps/hub-api/src/ausencias/notificaciones.test.ts` (los que ya hay tienen que seguir verdes)

`tocaGoogle(estadoPrevio)` pregunta «¿esta fila estaba en Google?» y `estaEnElCalendario(estado)` pregunta «¿una fila con este estado está en Google?». Una vez ensanchado el primero, **son la misma función**. Dejar las dos es reintroducir a mano la duplicación que costó el bug de `ocupaAgenda`.

- [ ] **Step 1: Borrar `tocaGoogle` y sustituir sus usos**

En `apps/hub-api/src/ausencias/notificaciones.ts`:

1. Borrar la constante `tocaGoogle` y su JSDoc completo (la explicación de por qué `registrada` no estaba ya vive en `estaEnElCalendario`).
2. Añadir `estaEnElCalendario` al import de `./types.js`.
3. Sustituir los tres usos, que son:
   - `correccionDeCalendario`: `if (!tocaGoogle(m.estadoPrevio) || ...)` → `if (!estaEnElCalendario(m.estadoPrevio) || ...)`
   - `prefijoDeAsunto`: `if (!tocaGoogle(m.estadoPrevio)) return '';` → `if (!estaEnElCalendario(m.estadoPrevio)) return '';`
   - `correoModificacionAprobada`: `...siHay(tocaGoogle(m.estadoPrevio), avisoDeAjustarGoogle(s, m))` → `...siHay(estaEnElCalendario(m.estadoPrevio), avisoDeAjustarGoogle(s, m))`

Localizar los usos con:

```bash
grep -n "tocaGoogle" apps/hub-api/src/ausencias/notificaciones.ts
```

- [ ] **Step 2: Verificar que el flujo de modificaciones no cambia**

Run: `npm run test --workspace=apps/hub-api -- notificaciones.test.ts`
Expected: PASS sin tocar ningún test. `registrada` sigue siendo inalcanzable como `estadoPrevio` de una modificación, así que el ensanche no cambia ni un texto.

Si algún test se pone rojo, **parar**: significa que había un `estadoPrevio: 'registrada'` en algún fixture, y eso es un fixture imposible que hay que mirar antes de seguir.

- [ ] **Step 3: Portón rápido entero**

Run: `npm run test --workspace=apps/hub-api`
Expected: PASS, 768 tests o más.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(ausencias): tocaGoogle era estaEnElCalendario preguntado sobre el estado previo" -- apps/hub-api/src/ausencias/notificaciones.ts
```

---

## Task 4: El evento `correccion_admin` en el tipo

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts:62` (junto a `EVENTOS_MODIFICACION`)

Grupo propio y no un valor más en `EVENTOS_SOLICITUD`, por la misma razón que `EVENTOS_MODIFICACION` está aparte: su constructor de payload necesita la foto del **antes**, que los de solicitud no tienen.

- [ ] **Step 1: Añadir el grupo**

En `apps/hub-api/src/ausencias/types.ts`, justo antes de la línea que declara `EVENTOS`:

```ts
/**
 * La corrección de una solicitud desde *Registro general*.
 *
 * Grupo propio y no un `EVENTO_SOLICITUD` más, por lo mismo que los de
 * modificación: su payload se construye a partir de DOS solicitudes —la de antes
 * y la de después—, y los constructores de eventos de solicitud solo reciben
 * una. Uno solo por ahora; si aparece un segundo, se añade aquí.
 */
export const EVENTOS_CORRECCION = ['correccion_admin'] as const;
export type EventoCorreccion = (typeof EVENTOS_CORRECCION)[number];
```

Y cambiar la declaración de `EVENTOS`:

```ts
export const EVENTOS = [...EVENTOS_SOLICITUD, ...EVENTOS_MODIFICACION, ...EVENTOS_CORRECCION] as const;
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build --workspace=apps/hub-api`
Expected: PASS sin errores.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ausencias): el tipo del outbox conoce la correccion del registro" -- apps/hub-api/src/ausencias/types.ts
```

---

## Task 5: El correo y el payload de la corrección

**Files:**
- Modify: `apps/hub-api/src/ausencias/notificaciones.ts` (al final, después de `construirPayloadModificacion`)
- Test: `apps/hub-api/src/ausencias/notificaciones.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `apps/hub-api/src/ausencias/notificaciones.test.ts`. Reutiliza el helper `solicitud()` que ya existe en ese fichero, y añade `construirPayloadCorreccion` al import de `./notificaciones.js`:

```ts
describe('el payload de una correccion del registro', () => {
  const ADMIN = 'comercial@ambientalia.com.co';
  const EVENT_ID = '2993c29668a94bf38708574110cde669';

  const aprobadaConEvento = (over: Partial<Solicitud> = {}) =>
    solicitud({ estado: 'aprobada', eventoCalendarioId: EVENT_ID, ...over });

  it('mueve el evento cuando cambian las fechas', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ fechaInicio: '2026-07-13', fechaFin: '2026-07-17' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.calendario).toMatchObject({
      calendarId: CALENDARIO_STAFF,
      eventId: EVENT_ID,
      accion: 'actualizar',
      inicio: '2026-07-13',
      // Fin EXCLUSIVO: Google no pinta el ultimo dia si no se le suma uno.
      fin: '2026-07-18',
    });
    expect(p.correo.asunto).toContain('⚠️ Ajustar la hoja —');
    expect(p.correo.cuerpo).toContain('ya se ha corregido solo');
  });

  it('borra el evento cuando la solicitud sale del calendario', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ estado: 'rechazada' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.calendario).toMatchObject({ eventId: EVENT_ID, accion: 'borrar' });
    expect(p.correo.cuerpo).toContain('ya se ha borrado solo');
  });

  // CANDADO. Sin el, corregir el recuento de dias manda a Google un update
  // identico al evento que ya hay y un correo diciendo que se corrigio algo.
  it('CANDADO: corregir solo los dias no toca el calendario, pero si avisa de la hoja', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ diasHabiles: 4 });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.calendario).toBeNull();
    expect(p.correo.asunto).toContain('⚠️ Ajustar la hoja —');
    expect(p.correo.cuerpo).toContain('el evento del calendario no cambia');
    expect(p.correo.cuerpo).not.toContain('se ha corregido solo');
  });

  // CANDADO. Las aprobadas ANTERIORES a la migracion 026 llevan en Google un id
  // que invento Google y que nadie apunto: existen, pero no se pueden localizar.
  it('CANDADO: sin id no se corrige nada y el aviso pide las dos cosas a mano', () => {
    const previa = solicitud({ estado: 'aprobada', eventoCalendarioId: null });
    const actual = solicitud({ estado: 'aprobada', eventoCalendarioId: null, fechaInicio: '2026-07-13' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.calendario).toBeNull();
    expect(p.correo.asunto).toContain('⚠️ Ajustar calendario y hoja —');
  });

  it('la hoja va a null SIEMPRE: n8n hace append y a esa fila no se puede volver', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ fechaInicio: '2026-07-13' });
    expect(construirPayloadCorreccion(previa, actual, ADMIN).hoja).toBeNull();
  });

  it('el correo va a la copia de la ficha y nombra al admin que lo hizo', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ fechaInicio: '2026-07-13' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.correo.para).toBe('administrativo@ambientalia.com.co');
    expect(p.correo.cuerpo).toContain(ADMIN);
  });

  // CANDADO. Este es el UNICO correo de la app con una sola fuente de
  // destinatario: en los demas la cadena de firmas rellena la lista. Un `para`
  // vacio no degrada el aviso, deja una fila del outbox que Gmail rechaza y n8n
  // reintenta cada diez minutos para siempre.
  it('CANDADO: una ficha sin copia cae en el valor por defecto, nunca en vacio', () => {
    const previa = aprobadaConEvento({ copiaCorreo: null });
    const actual = aprobadaConEvento({ copiaCorreo: null, fechaInicio: '2026-07-13' });
    const p = construirPayloadCorreccion(previa, actual, ADMIN);

    expect(p.correo.para).toBe(COPIA_POR_DEFECTO);
    expect(p.correo.para).not.toBe('');
  });

  it('el cuerpo enseña el antes y el despues, con estado y recuento', () => {
    const previa = aprobadaConEvento();
    const actual = aprobadaConEvento({ estado: 'rechazada' });
    const cuerpo = construirPayloadCorreccion(previa, actual, ADMIN).correo.cuerpo;

    expect(cuerpo).toContain('2026-07-06 a 2026-07-10');
    expect(cuerpo).toContain('aprobada');
    expect(cuerpo).toContain('rechazada');
  });
});
```

Añadir `COPIA_POR_DEFECTO` al import de `./config.js` en ese fichero.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test --workspace=apps/hub-api -- notificaciones.test.ts`
Expected: FAIL con `construirPayloadCorreccion is not exported`.

- [ ] **Step 3: Escribir el correo y el payload**

Al final de `apps/hub-api/src/ausencias/notificaciones.ts`, antes de `eventosDeAlta`:

```ts
// ── La corrección de una solicitud desde Registro general ──────────────────

/**
 * Cómo se llama cada estado en un correo.
 *
 * Hace falta porque la corrección más corriente —marcar `rechazada` una fila que
 * el registro daba por aprobada— **no mueve las fechas**: sin el estado, el
 * bloque de antes y después saldría con las dos líneas idénticas.
 */
const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  pendiente: 'pendiente de firma',
  pendiente_2: 'pendiente de la segunda firma',
  aprobada: 'aprobada',
  rechazada: 'rechazada',
  registrada: 'registrada',
};

/** Una de las dos fotos del bloque «antes / ahora». */
const fotoDe = (s: Solicitud): string =>
  `${s.fechaInicio} a ${s.fechaFin} (${dias(s.diasHabiles)}) — ${ETIQUETA_ESTADO[s.estado]}`;

/**
 * Qué hacerle al evento del calendario tras una corrección, o `null`.
 *
 * Los dos `null` no son el mismo y conviene no confundirlos:
 *  - **Sin `eventoCalendarioId`**: la solicitud se aprobó ANTES de que
 *    empezáramos a imponer el id, así que su evento existe pero no se puede
 *    localizar. Esas siguen con el aviso manual y se vacían solas.
 *  - **Sin cambio de calendario**: el evento ya dice lo que tiene que decir. Un
 *    `actualizar` idéntico sería un viaje a Google para nada, y sobre todo haría
 *    que el correo dijera que se corrigió algo que nadie tocó.
 *
 * Es la ÚNICA fuente de esta decisión: el texto del correo pregunta por aquí y
 * el payload se construye desde aquí, así que lo que lee administración y lo que
 * n8n hace de verdad no pueden discrepar.
 */
function correccionDelRegistro(previa: Solicitud, actual: Solicitud): EventoCalendario | null {
  if (previa.eventoCalendarioId === null || !cambiaElCalendario(previa, actual)) return null;
  return {
    // Las fechas salen de la solicitud YA corregida: en un `actualizar` son las
    // nuevas, y en un `borrar` describen el evento justo antes de desaparecer.
    ...calendario(actual),
    // El id GUARDADO, no el derivado: son el mismo valor hoy, pero el guardado es
    // el que prueba que ese evento lo creamos nosotros.
    eventId: previa.eventoCalendarioId,
    accion: estaEnElCalendario(actual.estado) ? 'actualizar' : 'borrar',
  };
}

/**
 * El párrafo de qué queda por hacer a mano. Cuatro textos, no dos.
 *
 * `avisoDeAjustarGoogle` —el de las modificaciones— contempla dos situaciones, y
 * aquí hay una tercera que allí no existe: **que el calendario no necesite
 * nada**. Un cambio de días o de comentarios desajusta la hoja y deja el evento
 * exactamente como estaba. Decir ahí «el evento ya se ha corregido solo» sería
 * falso, y callarse lo de la hoja dejaría la corrección a medias.
 *
 * Se nombra a quien tiene que actuar («Administración:») por lo mismo que en el
 * otro aviso: sin eso, el párrafo se lee como una tarea de nadie.
 */
function avisoDeLaCorreccion(previa: Solicitud, actual: Solicitud): string {
  if (!cambiaElCalendario(previa, actual)) {
    return '⚠️ Administración: el evento del calendario no cambia con esta corrección. La fila de la hoja sí: hay que ajustarla a mano.';
  }
  if (previa.eventoCalendarioId === null) {
    return '⚠️ Administración: esta ausencia ya estaba en el calendario y en la hoja, y NO se corrigen solas: hay que ajustar a mano el evento del calendario y la fila de la hoja.';
  }
  return estaEnElCalendario(actual.estado)
    ? '⚠️ Administración: el evento del calendario ya se ha corregido solo. La fila de la hoja no: hay que ajustarla a mano a lo nuevo.'
    : '⚠️ Administración: el evento del calendario ya se ha borrado solo. La fila de la hoja no: hay que ajustarla a mano.';
}

/**
 * El prefijo del asunto. Solo distingue si queda calendario por tocar a mano:
 * la hoja siempre queda, así que nombrarla no aporta nada al asunto.
 */
const prefijoDeLaCorreccion = (previa: Solicitud, actual: Solicitud): string =>
  cambiaElCalendario(previa, actual) && previa.eventoCalendarioId === null
    ? '⚠️ Ajustar calendario y hoja — '
    : '⚠️ Ajustar la hoja — ';

/**
 * El aviso de que un admin corrigió el registro.
 *
 * Va SOLO a la copia de la ficha —administración—, y no a la cadena de decisión.
 * Es deliberado: el `PATCH` es la vía de corregir el registro, y avisar al dueño
 * de cada errata corregida es justo lo que evita la decisión escrita en
 * `repo.actualizarSolicitud`. Lo que sí cambia respecto a ella es el calendario,
 * que es un artefacto derivado y no una notificación.
 *
 * ⚠️ El `??` NO es paranoia. Este es el único correo de la app con una sola
 * fuente de destinatario: en todos los demás la cadena de firmas rellena la
 * lista. `copiaCorreo` es nulable y `destinatarios` salta los nulos, así que una
 * ficha con la copia vaciada desde el Organigrama daría un `sendTo` vacío — que
 * no es un aviso degradado, es una fila del outbox que Gmail rechaza y n8n
 * reintenta cada diez minutos para siempre.
 */
function correoCorreccion(previa: Solicitud, actual: Solicitud, adminEmail: string): CorreoEvento {
  return {
    para: destinatarios(actual.copiaCorreo ?? COPIA_POR_DEFECTO),
    asunto: `${prefijoDeLaCorreccion(previa, actual)}Corregida en el registro: solicitud ${PERIODO[actual.tipo]} de ${actual.empleadoNombre}`,
    cuerpo: [
      '¡Hola!',
      '',
      `${adminEmail} ha corregido desde *Registro general* una solicitud ${PERIODO[actual.tipo]} de ${actual.empleadoNombre} que ya estaba en el calendario y en la hoja.`,
      '',
      `📅 Antes: ${fotoDe(previa)}`,
      `📅 Ahora: ${fotoDe(actual)}`,
      '',
      avisoDeLaCorreccion(previa, actual),
      '',
      'Saludos,',
      FIRMA_GERENCIA,
    ].join('\n'),
  };
}

/**
 * El payload de una corrección del registro.
 *
 * `hoja` va a `null` SIEMPRE, por lo mismo que en las modificaciones: n8n hace
 * `append` y no queda constancia de en qué fila cayó, así que a esa fila no se
 * puede volver. Por eso el ⚠️ la nombra en los cuatro textos.
 *
 * Sin parámetro `evento`, al contrario que `construirPayloadModificacion`: allí
 * hay tres textos entre los que elegir y aquí uno solo.
 */
export function construirPayloadCorreccion(
  previa: Solicitud,
  actual: Solicitud,
  adminEmail: string,
): PayloadEvento {
  return {
    tipo: actual.tipo,
    tipoEtiqueta: ETIQUETA_TIPO[actual.tipo],
    estado: actual.estado,
    empleadoNombre: actual.empleadoNombre,
    correo: correoCorreccion(previa, actual, adminEmail),
    calendario: correccionDelRegistro(previa, actual),
    hoja: null,
  };
}
```

Añadir a los imports de `notificaciones.ts`:
- de `./config.js`: `COPIA_POR_DEFECTO`
- de `./types.js`: `cambiaElCalendario`, `estaEnElCalendario`

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test --workspace=apps/hub-api -- notificaciones.test.ts`
Expected: PASS.

- [ ] **Step 5: Falsar el candado del destinatario**

Cambiar temporalmente `actual.copiaCorreo ?? COPIA_POR_DEFECTO` por `actual.copiaCorreo`. Ejecutar.
Expected: FAIL en `CANDADO: una ficha sin copia cae en el valor por defecto`.
**Deshacer** y volver a ejecutar: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ausencias): el correo de una correccion dice que se arreglo solo y que queda a mano" -- apps/hub-api/src/ausencias/notificaciones.ts apps/hub-api/src/ausencias/notificaciones.test.ts
```

---

## Task 6: La columna deja de mentir tras un `borrar`

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts:958` (`anotarEventoDeCalendario`) y `repo.ts:1604` (`decidirModificacion`)
- Test: `apps/hub-api/src/ausencias/repo.evento-calendario.db.test.ts`

Hoy `evento_calendario_id` no se vacía nunca: tras una anulación apunta a un evento que Google ya borró. **Eso pasa en producción ahora mismo.** Sin arreglarlo, devolver esa fila a `aprobada` desde el registro emitiría un `actualizar` contra un evento inexistente, y el IF «¿El fallo es esperable?» de n8n se lo tragaría como 404: nadie sabría que el evento no volvió.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `apps/hub-api/src/ausencias/repo.evento-calendario.db.test.ts`, dentro del `describe` que ya existe:

```ts
  // CANDADO. La columna significa "hay un evento vivo en Google", no "impusimos
  // un id alguna vez". Sin el vaciado, una fila anulada conserva el id de un
  // evento borrado, y la siguiente correccion mandaria un `actualizar` contra
  // algo que no existe: n8n lo tragaria como 404 esperable, en silencio.
  it('CANDADO: anular vacia el id, porque el evento ya no existe en Google', async () => {
    const s = await sembrarCaso('pendiente');
    const aprobada = await aprobar(s);
    expect(await idEnLaBase(s.id)).toBe(idDeEventoCalendario(s.id));

    await anularPorModificacion(aprobada!);

    expect(await idEnLaBase(s.id)).toBeNull();
  });
```

Y el helper, junto a los otros del fichero. Usa las funciones reales del repo, no INSERTs a mano:

```ts
/** Pide una anulacion y la aprueba, que es como se borra un evento de verdad. */
async function anularPorModificacion(s: Solicitud): Promise<void> {
  const alta = await crearModificacion(
    db,
    {
      solicitudId: s.id,
      clase: 'anulacion',
      // El testigo compara con el estado REAL de la fila; una `aprobada` recien
      // decidida lo cumple.
      estadoEsperado: s.estado,
      // Los tres a null los EXIGE el CHECK `modificaciones_campos_por_clase` de
      // la 024 para una anulacion.
      fechaInicioNueva: null,
      fechaFinNueva: null,
      diasHabilesNuevos: null,
      motivo: 'ya no las necesito',
      aprobadorCorreo: 'jefe1@ambientalia.com.co',
    },
    construirPayloadModificacion,
  );
  if (!alta.ok) throw new Error(`el alta de la propuesta deberia haber funcionado, y dio ${alta.razon}`);

  const decidida = await decidirModificacion(db, alta.modificacion.id, true, null, null, construirPayloadModificacion);
  if (!decidida.ok) throw new Error(`la decision deberia haber funcionado, y dio ${decidida.razon}`);
}
```

⚠️ `construirPayloadModificacion` y no el `payloadStub` del harness, aunque los tests de `repo.solapes.db.test.ts` usen el stub: aquí lo que se prueba es que la marca se vacía **a partir de la acción del payload**, y un stub sin `calendario` haría que `anotarEventoDeCalendario` volviera de vacío. El test pasaría por la razón equivocada.

Añadir a los imports del fichero: `crearModificacion` y `decidirModificacion` de `./repo.js`, y `construirPayloadModificacion` de `./notificaciones.js`.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test:db --workspace=apps/hub-api -- repo.evento-calendario.db.test.ts`
Expected: FAIL — `expected '2993c296…' to be null`. Ese es el bug que existe hoy en producción, reproducido.

- [ ] **Step 3: Extender `anotarEventoDeCalendario`**

En `apps/hub-api/src/ausencias/repo.ts`, sustituir el cuerpo de `anotarEventoDeCalendario`:

```ts
async function anotarEventoDeCalendario(
  client: PoolClient,
  solicitud: Solicitud,
  payload: PayloadEvento,
): Promise<void> {
  // La condicion se lee del PAYLOAD, no de una lista de eventos copiada aqui:
  // asi la marca se escribe exactamente cuando se emite la accion, y no puede
  // desincronizarse de construirPayload el dia que cambie el reparto de efectos.
  const cal = payload.calendario;
  if (cal?.accion !== 'crear' && cal?.accion !== 'borrar') return;
  // `borrar` la VACIA: la columna dice si hay evento vivo en Google, no si
  // alguna vez impusimos un id. Dejarla puesta tras un borrado hace que la
  // siguiente correccion mande un `actualizar` contra un evento que no existe,
  // y el IF de fallos esperables de n8n se lo traga como 404: en silencio.
  const id = cal.accion === 'crear' ? cal.eventId : null;
  await client.query(`UPDATE portal.solicitudes_ausencia SET evento_calendario_id = $2 WHERE id = $1`, [
    solicitud.id,
    id,
  ]);
  // La fila se leyo con SELECT_SOLICITUD ANTES de este UPDATE, asi que el objeto
  // que se devuelve llevaria un valor que dejo de ser cierto hace dos lineas. Y
  // este campo decide si Google se corrige solo: devolverlo obsoleto es
  // exactamente la clase de texto caducado que mas cara sale en esta app.
  solicitud.eventoCalendarioId = id;
}
```

- [ ] **Step 4: Que `decidirModificacion` la llame**

En `apps/hub-api/src/ausencias/repo.ts:1600-1607`, hoy el payload se construye dentro de la llamada al INSERT. Hay que sacarlo a una variable y anotar después:

```ts
      const evento: EventoModificacion = aprueba ? 'modificacion_aprobada' : 'modificacion_rechazada';
      const payload = construirPayload(solicitud, modificacion, evento);
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [modificacion.solicitudId, evento, JSON.stringify(payload)],
      );
      // Va DESPUES del INSERT y en la MISMA transaccion, igual que en
      // `decidirSolicitud`: si el evento sale, la marca cambia, y si hay ROLLBACK
      // no cambia ninguna de las dos.
      await anotarEventoDeCalendario(client, solicitud, payload);
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm run test:db --workspace=apps/hub-api -- repo.evento-calendario.db.test.ts`
Expected: PASS.

- [ ] **Step 6: Falsar el candado**

Cambiar temporalmente la guarda a `if (cal?.accion !== 'crear') return;` (el comportamiento de hoy). Ejecutar.
Expected: FAIL en `CANDADO: anular vacia el id`.
**Deshacer** y volver a ejecutar: PASS.

- [ ] **Step 7: Los otros tests de db siguen verdes**

Run: `npm run test:db --workspace=apps/hub-api`
Expected: PASS, 42 tests o más.

- [ ] **Step 8: Commit**

```bash
git commit -m "fix(ausencias): la marca del evento apuntaba a un evento que Google ya habia borrado" -- apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/repo.evento-calendario.db.test.ts
```

---

## Task 7: `actualizarSolicitud` emite la corrección

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts:660` (`actualizarSolicitud`)
- Modify: `apps/hub-api/src/ausencias/router.ts:370-373`
- Modify: `apps/hub-api/src/ausencias/router.test.ts` (el doble)
- Test: `apps/hub-api/src/ausencias/repo.correccion-admin.db.test.ts` (crear)

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/hub-api/src/ausencias/repo.correccion-admin.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { actualizarSolicitud, decidirSolicitud, type EdicionSolicitud } from './repo.js';
import { construirPayload, construirPayloadCorreccion } from './notificaciones.js';
import { transicionAlDecidir, type Solicitud } from './types.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from '../test-db/harness.js';

// Que un admin corrija el registro deje de dejar Google contando otra historia,
// contra Postgres de verdad.
//
// Estos candados NO los caza el porton rapido: `router.test.ts` mockea el repo
// entero, asi que el `INSERT` del outbox y su transaccion no existen ahi. Es la
// misma leccion del solapamiento: estrechar el WHERE dejaba 531/531 en verde.

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

/** Una solicitud APROBADA por la via real, para que tenga su id de evento. */
async function aprobadaConEvento(): Promise<Solicitud> {
  const empleadoId = await sembrarEmpleado(db, CORREO);
  const s = await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado: 'pendiente',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo: null,
  });
  const t = transicionAlDecidir(s, true);
  if (!t) throw new Error('una pendiente siempre tiene transicion');
  const aprobada = await decidirSolicitud(db, s.id, s.estado, t, null, null, construirPayload);
  if (!aprobada) throw new Error('no se pudo aprobar');
  return aprobada;
}

/** Los campos de la edicion, partiendo de la solicitud tal como esta. */
function edicionDe(s: Solicitud, over: Partial<EdicionSolicitud> = {}): EdicionSolicitud {
  return {
    empleadoId: s.empleadoId,
    tipo: s.tipo,
    fechaInicio: s.fechaInicio,
    fechaFin: s.fechaFin,
    dias: s.diasHabiles,
    estado: s.estado,
    comentarios: s.comentarios,
    observaciones: s.observaciones,
    ...over,
  };
}

const corregir = (s: Solicitud, over: Partial<EdicionSolicitud> = {}) =>
  actualizarSolicitud(db, s.id, edicionDe(s, over), ADMIN, construirPayloadCorreccion);

/** El payload del ultimo evento encolado. */
async function ultimoPayload(): Promise<{ calendario: { accion: string; eventId: string } | null; correo: { para: string; asunto: string } }> {
  const { rows } = await db.query('SELECT payload FROM portal.ausencias_outbox ORDER BY id DESC LIMIT 1');
  return (rows[0] as { payload: never })?.payload;
}

describe('corregir una solicitud desde el registro general', () => {
  it('mover las fechas de una aprobada encola la correccion y mueve el evento', async () => {
    const s = await aprobadaConEvento();
    await corregir(s, { fechaInicio: '2026-07-13', fechaFin: '2026-07-17' });

    expect(await eventosDelOutbox(db)).toEqual(['aprobada', 'correccion_admin']);
    expect((await ultimoPayload()).calendario).toMatchObject({ accion: 'actualizar' });
  });

  it('sacarla del calendario lo borra y vacia la marca', async () => {
    const s = await aprobadaConEvento();
    await corregir(s, { estado: 'rechazada' });

    expect((await ultimoPayload()).calendario).toMatchObject({ accion: 'borrar' });
    const { rows } = await db.query('SELECT evento_calendario_id FROM portal.solicitudes_ausencia WHERE id = $1', [s.id]);
    expect((rows[0] as { evento_calendario_id: string | null }).evento_calendario_id).toBeNull();
  });

  // CANDADO. Sin `estaEnElCalendario(previa.estado)`, cada errata corregida sobre
  // una pendiente mandaria un correo a administracion sobre una fila que nunca
  // estuvo en Google.
  it('CANDADO: una pendiente corregida no encola NADA', async () => {
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const s = await sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'pendiente',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
      segundoAprobadorCorreo: null,
    });
    await corregir(s, { fechaInicio: '2026-07-13', fechaFin: '2026-07-17' });

    expect(await eventosDelOutbox(db)).toEqual([]);
  });

  // CANDADO. Sin `cambiaLaHoja`, tocar una nota interna manda un ⚠️ que no pide
  // ajustar nada — que es como se entrena a la gente a no leerlos.
  it('CANDADO: corregir solo las observaciones no encola nada', async () => {
    const s = await aprobadaConEvento();
    await corregir(s, { observaciones: 'revisado con RRHH' });

    expect(await eventosDelOutbox(db)).toEqual(['aprobada']);
  });

  it('corregir solo los dias avisa de la hoja pero no toca el calendario', async () => {
    const s = await aprobadaConEvento();
    await corregir(s, { dias: 4 });

    expect(await eventosDelOutbox(db)).toEqual(['aprobada', 'correccion_admin']);
    expect((await ultimoPayload()).calendario).toBeNull();
  });

  // CANDADO. El INSERT del outbox y el UPDATE tienen que deshacerse juntos: una
  // correccion que revienta no puede dejar el correo dicho. Se provoca con la
  // cuarta puerta del solapamiento, que lanza DENTRO de la transaccion.
  it('CANDADO: si la correccion choca con otra ausencia, no queda ni fila ni correo', async () => {
    const s = await aprobadaConEvento();
    const otra = await sembrarSolicitud(db, {
      empleadoId: s.empleadoId,
      correo: CORREO,
      estado: 'aprobada',
      fechaInicio: '2026-08-03',
      fechaFin: '2026-08-07',
      segundoAprobadorCorreo: null,
    });
    void otra;

    await expect(corregir(s, { fechaInicio: '2026-08-05', fechaFin: '2026-08-06' })).rejects.toThrow();

    expect(await eventosDelOutbox(db)).toEqual(['aprobada']);
    const { rows } = await db.query('SELECT fecha_inicio::text FROM portal.solicitudes_ausencia WHERE id = $1', [s.id]);
    expect((rows[0] as { fecha_inicio: string }).fecha_inicio).toBe('2026-07-06');
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test:db --workspace=apps/hub-api -- repo.correccion-admin.db.test.ts`
Expected: FAIL — `actualizarSolicitud` recibe 3 argumentos, no 5.

- [ ] **Step 3: Cambiar `actualizarSolicitud`**

En `apps/hub-api/src/ausencias/repo.ts:660`, la firma y el cuerpo:

```ts
export async function actualizarSolicitud(
  db: Pool,
  id: string,
  campos: EdicionSolicitud,
  adminEmail: string,
  construirPayload: (previa: Solicitud, actual: Solicitud, adminEmail: string) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    // La foto del ANTES, dentro de la transaccion y antes del UPDATE. Es lo
    // unico que permite saber si la fila estaba en Google y si la correccion
    // desajusta algo: despues del UPDATE ese dato ya no existe en ningun sitio.
    const previa = await solicitudPorId(client, id);
    if (previa === null) return null;

    if (ocupaAgenda(campos.tipo, campos.estado)) {
      const choque = await solapeDe(client, campos.empleadoId, campos.fechaInicio, campos.fechaFin, id);
      if (choque) throw new SolapeAlAplicar(choque);
    }

    // El UPDATE y su array de parametros NO se tocan: se quedan exactamente
    // como estan hoy (repo.ts:685-712), incluidos sus comentarios.
    const { rows } = await client.query(/* el UPDATE de siempre */);
    if (rows.length === 0) return null;

    const actual = await solicitudPorId(client, id);
    // Imposible en la practica —acabamos de escribir esa fila por este mismo
    // client—, pero el tipo lo admite y devolver `previa` seria mentir.
    if (actual === null) return null;

    // Las dos mitades niegan cosas distintas y las dos hacen falta:
    //  - `estaEnElCalendario(previa.estado)`: la fila ESTABA en Google. Corregir
    //    una pendiente no desajusta nada, porque nunca se mando nada.
    //  - `cambiaLaHoja`: hay algo que ajustar de verdad. Es el porton unico, y
    //    CONTIENE a `cambiaElCalendario`, asi que no se pierde ninguna
    //    correccion de calendario por pasar por aqui.
    //
    // Y como cada fila del outbox es EXACTAMENTE UN correo, esta condicion es a
    // la vez la de que exista la fila: no hay correccion de calendario sin
    // correo ni correo sin correccion.
    if (estaEnElCalendario(previa.estado) && cambiaLaHoja(previa, actual)) {
      const payload = construirPayload(previa, actual, adminEmail);
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [id, 'correccion_admin', JSON.stringify(payload)],
      );
      await anotarEventoDeCalendario(client, actual, payload);
    }

    return actual;
  });
}
```

Y **actualizar su JSDoc**: la frase «NO encola nada en el outbox, a propósito» ya no es cierta. Sustituirla por lo que sí sigue siendo verdad —que no manda correos de decisión— y decir qué cambió:

```
 * Encola un `correccion_admin` **solo** si la fila estaba en Google y la
 * corrección desajusta algo (`estaEnElCalendario` + `cambiaLaHoja`). Eso NO
 * contradice la decisión original de esta función, que sigue en pie: aprobar o
 * rechazar se hace en la bandeja, y un admin arreglando una errata no dispara
 * correos a la cadena de firmas. El aviso va solo a administración, y existe
 * porque el evento del calendario es un artefacto derivado: o se corrige, o
 * miente. Ver el spec del 2026-08-19.
```

Añadir a los imports de `repo.ts` desde `./types.js`: `estaEnElCalendario`, `cambiaLaHoja`.

- [ ] **Step 4: Cambiar el router**

En `apps/hub-api/src/ausencias/router.ts`:

1. Añadir el import: `import { construirPayloadCorreccion } from './notificaciones.js';`
2. En la línea 373, pasar los dos argumentos nuevos:

```ts
      const actualizada = await repo.actualizarSolicitud(
        db,
        req.params.id,
        campos,
        // Quien corrigio, para que el correo lo diga. El log ya lo tenia; el
        // aviso a administracion sin nombre vale mucho menos.
        sesionDe(req).email,
        construirPayloadCorreccion,
      );
```

3. Actualizar el JSDoc de la ruta, que hoy dice «No manda correos»:

```ts
  /**
   * Corrige una solicitud del registro. No avisa a la cadena de firmas: para
   * aprobar o rechazar está la bandeja, que es donde sí se avisa. Sí manda un
   * aviso a administración cuando la corrección desajusta el calendario o la
   * hoja, y corrige el evento de Google cuando puede. Ver repo.actualizarSolicitud.
   */
```

- [ ] **Step 5: Arreglar el doble de `router.test.ts`**

`router.test.ts` mockea `./repo.js` entero, así que su `actualizarSolicitud` tiene que aceptar la firma nueva. Localizarlo:

```bash
grep -n "actualizarSolicitud" apps/hub-api/src/ausencias/router.test.ts
```

Añadir los dos parámetros al doble. **No** reimplementar ahí la lógica del outbox: ese fichero no puede probarla —no hay transacción ni base— y una reimplementación es justo lo que hizo que el solapamiento pasara 531/531 con la regla rota.

- [ ] **Step 6: Ejecutar los dos portones**

Run: `npm run test --workspace=apps/hub-api`
Expected: PASS.

Run: `npm run test:db --workspace=apps/hub-api`
Expected: PASS, incluidos los seis tests nuevos.

- [ ] **Step 7: Falsar los dos candados del disparo**

a) Quitar `estaEnElCalendario(previa.estado) &&` de la condición. Ejecutar `test:db`.
Expected: FAIL en `CANDADO: una pendiente corregida no encola NADA`.

b) Restaurar, y cambiar `cambiaLaHoja` por `cambiaElCalendario`. Ejecutar `test:db`.
Expected: FAIL en `corregir solo los dias avisa de la hoja pero no toca el calendario`.

**Deshacer las dos** y volver a ejecutar: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.correccion-admin.db.test.ts
git commit -m "feat(ausencias): corregir el registro corrige tambien el calendario y avisa de la hoja" -- apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts apps/hub-api/src/ausencias/repo.correccion-admin.db.test.ts
```

---

## Task 8: Documentación

**Files:**
- Modify: `docs/dev/app-ausencias.md`

- [ ] **Step 1: Escribir la sección**

Añadir una sección «**Corregir desde el registro no deja Google desincronizado**», después de «Una persona no puede estar ausente dos veces a la vez». Tiene que cubrir, y en este orden:

1. Qué hace ahora el `PATCH` y qué **sigue sin hacer** (no crea eventos, no toca la hoja).
2. La tabla de las tres preguntas y sus cuatro combinaciones.
3. Que `estaEnElCalendario` **no es** `ocupaAgenda`, con el porqué.
4. Que `cambiaLaHoja` contiene a `cambiaElCalendario` y qué se rompe si deja de contenerla.
5. Que la columna `evento_calendario_id` cambió de significado, y que la 027 amplía el CHECK.
6. Que **n8n no se tocó**, y por qué no hacía falta (ningún nodo lee el nombre del evento).
7. El riesgo aceptado: las correcciones del histórico mandan correo.

- [ ] **Step 2: Actualizar la línea del `PATCH` en «Lo que NO hace»**

Buscar en ese documento la deuda anotada de que el `PATCH` no encola nada y **borrarla o reescribirla**. Dejar ahí un texto que dejó de ser cierto es el modo de fallo más repetido de esta app.

```bash
grep -n "PATCH" docs/dev/app-ausencias.md
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(ausencias): la correccion del registro y por que sus predicados no son ocupaAgenda" -- docs/dev/app-ausencias.md
```

---

## Cierre

- [ ] **Step 1: Los cuatro portones en verde**

```bash
npm run build --workspace=apps/hub-api
npm run test --workspace=apps/hub-api
npm run test:db --workspace=apps/hub-api
npm run build --workspace=apps/portal
```

- [ ] **Step 2: Revisar el diff entero**

```bash
git diff main...feat/correccion-admin-calendario
```

Buscar en él: comentarios que prometan algo que el código no hace, textos que dejaron de ser ciertos en `repo.ts` y `router.ts`, y cualquier predicado duplicado.

- [ ] **Step 3: Mezclar**

```bash
git checkout main
git merge --no-ff feat/correccion-admin-calendario
```

⚠️ **NO empujar sin decidir antes lo del riesgo aceptado.** `git push` **es** el despliegue: EasyPanel construye y sirve al empujar a `origin/main`, sin que nadie toque el panel. Si la limpieza del histórico —la fila de Paola Pachón— se va a hacer sin correos, hay que hacerla **antes** del push.
