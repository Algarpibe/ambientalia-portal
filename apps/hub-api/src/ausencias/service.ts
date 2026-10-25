// Los casos de uso de la app de ausencias: lo que decide el servidor entre la
// ruta (router.ts) y el SQL (repo.ts).
//
// ARQ-612 — este fichero ya no tiene lógica: es el barril de service/, la ÚNICA
// puerta por la que el resto del código llega a los trozos, con el mismo patrón
// que repo.ts. router.ts los llama como `service.*` y los tests importan de
// aquí. Lo vigila service/barril.test.ts, que comprueba además que los trozos
// sigan dentro del umbral de cobertura.
//
// El contenido de los correos y los destinos de Google viven en
// notificaciones.ts y config.ts. En service/ solo se decide QUÉ eventos se
// encolan.

// La clase vive en errores.ts; se reexporta para que quien la importaba de aquí
// (router.ts, los tests) no cambie.
export { AusenciaError } from './errores.js';

// Quién es la sesión: el tipo `Sesion` y las dos formas de pasar de ella a una
// ficha. La usan casi todos los trozos, que la importan de service/sesion.ts.
export * from './service/sesion.js';

// ── Validación ─────────────────────────────────────────────────────────────

// ARQ-612 — en service/validacion.ts, pura: los topes, la validación de una
// solicitud y de una modificación, y el nombre del PDF. Los trozos que la usan
// la importan de ahí. Se reexporta todo.
export * from './service/validacion.js';

// ── Casos de uso ───────────────────────────────────────────────────────────

// ARQ-612 — el solapamiento visto desde el servicio, en service/solapes.ts: lo
// que se le cuenta al cliente del choque y la puerta que comparten el alta y
// proponer un cambio de fechas. Se reexporta todo.
export * from './service/solapes.js';

// ARQ-612 — la vida de una solicitud (el alta, las listas de quien pide y de
// quien firma, la decisión de la bandeja y la retirada por su propio dueño), en
// service/solicitudes.ts. Se reexporta todo.
export * from './service/solicitudes.js';

// ARQ-612 — quién ve qué en el registro (los movimientos, la pestaña de
// adjuntos y la puerta de un PDF), en service/registro.ts. Se reexporta todo.
export * from './service/registro.js';

// ── Modificación de una solicitud ya enviada ───────────────────────────────

// ARQ-612 — en service/modificaciones.ts: qué estados admiten un cambio o una
// anulación, pedirla, retirarla y decidirla. Se reexporta todo.
export * from './service/modificaciones.js';

// ── Importación del histórico de la hoja ───────────────────────────────────

// ARQ-612 — en service/historico.ts. Se reexporta todo.
export * from './service/historico.js';

// ── Saldo de vacaciones ────────────────────────────────────────────────────

// ARQ-612 — en service/saldos.ts: validar el saldo de corte, juntar cada ficha
// con sus ausencias (`combinar`) y las consultas que lo usan. Las dos
// comprobaciones del alta y el panel de KPIs importan lo que usan. Se
// reexporta todo.
export * from './service/saldos.js';

// ── Organigrama ────────────────────────────────────────────────────────────

// ARQ-612 — en service/organigrama.ts: los empleados con su posición en el
// árbol y las puertas que lo cambian o que reparten las llaves de la ficha. Se
// reexporta todo.
export * from './service/organigrama.js';

// ── Panel de KPIs ──────────────────────────────────────────────────────────

// ARQ-612 — en service/kpis.ts. Se reexporta todo.
export * from './service/kpis.js';

// ── Calendario ─────────────────────────────────────────────────────────────

// ARQ-612 — en service/calendario.ts, las dos vistas con el alcance que
// comparten. Se reexporta todo.
export * from './service/calendario.js';

// ── Baja de un empleado ─────────────────────────────────────────────────────

// ARQ-612 — en service/retiro.ts: registrar la baja, deshacerla y la lista de
// retirados. Se reexporta todo.
export * from './service/retiro.js';
