# Equipos en taller — Responsable asignado desde la tabla (diseño)

Fecha: 19/11/2026. Estado: aprobado por el dueño, pendiente de plan. Diseño base de la app: `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`.

## Por qué

Hoy la columna «Responsable» de la tabla es el Encargado del ticket en Desk 2.0 (`cf_encargado`, en `Ticket.enc` / `Fila.z.enc`). El portal no puede cambiarlo: su acceso a Desk 2.0 es de solo lectura a propósito. Además, los equipos sin ticket no tienen responsable, y «Mis equipos» reconoce al técnico solo por parecido de nombre (`apps/equipos-taller/src/tecnico.ts`).

Se quiere poder asignar el responsable de cada equipo desde la tabla, eligiendo entre los usuarios que tienen la app «Equipos en taller».

## Decisiones

- **D1. La asignación vive solo en el portal.** Desk 2.0 no cambia. El dueño acepta que Desk 2.0 y el portal puedan mostrar personas distintas para el mismo equipo.
- **D2. Por visita, no por equipo.** La asignación se guarda con la clave de la visita (`claveFila`: serial normalizado + `|` + fecha de entrada, `nucleo/pantalla.ts`). Si el equipo vuelve al taller, la nueva visita empieza sin asignación y muestra el Encargado de Desk.
- **D3. Tabla propia, con el usuario y no el nombre.** No se reutiliza `portal.equipos_ajuste`: su clave es `PRIMARY KEY`, así que una visita con un ajuste («Retirado», «En taller»…) no podría tener además responsable. Se guarda el `user_id` para que «Mis equipos» reconozca al técnico por su cuenta y para que un cambio de nombre no deje la asignación huérfana.
- **D4. Quién asigna:** quien tenga la llave «Edita ajustes» o sea admin (la misma comprobación que los ajustes manuales, `exigirEditar` en `router.ts`).
- **D5. A quién se puede asignar:** usuarios activos con la app `equipos-taller` asignada (`portal.user_apps`). Un admin sin la app no aparece (mismo criterio que «Tablero TV» en el menú).
- **D6. Vigencia:** una asignación solo cuenta mientras su usuario siga activo y con la app. Si deja de cumplirlo, la visita vuelve a mostrar el Encargado de Desk; la fila se conserva y vuelve a contar si recupera el acceso. Si el usuario se borra, sus asignaciones se borran.
- **D7. Regla de precedencia única:** asignación del portal vigente → si no, Encargado de Desk → «Pendiente Asignar» de Desk se sigue mostrando como «Sin asignar». La aplican la tabla, el tablero, la TV y «Mis equipos».
- **D8. Se guarda al elegir**, sin botón «Guardar»: es un solo valor y se deshace con otra elección. Si falla, el selector vuelve al valor anterior y se muestra el error.

## Datos (hub-api)

**Migración `078_equipos_responsable.sql`** (en `apps/hub-api/src/users/migrations/`, registrada en `MIGRATIONS` de `src/db.ts`). Idempotente y sin datos sembrados, porque las migraciones se re-ejecutan en cada arranque.

```sql
CREATE TABLE IF NOT EXISTS portal.equipos_responsable (
  clave            text        PRIMARY KEY
                               CHECK (clave ~ '^[A-Z0-9]{3,20}\|\d{4}-\d{2}-\d{2}$'),
  user_id          uuid        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  asignado_por_id  uuid        NULL REFERENCES portal.users(id) ON DELETE SET NULL,
  asignado_por     text        NOT NULL,
  asignado_en      timestamptz NOT NULL DEFAULT now()
);
```

- La expresión de la clave es la de las visitas de `portal.equipos_ajuste` (071), sin las variantes `*serial` ni `pdf:`.
- `asignado_por` guarda el nombre de quien asignó en ese momento, como `usuario` en los ajustes.
- Lleva el mismo bloque DATA-332 que la 071: `GRANT SELECT, INSERT, UPDATE, DELETE ON portal.equipos_responsable TO portal_app` cuando el rol existe.
- La clasificación de cada hora no toca esta tabla: solo reescribe `foto`, `exits` y `ent` de `portal.equipos_estado`.

**Repo** (`src/equipos/repo.ts`):

- `listarResponsables()`: solo las asignaciones vigentes (D6), con el nombre actual del usuario (`full_name`) por `JOIN` con `portal.users` y `portal.user_apps`.
- `guardarResponsable(clave, userId, quien)`: upsert por clave.
- `borrarResponsable(clave)`: idempotente.
- `listarTecnicos()`: usuarios activos con la app, por `lower(full_name)`.
- `esTecnicoValido(userId)`: activo y con la app, para validar la asignación.

## API (`/api/equipos-taller`)

| Método y ruta | Quién | Respuesta |
|---|---|---|
| `GET /` (existente) | quien tiene la app | añade `responsables: Record<clave, ResponsableAsignado>` |
| `GET /tecnicos` | llave «Edita ajustes» o admin | `{ tecnicos: { userId, nombre }[] }` |
| `PUT /responsables/:clave` con `{ userId }` | llave o admin | 200 `{ responsable }` |
| `DELETE /responsables/:clave` | llave o admin | 200 `{ ok: true }`, también si no había asignación |

- `ResponsableAsignado = { userId, nombre, por, en }` (en `contrato.ts`).
- Errores, siempre en JSON:
  - 400 si la clave no es de visita o falta `userId`;
  - 403 `sin_llave`;
  - 422 `usuario_sin_app` si el usuario no está activo o no tiene la app.
- **TV con llave de kiosco:** `servicio-tablero.ts` lee las asignaciones y `armarRespuestaTablero` las aplica en el servidor. La respuesta del kiosco solo lleva nombres, nunca `userId`. Las pruebas de amenazas T1–T8 de `router-kiosco.test.ts` siguen en verde.

## Núcleo (puro, `apps/hub-api/src/equipos/nucleo`)

- `Fila` gana un campo opcional `resp?: { userId?: string; nombre: string; por?: string; en?: string }`.
- `aplicarResponsables(rows, mapa)` lo rellena por `claveFila`. Se encadena después de `aplicarAjustes` en todos los sitios que hoy lo llaman: `useTableroDatos`, `armarRespuestaTablero` y la tabla.
- `responsableDe(fila)` devuelve el responsable efectivo según D7: `{ nombre, userId?, origen: 'portal' | 'desk' } | null`.
- `tarjetaDe` (`taller-board.ts`) usa `responsableDe` en lugar de leer `r.z?.enc`. `Tarjeta.tecnico` gana `userId?` (vacío cuando el responsable viene de Desk).
- `pureza.test.ts` sigue en verde: nada de esto importa fuera de la carpeta.

## Pantallas (`apps/equipos-taller/src`)

**Tabla (`EquiposServicio.tsx`, `filaEquipo`).** Misma columna, sin rediseño.

- **Con permiso** (`puedeEditar`) y una clave de visita válida, la celda es un selector:
  - primera opción «De Desk: <Encargado>», o «De Desk: sin asignar». Elegirla quita la asignación (`DELETE`);
  - luego los técnicos de `GET /tecnicos`, que se piden una vez al abrir la tabla con permiso.
- Al elegir se actualiza al momento y se llama a la API. Si responde bien, se actualiza `datos.responsables`; si falla, vuelve al valor anterior y avisa con `notify`.
- **Sin permiso**, o en una visita sin clave válida (serial ilegible), se ve solo el nombre, como hoy.
- Un nombre asignado en el portal lleva un `title` con «Asignado por <por> el dd/mm/aaaa».
- Si dos personas asignan a la vez, gana la última. Lo que haya hecho la otra se ve en el siguiente refresco de 60 s.
- `api.ts` gana `tecnicos()`, `asignarResponsable(clave, userId)` y `quitarResponsable(clave)`.

**Tablero y TV.** La tarjeta muestra el responsable efectivo (`Tarjeta.tecnico`). No hay nada editable: el tablero sigue siendo de solo lectura.

**«Mis equipos».**

- Una tarjeta es tuya si `tecnico.userId` es tu usuario (`profile.id`: `RutaMisEquipos` pasará a mandarlo junto con `full_name`, que es lo único que manda hoy).
- Si la tarjeta no tiene asignación del portal, se mantiene lo de hoy: tu nombre frente al Encargado de Desk (`coincideTecnico` / `esDe`), con el selector «¿Quién eres?» recordado en el dispositivo.
- Si el portal asignó la visita a otra persona, no te aparece aunque Desk diga que es tuya.

## Errores

- El manejador final `src/errores-json.ts` garantiza JSON en cualquier fallo del servidor.
- Un fallo al guardar nunca deja la tabla mostrando una asignación que no existe (vuelta atrás de D8).
- Si `GET /tecnicos` falla, la tabla se ve como sin permiso (solo nombres) y avisa una vez.

## Pruebas (TDD estricto: la prueba primero y verla fallar)

- **Núcleo** (`nucleo/*.test.ts`):
  - el portal manda sobre Desk y sin asignación se usa Desk;
  - «Pendiente Asignar» se ve como «Sin asignar»;
  - una visita nueva del mismo serial no hereda la asignación;
  - `tarjetaDe` usa el responsable efectivo.
- **Servidor** (`router.test.ts`, `servicio-tablero.test.ts`, `router-kiosco.test.ts`):
  - 403 sin llave en las tres rutas nuevas;
  - 422 si el usuario no tiene la app, 400 con una clave inválida;
  - asignar, reasignar y quitar;
  - el kiosco no expone `userId`.
- **Base de datos** (`*.db.test.ts`, `--config vitest.db.config.ts`, Docker):
  - la 078 se aplica dos veces sin error y el CHECK rechaza claves `*serial` y `pdf:`;
  - al borrar un usuario se borran sus asignaciones;
  - `listarResponsables` omite usuarios inactivos o sin la app.
- **Pantallas** (`EquiposServicio.test.tsx`, `MisEquipos.test.tsx`, `tecnico.test.ts`, `tablero/Tablero.test.tsx`):
  - el selector solo aparece con permiso;
  - vuelve atrás si falla y la opción «De Desk» quita la asignación;
  - el tablero muestra al asignado;
  - «Mis equipos» encuentra la tarjeta por `userId` aunque el nombre no coincida.
- Datos de prueba inventados. Antes de cada commit: `cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs`.

## Fuera de alcance

- Escribir el Encargado en Desk 2.0: llegará con el cambio futuro de escritura en Desk.
- Asignar desde el tablero, la TV o «Mis equipos».
- Historial de reasignaciones.
- Avisar por correo al técnico asignado.

## Despliegue

Rama `feat/equipos-responsable` → fast-forward a `main` → push. El usuario despliega en EasyPanel **hub-api primero** (migración 078) y después el portal.
