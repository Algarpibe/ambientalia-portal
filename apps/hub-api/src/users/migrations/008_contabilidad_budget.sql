-- Migration 008: presupuesto anual de la app Contabilidad (editable por admin).
-- Vive en el esquema `portal` (BD de usuarios, escribible). Idempotente.
CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.contabilidad_budget (
  year        INTEGER     PRIMARY KEY,
  presupuesto NUMERIC     NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID
);

-- Semilla del presupuesto 2026 (del Excel). No pisa si ya existe.
INSERT INTO portal.contabilidad_budget (year, presupuesto)
VALUES (2026, 4416000000)
ON CONFLICT (year) DO NOTHING;
