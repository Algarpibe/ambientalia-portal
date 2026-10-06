-- Migration 042: Trazabilidad Mantenimientos Clientes (GRIMM EDM 180).
--
-- Inventario de equipos importado de la hoja F-ST-022 «Trazabilidad Mttos
-- Clientes» y el seguimiento de avisos previos a clientes.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Everything here
-- is CREATE ... IF NOT EXISTS. Never add a statement that fails or changes data
-- on a second run.
--
-- tmc_seguimiento NO tiene FK a tmc_equipos a proposito: una reimportacion que
-- deja fuera un equipo lo marca inactivo, y si vuelve en otra importacion
-- recupera su seguimiento (avisos, notas). Las personas se guardan como id +
-- correo sin FK a portal.users, como en los logs de ausencias y calibraciones.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_equipos (
  clave                 VARCHAR(80)   PRIMARY KEY,
  serial                VARCHAR(120)  NOT NULL,
  cliente               VARCHAR(200)  NOT NULL,
  marca                 VARCHAR(60)   NOT NULL,
  modelo                VARCHAR(60)   NOT NULL,
  fecha_factura         DATE          NULL,
  hoja_vida             VARCHAR(200)  NULL,
  ultima_entrada        DATE          NULL,
  ultima_calibracion    DATE          NULL,
  entradas_st           INTEGER       NULL CHECK (entradas_st >= 0),
  calibraciones_periodo INTEGER       NULL CHECK (calibraciones_periodo >= 0),
  correctivos_periodo   INTEGER       NULL CHECK (correctivos_periodo >= 0),
  activo                BOOLEAN       NOT NULL DEFAULT TRUE,
  importacion_id        BIGINT        NULL,
  actualizado_en        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tmc_equipos_cliente_idx ON portal.tmc_equipos (cliente);

CREATE TABLE IF NOT EXISTS portal.tmc_seguimiento (
  clave               VARCHAR(80)   PRIMARY KEY,
  en_ambientalia      BOOLEAN       NOT NULL DEFAULT FALSE,
  aviso_enviado       DATE          NULL,
  servicio_programado DATE          NULL,
  nota                VARCHAR(2000) NOT NULL DEFAULT '',
  actualizado_por_id  UUID          NULL,
  actualizado_por     VARCHAR(254)  NOT NULL,
  actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal.tmc_importaciones (
  id            BIGSERIAL     PRIMARY KEY,
  archivo       VARCHAR(255)  NOT NULL,
  total         INTEGER       NOT NULL CHECK (total >= 0),
  nuevos        INTEGER       NOT NULL CHECK (nuevos >= 0),
  actualizados  INTEGER       NOT NULL CHECK (actualizados >= 0),
  retirados     INTEGER       NOT NULL CHECK (retirados >= 0),
  por_id        UUID          NULL,
  por           VARCHAR(254)  NOT NULL,
  en            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
