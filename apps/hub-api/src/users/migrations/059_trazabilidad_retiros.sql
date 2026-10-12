-- Migration 059: Trazabilidad Mantenimientos Clientes - retirar y reincorporar
-- a mano (lote 9d-2b).
--
-- Hasta ahora un equipo que ya no existe no se podia quitar de ningun modo:
-- `activo` seguia al maestro de Desk 2.0, que lo reactivaba al sincronizar.
--
-- tmc_equipos gana la marca de "retirado a mano": quien, cuando y por que.
--   retirado_en IS NOT NULL = lo retiro una persona (y entonces activo = FALSE).
--   La sincronizacion con el maestro la RESPETA: no lo reactiva aunque Desk
--   2.0 lo tenga activo. Reincorporar la vacia y el equipo vuelve a seguir al
--   maestro. Las cuatro nacen vacias: nadie queda retirado por desplegar esto.
--
-- tmc_retiros: una fila por cada retiro o reincorporacion, de un equipo
--   (`clave`) o de una fila de la hoja congelada sin equipo (`congelacion_id`
--   + `fila`): la hoja congelada sigue inmutable, lo que se apunta es esto.
--   accion          'retirar' o 'reincorporar'.
--   motivo          obligatorio.
--   antes, despues  el valor anterior y el nuevo ('activo' / 'retirado').
--   por_id, por, en la firma. Las personas, id + correo, sin clave foranea.
-- No se cambia ni se borra: es la auditoria y, para una fila de la hoja, su
-- estado (esta retirada si su ultima fila aqui es un 'retirar').
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only ADD COLUMN
-- IF NOT EXISTS and CREATE ... IF NOT EXISTS, no seed. Never add a statement
-- that fails or changes data on a second run. retiros.test.ts vigila esta regla.

ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS retirado_en TIMESTAMPTZ NULL;
ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS retirado_por_id UUID NULL;
ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS retirado_por VARCHAR(254) NULL;
ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS retirado_motivo TEXT NULL;

CREATE TABLE IF NOT EXISTS portal.tmc_retiros (
  id             BIGSERIAL     PRIMARY KEY,
  clave          VARCHAR(80)   NULL,
  congelacion_id BIGINT        NULL,
  fila           INTEGER       NULL,
  accion         VARCHAR(12)   NOT NULL CHECK (accion IN ('retirar', 'reincorporar')),
  motivo         TEXT          NOT NULL CHECK (btrim(motivo) <> ''),
  antes          VARCHAR(12)   NOT NULL,
  despues        VARCHAR(12)   NOT NULL,
  por_id         UUID          NULL,
  por            VARCHAR(254)  NOT NULL,
  en             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT tmc_retiros_objeto CHECK ((clave IS NULL) <> (fila IS NULL) AND (fila IS NULL) = (congelacion_id IS NULL))
);
CREATE INDEX IF NOT EXISTS tmc_retiros_clave_idx ON portal.tmc_retiros (clave);
CREATE INDEX IF NOT EXISTS tmc_retiros_fila_idx ON portal.tmc_retiros (congelacion_id, fila);
