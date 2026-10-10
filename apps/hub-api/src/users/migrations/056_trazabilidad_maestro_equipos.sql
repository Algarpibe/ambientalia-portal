-- Migration 056: Trazabilidad Mantenimientos Clientes - maestro de equipos
-- desde Desk 2.0 (lote 9b).
--
-- El inventario (tmc_equipos) deja de salir de la Excel F-ST-022 y pasa a
-- alimentarse, a mano y tras ver el plan, del maestro de equipos de Desk 2.0
-- (que el portal solo lee). En este lote, solo los GRIMM EDM 180.
--
-- tmc_equipos gana tres columnas, que admiten lo que ya habia:
--   desk_id     el id del equipo en Desk 2.0 con el que quedo enlazado (NULL =
--               sin enlazar). Como mucho una fila del portal por equipo de alla.
--   origen      de donde sale el dato: 'fst022' (la ultima importacion de la
--               Excel; lo que ya habia) o 'desk' (lo confirmo o lo dio de alta
--               el maestro).
--   maestro_en  la ultima vez que una sincronizacion lo encontro en el maestro.
--
-- tmc_maestro_sincronizaciones: una fila por sincronizacion aplicada: quien,
--   cuando, la huella del plan, sus recuentos y el detalle de lo que cambio
--   (`cambios`: clave del equipo, campo, valor anterior y nuevo). Auditoria: no
--   se cambia ni se borra. Las personas, id + correo, sin clave foranea.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only ADD COLUMN
-- IF NOT EXISTS and CREATE ... IF NOT EXISTS, no seed. Never add a statement
-- that fails or changes data on a second run. maestro.test.ts vigila esta regla.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS desk_id    TEXT        NULL;
ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS origen     VARCHAR(10) NOT NULL DEFAULT 'fst022' CHECK (origen IN ('fst022', 'desk'));
ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS maestro_en TIMESTAMPTZ NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tmc_equipos_desk_id_uq ON portal.tmc_equipos (desk_id) WHERE desk_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS portal.tmc_maestro_sincronizaciones (
  id         BIGSERIAL     PRIMARY KEY,
  huella     VARCHAR(64)   NOT NULL CHECK (huella ~ '^[0-9a-f]{64}$'),
  recuentos  JSONB         NOT NULL CHECK (jsonb_typeof(recuentos) = 'object'),
  cambios    JSONB         NOT NULL CHECK (jsonb_typeof(cambios) = 'array'),
  por_id     UUID          NULL,
  por        VARCHAR(254)  NOT NULL,
  en         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
