-- Migration 064: Trazabilidad Mantenimientos Clientes - frecuencia de
-- preventivo por cliente y vigencia de calibracion «segun contrato» (lote 12).
--
-- Decision de Alfonso (18/10/2026): Horiba no tiene plazo fijo de
-- calibracion: se calibra con el mantenimiento preventivo, cuya frecuencia
-- depende del CONTRATO DE CADA CLIENTE. Asi que:
--   1. cada cliente tiene una «frecuencia de preventivo» (meses) o ninguna
--      (sin contrato), con firma, motivo e historial. Solo la rellena un
--      administrador del portal (permiso contrato.write, de ningun rol);
--   2. una marca puede vencer «segun contrato del cliente»: cada equipo suyo
--      vence segun la frecuencia de SU cliente; sin frecuencia, sin
--      vencimiento. GRIMM EDM 180 sigue fijo en 365 (la 063 ya le prohibe
--      tener fila: tmc_marcas_vigencia_no_edm180).
-- Una sola frecuencia por cliente: contratos distintos por equipo NO.
--
-- tmc_marcas_vigencia.contrato   TRUE = la marca vence segun contrato (y
--   entonces dias va NULL: CHECK tmc_marcas_vigencia_contrato_sin_dias).
--   Nace FALSE: al desplegar, ninguna marca cambia.
-- tmc_marcas_vigencia_cambios.antes_contrato / despues_contrato   el
--   historial de la marca dice tambien si antes o despues iba por contrato.
-- tmc_contratos: una fila por cliente que alguien ha tocado.
--   clave   el cliente normalizado (claveCliente, como tmc_contactos).
--   cliente como se escribia en el inventario al cambiarlo.
--   meses   la frecuencia de preventivo (1..36); NULL = sin contrato.
--   motivo, por_id, por, en   la firma del ultimo cambio.
--   Sin fila = sin contrato.
-- tmc_contratos_cambios: un apunte por cambio, con el valor anterior y el
--   nuevo (NULL = sin contrato), el motivo y la firma. No se cambia ni se
--   borra.
-- Solo clientes, meses y la firma. No es una tabla de mensajes: cambiar una
-- frecuencia no manda nada a nadie.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only
-- CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS (la restriccion de la
-- columna nueva va DENTRO de su ADD COLUMN: si la columna ya existe, no se
-- vuelve a crear) and NO SEED (contratos-repo.test.ts vigila esta regla).

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.tmc_marcas_vigencia ADD COLUMN IF NOT EXISTS contrato BOOLEAN NOT NULL DEFAULT FALSE
  CONSTRAINT tmc_marcas_vigencia_contrato_sin_dias CHECK (NOT contrato OR dias IS NULL);

ALTER TABLE portal.tmc_marcas_vigencia_cambios ADD COLUMN IF NOT EXISTS antes_contrato BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE portal.tmc_marcas_vigencia_cambios ADD COLUMN IF NOT EXISTS despues_contrato BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS portal.tmc_contratos (
  clave    VARCHAR(200)  PRIMARY KEY CHECK (clave <> ''),
  cliente  VARCHAR(200)  NOT NULL,
  meses    INTEGER       NULL CHECK (meses IS NULL OR meses BETWEEN 1 AND 36),
  motivo   TEXT          NOT NULL CHECK (btrim(motivo) <> ''),
  por_id   UUID          NULL,
  por      VARCHAR(254)  NOT NULL,
  en       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal.tmc_contratos_cambios (
  id       BIGSERIAL     PRIMARY KEY,
  clave    VARCHAR(200)  NOT NULL,
  cliente  VARCHAR(200)  NOT NULL,
  antes    INTEGER       NULL,
  despues  INTEGER       NULL,
  motivo   TEXT          NOT NULL CHECK (btrim(motivo) <> ''),
  por_id   UUID          NULL,
  por      VARCHAR(254)  NOT NULL,
  en       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tmc_contratos_cambios_clave_idx ON portal.tmc_contratos_cambios (clave, id);
