# Diseño — Tipo de servicio sugerido por el vencimiento de la calibración (Trazabilidad Mantenimientos)

Aprobado por Alfonso el 2026-11-24.

## Objetivo

En la pestaña «Servicios», cuando un ticket llega **sin tipo de servicio** y su
equipo entró con la calibración vencida o a punto de vencer, la app **sugiere**
el tipo «Diagnóstico + Calibración». Una persona lo confirma con un clic. La app
nunca pone el tipo por su cuenta.

## Por qué es una sugerencia y no un cambio automático

El tipo de servicio decide el plazo del ticket (días hábiles) y la duración de
sus etapas en la agenda. Si la app lo adivinara mal, el reloj del servicio
cambiaría sin que nadie lo viera. Además, un equipo que llega vencido puede venir
en realidad por una avería.

## Regla

La sugerencia aparece solo si se cumplen las tres condiciones:

1. **El ticket no tiene tipo**: ni el de Desk ni uno puesto a mano
   (`tipoEfectivo` vacío). Si tiene tipo, no se sugiere nada.
2. **Su serial casa con un equipo del inventario** (`EN_INVENTARIO`: en
   seguimiento o de una marca incluida) **y la vigencia de ese equipo tiene
   días** (`vigenciaDeEquipo` distinto de null). Hoy, en la práctica, solo GRIMM
   EDM 180 (365 días). Las marcas sin vencimiento y las marcas apagadas, como
   Horiba, no reciben sugerencia.
3. **El día de entrada del ticket** (`ingreso`, el mismo que usa el plazo), la
   calibración del equipo ya estaba vencida o vencía en **60 días o menos**.
   Para equipos vencidos no hay límite hacia atrás, así que también se sugiere
   para los que llevan más de un año vencidos (`FUERA_CICLO`).

La fecha de referencia es el **ingreso**, no hoy: si el equipo se calibra
durante este mismo servicio, la sugerencia no puede desaparecer por eso.

**La calibración que cuenta el día de entrada** se calcula con la regla que ya
existe:

- Si el equipo tiene filas en `tmc_calibraciones`, vale
  `calibracionQueCuenta(filas, ingreso)`, que solo mira filas vigentes con fecha
  igual o anterior al ingreso.
- Si no tiene ninguna fila, ni siquiera anulada, vale la fecha de respaldo del
  inventario, pero solo si es igual o anterior al ingreso. Es el mismo criterio
  de `fechaEfectiva`.
- Si no hay ninguna fecha, no hay sugerencia.

**El vencimiento** es la última calibración más la vigencia, calculado con
`estadoCalibracion(ultima, ingreso, vigencia)`. Se sugiere cuando
`vigenciaDias <= 60`, valor que incluye los negativos (vencida).

**El tipo sugerido** es siempre «Diagnóstico + Calibración» (clave
`diagnostico + calibracion`, sembrada por la migración 045). Si esa fila no
estuviera en `portal.tmc_plazos`, no se sugiere nada.

**Seriales repetidos**: se elige el equipo con el mismo orden que ya usa
`CLIENTE_POR_SERIAL`, primero el que está en el inventario, luego el activo y
luego por clave. Si el elegido no está en el inventario, no hay sugerencia.

## Servidor (hub-api)

- **Función pura nueva** en `src/trazabilidad/dominio.ts`, reexportada a la
  sub-app por `src/dominio.ts`. Recibe el tipo efectivo, la última calibración al
  ingreso, la vigencia en días, el ingreso y el tipo sugerido disponible.
  Devuelve `{ clave, etiqueta, vence } | null`. El umbral es una constante con
  nombre: `UMBRAL_SUGERENCIA_DIAS = 60`.
- **`listarServicios`** añade a cada `ServicioVista` el campo
  `tipoSugerido: { clave: string; etiqueta: string; vence: string } | null`.
  Solo tiene valor en los tickets sin tipo. Los datos que faltan (equipo por
  serial con marca, cliente y seguimiento; sus filas de calibración; las
  vigencias con `leerVigencias`) se leen en las consultas que ya lanza la
  función o en una más, en paralelo con las actuales.
- **No hay ruta nueva.** Confirmar la sugerencia usa la que ya existe,
  `PUT /trazabilidad/servicios/:numero/tipo`, con la misma validación, el
  permiso `servicios.tipo.write` y la firma en `tmc_servicios_tipo`.
- **No hay migración ni tabla nueva**, y la sugerencia no se guarda en ningún
  sitio: se recalcula en cada lectura.

## Pantalla (sub-app)

- En `TipoSelect`, cuando `s.tipoSugerido` no es null, aparece junto al
  desplegable una etiqueta ámbar: «Sugerido: Diagnóstico + Calibración —
  vencía el 12/03/2026». Dice «vence el» si la fecha es posterior al ingreso.
- Junto a la etiqueta va el botón **«Usar»**, que llama a `onCambio` con la clave
  y la etiqueta sugeridas: hace lo mismo que elegir el tipo en el desplegable.
- Quien no tiene el permiso (`bloqueado`) ve la etiqueta pero no el botón.
- Mientras se guarda otro ticket (`guardando`), el botón se desactiva igual que
  el desplegable.
- El texto de la etiqueta lo produce una función pura en `src/lib`, con pruebas.

## Qué no hace

- No cambia el tipo de ningún ticket por su cuenta.
- No escribe en Desk ni en Desk 2.0.
- No cambia el plazo ni la agenda de un ticket hasta que alguien confirma.
- No sugiere otros tipos ni usa otras señales, como el asunto o el historial
  del equipo.

## Pruebas

Las pruebas se escriben antes que el código (TDD) en la lógica pura:

- Función de la regla (hub-api): vencida; vencida hace más de un año; a 60 días
  justos (sí); a 61 (no); sin calibración (no); vigencia null (no); ticket con
  tipo de Desk o puesto a mano (no); tipo sugerido inexistente en Configuración
  (no); calibración posterior al ingreso que no cuenta.
- Base de datos (`trazabilidad.db.test.ts`): `listarServicios` devuelve
  `tipoSugerido` para un GRIMM vencido sin tipo, null con tipo y null para un
  equipo de marca sin vigencia.
- Sub-app (`src/lib`): el texto «vencía el» o «vence el».
- Solo datos ficticios: el repositorio es público.

## Alcance

Un solo lote, por debajo de 800 líneas cambiadas. El orden de despliegue es el
habitual: primero hub-api y justo después el portal.
