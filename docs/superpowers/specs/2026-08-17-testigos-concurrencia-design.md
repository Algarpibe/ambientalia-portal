# Diseño — Los testigos de concurrencia se prueban contra Postgres de verdad

## Objetivo

Que romper un testigo de concurrencia de la app Vacaciones y Permisos ponga un
test en rojo **por lo que hace**, y no por el texto que tiene escrito.

Hoy ningún test ejecuta el SQL de `repo.ts`. `router.test.ts:110` hace
`vi.mock('./repo.js')` y lo sustituye entero por un doble in-memory; `repo.test.ts`
usa un `Pool` falso que devuelve filas fijas. Lo único que vigila los testigos son
unas aserciones sobre el texto de las consultas y unos comentarios en el código.

## Lo que realmente está descubierto

Tres cosas, verificadas leyendo el código y no supuestas. La primera corrige el
planteamiento con el que se abrió el trabajo:

1. **El `IN (...)` sí pondría rojo un test, hoy.** La aserción de `repo.test.ts:131`
   busca el literal `AND s.estado = $8`, y sustituirlo por un `IN` lo borra. El
   comentario de `repo.ts` que afirma lo contrario habla de «los 677 tests», es
   decir, de antes de que esa aserción existiera. Es texto que dejó de ser cierto.

2. **La desalineación de parámetros pasa entera.** El literal `$8` puede seguir en
   el SQL mientras el array deja de mandar el `estadoEsperado` en esa posición:
   basta con añadir un campo a `DatosModificacion` e insertarlo antes en el array.
   Test verde, testigo muerto. Es el modo de fallo más plausible de los tres, y el
   que ninguna aserción de forma puede cubrir por construcción.

3. **`decidirSolicitud` no tiene ni siquiera eso.** Su `WHERE id = $1 AND estado = $7`
   (`repo.ts:1057`) no lo vigila ninguna aserción: `repo.test.ts` solo importa
   `crearModificacion` y `decidirModificacion`. Cero cobertura de cualquier clase,
   arrastrada desde la 018.

Un cuarto hallazgo, del mismo tipo: el test del `23505` es **circular**. El pool
falso fabrica el nombre `ux_modificaciones_una_pendiente` que el código compara,
así que renombrar el índice en una migración deja el test verde y devuelve un 500
en producción.

## Decisiones

### Postgres real en Docker, y no pg-mem ni más aserciones de forma

Un motor en memoria queda descartado por el propio esquema: la 024 lleva un
`DO $$` que consulta `pg_constraint` y `pg_get_constraintdef` para localizar un
CHECK por `conkey`, y la 001 exige `pgcrypto` y `gen_random_uuid()`. Un subconjunto
de Postgres no digiere eso, y un esquema de test recortado para que quepa sería una
mentira nueva encima de la que venimos a quitar.

Endurecer las aserciones de forma tampoco alcanza: protegerían el contrato del
driver, nunca la semántica del motor. El ROLLBACK de `decidirModificacion` es el
ejemplo — hoy se comprueba que la cadena `'ROLLBACK'` aparece en un array, no que
la propuesta siga `pendiente` después.

La concurrencia real **no hace falta** para falsar un testigo optimista. Basta
intercalar en secuencia: se lee el estado, otro lo cambia, y la operación se
ejecuta con el estado viejo. Debe afectar a cero filas.

### Cuarto portón aparte

`npm run test:db --workspace=apps/hub-api`, con `vitest.db.config.ts` que incluye
solo `**/*.db.test.ts`, y un `vitest.config.ts` nuevo que los excluye del run
normal conservando `configDefaults.exclude`.

El portón de siempre queda idéntico: mismos tests, mismos segundos, sin Docker.
El coste aceptado es acordarse de correr el cuarto; se documenta en
`docs/dev/app-ausencias.md` y en el flujo de subagentes.

### El esquema sale del array real de migraciones

Se extrae de `db.ts:53-58` el bucle a `export async function aplicarMigraciones(db)`,
que `initDb()` pasa a llamar. `initDb()` no se reutiliza tal cual: hace
`process.exit(1)` sin `HUB_DB_URL` —mataría a vitest— y siembra usuarios desde
`AUTH_USERS`.

Así el contenedor recorre el mismo array `MIGRATIONS`, y es imposible que el
esquema de test envejezca por su cuenta. Añadir la 026 sin apuntarla en el array
—el olvido que no da error— se delata aquí.

### Aislamiento por TRUNCATE, no por transacción

`TRUNCATE ... RESTART IDENTITY CASCADE` de las tablas implicadas en un `beforeEach`.
Envolver cada test en una transacción no sirve: el código bajo prueba abre las
suyas con `withTransaction`, y anidarlas exigiría savepoints, que es justo lo que
no se quiere simular — el ROLLBACK real es una de las cosas que se vienen a probar.

### El pool es el de producción

`createPoolFromUrl(...)` de `@algarpibe/zoho-sync` apuntando al contenedor, y el
sembrado con las funciones reales del repo (`asegurarEmpleado`, `crearSolicitud`).
Ningún doble, y ningún esquema duplicado en los tests.

## Los cinco tests

1. **`decidirSolicitud`, el doble clic.** Solicitud `pendiente` con segunda firma.
   Dos llamadas con el **mismo** `estadoEsperado: 'pendiente'`: la primera devuelve
   la solicitud ya en `pendiente_2`, la segunda `null`, y el outbox tiene un evento.
   *Falsación:* con `estado IN ('pendiente','pendiente_2')` y un CASE, la segunda
   encadena `pendiente_2 → aprobada` y la solicitud queda concedida con una sola
   persona firmando las dos veces.

2. **`crearModificacion`, la foto que miente.** Solicitud `pendiente`, el jefe la
   aprueba entre medias, y se pide el cambio con `estadoEsperado: 'pendiente'`.
   Sale `{ok:false, razon:'estado'}`, con la tabla de propuestas y el outbox vacíos.
   *Falsación:* con el `IN (...)` la propuesta se guarda con `estado_previo =
   'pendiente'` sobre algo que ya está aprobada y en el calendario de Google.

3. **El testigo triple, la corrección pisada.** Solicitud `aprobada` del 6 al 10,
   propuesta viva, y un admin corrige las fechas por PATCH a 7-11. Al aprobar:
   `{ok:false, razon:'solicitud_cambio_de_estado'}`, la propuesta **sigue
   `pendiente`**, la solicitud conserva 7-11 y el outbox está vacío.
   *Falsación:* quitando los dos campos de fecha del `WHERE`, la aprobación pisa la
   corrección en silencio, que es el fallo que nadie detecta porque el PATCH no
   encola nada.

4. **El `23505` emitido por Postgres.** Dos `crearModificacion` seguidas sobre la
   misma solicitud: la segunda, `{ok:false, razon:'duplicada'}`. Deja de ser
   circular — el nombre del índice lo pone la migración, no el test.

5. **Las migraciones.** Base virgen, aplicar las 21, y aplicarlas **otra vez** sin
   error. Además, encolar un `modificacion_solicitada` en el outbox: es el test de
   regresión del `22001` del 2026-08-17 y cubre las dos restricciones distintas, el
   CHECK y el ancho de la columna.

## Qué se borra y qué se queda

Las dos aserciones de forma sobre los testigos **se borran**: quedan cubiertas por
comportamiento, y mantenerlas solo aporta roturas por reformateo. También la de
«aprobar un cambio de fechas NO escribe el estado», que pasa a comprobarse mirando
que la solicitud sigue `pendiente` después de aprobar el cambio.

`repo.test.ts` **se queda** con lo que Postgres no puede dar sin ensuciar el
esquema: la traducción de un `23505` de otro constraint, y el error que no es
`23505`. Ese fichero sigue siendo el sitio de los errores del driver.

## El texto que hay que actualizar

Va en el mismo trabajo, no después:

- Los comentarios de `repo.ts` que dicen «NINGUN TEST EJECUTA ESTE SQL» (dos, en
  `crearModificacion` y en `TESTIGO_SOLICITUD`) y el que cuenta «los 677».
- La deuda anotada en `docs/dev/app-ausencias.md`, que pasa a describir el cuarto
  portón y cómo se corre.
- La cabecera de `repo.test.ts`, que hoy afirma ser «los únicos tests del repo que
  no necesitan Postgres» — cierto, pero deja de ser toda la historia.

## Protocolo de falsación

Cada candado se rompe **de verdad** en el código, se corre `test:db`, se comprueba
que sale rojo por ese motivo y se revierte. Los cinco resultados se reportan con su
salida. Un candado que pasa por construcción no es un candado, y esta app ya tuvo
uno: el del solicitante que no puede autoaprobarse, que daba 403 por otra rama.

## Lo que NO entra

Los demás invariantes que solo viven en SQL: `ausenciasEntre` con su
`estado <> 'rechazada'` que falla en abierto, las bandejas de pendientes y el
cálculo del saldo. El harness los deja al alcance, pero ampliar ahora convertiría
esto en una reescritura de la capa de tests.

Tampoco entra el doble in-memory de `router.test.ts` (~445 líneas modelando un
`repo.ts` de 1659). Sigue siendo deuda anotada.

## Asunciones

- **Imagen `postgres:16-alpine`.** No está confirmada la versión que corre EasyPanel.
  Si es otra, es un cambio de una línea en el `globalSetup`, pero hasta confirmarlo
  la fidelidad del harness es una suposición.
- **Docker arrancado** al correr el cuarto portón. Verificado disponible en la
  máquina de desarrollo (29.6.2, demonio respondiendo).
- `@testcontainers/postgresql` como dependencia de desarrollo, por la espera de
  readiness y la limpieza del contenedor cuando la suite peta a medias.
