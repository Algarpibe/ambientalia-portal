-- Migration 001: user-management module
-- Crea las tablas `portal.users` y `portal.user_apps` en un esquema DEDICADO
-- `portal`, para no colisionar con una tabla `public.users` ajena que ya existe
-- en la BD zoho-hub (de otro sistema). Schema per design.md, aislado en `portal`.
-- Idempotente: safe to run on every startup.

-- gen_random_uuid() es nativo en PostgreSQL 13+; pgcrypto es un fallback para
-- versiones anteriores. Idempotente.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Esquema dedicado del portal (aísla estas tablas de public.*).
CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     VARCHAR(255) NOT NULL CHECK (char_length(full_name) <= 255),
  email         VARCHAR(254) NOT NULL,
  password_hash TEXT         NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'reader'
                             CHECK (role IN ('admin', 'reader')),
  status        VARCHAR(10)  NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'active', 'inactive')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_users_status  ON portal.users (status);
CREATE INDEX IF NOT EXISTS idx_users_email   ON portal.users (email);
CREATE INDEX IF NOT EXISTS idx_users_created ON portal.users (created_at DESC);

CREATE TABLE IF NOT EXISTS portal.user_apps (
  user_id UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  app_id  VARCHAR(80) NOT NULL,

  PRIMARY KEY (user_id, app_id)
);

-- Reverse lookup: which users have access to a given app.
CREATE INDEX IF NOT EXISTS idx_user_apps_app_id ON portal.user_apps (app_id);
