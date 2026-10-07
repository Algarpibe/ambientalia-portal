-- Migration 054: Trazabilidad Mantenimientos Clientes - agenda del taller:
-- el historial de estados PROPIO de la agenda.
--
-- tmc_agenda_historial: en que estado ha estado cada ticket segun la FUENTE
--   PRINCIPAL de la agenda, por tramos. Misma forma que la 047
--   (tmc_estados_historial): una fila = un tramo, `hasta` NULL = sigue ahi,
--   `desde_real` FALSE = primera observacion (el comienzo real no se sabe).
--
-- Por que otra tabla y no la 047: aquella la alimenta la replica de tickets y
-- con ella se calcula el reloj del plazo de la pantalla de servicios, que lee
-- sus tickets de esa misma replica. La agenda lee de otra base, que puede
-- discrepar: cada pantalla lleva el historial de la base de la que lee sus
-- tickets. Esta tabla solo se escribe cuando contesta la fuente principal;
-- en respaldo no se apunta nada (alternar de base escribiria cambios de
-- estado que nunca ocurrieron).
--
-- Solo la escribe registrarEstadosAgenda (trazabilidad/repo.ts), con su
-- propio bloqueo, distinto del de la 047.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only CREATE ...
-- IF NOT EXISTS, no seed and no copy from the 047 table: a restart never
-- touches a history that cannot be rebuilt. Never add a statement that fails
-- or changes data on a second run. agenda-asignaciones.test.ts vigila esta
-- regla.
--
-- Sin claves foraneas. Nada de esto toca la replica de tickets ni la base de
-- la herramienta de tickets.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_agenda_historial (
  id          BIGSERIAL     PRIMARY KEY,
  numero      INTEGER       NOT NULL CHECK (numero > 0),
  clave       TEXT          NOT NULL,
  etiqueta    TEXT          NOT NULL,
  desde       TIMESTAMPTZ   NOT NULL,
  hasta       TIMESTAMPTZ   NULL,
  desde_real  BOOLEAN       NOT NULL,
  CHECK (hasta IS NULL OR hasta >= desde)
);

CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_historial_abierto_uq ON portal.tmc_agenda_historial (numero) WHERE hasta IS NULL;
CREATE INDEX IF NOT EXISTS tmc_agenda_historial_numero_idx ON portal.tmc_agenda_historial (numero, desde);
