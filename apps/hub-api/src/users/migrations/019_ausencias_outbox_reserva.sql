-- Migration 019: reserva temporal al servir un evento del outbox.
--
-- El problema que arregla, observado en producción el 2026-08-13: el mismo
-- evento se sirvió dos veces y el empleado recibió el correo por duplicado.
--
-- `eventosPendientes` sirve SIN marcar —el estado solo avanza al confirmar, para
-- que un fallo de Gmail se recupere solo en el ciclo siguiente— así que entre
-- servir y confirmar hay una ventana de lo que tarde el envío (unos segundos).
-- Los dos disparadores del workflow, el webhook del portal y el barrido de diez
-- minutos, arrancaron con 0,7 s de diferencia: el segundo leyó las mismas filas
-- que el primero todavía no había confirmado, y ambos mandaron el correo.
--
-- Con `servido_at`, servir un evento lo reserva: deja de ofrecerse durante unos
-- minutos. La propiedad que se quería conservar sigue intacta —si el envío falla,
-- al expirar la reserva el evento vuelve a la cola por sí solo—, pero dos
-- disparadores casi simultáneos ya no pueden llevarse la misma fila.
--
-- No es solo un correo repetido: la misma carrera sobre un evento `aprobada`
-- habría creado dos eventos en Google Calendar y dos filas en la hoja que
-- consulta Nómina.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- NULL = nunca servido. Las filas anteriores a esta migración quedan así, que es
-- justo lo correcto: las pendientes vuelven a ofrecerse de inmediato y las ya
-- enviadas siguen fuera por su `enviado_at`.
ALTER TABLE portal.ausencias_outbox
  ADD COLUMN IF NOT EXISTS servido_at TIMESTAMPTZ;

-- El índice parcial de 015 (`idx_outbox_pendiente ON (id) WHERE enviado_at IS
-- NULL`) sigue siendo el que manda: acota a las pendientes, que son unas pocas
-- filas, y sobre ese conjunto el filtro por `servido_at` no necesita índice
-- propio.
