-- Migration 012: agrupaciones de categorías de salestracker (config admin, global).
CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.st_category_groups (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  color      TEXT,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal.st_category_group_mappings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES portal.st_category_groups(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES portal.st_categories(id)      ON DELETE CASCADE,
  UNIQUE (group_id, category_id)
);
CREATE INDEX IF NOT EXISTS st_cgm_group_idx ON portal.st_category_group_mappings (group_id);
CREATE INDEX IF NOT EXISTS st_cgm_category_idx ON portal.st_category_group_mappings (category_id);
