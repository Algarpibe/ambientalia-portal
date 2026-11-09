-- Migration 070: DocumentoNúmero persistente e irrepetible de WO-sales (§8.1, ARQ-610).
--
-- El builder numeraba por POSICIÓN en cada archivo, desde 1: cada archivo chocaba con los
-- pedidos ya cargados en World Office, y cuando una OV salía del archivo (facturada) las de
-- detrás se corrían un número. Aquí cada OV recibe su número UNA vez y lo conserva para
-- siempre: las filas nunca se borran ni se modifican (por eso, al terminar cada arranque,
-- portal_app solo tiene SELECT e INSERT; ver el final). Un solo contador para todos los prefijos
-- (OV_25, OV_26, OV_27…), que nunca se reinicia: el siguiente es MAX + 1
-- (documento-numero.repo.ts), no una SEQUENCE, que gastaría números en un INSERT que choca o se
-- revierte.
--
-- Siembra: las 37 OV del archivo DocumentosVentasEncabezadosMovimientoInventarioWO_2026-10-31.xls
-- (lo que ya está cargado en WO), con el número que llevaban allí. Número de OV reconstruido como
-- OV-20{AA}-{Nota} a partir del prefijo y la Nota. Más la OV-2026-212 con el 38 (ver abajo).
-- La siguiente OV nueva, OV-2026-213, recibe el 39.
--
-- Solo DDL e INSERT idempotentes: initDb() re-ejecuta las migraciones en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.wo_sales_documento_numero (
  numero_ov        text        PRIMARY KEY,
  documento_numero integer     NOT NULL UNIQUE CHECK (documento_numero > 0),
  origen           text        NOT NULL CHECK (origen IN ('congelado', 'asignado')),
  asignado_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO portal.wo_sales_documento_numero (numero_ov, documento_numero, origen) VALUES
  ('OV-2022-105',  1, 'congelado'),
  ('OV-2025-030',  2, 'congelado'),
  ('OV-2025-086',  3, 'congelado'),
  ('OV-2025-087',  4, 'congelado'),
  ('OV-2025-199',  5, 'congelado'),
  ('OV-2026-021',  6, 'congelado'),
  ('OV-2026-033',  7, 'congelado'),
  ('OV-2026-057',  8, 'congelado'),
  ('OV-2026-081',  9, 'congelado'),
  ('OV-2026-142', 10, 'congelado'),
  ('OV-2026-143', 11, 'congelado'),
  ('OV-2026-146', 12, 'congelado'),
  ('OV-2026-153', 13, 'congelado'),
  ('OV-2026-155', 14, 'congelado'),
  ('OV-2026-156', 15, 'congelado'),
  ('OV-2026-157', 16, 'congelado'),
  ('OV-2026-160', 17, 'congelado'),
  ('OV-2026-167', 18, 'congelado'),
  ('OV-2026-171', 19, 'congelado'),
  ('OV-2026-187', 20, 'congelado'),
  ('OV-2026-188', 21, 'congelado'),
  ('OV-2026-189', 22, 'congelado'),
  ('OV-2026-193', 23, 'congelado'),
  ('OV-2026-194', 24, 'congelado'),
  ('OV-2026-196', 25, 'congelado'),
  ('OV-2026-198', 26, 'congelado'),
  ('OV-2026-201', 27, 'congelado'),
  ('OV-2026-202', 28, 'congelado'),
  ('OV-2026-203', 29, 'congelado'),
  ('OV-2026-204', 30, 'congelado'),
  ('OV-2026-205', 31, 'congelado'),
  ('OV-2026-206', 32, 'congelado'),
  ('OV-2026-207', 33, 'congelado'),
  ('OV-2026-208', 34, 'congelado'),
  ('OV-2026-209', 35, 'congelado'),
  ('OV-2026-210', 36, 'congelado'),
  ('OV-2026-211', 37, 'congelado'),
  -- Decisión del usuario (2026-11-09): la 212 queda congelada con el 38. Ya está facturada en Zoho
  -- (antes del despliegue), así que nunca saldrá en el archivo; se congela para que la 213 reciba el
  -- 39. A diferencia de las filas 1–37, NO estaba en el archivo del 31/10 ni está cargada en WO.
  ('OV-2026-212', 38, 'congelado')
ON CONFLICT DO NOTHING;

-- DATA-332: el rol de las peticiones lee y añade números, nunca los cambia ni los borra.
-- La 068 re-concede SELECT, INSERT, UPDATE y DELETE sobre TODAS las tablas del esquema en cada
-- arranque, y corre ANTES que esta: sin el REVOKE, desde el segundo arranque portal_app volvería
-- a poder modificar y borrar números. Como la 070 corre después de la 068, cada arranque termina
-- con solo SELECT e INSERT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT ON portal.wo_sales_documento_numero TO portal_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON portal.wo_sales_documento_numero FROM portal_app;
  END IF;
END $$;
