-- Migration 007: overrides manuales de la app Contabilidad.
-- Guarda datos que Zoho no tiene, por ahora solo `cartera` (texto libre) por
-- número de factura. Vive en el esquema `portal` (BD de usuarios, escribible),
-- NO en la réplica read-only de Zoho. Idempotente: safe en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.contabilidad_overrides (
  invoice_number TEXT        PRIMARY KEY,
  cartera        TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by     UUID
);
