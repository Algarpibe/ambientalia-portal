-- Migration 009: estado per-usuario de salestracker (favoritos + vistas guardadas).
-- Esquema `portal` (BD escribible de HUB_DB_URL). Idempotente.
CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.st_favorites (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  customer_name TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, customer_name)
);
CREATE INDEX IF NOT EXISTS st_favorites_user_idx ON portal.st_favorites (user_id);

CREATE TABLE IF NOT EXISTS portal.st_saved_views (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL,
  view_key   TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  state      JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, view_key, name)
);
CREATE INDEX IF NOT EXISTS st_saved_views_user_key_idx ON portal.st_saved_views (user_id, view_key);
