# La segunda firma, opcional por trabajador — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una casilla en la ficha de cada empleado decida si sus solicitudes necesitan dos firmas o una; con la casilla apagada, el superior de segundo nivel deja de firmar pero sigue recibiendo el correo del resultado.

**Architecture:** El superior de segundo nivel tiene dos papeles posibles y se guardan en **campos distintos**: `segundo_aprobador_correo` si firma, `informado_correo` si solo se entera. Nunca los dos a la vez. Así `segundo_aprobador_correo IS NULL` sigue significando exactamente lo que ya significa hoy —una sola firma— y la máquina de estados, el permiso de firma, el del adjunto y el historial no se tocan. El único cambio en los correos es sumar el informado a `cadenaDeDecision`.

**Tech Stack:** Node 20, TypeScript ESM con NodeNext (imports con `.js` aunque el fichero sea `.ts`), Express 4, PostgreSQL con SQL crudo (`$1`, sin ORM), Vitest + supertest, React 19 + Tailwind 3 en el frontend.

**Spec:** `docs/superpowers/specs/2026-08-14-segunda-firma-opcional-design.md`

**Rama:** `feat/segunda-firma-opcional` (ya creada, con la spec commiteada). Al terminar se mezcla con `git merge --no-ff`.

---

## Cosas que hay que saber antes de empezar

Quien ejecute esto probablemente no conozca el repo. Cinco cosas que no son evidentes y cuestan caras:

1. **PowerShell es el shell**, y **pierde el directorio de trabajo entre llamadas**. Empieza cada comando con `Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"` o npm no encontrará los workspaces. PowerShell 5.1 **no admite `&&`**: usa `;`.
2. **Las migraciones se re-ejecutan en cada arranque** y hay que **añadirlas a mano** al array `MIGRATIONS` de `apps/hub-api/src/db.ts`. Olvidarlo **no da ningún error**: la migración simplemente no corre. Y si una migración lanza, `initDb()` no lo captura, hub-api no arranca y **cae el portal entero**.
3. **El build compila los tests** (`tsconfig.json` tiene `include: ["src"]`), así que un literal de tipo incompleto en un `.test.ts` rompe `npm run build`. Vitest, en cambio, **no comprueba tipos**: `build` y `test` son dos portones distintos y hay que pasar los dos.
4. **No hay Postgres en ningún test.** Las reglas de negocio viven en funciones puras (`jerarquia.ts`, `types.ts`, partes de `service.ts`) precisamente por eso, y `router.test.ts` usa un **doble del repo** en memoria. No escribas tests que necesiten base de datos: no hay dónde.
5. **Nunca `git add -A`**: hay un `apps/WO-sales/prompts/` sin trackear que es ajeno a esto. Commitea siempre con rutas explícitas: `git commit -m "..." -- ruta1 ruta2`.

El **Dockerfile no hay que tocarlo**: ya copia la carpeta entera de migraciones con `cp -R src/users/migrations dist/users/`, así que un `.sql` nuevo viaja solo.

Código, comentarios y mensajes de commit **en español**. Los comentarios explican **por qué**, no qué.

---

## Estructura de ficheros

**Se crea uno solo:**

| Fichero | Responsabilidad |
|---|---|
| `apps/hub-api/src/users/migrations/023_ausencias_segunda_firma.sql` | Las dos columnas nuevas |

**Se modifican, por capas:**

| Fichero | Qué gana |
|---|---|
| `apps/hub-api/src/db.ts` | La 023 en el array `MIGRATIONS` |
| `apps/hub-api/src/ausencias/types.ts` | `Empleado.requiereSegundaFirma`, `Solicitud.informadoCorreo` |
| `apps/hub-api/src/ausencias/jerarquia.ts` | El reparto: `Aprobadores.informado` |
| `apps/hub-api/src/ausencias/repo.ts` | Las dos columnas en SQL, el `UPDATE` del panel |
| `apps/hub-api/src/ausencias/service.ts` | Congelar el informado; `fijarSegundaFirma`; el maestro |
| `apps/hub-api/src/ausencias/notificaciones.ts` | El informado en `cadenaDeDecision` |
| `apps/hub-api/src/ausencias/router.ts` | `PUT /ausencias/empleados/:id/segunda-firma` |
| `apps/ausencias/src/api.ts` | El espejo manual de los tipos + la llamada nueva |
| `apps/ausencias/src/PanelOrganigrama.tsx` | La casilla y los cuatro estados de la columna |
| `docs/dev/app-ausencias.md` | La documentación viva |

**Tests que se tocan:** `jerarquia.test.ts`, `notificaciones.test.ts`, `service.test.ts`, `router.test.ts`, `historico.test.ts`.

---

### Tarea 1: El dato — migración 023 y el campo en la ficha

Primero el dato, y nadie lo usa todavía. Así cada commit deja los tres portones en verde.

**Files:**
- Create: `apps/hub-api/src/users/migrations/023_ausencias_segunda_firma.sql`
- Modify: `apps/hub-api/src/db.ts:24`
- Modify: `apps/hub-api/src/ausencias/types.ts:100-113`
- Modify: `apps/hub-api/src/ausencias/repo.ts:41-71`
- Modify: `apps/hub-api/src/ausencias/historico.test.ts:16`

- [ ] **Paso 1: Escribir la migración**

Crea `apps/hub-api/src/users/migrations/023_ausencias_segunda_firma.sql`:

```sql
-- Migration 023: si las solicitudes de alguien necesitan dos firmas o una.
--
-- Hasta ahora la cascada no era negociable: si por encima del jefe inmediato
-- había alguien más, ese alguien tenía que firmar. Cuando el jefe inmediato ya
-- tiene autoridad suficiente, eso solo añade espera.
--
-- Con la casilla apagada, el de segundo nivel deja de firmar pero NO deja de
-- enterarse: su correo se congela en `informado_correo` y entra en la cadena de
-- destinatarios de la aprobación y del rechazo. Firmante e informado son
-- EXCLUYENTES: cuando uno tiene valor, el otro es NULL. Esa exclusión es lo que
-- deja intacto todo lo que ya lee `segundo_aprobador_correo` — la máquina de
-- estados, el permiso de firma, el del adjunto y el historial de aprobaciones.
--
-- Sembrado uniforme, así que DEFAULT como en la 021 y NINGÚN UPDATE: `initDb()`
-- re-ejecuta esto en cada arranque y un UPDATE devolvería la doble firma a quien
-- se la hubieran quitado desde el panel. Toda la plantilla arranca con doble
-- firma, que es el comportamiento de hoy, así que el día del despliegue no
-- cambia nada para nadie.
--
-- El DEFAULT se queda después del relleno, a propósito: `asegurarEmpleado` crea
-- fichas solas en el primer acceso de cada persona, y así ninguna nace saltándose
-- una firma por descuido.
--
-- `informado_correo` nace sin valor: las solicitudes anteriores se quedan en NULL
-- y eso ya es correcto, porque todas nacieron con doble firma.
--
-- Depende del orden del array `MIGRATIONS` de db.ts: la 015 crea
-- `portal.empleados` y `portal.solicitudes_ausencia`. Aditiva y sin destruir
-- nada: revertir el build no obliga a tocar la base.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS requiere_segunda_firma BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS informado_correo VARCHAR(254);
```

- [ ] **Paso 2: Registrarla en el array de migraciones**

En `apps/hub-api/src/db.ts:24`, añade el fichero **al final** del array `MIGRATIONS`, después de `'022_ausencias_visores.sql'`:

```ts
const MIGRATIONS = ['001_create_users.sql', '002_add_avatar.sql', '003_add_preferences.sql', '004_wo_sales_email.sql', '005_drop_wo_sales_recipients.sql', '006_wo_sales_email_sent.sql', '007_contabilidad_overrides.sql', '008_contabilidad_budget.sql', '013_user_state_fk_cascade.sql', '014_drop_salestracker.sql', '015_ausencias.sql', '016_ausencias_historico.sql', '017_saldo_vacaciones.sql', '018_ausencias_cascada.sql', '019_ausencias_outbox_reserva.sql', '020_ausencias_drop_drive.sql', '021_ausencias_copia.sql', '022_ausencias_visores.sql', '023_ausencias_segunda_firma.sql'];
```

- [ ] **Paso 3: El campo en el tipo `Empleado`**

En `apps/hub-api/src/ausencias/types.ts`, dentro de `interface Empleado`, justo después de `veAdjuntos`:

```ts
  /** Puede abrir CUALQUIER adjunto de CUALQUIER persona. Llave maestra. */
  veAdjuntos: boolean;
  /**
   * Si sus solicitudes necesitan también la firma del jefe de su jefe, o basta
   * con la del jefe inmediato.
   *
   * Apagarlo NO deja a nadie sin enterarse: el de segundo nivel pasa de firmante
   * a informado y sigue recibiendo el correo del resultado. El valor por defecto
   * vive en el SQL (`DEFAULT TRUE`), no aquí — repetirlo en TypeScript daría dos
   * fuentes de verdad para el mismo default.
   */
  requiereSegundaFirma: boolean;
```

- [ ] **Paso 4: Leer la columna en el repo**

En `apps/hub-api/src/ausencias/repo.ts`, tres cambios seguidos. `COLS_EMPLEADO` (línea 41):

```ts
const COLS_EMPLEADO = `
  id, nombre_completo, correo, cargo, credencial,
  aprobador_correo, copia_correo, user_id, activo, ve_adjuntos, requiere_segunda_firma`;
```

En `interface FilaEmpleadoDb`, después de `ve_adjuntos: boolean;`:

```ts
  requiere_segunda_firma: boolean;
```

En `function aEmpleado`, después de `veAdjuntos: r.ve_adjuntos,`:

```ts
    requiereSegundaFirma: r.requiere_segunda_firma,
```

- [ ] **Paso 5: Arreglar el único literal de `Empleado` que hay en los tests**

`apps/hub-api/src/ausencias/historico.test.ts:16` construye un `Empleado` completo y el build se romperá sin esto. Añade el campo junto a `veAdjuntos: false,`:

```ts
    veAdjuntos: false,
    requiereSegundaFirma: true,
```

- [ ] **Paso 6: Los dos portones de hub-api**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: el build sin errores y los 581 tests en verde. **Si falla `users.service.test.ts > property tests > 4.5`, reejecuta**: es un flake conocido de `fast-check` (~1 de cada 5).

- [ ] **Paso 7: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): la ficha dice si sus solicitudes necesitan dos firmas" -- apps/hub-api/src/users/migrations/023_ausencias_segunda_firma.sql apps/hub-api/src/db.ts apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/historico.test.ts
```

---

### Tarea 2: El reparto — firmante o informado, nunca los dos

Ahora sí, TDD. Esta es la regla de negocio y vive en una función pura.

**Files:**
- Modify: `apps/hub-api/src/ausencias/jerarquia.test.ts`
- Modify: `apps/hub-api/src/ausencias/jerarquia.ts:19-63`

- [ ] **Paso 1: Escribir los tests que fallan**

En `apps/hub-api/src/ausencias/jerarquia.test.ts`, añade este helper justo debajo de `function enlace(...)`:

```ts
/** Un solicitante. Por defecto con doble firma, que es el default del SQL. */
function solicitante(correo: string, aprobadorCorreo: string, requiereSegundaFirma = true) {
  return { correo, aprobadorCorreo, requiereSegundaFirma };
}
```

Y añade estos cuatro tests **al final** del `describe('aprobadoresDe', ...)`, antes de su llave de cierre:

```ts
  it('con la casilla apagada el jefe del jefe no firma: solo se le informa', () => {
    const r = aprobadoresDe(solicitante(ANA, XIOMARA, false), enlace(XIOMARA, ALFONSO));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: ALFONSO });
  });

  it('apagar la casilla NO inventa a quien informar si el árbol ya se acababa', () => {
    // El jefe es la raíz. No hay segundo nivel, así que no hay ni firma que
    // quitar ni aviso que dar: el correo tiene que salir igual que hoy.
    const r = aprobadoresDe(solicitante(ANA, XIOMARA, false), enlace(XIOMARA, XIOMARA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: null });
  });

  it('un ciclo de dos no convierte al solicitante en informado de sí mismo', () => {
    // Las cuatro reglas de corte se aplican ANTES de repartir. Sin eso, apagar
    // la casilla pondría a Ana en el correo de su propia solicitud.
    const r = aprobadoresDe(solicitante(ANA, XIOMARA, false), enlace(XIOMARA, ANA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: null });
  });

  it('firmante e informado nunca tienen valor a la vez', () => {
    // La invariante de la que depende que nada más haya que tocarse: mientras
    // `segundo` sea null, todo lo que ya lee ese campo sigue siendo correcto.
    const casos = [
      aprobadoresDe(solicitante(ANA, XIOMARA, true), enlace(XIOMARA, ALFONSO)),
      aprobadoresDe(solicitante(ANA, XIOMARA, false), enlace(XIOMARA, ALFONSO)),
      aprobadoresDe(solicitante(ANA, XIOMARA, false), null),
      aprobadoresDe(solicitante(ANA, ALFONSO, true), enlace(ALFONSO, ALFONSO)),
    ];
    for (const r of casos) {
      expect(r.segundo === null || r.informado === null).toBe(true);
    }
  });
```

- [ ] **Paso 2: Correr los tests y verlos fallar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- jerarquia
```

Esperado: FAIL. Los tres primeros por `{ primero, segundo }` frente a `{ primero, segundo, informado }`; el cuarto pasa por accidente (`undefined === null` es `false`, pero `r.segundo === null` ya es `true` en tres de los cuatro casos) — no te fíes de él hasta el paso 4.

- [ ] **Paso 3: Implementar el reparto**

En `apps/hub-api/src/ausencias/jerarquia.ts`, sustituye `interface Aprobadores` y la función `aprobadoresDe` enteras por esto:

```ts
export interface Aprobadores {
  /** Quien firma primero. Siempre el `aprobadorCorreo` del solicitante. */
  primero: string;
  /** Quien firma después, o `null` si no hay segunda firma. */
  segundo: string | null;
  /**
   * El de segundo nivel cuando NO firma: solo se le avisa del resultado.
   *
   * Nunca tiene valor a la vez que `segundo` — es una firma o es un aviso. De esa
   * exclusión depende que el resto del código no tenga que cambiar: mientras
   * `segundo` sea `null`, «una sola firma» sigue significando lo que ya
   * significaba.
   */
  informado: string | null;
}

/**
 * Los dos que tienen que firmar —o el que firma y el que solo se entera—, para
 * congelarlos en el alta de la solicitud.
 *
 * @param solicitante su correo, el de su jefe inmediato y si exige segunda firma.
 * @param jefe la ficha ACTIVA del jefe, o `null` si no la tiene (no está en el
 *   maestro, o alguien la desactivó). Lo resuelve `repo.enlaceDe`.
 */
export function aprobadoresDe(
  solicitante: { correo: string; aprobadorCorreo: string; requiereSegundaFirma: boolean },
  jefe: EnlaceJerarquia | null,
): Aprobadores {
  // El primer nivel NO tiene condiciones: es literalmente lo que dice la ficha,
  // igual que antes de existir la cascada. Importa porque ese correo puede ser un
  // buzón sin ficha de empleado —hoy lo es para toda la plantilla— y tiene que
  // seguir funcionando exactamente igual.
  const primero = solicitante.aprobadorCorreo.toLowerCase();
  const yo = solicitante.correo.toLowerCase();

  // No hay segundo nivel: ni firma ni aviso. Los cuatro cortes de abajo terminan
  // aquí, y por eso se aplican ANTES de mirar la casilla — apagarla no puede
  // inventar un destinatario donde el árbol ya se acababa.
  const sinSegundoNivel = { primero, segundo: null, informado: null };

  // Sin ficha activa del jefe no se puede subir. Y NO se salta al abuelo: si a
  // alguien le desactivan el jefe, su solicitud se cierra con una firma en vez de
  // aterrizar en el buzón de quien no la esperaba.
  if (!jefe) return sinSegundoNivel;

  const abuelo = jefe.aprobadorCorreo.toLowerCase();

  // El jefe es su propio jefe: es la raíz del organigrama, no hay más escalones.
  if (abuelo === jefe.correo.toLowerCase()) return sinSegundoNivel;

  // El jefe del jefe es el mismo que ya firma primero: una firma, no dos iguales.
  if (abuelo === primero) return sinSegundoNivel;

  // El jefe del jefe soy yo. Pasa con un ciclo de dos (A jefe de B, B jefe de A).
  // Sin este corte, el solicitante se firmaría a sí mismo la segunda aprobación y
  // la cascada se convertiría en autoaprobación sin que nada fallara.
  if (abuelo === yo) return sinSegundoNivel;

  // Hay alguien de segundo nivel, y la casilla decide su papel: firmante, o
  // informado que se entera del resultado sin poder decidirlo.
  return solicitante.requiereSegundaFirma
    ? { primero, segundo: abuelo, informado: null }
    : { primero, segundo: null, informado: abuelo };
}
```

- [ ] **Paso 4: Actualizar los ocho tests que ya existían**

Los `toEqual` antiguos comparan objetos de dos campos y ahora hay tres. En `jerarquia.test.ts`, dentro de `describe('aprobadoresDe', ...)`, cambia **las ocho llamadas** para que usen el helper y esperen los tres campos:

```ts
  it('cadena de tres: firma el jefe y luego el jefe del jefe', () => {
    const r = aprobadoresDe(solicitante(ANA, XIOMARA), enlace(XIOMARA, ALFONSO));
    expect(r).toEqual({ primero: XIOMARA, segundo: ALFONSO, informado: null });
  });

  it('el jefe no tiene ficha en el maestro: una sola firma', () => {
    // El caso real de hoy: todo el mundo cuelga de un buzón que puede no estar
    // dado de alta como empleado. Tiene que seguir funcionando igual que antes.
    const r = aprobadoresDe(solicitante(ANA, ALFONSO), null);
    expect(r).toEqual({ primero: ALFONSO, segundo: null, informado: null });
  });

  it('el jefe tiene la ficha desactivada: una sola firma, y NO salta al abuelo', () => {
    // `enlaceDe` filtra por `activo`, así que un jefe desactivado llega como null.
    // Si esto devolviera el abuelo, desactivar a alguien mandaría las solicitudes
    // de su equipo al buzón de quien no las espera.
    const r = aprobadoresDe(solicitante(ANA, XIOMARA), null);
    expect(r.segundo).toBeNull();
  });

  it('el jefe es la raíz (jefe de sí mismo): una sola firma', () => {
    const r = aprobadoresDe(solicitante(XIOMARA, ALFONSO), enlace(ALFONSO, ALFONSO));
    expect(r).toEqual({ primero: ALFONSO, segundo: null, informado: null });
  });

  it('quien es su propio jefe se aprueba a sí mismo, sin segunda firma', () => {
    const r = aprobadoresDe(solicitante(ALFONSO, ALFONSO), enlace(ALFONSO, ALFONSO));
    expect(r).toEqual({ primero: ALFONSO, segundo: null, informado: null });
  });

  it('un ciclo de dos NO deja que el solicitante se firme a sí mismo', () => {
    // Ana es jefa de Xiomara y Xiomara es jefa de Ana. Sin el corte, el segundo
    // aprobador de Ana sería Ana: autoaprobación disfrazada de cascada.
    const r = aprobadoresDe(solicitante(ANA, XIOMARA), enlace(XIOMARA, ANA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: null });
  });

  it('no repite firmante cuando el jefe del jefe es el mismo que firma primero', () => {
    const r = aprobadoresDe(solicitante(ANA, XIOMARA), enlace(XIOMARA, XIOMARA));
    expect(r).toEqual({ primero: XIOMARA, segundo: null, informado: null });
  });

  it('las mayúsculas no cambian el resultado', () => {
    const r = aprobadoresDe(
      solicitante('Ana.Ruiz@Ambientalia.com.co', 'XIOMARA.perez@ambientalia.com.co'),
      enlace('xiomara.PEREZ@ambientalia.com.co', 'Comercial@ambientalia.com.co'),
    );
    expect(r).toEqual({ primero: XIOMARA, segundo: ALFONSO, informado: null });
  });
```

- [ ] **Paso 5: Correr los tests y verlos pasar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- jerarquia
```

Esperado: PASS, con los cuatro tests nuevos y los ocho actualizados.

- [ ] **Paso 6: Falsar el corte**

No basta con que pasen. Comprueba que el corte del ciclo **de verdad protege al informado**: en `jerarquia.ts`, comenta temporalmente la línea `if (abuelo === yo) return sinSegundoNivel;` y vuelve a correr. El test «un ciclo de dos no convierte al solicitante en informado de sí mismo» **tiene que ponerse rojo**. Si sigue verde, el test no prueba lo que dice. Descomenta antes de seguir.

- [ ] **Paso 7: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): el de segundo nivel firma o solo se entera, nunca las dos" -- apps/hub-api/src/ausencias/jerarquia.ts apps/hub-api/src/ausencias/jerarquia.test.ts
```

---

### Tarea 3: Congelar al informado en el alta

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts:145` (interface `Solicitud`)
- Modify: `apps/hub-api/src/ausencias/repo.ts:672-802`
- Modify: `apps/hub-api/src/ausencias/service.ts:203-222`
- Modify: `apps/hub-api/src/ausencias/router.test.ts` (fixture y tests nuevos)
- Modify: `apps/hub-api/src/ausencias/notificaciones.test.ts:22`
- Modify: `apps/hub-api/src/ausencias/service.test.ts:46`

- [ ] **Paso 1: Escribir los tests que fallan**

Primero **el fixture**: en `apps/hub-api/src/ausencias/router.test.ts`, dentro del `beforeEach` de la línea 371, añade el campo a `estado.empleado` (después de `aprobadorCorreo`):

```ts
  estado.empleado = {
    id: 'e1',
    nombreCompleto: 'Ana Ruiz',
    correo: 'ana.ruiz@ambientalia.com.co',
    cargo: 'Analista',
    credencial: 1002,
    aprobadorCorreo: 'comercial@ambientalia.com.co',
    // El default del SQL. Sin esto, `aprobadoresDe` leería `undefined` y TODOS
    // los tests de la cascada perderían su segunda firma de golpe.
    requiereSegundaFirma: true,
    userId: null,
    activo: true,
  };
```

Ahora el describe nuevo. Añádelo **justo después** del `describe('aprobación en cascada', ...)` (termina cerca de la línea 800; ponlo tras su llave de cierre):

```ts
// ── La segunda firma, apagada por ficha ────────────────────────────────────

describe('la segunda firma se puede apagar por ficha', () => {
  const JEFA = 'jefa.directa@ambientalia.com.co';
  const GERENCIA = 'comercial@ambientalia.com.co';

  beforeEach(() => {
    // Ana → Jefa → Gerencia. La ficha de la jefa TIENE que estar en la plantilla:
    // `enlaceDe` solo sube por fichas activas.
    estado.empleado.aprobadorCorreo = JEFA;
    estado.plantilla.push({
      id: '55555555-5555-4555-8555-555555555555',
      nombreCompleto: 'Jefa Directa',
      correo: JEFA,
      cargo: 'Coordinadora',
      credencial: 900,
      aprobadorCorreo: GERENCIA,
      requiereSegundaFirma: true,
      userId: null,
      activo: true,
    });
  });

  const crear = async () =>
    (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva())
        .expect(201)
    ).body as Record<string, unknown>;

  it('con la casilla apagada, el alta congela al informado y a ningún segundo firmante', async () => {
    estado.empleado.requiereSegundaFirma = false;
    const s = await crear();
    expect(s.aprobadorCorreo).toBe(JEFA);
    expect(s.segundoAprobadorCorreo).toBeNull();
    expect(s.informadoCorreo).toBe(GERENCIA);
  });

  it('con la casilla encendida hay segunda firma y nadie a quien informar', async () => {
    const s = await crear();
    expect(s.segundoAprobadorCorreo).toBe(GERENCIA);
    expect(s.informadoCorreo).toBeNull();
  });

  it('la primera firma cierra la solicitud cuando la casilla está apagada', async () => {
    // El comportamiento que justifica el diseño entero: con `segundo` en null, la
    // máquina de estados ya cierra en la primera firma sin tocarla.
    estado.empleado.requiereSegundaFirma = false;
    const s = await crear();
    const r = await request(app())
      .post(`/api/ausencias/solicitudes/${s.id}/decision`)
      .set('Authorization', `Bearer ${token({ sub: JEFA })}`)
      .send({ aprueba: true })
      .expect(200);
    expect(r.body.estado).toBe('aprobada');
    expect(r.body.decididaAt).not.toBeNull();
    // Y no se encola ningún aviso de segunda firma: no hay segunda firma.
    expect(estado.eventos.filter((e) => e.evento === 'aprobacion_2')).toHaveLength(0);
  });

  it('el de segundo nivel no puede firmar una solicitud que ya no le toca', async () => {
    // Candado. Si `informadoCorreo` acabara alguna vez leyéndose como firmante,
    // esto se pondría rojo — que es justo lo que hay que impedir.
    estado.empleado.requiereSegundaFirma = false;
    const s = await crear();
    await request(app())
      .post(`/api/ausencias/solicitudes/${s.id}/decision`)
      .set('Authorization', `Bearer ${token({ sub: GERENCIA })}`)
      .send({ aprueba: true })
      .expect(403);
  });

  it('una incapacidad no congela ni firmante ni informado, apagada la casilla o no', async () => {
    // Las incapacidades se INFORMAN, no se aprueban: dejar aquí a alguien la
    // haría aparecer en una bandeja de pendientes que nadie tiene que atender.
    // Su aviso a gerencia sale por `COPIA_INCAPACIDADES`, que esto no toca.
    estado.empleado.requiereSegundaFirma = false;
    const s = (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva({ tipo: 'incapacidad' }))
        .expect(201)
    ).body;
    expect(s.estado).toBe('registrada');
    expect(s.aprobadorCorreo).toBeNull();
    expect(s.segundoAprobadorCorreo).toBeNull();
    expect(s.informadoCorreo).toBeNull();
  });
});
```

- [ ] **Paso 2: Correr los tests y verlos fallar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- router
```

Esperado: FAIL en los dos primeros, con `informadoCorreo` llegando como `undefined`.

- [ ] **Paso 3: El campo en el tipo `Solicitud`**

En `apps/hub-api/src/ausencias/types.ts`, dentro de `interface Solicitud`, justo después de `segundoAprobadorCorreo`:

```ts
  /**
   * El de segundo nivel cuando NO firma, congelado en el alta igual que los
   * firmantes. Recibe el correo de la decisión final y nada más: ni firma, ni
   * abre el adjunto, ni la solicitud le cuenta como aprobación suya.
   *
   * Excluyente con `segundoAprobadorCorreo`: si uno tiene valor, el otro es
   * `null`. Se congela —al contrario que `copiaCorreo`— porque nace del ÁRBOL y
   * no de una preferencia de aviso: un cambio de organigrama a mitad de trámite
   * no debe reescribir a quién se le prometió el resultado.
   */
  informadoCorreo: string | null;
```

- [ ] **Paso 4: Leer y escribir la columna en el repo**

En `apps/hub-api/src/ausencias/repo.ts`, cuatro sitios. En `SELECT_SOLICITUD`, línea 682:

```ts
         s.comentarios, s.estado, s.aprobador_correo, s.segundo_aprobador_correo, s.informado_correo,
```

En `interface FilaSolicitudDb`, después de `segundo_aprobador_correo`:

```ts
  informado_correo: string | null;
```

En `function aSolicitud`, después de `segundoAprobadorCorreo: r.segundo_aprobador_correo,`:

```ts
    informadoCorreo: r.informado_correo,
```

En `interface DatosInsercion`, después de `segundoAprobadorCorreo`:

```ts
  /** Congelado por lo mismo que los firmantes: nace del árbol, no de un ajuste. */
  informadoCorreo: string | null;
```

Y en el `INSERT` de `crearSolicitud`, la columna y el parámetro (ojo: **`$11` es nuevo**):

```ts
      `INSERT INTO portal.solicitudes_ausencia
         (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin,
          dias_habiles, comentarios, estado, aprobador_correo, segundo_aprobador_correo,
          informado_correo)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11)
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
      ],
```

- [ ] **Paso 5: Guardarlo en el alta**

En `apps/hub-api/src/ausencias/service.ts`, dentro de la llamada a `repo.crearSolicitud`, después de `segundoAprobadorCorreo`:

```ts
      aprobadorCorreo: firmantes ? firmantes.primero : null,
      segundoAprobadorCorreo: firmantes ? firmantes.segundo : null,
      informadoCorreo: firmantes ? firmantes.informado : null,
```

- [ ] **Paso 6: Los dos helpers de test que construyen una `Solicitud` completa**

El build compila los tests, así que estos dos literales lo romperían. En `apps/hub-api/src/ausencias/notificaciones.test.ts:22` y en `apps/hub-api/src/ausencias/service.test.ts:46`, añade en ambos la línea justo después de `segundoAprobadorCorreo: null,`:

```ts
    informadoCorreo: null,
```

- [ ] **Paso 7: Correr los dos portones**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: build limpio y todo verde, incluidos los cuatro tests nuevos.

- [ ] **Paso 8: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): el alta congela a quien solo se entera del resultado" -- apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.test.ts apps/hub-api/src/ausencias/notificaciones.test.ts apps/hub-api/src/ausencias/service.test.ts
```

---

### Tarea 4: El correo del resultado llega al informado

**Files:**
- Modify: `apps/hub-api/src/ausencias/notificaciones.test.ts`
- Modify: `apps/hub-api/src/ausencias/notificaciones.ts:163-173`

- [ ] **Paso 1: Escribir los tests que fallan**

En `apps/hub-api/src/ausencias/notificaciones.test.ts`, añade este bloque al final del fichero:

```ts
describe('cuando la segunda firma está apagada', () => {
  const INFORMADO = 'gerencia@ambientalia.com.co';

  // Una solicitud de firma única con alguien de segundo nivel al que solo se le
  // informa: `segundo` en null e `informado` con valor, que es la invariante.
  const conInformado = (over = {}) =>
    solicitud({ segundoAprobadorCorreo: null, informadoCorreo: INFORMADO, ...over });

  it('la aprobación llega también a quien no firmó', () => {
    const p = construirPayload(conInformado({ estado: 'aprobada' }), 'aprobada');
    expect(p.correo.para).toBe(
      'ana.ruiz@ambientalia.com.co, comercial@ambientalia.com.co, gerencia@ambientalia.com.co, administrativo@ambientalia.com.co',
    );
  });

  it('el rechazo también: quien reorganiza el trabajo tiene que enterarse', () => {
    const p = construirPayload(conInformado({ estado: 'rechazada' }), 'rechazada');
    expect(p.correo.para).toContain(INFORMADO);
  });

  it('el acuse del alta NO lo lleva: solo el veredicto', () => {
    // Está informado del resultado, no metido en el trámite.
    const p = construirPayload(conInformado(), 'creada');
    expect(p.correo.para).toBe('ana.ruiz@ambientalia.com.co');
  });

  it('el aviso al aprobador NO lo lleva', () => {
    const p = construirPayload(conInformado(), 'aprobacion');
    expect(p.correo.para).toBe('comercial@ambientalia.com.co');
  });

  it('el acuse no anuncia dos aprobaciones, porque ya no las hay', () => {
    expect(construirPayload(conInformado(), 'creada').correo.cuerpo).not.toContain('dos aprobaciones');
  });

  it('no se duplica cuando el informado es además la copia de la ficha', () => {
    const p = construirPayload(
      conInformado({ estado: 'aprobada', copiaCorreo: INFORMADO }),
      'aprobada',
    );
    expect(p.correo.para).toBe(
      'ana.ruiz@ambientalia.com.co, comercial@ambientalia.com.co, gerencia@ambientalia.com.co',
    );
  });
});
```

- [ ] **Paso 2: Correr los tests y verlos fallar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- notificaciones
```

Esperado: FAIL en los dos primeros y en el sexto — el informado no aparece en la lista de destinatarios. Los otros tres pasan ya, y son el candado de que **no** se cuela donde no toca.

- [ ] **Paso 3: Sumarlo a la cadena**

En `apps/hub-api/src/ausencias/notificaciones.ts`, sustituye el comentario y la definición de `cadenaDeDecision`:

```ts
/**
 * Quiénes se enteran de una decisión: el solicitante, **toda la cadena que la
 * firmó**, quien debía enterarse sin firmar, y administración.
 *
 * Los dos aprobadores van incluidos a propósito. El segundo suele coincidir con
 * la copia a administración y por eso parecía que ya funcionaba, pero el jefe
 * inmediato —que dio el primer visto bueno— no recibía nada: daba su firma y no
 * volvía a saber en qué acabó.
 *
 * `informadoCorreo` es el de segundo nivel cuando su ficha no exige segunda
 * firma. Nunca coexiste con `segundoAprobadorCorreo`, así que esto no manda dos
 * correos a nadie: uno de los dos es siempre `null` y `destinatarios` lo filtra.
 */
const cadenaDeDecision = (s: Solicitud) =>
  destinatarios(
    s.solicitanteEmail,
    s.aprobadorCorreo,
    s.segundoAprobadorCorreo,
    s.informadoCorreo,
    s.copiaCorreo,
  );
```

- [ ] **Paso 4: Correr los tests y verlos pasar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- notificaciones
```

Esperado: PASS, los seis nuevos y los que ya había.

- [ ] **Paso 5: Falsar el candado del alta**

Añade temporalmente `s.informadoCorreo` a la lista de `destinatarios` dentro de `acuseSolicitante` (el `para:` de la rama no-incapacidad) y vuelve a correr: «el acuse del alta NO lo lleva» **tiene que ponerse rojo**. Deshaz el cambio antes de seguir.

- [ ] **Paso 6: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): el correo del resultado llega tambien a quien no firmo" -- apps/hub-api/src/ausencias/notificaciones.ts apps/hub-api/src/ausencias/notificaciones.test.ts
```

---

### Tarea 5: Los dos candados de permisos

Ni `puedeDecidir` ni `puedeVerAdjunto` cambian. Estos tests fijan que **siguen sin cambiar** cuando aparece un informado, y hay que falsarlos para que valgan algo.

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.test.ts`

- [ ] **Paso 1: Escribir los tests**

Añade al final de `apps/hub-api/src/ausencias/service.test.ts`:

```ts
describe('el informado no hereda ningún permiso del segundo firmante', () => {
  const INFORMADO = 'gerencia@ambientalia.com.co';
  const suSesion = { email: INFORMADO, userId: null, esAdmin: false };

  const sinSegundaFirma = solicitud({
    aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
    segundoAprobadorCorreo: null,
    informadoCorreo: INFORMADO,
  });

  it('no puede firmarla mientras está pendiente', () => {
    expect(puedeDecidir(suSesion, sinSegundaFirma)).toBe(false);
  });

  it('tampoco cuando ya está decidida', () => {
    // En estado terminal `puedeDecidir` deja pasar a los firmantes para que el
    // 409 gane al 403. El informado no es firmante, así que sigue siendo 403.
    expect(puedeDecidir(suSesion, { ...sinSegundaFirma, estado: 'aprobada' })).toBe(false);
  });

  it('no puede abrir el soporte', () => {
    // `AdjuntoCompleto` ni siquiera tiene `informadoCorreo`, y ese es el diseño:
    // recibe el correo del resultado, no acceso al dato de salud que lo respalda.
    const adj = {
      solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
      segundoAprobadorCorreo: null,
    } as never;
    expect(puedeVerAdjunto(suSesion, adj, false)).toBe(false);
  });

  it('con la llave maestra sí lo abre, como cualquiera que la tenga', () => {
    // La llave AÑADE acceso y nunca lo condiciona: no ser firmante no puede
    // quitársela a quien la tiene por otra vía.
    const adj = {
      solicitanteEmail: 'ana.ruiz@ambientalia.com.co',
      aprobadorCorreo: 'jefa.directa@ambientalia.com.co',
      segundoAprobadorCorreo: null,
    } as never;
    expect(puedeVerAdjunto(suSesion, adj, true)).toBe(true);
  });
});
```

- [ ] **Paso 2: Correr los tests**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- service
```

Esperado: PASS a la primera. **Eso es exactamente el problema**: pasan por construcción y hay que demostrar que muerden.

- [ ] **Paso 3: Falsar los dos candados**

Uno cada vez, deshaciendo entre medias.

**Candado 1.** En `service.ts`, dentro de `puedeDecidir`, cambia la rama de `pendiente` por:

```ts
  if (s.estado === 'pendiente')
    return (
      (s.aprobadorCorreo ?? '').toLowerCase() === yo || (s.informadoCorreo ?? '').toLowerCase() === yo
    );
```

Corre `npm run test --workspace=apps/hub-api -- service`. «no puede firmarla mientras está pendiente» **tiene que ponerse rojo**. Deshaz.

**Candado 2.** En `service.ts`, dentro de `puedeVerAdjunto`, añade al `return` final:

```ts
    (a.solicitanteEmail.toLowerCase() === yo ||
      (a.aprobadorCorreo ?? '').toLowerCase() === yo ||
      (a.segundoAprobadorCorreo ?? '').toLowerCase() === yo ||
      (a as { informadoCorreo?: string | null }).informadoCorreo?.toLowerCase() === yo)
```

Corre los tests otra vez. «no puede abrir el soporte» **tiene que ponerse rojo**. Deshaz.

Si alguno de los dos se queda verde con el código roto, el test no prueba lo que su nombre promete y hay que arreglarlo antes de seguir.

- [ ] **Paso 4: Confirmar que el código volvió a su sitio**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git diff --stat apps/hub-api/src/ausencias/service.ts
```

Esperado: **sin salida**. `service.ts` no debe tener ningún cambio en esta tarea.

- [ ] **Paso 5: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "test(ausencias): el informado no firma ni abre el soporte" -- apps/hub-api/src/ausencias/service.test.ts
```

---

### Tarea 6: El endpoint que enciende y apaga la casilla

**Files:**
- Modify: `apps/hub-api/src/ausencias/router.test.ts`
- Modify: `apps/hub-api/src/ausencias/repo.ts:426-432` (junto a `fijarCopia`)
- Modify: `apps/hub-api/src/ausencias/service.ts:609` (después de `fijarCopia`)
- Modify: `apps/hub-api/src/ausencias/router.ts:238-245` (después de la ruta de copia)

- [ ] **Paso 1: Escribir los tests que fallan**

Primero **el doble del repo**: en `apps/hub-api/src/ausencias/router.test.ts`, junto a `fijarCopia` (línea 187), añade:

```ts
  fijarSegundaFirma: async (_db: unknown, empleadoId: string, requiere: boolean) => {
    const e = estado.plantilla.find((x: any) => x.id === empleadoId);
    if (!e) return false;
    e.requiereSegundaFirma = requiere;
    return true;
  },
```

Y añade el describe del endpoint, después del de `PUT /ausencias/empleados/:id/visor`:

```ts
describe('PUT /ausencias/empleados/:id/segunda-firma', () => {
  it('un admin apaga la segunda firma de alguien', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ requiereSegundaFirma: false })
      .expect(200);
    expect(r.body).toMatchObject({ id: E1, requiereSegundaFirma: false });
  });

  it('y la vuelve a encender', async () => {
    estado.plantilla[0].requiereSegundaFirma = false;
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ requiereSegundaFirma: true })
      .expect(200);
    expect(r.body).toHaveProperty('requiereSegundaFirma', true);
  });

  it('400 si el cuerpo no trae un booleano', async () => {
    // `'no'` es una cadena con valor de verdad: sin la comprobación de tipo,
    // apagar la casilla desde un cliente descuidado la dejaría encendida.
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ requiereSegundaFirma: 'no' })
      .expect(400);
    expect(r.body.error).toBe('segunda_firma_invalida');
  });

  it('400 si el cuerpo viene vacío', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({})
      .expect(400);
    expect(r.body.error).toBe('segunda_firma_invalida');
  });

  it('404 si el empleado no existe', async () => {
    await request(app())
      .put('/api/ausencias/empleados/99999999-9999-4999-8999-999999999999/segunda-firma')
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ requiereSegundaFirma: false })
      .expect(404);
  });

  it('403 a quien no es admin', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/segunda-firma`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ requiereSegundaFirma: false })
      .expect(403);
  });
});
```

- [ ] **Paso 2: Correr los tests y verlos fallar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- router
```

Esperado: FAIL con 404 en todos (la ruta no existe todavía).

- [ ] **Paso 3: El `UPDATE` en el repo**

En `apps/hub-api/src/ausencias/repo.ts`, justo después de `fijarCopia`:

```ts
/**
 * Enciende o apaga la segunda firma de un empleado. Devuelve false si no existía
 * o estaba inactivo, igual que `fijarJefe` y `fijarCopia`.
 */
export async function fijarSegundaFirma(db: Pool, empleadoId: string, requiere: boolean): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE portal.empleados SET requiere_segunda_firma = $2 WHERE id = $1 AND activo`,
    [empleadoId, requiere],
  );
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Paso 4: El servicio**

En `apps/hub-api/src/ausencias/service.ts`, después de `fijarCopia`:

```ts
/**
 * Enciende o apaga la segunda firma de alguien.
 *
 * Sin registro de auditoría, al contrario que `fijarVisor`: esto no da acceso a
 * ningún dato personal, así que se queda al nivel del jefe y de la copia. Y sin
 * comprobación de ciclos, al contrario que `fijarJefe`: no se toca ninguna arista
 * del árbol, solo si el escalón de arriba firma o se limita a enterarse.
 *
 * Las solicitudes ya en vuelo no se mueven: llevan su reparto congelado del alta.
 */
export async function fijarSegundaFirma(
  db: Pool,
  empleadoId: string,
  body: unknown,
): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  // El tipo se exige, no se interpreta: `'no'` es una cadena con valor de verdad,
  // y aceptarla dejaría encendida una casilla que alguien quiso apagar.
  if (typeof b.requiereSegundaFirma !== 'boolean') {
    throw new AusenciaError('segunda_firma_invalida', 400, 'requiereSegundaFirma');
  }

  if (!(await repo.fijarSegundaFirma(db, empleadoId, b.requiereSegundaFirma))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}
```

- [ ] **Paso 5: La ruta**

En `apps/hub-api/src/ausencias/router.ts`, después de la ruta `/copia`:

```ts
  /**
   * Enciende o apaga la segunda firma de alguien. Solo admin.
   *
   * Las solicitudes ya en vuelo NO se mueven: cada una lleva congelado desde el
   * alta si su segundo nivel firma o solo se entera del resultado.
   */
  router.put('/ausencias/empleados/:id/segunda-firma', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarSegundaFirma(db, req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_segunda_firma');
    }
  });
```

- [ ] **Paso 6: Correr los dos portones**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: build limpio y los seis tests nuevos en verde.

- [ ] **Paso 7: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): endpoint para encender o apagar la segunda firma" -- apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
```

---

### Tarea 7: El maestro del organigrama enseña a quién se informa

Sin esto, la columna del panel se quedaría sin el nombre que pintar.

**Files:**
- Modify: `apps/hub-api/src/ausencias/router.test.ts`
- Modify: `apps/hub-api/src/ausencias/service.ts:515-538`

- [ ] **Paso 1: Escribir el test que falla**

Añade dentro del `describe('la segunda firma se puede apagar por ficha', ...)` de la tarea 3:

```ts
  it('el maestro dice quién es el de segundo nivel aunque no firme', async () => {
    // Si esto devolviera null, el panel pintaría «una sola firma» donde sí hay
    // alguien arriba, y ocultaría justo lo que la casilla hace visible.
    estado.plantilla[0].aprobadorCorreo = JEFA;
    estado.plantilla[0].requiereSegundaFirma = false;
    const r = await request(app())
      .get('/api/ausencias/empleados')
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .expect(200);
    const ana = r.body.empleados.find((e: any) => e.id === E1);
    expect(ana.segundoAprobadorCorreo).toBeNull();
    expect(ana.informadoCorreo).toBe(GERENCIA);
    expect(ana.requiereSegundaFirma).toBe(false);
  });
```

- [ ] **Paso 2: Correr el test y verlo fallar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- router
```

Esperado: FAIL — `informadoCorreo` llega `undefined`.

- [ ] **Paso 3: Derivar los dos campos**

En `apps/hub-api/src/ausencias/service.ts`, cambia la interfaz y la función:

```ts
/** Un empleado del maestro con su posición en el árbol ya derivada. */
export interface EmpleadoConJefatura extends Empleado {
  /** Quien firmaría en segundo lugar una solicitud suya creada ahora mismo. */
  segundoAprobadorCorreo: string | null;
  /**
   * Quien solo se enteraría del resultado, si su ficha no exige segunda firma.
   * Excluyente con el de arriba, y por eso van los dos: el panel necesita saber
   * QUIÉN está en el escalón de arriba aunque hoy no firme.
   */
  informadoCorreo: string | null;
  /** Su rama del organigrama forma un círculo. Se avisa, no se bloquea. */
  enCiclo: boolean;
}
```

```ts
export async function empleadosConJefatura(db: Pool): Promise<EmpleadoConJefatura[]> {
  const [empleados, enlaces] = await Promise.all([repo.listarEmpleados(db), repo.enlacesActivos(db)]);
  const porCorreo = new Map(enlaces.map((e) => [e.correo, e]));
  const enCiclo = new Set(detectarCiclos(construirIndice(enlaces)).flat());

  return empleados.map((e) => {
    const arriba = aprobadoresDe(e, porCorreo.get(e.aprobadorCorreo.toLowerCase()) ?? null);
    return {
      ...e,
      segundoAprobadorCorreo: arriba.segundo,
      informadoCorreo: arriba.informado,
      enCiclo: enCiclo.has(e.correo.toLowerCase()),
    };
  });
}
```

- [ ] **Paso 4: Correr los dos portones**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: todo verde.

- [ ] **Paso 5: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): el maestro dice quien esta arriba aunque no firme" -- apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.test.ts
```

---

### Tarea 8: La casilla en el Organigrama

`apps/ausencias` **no tiene tests** y su `typecheck` no es portón: aquí el portón es `npm run build --workspace=apps/portal` (que compila la sub-app) y **mirarlo en el navegador**.

**Files:**
- Modify: `apps/ausencias/src/api.ts:17-34, 249-255`
- Modify: `apps/ausencias/src/PanelOrganigrama.tsx`

- [ ] **Paso 1: El espejo manual de los tipos**

`apps/ausencias/src/api.ts` es un espejo **a mano** de `types.ts`: si no se actualiza, el campo no existe para el navegador. En `interface Empleado`, después de `veAdjuntos`:

```ts
  /** Puede abrir CUALQUIER adjunto de CUALQUIER persona. Llave maestra. */
  veAdjuntos: boolean;
  /** Si sus solicitudes necesitan la firma del jefe de su jefe, o basta una. */
  requiereSegundaFirma: boolean;
```

Y en `EmpleadoConJefatura`:

```ts
/** Un empleado del maestro con su posición en el árbol, derivada por hub-api. */
export interface EmpleadoConJefatura extends Empleado {
  segundoAprobadorCorreo: string | null;
  /** El de segundo nivel cuando NO firma. Excluyente con el de arriba. */
  informadoCorreo: string | null;
  enCiclo: boolean;
}
```

- [ ] **Paso 2: La llamada**

En `apps/ausencias/src/api.ts`, junto a `fijarVisor`:

```ts
/** Enciende o apaga la segunda firma de alguien. No mueve lo que ya está en vuelo. */
export const fijarSegundaFirma = (id: string, requiereSegundaFirma: boolean) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/segunda-firma`, {
    requiereSegundaFirma,
  });
```

- [ ] **Paso 3: La fila del panel**

En `apps/ausencias/src/PanelOrganigrama.tsx`, el import, la interfaz `Fila` y `filaInicial`:

```tsx
import { fetchEmpleados, fijarJefe, fijarCopia, fijarVisor, fijarSegundaFirma, type EmpleadoConJefatura } from './api';
```

```tsx
interface Fila {
  aprobadorCorreo: string;
  copiaCorreo: string | null;
  veAdjuntos: boolean;
  requiereSegundaFirma: boolean;
  guardando: boolean;
  error: string | null;
  exito: boolean;
}

const filaInicial = (e: EmpleadoConJefatura): Fila => ({
  aprobadorCorreo: e.aprobadorCorreo,
  copiaCorreo: e.copiaCorreo,
  veAdjuntos: e.veAdjuntos,
  requiereSegundaFirma: e.requiereSegundaFirma,
  guardando: false,
  error: null,
  exito: false,
});
```

- [ ] **Paso 4: Guardar el cuarto campo**

Dentro de `guardar`, después de la llamada a `fijarVisor` (mantén el orden secuencial: cada endpoint devuelve el maestro entero y tiene que ver escrito lo del anterior):

```tsx
      if (fila.veAdjuntos !== empleado?.veAdjuntos) await fijarVisor(id, fila.veAdjuntos);
      if (fila.requiereSegundaFirma !== empleado?.requiereSegundaFirma)
        await fijarSegundaFirma(id, fila.requiereSegundaFirma);
```

Y en `haCambiado`, la cuarta condición:

```tsx
                const haCambiado =
                  fila.aprobadorCorreo !== e.aprobadorCorreo ||
                  fila.copiaCorreo !== e.copiaCorreo ||
                  fila.veAdjuntos !== e.veAdjuntos ||
                  fila.requiereSegundaFirma !== e.requiereSegundaFirma;
```

- [ ] **Paso 5: La columna «2ª firma»**

Sustituye la celda entera (la que hoy sólo pinta texto) por la casilla más los cuatro estados:

```tsx
                    <td className="px-4 py-2.5 text-gray-600">
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          // `!!` por lo mismo que en la casilla de soportes: una
                          // fila de un backend que aún no mande el campo volvería
                          // el checkbox «no controlado» a medio render.
                          checked={!!fila.requiereSegundaFirma}
                          onChange={(ev) =>
                            actualizar(e.id, { requiereSegundaFirma: ev.target.checked, error: null })
                          }
                          aria-label={`Las solicitudes de ${e.nombreCompleto} necesitan dos firmas`}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-100"
                        />
                        Necesaria
                      </label>
                      {/* Se pinta lo GUARDADO (`e`), no lo editado (`fila`): hasta
                          que no se guarde, el servidor no ha recalculado quién
                          queda arriba y enseñarlo antes sería adivinar. */}
                      <div className="mt-1 text-xs">
                        {e.segundoAprobadorCorreo ? (
                          <span title={e.segundoAprobadorCorreo}>{quienFirma(e.segundoAprobadorCorreo)}</span>
                        ) : e.informadoCorreo ? (
                          <span className="text-gray-400" title={e.informadoCorreo}>
                            {quienFirma(e.informadoCorreo)} — solo informado
                          </span>
                        ) : (
                          <span className="text-gray-300">— una sola firma</span>
                        )}
                      </div>
                    </td>
```

- [ ] **Paso 6: El texto que explica qué hace la casilla**

Sustituye el primer párrafo del panel. Lo que no puede faltar es **qué sí pasa** cuando se apaga, no solo qué deja de pasar:

```tsx
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        El <b>jefe inmediato</b> es quien da el primer visto bueno a las solicitudes de esa persona.
        La <b>segunda firma</b> se deduce sola: es el jefe de su jefe. Quien no tenga a nadie por
        encima —porque es su propio jefe— cierra las solicitudes con una sola firma.
      </p>
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        Si desmarcas <b>Necesaria</b>, la solicitud queda aprobada con la firma del jefe inmediato.
        Quien estaba en el segundo escalón <b>sigue recibiendo el correo</b> con el resultado,
        aprobado o rechazado; lo que pierde es tener que firmarlo (y, con ello, el acceso al soporte
        adjunto de esa solicitud).
      </p>
```

- [ ] **Paso 7: El portón del portal**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/portal
```

Esperado: build sin errores.

- [ ] **Paso 8: Verlo en el navegador**

Levanta el portal en local, entra como admin y abre **Vacaciones y Permisos → Organigrama**. Comprueba los cuatro estados de la tabla de la spec:

1. Casilla marcada y alguien arriba → sale el nombre de quien firma.
2. Casilla marcada y nadie arriba (la raíz) → «una sola firma».
3. Desmarca a alguien con jefe de segundo nivel y **guarda** → «`<nombre>` — solo informado» en gris.
4. Cambia el jefe de esa persona a la raíz y guarda → vuelve a «una sola firma».

Comprueba además que el botón **Guardar** se enciende al tocar la casilla y se apaga si la devuelves a su valor original.

- [ ] **Paso 9: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): la casilla de la segunda firma, en el organigrama" -- apps/ausencias/src/api.ts apps/ausencias/src/PanelOrganigrama.tsx
```

---

### Tarea 9: Documentación, portones y cierre

**Files:**
- Modify: `docs/dev/app-ausencias.md`

- [ ] **Paso 1: Documentar**

Lee `docs/dev/app-ausencias.md` entero antes de tocarlo: es documentación viva y hay afirmaciones sobre la cascada («la segunda firma la da siempre el jefe del jefe», o parecidas) que **dejan de ser ciertas** con este cambio. Corrígelas, no te limites a añadir una sección — el patrón de fallo más repetido en esta app es el texto que dejó de ser verdad sin que nada avise.

Contenido mínimo que tiene que quedar dicho, sin copiar la spec:

- Que la segunda firma es **opcional por ficha**, y que se cambia en Organigrama.
- Que quien está arriba pasa de **firmante a informado**: recibe el correo de la aprobación y del rechazo, pero **no** firma, **no** abre el soporte y **no** le cuenta en su historial de aprobaciones.
- Que el reparto se **congela en el alta**, así que cambiar la casilla no mueve lo que ya está en trámite.
- Que `segundo_aprobador_correo` e `informado_correo` son **excluyentes**, y que de esa exclusión depende que el resto del código no tenga condicionales nuevos.
- Que toda la plantilla arrancó con la casilla **encendida** (migración 023, `DEFAULT TRUE`).

- [ ] **Paso 2: Los tres portones, enteros**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api; npm run build --workspace=apps/portal
```

Esperado: los tres en verde. Recuerda el flake de `users.service.test.ts > property tests > 4.5` (~1 de cada 5): si falla solo ese, reejecuta.

- [ ] **Paso 3: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "docs(ausencias): la segunda firma opcional y el papel de informado" -- docs/dev/app-ausencias.md
```

- [ ] **Paso 4: Mezclar en main**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git checkout main; git merge --no-ff feat/segunda-firma-opcional -m "merge: la segunda firma se puede apagar por trabajador"
```

- [ ] **Paso 5: Verificación tras desplegar hub-api**

**hub-api primero, portal después.** En cuanto arranque hub-api, comprueba que la 023 corrió:

```sql
\c "zoho-hub"
SELECT count(*) FILTER (WHERE requiere_segunda_firma) AS con_doble,
       count(*) FILTER (WHERE NOT requiere_segunda_firma) AS con_una
  FROM portal.empleados WHERE activo;
```

Esperado: **todas** en `con_doble` y **cero** en `con_una` — el despliegue no cambia el comportamiento de nadie. Si falla con `column ... does not exist`, la 023 no se aplicó, y la causa casi siempre es no haberla añadido al array `MIGRATIONS` de `db.ts`.

---

## Lo que este plan NO hace

Dicho para que nadie lo añada «de paso»:

- **No registra** en ninguna tabla quién encendió o apagó la casilla. Decisión de la spec: no da acceso a datos personales.
- **No reescribe** las solicitudes en vuelo al cambiar la casilla.
- **No toca** `puedeDecidir`, `puedeVerAdjunto`, `transicionAlDecidir`, `correoDelTurno` ni el historial de aprobaciones. Si acabas necesitando tocarlos, algo se ha desviado del diseño: para.
- **No toca** `COPIA_INCAPACIDADES` ni el circuito de las incapacidades.
- **No añade** un tercer nivel de firma, ni doble firma por tipo de solicitud, ni un interruptor global.
