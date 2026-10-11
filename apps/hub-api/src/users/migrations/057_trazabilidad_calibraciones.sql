-- Migration 057: Trazabilidad Mantenimientos Clientes - calibraciones desde
-- Desk 2.0 (lote 9c).
--
-- La fecha de calibracion de un equipo deja de ser una columna suelta
-- (tmc_equipos.ultima_calibracion, que ya no escribe nadie) y pasa a salir de
-- las calibraciones conocidas, una fila cada una. La «ultima calibracion» es
-- la fecha maxima entre las filas vigentes del equipo (regla: calibraciones.ts).
--
-- tmc_calibraciones: una fila por calibracion conocida.
--   clave           el equipo del portal (tmc_equipos.clave); NULL si el serial
--                   no es de un equipo del inventario (otras marcas, lote 9d).
--   serial, serial_norm, desk_equipo_id   lo que traia: el serial tal cual y
--                   normalizado, y el equipo de Desk 2.0 si el ticket lo dice.
--   fecha           NUNCA se edita: una correccion anula la fila e inserta otra.
--   origen          'fst022' (punto de partida: la hoja congelada), 'desk' (el
--                   campo de Zoho de un ticket) o 'manual' (lote 9d).
--   ticket          numero del ticket; solo y siempre en las de origen 'desk'.
--   corrige_ticket, corrige_fecha   solo en una 'manual' que corrige un ticket:
--                   su numero y la fecha que ese ticket tenia en Zoho. La manual
--                   manda mientras el ticket siga con esa fecha.
--   estado          'vigente', 'anulada' o 'en_revision' (no cuenta: fecha
--                   futura o absurda, o serial ambiguo); `motivo` dice por que.
--   por_id, por, en, pasada_id   firma del alta (y la pasada que la trajo).
--   anulada_*       firma de la anulacion; anulada_pasada_id NULL = la anulo
--                   una persona, y entonces la pasada no la resucita.
-- Como mucho una fila sin anular por ticket de Desk, y una fila fst022 por
-- equipo. Las personas, id + correo, sin clave foranea.
--
-- tmc_calibraciones_pasadas: auditoria de cada pasada aplicada: quien, cuando,
--   la huella del plan, sus recuentos y el detalle de lo que nacio y lo que se
--   anulo. No se cambia ni se borra.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only CREATE ...
-- IF NOT EXISTS, no seed. Never add a statement that fails or changes data on
-- a second run. calibraciones.test.ts vigila esta regla.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_calibraciones (
  id                BIGSERIAL     PRIMARY KEY,
  clave             VARCHAR(80)   NULL,
  serial            TEXT          NOT NULL DEFAULT '',
  serial_norm       TEXT          NOT NULL DEFAULT '',
  desk_equipo_id    TEXT          NULL,
  fecha             DATE          NOT NULL,
  origen            VARCHAR(10)   NOT NULL CHECK (origen IN ('fst022', 'desk', 'manual')),
  ticket            INTEGER       NULL,
  corrige_ticket    INTEGER       NULL,
  corrige_fecha     DATE          NULL,
  estado            VARCHAR(12)   NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'anulada', 'en_revision')),
  motivo            TEXT          NULL,
  pasada_id         BIGINT        NULL,
  por_id            UUID          NULL,
  por               VARCHAR(254)  NOT NULL,
  en                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  anulada_pasada_id BIGINT        NULL,
  anulada_por_id    UUID          NULL,
  anulada_por       VARCHAR(254)  NULL,
  anulada_en        TIMESTAMPTZ   NULL,
  anulada_motivo    TEXT          NULL,
  CONSTRAINT tmc_calibraciones_ticket_de_desk CHECK ((origen = 'desk') = (ticket IS NOT NULL)),
  CONSTRAINT tmc_calibraciones_corrige CHECK ((corrige_ticket IS NULL) = (corrige_fecha IS NULL) AND (corrige_ticket IS NULL OR origen = 'manual')),
  CONSTRAINT tmc_calibraciones_anulada_firmada CHECK ((estado = 'anulada') = (anulada_en IS NOT NULL AND anulada_por IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS tmc_calibraciones_ticket_uq ON portal.tmc_calibraciones (ticket) WHERE origen = 'desk' AND estado <> 'anulada';
CREATE UNIQUE INDEX IF NOT EXISTS tmc_calibraciones_fst022_uq ON portal.tmc_calibraciones (clave) WHERE origen = 'fst022';
CREATE INDEX IF NOT EXISTS tmc_calibraciones_clave_idx ON portal.tmc_calibraciones (clave);

CREATE TABLE IF NOT EXISTS portal.tmc_calibraciones_pasadas (
  id         BIGSERIAL     PRIMARY KEY,
  huella     VARCHAR(64)   NOT NULL CHECK (huella ~ '^[0-9a-f]{64}$'),
  recuentos  JSONB         NOT NULL CHECK (jsonb_typeof(recuentos) = 'object'),
  detalle    JSONB         NOT NULL CHECK (jsonb_typeof(detalle) = 'array'),
  por_id     UUID          NULL,
  por        VARCHAR(254)  NOT NULL,
  en         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
