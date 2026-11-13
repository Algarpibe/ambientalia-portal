# Ausencias — cargo editable desde la pestaña Empleados

**Fecha:** 2026-11-13
**Estado:** diseño aprobado; pendiente de plan.
**Depende de:** la pestaña Empleados (`apps/ausencias/src/ImportarEmpleados.tsx`) y las puertas
del organigrama en hub-api (`service/organigrama.ts`, `repo/empleados.ts`, `router.ts`), en
producción.

## 1. Objetivo

Que el administrador pueda poner, cambiar o quitar el **cargo** de cualquier ficha activa desde
la pestaña Empleados.

Hoy ninguna pantalla lo permite: las fichas que se crean solas al entrar por primera vez
(`asegurarEmpleado`) o con «Dar de alta desde el portal» nacen sin cargo, y la vía que lo
rellenaba —pegar la hoja de Google— se retiró. Ya hay fichas reales en producción así.

## 2. Decisiones (cerradas en brainstorming)

- **Opción B:** una pantalla para editarlo, en la propia celda Cargo de la tabla de Activos.
- **Una fila a la vez**, como al registrar una baja.
- **Vacío = sin cargo:** guardar el campo vacío (o solo con espacios) deja `null` y la celda
  vuelve a «—».
- **Sin historial:** el cargo no da ningún permiso, igual que la copia o la segunda firma, que
  tampoco lo dejan.
- **Sin correo:** cambiar el cargo no avisa a nadie.
- **Solo fichas activas**, con el mismo criterio `AND activo` que el resto de puertas de la
  ficha.

## 3. hub-api

### 3.1 Repositorio — `repo/empleados.ts`

Función nueva junto a `fijarCopia`:

```ts
fijarCargo(db: Pool, empleadoId: string, cargo: string | null): Promise<boolean>
```

`UPDATE portal.empleados SET cargo = $2 WHERE id = $1 AND activo`. Devuelve `false` si la ficha
no existe o está inactiva, igual que `fijarJefe` y `fijarCopia`. No valida nada: eso es cosa del
servicio.

### 3.2 Servicio — `service/organigrama.ts`

Función nueva junto a `fijarCopia`:

```ts
fijarCargo(db: Pool, empleadoId: string, body: unknown): Promise<Empleado>
```

Reglas, en este orden:

1. `body.cargo` tiene que ser `string` o `null`. Cualquier otra cosa (número, booleano, la
   clave ausente) → **400 `cargo_invalido`**, campo `cargo`.
2. Si es cadena, se recorta (`trim`). Si queda vacía → `null`.
3. Si contiene un **carácter de control** (U+0000–U+001F o U+007F) → **400 `cargo_invalido`**.
   El NUL es el caso que importa: PostgreSQL lo rechaza en una columna de texto y la ruta
   respondería un 500. Los demás (tabulador, salto de línea…) no caben en un cargo de una sola
   línea y descolocarían la firma de los correos.
4. Si pasa de **255 caracteres** → **400 `cargo_invalido`**. Se cuentan por puntos de código
   (`[...texto].length`) y no con `.length`, porque así es como cuenta `VARCHAR(255)`: un emoji
   es un carácter para PostgreSQL y dos unidades UTF-16 para JavaScript.
5. `repo.fijarCargo` devuelve `false` → **404 `empleado_no_encontrado`**.
6. Devuelve la ficha releída con `repo.empleadoPorId` (si ya no está → 404
   `empleado_no_encontrado`).

Devuelve `Empleado` y no `EmpleadoConJefatura`, al contrario que `fijarJefe` y `fijarCopia`: el
cargo no toca el árbol, y recalcular `empleadosConJefatura` serían tres consultas para nada. La
pantalla recarga la lista de todos modos.

### 3.3 Ruta — `router.ts`

`PUT /api/ausencias/empleados/:id/cargo`, detrás de `requireAuth, requireAdmin`, justo después
de `/copia` y con la misma forma (`sendError(res, e, 'ausencias_fijar_cargo')`). Cuerpo:
`{ cargo: string | null }`. Respuesta 200: la ficha (`Empleado`).

### 3.4 Efecto en lo que ya existe

Ninguno que haya que tocar. El cargo nuevo se ve en el acto, también en las solicitudes que ya
están en trámite, porque los dos sitios que lo usan lo leen de la ficha en el momento:

- la firma de los correos (`service/sesion.ts`, desde la ficha de quien firma);
- `empleadoCargo` de las solicitudes y del registro (JOIN con `portal.empleados` en
  `repo/filas.ts` y `repo/registro.ts`).

Sin migración: la columna `portal.empleados.cargo VARCHAR(255)` existe desde la 015.

## 4. Pantalla (apps/ausencias)

### 4.1 Cliente — `api/organigrama.ts`

```ts
fijarCargo(id: string, cargo: string | null): Promise<Empleado>
```

`PUT /api/ausencias/empleados/:id/cargo` con su **propio lector de errores** (`errorDeCargo`,
patrón de `errorDeNota`), porque `mensajeDeError` enseñaría el código crudo `cargo_invalido` en
un 400 y «No se pudieron cargar los datos (error 404)» en un 404:

- `cargo_invalido` → «El cargo admite hasta 255 caracteres y no puede llevar saltos de línea ni
  caracteres de control.»
- 404 con `error: 'empleado_no_encontrado'` → «Esa ficha ya no está activa. Recarga la lista.»
- Cualquier otra cosa → `errorGenerico`. Esto incluye un 404 **sin** ese código: es lo que
  contestaría un hub-api antiguo si el portal se desplegara antes y la ruta no existiera
  todavía, y decir «la ficha no está activa» sería mentir.

### 4.2 `ImportarEmpleados.tsx`

- Estado nuevo `edicionCargo: { id: string; texto: string } | null`, separado del de la baja
  (`edicion`). Comparten `guardando`.
- **Celda sin editar:** el cargo (o «—») y un botón de lápiz (`Pencil` de lucide-react) con
  `aria-label` «Editar el cargo de {nombre}».
- **Al pulsar el lápiz:** un `<input type="text">` con el foco puesto, `maxLength={255}`,
  `aria-label` «Cargo de {nombre}» y precargado con el cargo actual (o vacío). Al lado,
  **Guardar** (desactivado mientras se guarda esa fila; dice «Guardando…») y **Cancelar**.
- **Teclado:** Enter guarda y Esc cancela.
- **Una fila a la vez:** pulsar el lápiz de otra fila abandona la edición anterior sin guardar.
- **Al guardar:** manda el texto tal cual (el recorte y el vacío → `null` los decide el
  servidor), cierra la edición, pone el aviso verde «Cargo de {nombre} actualizado.» y recarga
  la lista con `setRecarga`, como hacen la baja y el alta.
- **Si falla:** el mensaje del lector de errores sale en la caja roja que ya existe, y la
  edición sigue abierta con lo tecleado para poder corregirlo.

## 5. Verificación

- **BD (`*.db.test.ts`):** `fijarCargo` cambia el cargo de una ficha activa; con `null` lo
  borra; con una ficha inactiva devuelve `false` y no la toca; con un id inexistente devuelve
  `false`.
- **Unitarios del servicio:** tipos no válidos y clave ausente → 400; recorte; vacío y solo
  espacios → `null`; NUL y salto de línea → 400; 255 caracteres pasa y 256 no; un emoji cuenta
  como un carácter (255 emojis pasan); ficha inexistente o inactiva → 404.
- **Ruta (supertest):** 403 para quien no es admin, 200 con la ficha para el admin, 400 y 404
  con su código.
- **Front:** tests de `errorDeCargo` (los tres casos, incluido el 404 sin código) y del panel en
  jsdom: el lápiz abre el campo con el cargo actual; Enter guarda y llama a `fijarCargo`; Esc
  cancela sin llamar; abrir otra fila cierra la primera; el error deja la edición abierta.
  Portón: `npm run typecheck`, `npm test` y `npm run build`.
- **Candados falsados** rompiendo el código de verdad (el `AND activo`, el recorte, el conteo
  por puntos de código, el carácter de control, el `requireAdmin`).
- **Trampas conocidas de hub-api:** el doble en memoria de `router.test.ts` tiene que modelar
  `fijarCargo` (su candado exige que modele exactamente las funciones de `repo.ts`); revisar las
  listas `TROZOS` de los `barril.test.ts` aunque no se cree ningún módulo nuevo.

## 6. Despliegue

hub-api primero y el portal después. Sin migración. Si el portal llegara antes, el lápiz
fallaría con el mensaje genérico (§4.1) y no se rompería nada más.

## 7. Fuera de alcance

- Historial de cambios del cargo.
- Editar otros campos de la ficha (nombre, correo).
- Dar de baja una ficha duplicada sin cargo que se vio en producción: es una decisión aparte.
