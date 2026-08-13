-- Migration 020: se retira la copia de los adjuntos a Google Drive.
--
-- El PDF nunca vivió en Drive: está en `portal.solicitud_adjuntos.contenido`
-- (BYTEA) desde el instante del alta, escrito en la misma transacción que la
-- solicitud. Drive era una copia secundaria que n8n subía después, y el control
-- de acceso a esos ficheros lo hacía Google, no el portal. Ahora administración
-- los consulta desde la propia app.
--
-- `drive_file_id` se queda sin sentido y sin datos: la escribía únicamente
-- `marcarAdjuntoEnDrive`, llamada solo desde el bloque `adjuntos` de
-- `/n8n/confirmado`, y el nodo «Confirmar el evento» del workflow manda
-- exclusivamente `{ ids: [...] }` — nunca `adjuntos`. Está toda a NULL.
--
-- Comprobación previa (count(col) ignora los NULL, así que `con_id` da 0):
--   SELECT count(*) AS filas, count(drive_file_id) AS con_id
--     FROM portal.solicitud_adjuntos;
--
-- ⚠️ Esto hace el despliegue irreversible en profundidad 1: revertir hub-api a
-- un build anterior deja a `SELECT_SOLICITUD` pidiendo una columna que ya no
-- existe, y todas las listas responderían 500.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque. `DROP
-- COLUMN` en Postgres es solo metadatos, no reescribe la tabla.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.solicitud_adjuntos
  DROP COLUMN IF EXISTS drive_file_id;
