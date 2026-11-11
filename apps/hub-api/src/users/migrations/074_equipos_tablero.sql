-- Migration 074: «Equipos en taller», ajustes del tablero y llaves de kiosco de la TV.
--
-- · equipos_tablero_config: UNA fila (id boolean PK CHECK (id)) con umbrales, horas de noche y
--   los 5 KPIs. Sin fila rigen los valores por defecto del código (AJUSTES_TABLERO_POR_DEFECTO).
-- · equipos_kiosco: llaves con nombre de la TV sin sesión. Solo se guarda el SHA-256 (hex) del
--   secreto: el texto plano no se guarda ni se puede recuperar. No caducan; se revocan.
--
-- ⚠️ NO siembra nada: initDb() re-ejecuta las migraciones en cada arranque. Solo DDL idempotente.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.equipos_tablero_config (
  id              boolean     PRIMARY KEY DEFAULT true CHECK (id),
  umbral_ambar    integer     NOT NULL CHECK (umbral_ambar >= 1),
  umbral_rojo     integer     NOT NULL,
  noche_desde     smallint    NOT NULL CHECK (noche_desde BETWEEN 0 AND 23),
  noche_hasta     smallint    NOT NULL CHECK (noche_hasta BETWEEN 0 AND 23),
  kpis            text[]      NOT NULL CHECK (
    cardinality(kpis) = 5
    AND kpis <@ ARRAY['en_taller', 'externo', 'revisar', 'ticket_cerrado', 'ticket_abierto', 'parciales', 'entregado', 'retirado']::text[]
  ),
  actualizado_por text        NULL,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipos_tablero_rojo_mayor CHECK (umbral_rojo > umbral_ambar)
);

CREATE TABLE IF NOT EXISTS portal.equipos_kiosco (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text        NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 60),
  hash          text        NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
  creado_por    text        NOT NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  revocado_en   timestamptz NULL,
  revocado_por  text        NULL,
  ultimo_uso_en timestamptz NULL
);
-- Dos llaves ACTIVAS no pueden llamarse igual; el nombre de una revocada se puede reusar.
CREATE UNIQUE INDEX IF NOT EXISTS equipos_kiosco_nombre_activo ON portal.equipos_kiosco (lower(btrim(nombre))) WHERE revocado_en IS NULL;

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.equipos_tablero_config, portal.equipos_kiosco TO portal_app;
  END IF;
END $$;
