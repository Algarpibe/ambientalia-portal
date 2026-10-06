-- Migration 043: Trazabilidad Mantenimientos Clientes - plazos de los servicios.
--
-- Plazo (en dias habiles) de cada tipo de servicio de Zoho Desk. Con el se
-- calcula la fecha limite de los tickets abiertos en la pestana «Servicios»:
-- ingreso + N dias habiles. dias_habiles NULL = ese tipo no tiene plazo.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. The table is
-- CREATE ... IF NOT EXISTS and the seed is INSERT ... ON CONFLICT DO NOTHING,
-- so a plazo edited from the app is never overwritten by a restart. Never add
-- a statement that fails or changes data on a second run.
--
-- `clave` es el tipo normalizado (minusculas, sin tildes, sin espacios de mas:
-- claveTipoServicio en trazabilidad/dominio.ts) y `etiqueta` lo que se ensena.
-- plazos.test.ts vigila que cada clave sembrada sea la normalizacion de su
-- etiqueta. actualizado_* queda NULL en las filas sembradas: se rellena cuando
-- alguien las edita (id + correo sin FK a portal.users, como en la 042).
--
-- Nada de esto toca el esquema desk: esa replica es del worker de zoho-hub.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_plazos (
  clave               VARCHAR(80)   PRIMARY KEY,
  etiqueta            VARCHAR(80)   NOT NULL,
  dias_habiles        INTEGER       NULL CHECK (dias_habiles BETWEEN 1 AND 365),
  actualizado_por_id  UUID          NULL,
  actualizado_por     VARCHAR(254)  NULL,
  actualizado_en      TIMESTAMPTZ   NULL
);

INSERT INTO portal.tmc_plazos (clave, etiqueta, dias_habiles) VALUES
  ('diagnostico', 'Diagnóstico', 3),
  ('calibracion', 'Calibración', 4),
  ('mantenimiento', 'Mantenimiento', NULL),
  ('garantia', 'Garantía', NULL),
  ('otro', 'Otro', NULL),
  ('no aplica', 'No aplica', NULL)
ON CONFLICT (clave) DO NOTHING;
