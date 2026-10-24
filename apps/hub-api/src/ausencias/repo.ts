// Acceso a datos de la app de ausencias. SQL crudo con parámetros posicionales,
// como el resto del repo (no hay ORM). Todas las tablas van cualificadas con
// `portal.` — la BD zoho-hub tiene un `public` ajeno.
//
// ARQ-612 — este fichero ya no tiene SQL: es el barril de repo/, la ÚNICA
// puerta por la que el resto del código llega a los trozos. service.ts y
// router.ts los llaman como `repo.*`, y el doble de router.test.ts compara sus
// exportaciones con las de este fichero. Lo vigila repo/barril.test.ts.

// La transacción, el candado por empleado (DATA-336) y el recorte por rama
// viven en repo/comun.ts, y de ahí solo se reexporta lo que ya se exportaba
// desde aquí antes de partirlo: el resto lo importan los trozos directamente.
export { conCandadoDelEmpleado, ramaDeDosNiveles, type Consultable, type PoolClient } from './repo/comun.js';

// ── Empleados y organigrama ────────────────────────────────────────────────

// ARQ-612 — en repo/empleados.ts, los dos juntos: comparten las columnas y la
// traducción de la ficha. Se reexporta todo, como los grupos de abajo.
export * from './repo/empleados.js';

// ── Saldos: vacaciones y compensatorios ────────────────────────────────────

// ARQ-612 — en repo/saldos.ts (y la traducción de la fila, compartida con la
// baja, en repo/filas.ts, que es interno y NO se reexporta).
export * from './repo/saldos.js';

// ── Llaves de la ficha (visores y exportadores) ────────────────────────────

// ARQ-612 — en repo/visores.ts. Se reexporta todo, como los KPIs de abajo.
export * from './repo/visores.js';

// ── Panel de KPIs ──────────────────────────────────────────────────────────

// ARQ-612 — en repo/kpis.ts. Se reexporta todo: service.ts las llama como
// `repo.*` y el doble de router.test.ts compara sus exportaciones con estas.
export * from './repo/kpis.js';

// ── Histórico importado de la hoja ─────────────────────────────────────────

// ARQ-612 — en repo/historico.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/historico.js';

// Aquí estaba `todasLasSolicitudes`, la compañía entera sin acotar por nadie,
// que servía al `GET /ausencias/historico` de admin. La sustituye `movimientos`
// (en repo/registro.ts): trae también las anulaciones y los cambios, y sobre
// todo acepta un `soloDe` con el que el servicio recorta por rama. Una consulta
// sin recorte que no llama nadie es una que alguien acaba llamando desde una
// ruta sin guard.

// ── Solicitudes ────────────────────────────────────────────────────────────

// ARQ-612 — en repo/solicitudes.ts; las consultas base y la traducción de la
// fila, en repo/filas.ts (interno). Se reexporta todo lo de solicitudes.
export * from './repo/solicitudes.js';

// ── Modificaciones ─────────────────────────────────────────────────────────

// ARQ-612 — en repo/modificaciones.ts: pedirlas, decidirlas, retirarlas y
// leerlas, con sus clases de error. Se reexporta todo.
export * from './repo/modificaciones.js';

// ── Correcciones de admin ──────────────────────────────────────────────────

// ARQ-612 — en repo/correcciones.ts: corregir y borrar, desde «Registro
// general», una solicitud o una fila del registro de movimientos. Se reexporta
// todo, como los grupos de arriba.
export * from './repo/correcciones.js';

// ── Adjuntos ───────────────────────────────────────────────────────────────

// ARQ-612 — en repo/adjuntos.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/adjuntos.js';

// ── Outbox ─────────────────────────────────────────────────────────────────

// ARQ-612 — el lado lector, en repo/outbox.ts. Los INSERT de eventos se quedan
// dentro de las transacciones que los encolan, en repo/solicitudes.ts,
// repo/modificaciones.ts y repo/correcciones.ts.
export * from './repo/outbox.js';

// ── Calendario ─────────────────────────────────────────────────────────────

// ARQ-612 — en repo/calendario.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/calendario.js';

// ── Solapes ────────────────────────────────────────────────────────────────

// ARQ-612 — en repo/solapes.ts. Se reexporta todo; los trozos que escriben y
// comprueban el solape (repo/modificaciones.ts y repo/correcciones.ts) lo
// importan de ahí directamente.
export * from './repo/solapes.js';

// ── El registro de movimientos ─────────────────────────────────────────────

// ARQ-612 — en repo/registro.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/registro.js';

// ── Baja de empleados ──────────────────────────────────────────────────────

// ARQ-612 — en repo/retiro.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/retiro.js';
