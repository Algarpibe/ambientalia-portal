# Diseño — Tipos de servicio creables desde Configuración (Trazabilidad Mantenimientos)

Aprobado por Alfonso el 2026-11-24.

## Objetivo

En «Configuración» → «Plazos por tipo de servicio» se pueden **crear** tipos de
servicio nuevos, como «Reparación», con el nombre y los días hábiles que se
quieran. Los tipos creados en la app y que ningún ticket abierto usa se pueden
**borrar**. Un tipo nuevo se puede poner a mano a cualquier ticket desde el
desplegable de «Servicios», con su plazo.

## Contexto

- Hoy los tipos aparecen de dos formas: los sembrados por las migraciones (la
  043 siembra Diagnóstico, Calibración, Mantenimiento, Garantía, Otro y No
  aplica; la 045, el compuesto «Diagnóstico + Calibración») y los que traen los
  tickets abiertos de Zoho Desk, que aparecen «sin plazo» hasta que alguien les
  pone uno.
- El servidor ya guarda cualquier tipo con `PUT /trazabilidad/plazos`
  (`guardarPlazo`: `INSERT … ON CONFLICT DO UPDATE`). Lo que falta es una vía
  explícita para crear, con aviso de duplicado, otra para borrar, y la
  pantalla.
- `portal.tmc_servicios_tipo` (044) ya guarda la etiqueta de cada tipo puesto a
  mano «por si su fila de tmc_plazos dejara de existir»: borrar un tipo no deja
  sin nombre a los tickets cerrados que lo tuvieron.
- Los tickets de Zoho Desk no traerán un tipo creado en la app mientras ese
  valor no exista también en el campo de Desk. Si un día se añade allí con el
  mismo nombre, la app lo junta solo (`claveTipoServicio`).

## Reglas

**Crear**
- Nombre obligatorio, de 1 a 80 caracteres tras quitar los espacios de los
  extremos. Tiene que contener al menos una letra o un dígito: así se descarta
  «*», que es la fila por defecto de la agenda.
- Días: un entero entre `PLAZO_MIN_DIAS` y `PLAZO_MAX_DIAS` (1–365), o vacío
  (sin plazo), igual que al editar.
- Si ya existe una fila de `tmc_plazos` con la misma clave normalizada
  (`claveTipoServicio`: sin tildes, mayúsculas ni espacios de más), se responde
  **409 `tipo_existente`** y no se toca nada. Esto incluye el compuesto.
- Un nombre cuya clave sea un tipo compuesto (`partesDeTipo`) se rechaza con
  400, como hoy en `parsePlazo`.
- La fila se guarda firmada (`actualizado_por_id`, `actualizado_por`,
  `actualizado_en`), como al editar un plazo.

**Borrar**
- Solo se pueden borrar los tipos **creados en la app**: los siete sembrados
  por las migraciones 043 y 045 no, porque volverían solos en el siguiente
  arranque (las migraciones se ejecutan en cada inicio con
  `ON CONFLICT DO NOTHING`), y porque el compuesto necesita Diagnóstico y
  Calibración. Las claves sembradas viven en una constante del dominio
  (`TIPOS_SEMBRADOS`), y una prueba vigila que coincida exactamente con lo que
  siembran la 043 y la 045. Borrar uno de ellos responde **409 `tipo_sembrado`**.
- Solo si **ningún ticket abierto** lo usa, ni con el tipo de Desk ni con el
  puesto a mano: el mismo recuento que hoy enseña la columna «Tickets
  abiertos». Si no, **409 `tipo_en_uso`** con el número de tickets.
- Si no existe la fila, **404 `tipo_no_encontrado`**.
- Comprobación y borrado van en **una transacción**: se borran la fila de
  `tmc_plazos` y las filas de `tmc_agenda_duraciones` de esa clave (sus días en
  la agenda), nunca la `'*'`.
- Las filas de `tmc_servicios_tipo` de tickets cerrados no se tocan:
  conservan su etiqueta.

**Permiso:** `config.write`, el mismo que edita los plazos (Director Técnico y
administradores del portal).

## Servidor (hub-api)

- `POST /trazabilidad/plazos` `{ tipo, dias }` → 200 con `{ plazos }`, la lista
  ya actualizada, igual que el `PUT`. Errores: 400 de validación, 409
  `tipo_existente`.
- `DELETE /trazabilidad/plazos/:clave` → 200 con `{ plazos }`. Errores: 404
  `tipo_no_encontrado`, 409 `tipo_sembrado` y 409 `tipo_en_uso`.
- `PlazoServicio` gana `borrable: boolean`, que vale true si el tipo no está
  sembrado, tiene fila propia y tiene `ticketsAbiertos === 0`. La pantalla
  enseña «Borrar» con este campo; el servidor lo vuelve a comprobar al borrar.
- El `PUT /trazabilidad/plazos` actual no cambia.
- No hace falta migración.

## Pantalla (sub-app)

- Al final de la tabla «Plazos por tipo de servicio», solo con `config.write`,
  una fila con una casilla de nombre, una casilla de días hábiles y el botón
  **«Crear»**. La validación de la pantalla es la misma que la del servidor.
  Tras crear se limpian las casillas y se notifica «Tipo «X» creado».
- En las filas `borrable`, solo con `config.write`, el botón **«Borrar»**. Al
  pulsarlo se pide confirmación en la propia fila, sin diálogo del navegador:
  «¿Borrar «X»? También se borran sus días en la agenda.» con los botones
  «Sí, borrar» y «Cancelar».
- El texto de ayuda bajo la tabla añade que los tipos también se pueden crear
  aquí y que solo se borran los creados en la app que ningún ticket abierto usa.
- Los errores del servidor (409 y 400) se enseñan en la tabla con su mensaje.
- La lógica de validar el nombre y los días va en funciones puras de `src/lib`,
  con pruebas.

## Qué no hace

- No escribe en Zoho Desk ni en Desk 2.0.
- No crea tipos compuestos ni permite renombrar: para corregir un tipo nuevo
  sin usar, se borra y se crea otra vez.
- No borra tipos sembrados ni tipos en uso.
- No guarda historial de los borrados: la fila de un tipo sin uso desaparece.

## Pruebas

- Puras con TDD (hub-api): validación del cuerpo de creación (nombre vacío,
  solo símbolos, más de 80 caracteres, compuesto, días fuera de rango, días
  vacíos) y la regla `borrable` (sembrado, en uso, sin uso).
- Una prueba que vigila que `TIPOS_SEMBRADOS` es exactamente lo que siembran la
  043 y la 045, leyendo los .sql.
- BD (`*.db.test.ts`): crear (200 y fila firmada), duplicado con otra grafía
  (409), borrar un tipo sin uso con sus duraciones (200, sin tocar la `'*'` ni
  otras), borrar uno en uso (409), uno sembrado (409) y uno inexistente (404).
- Router: permisos (sin `config.write` → 403) y códigos de error.
- Sub-app (`src/lib`): validación del nombre y de los días.
- Solo datos ficticios: el repositorio es público.

## Alcance

Un lote de menos de 800 líneas cambiadas. Se despliega como siempre: primero
hub-api y justo después el portal.
