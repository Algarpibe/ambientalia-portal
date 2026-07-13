-- Migration 001: user-management module
-- Creates the `users` and `user_apps` tables backing the dynamic user model
-- (replaces the AUTH_USERS env-var scheme). Schema per design.md.
-- Idempotent: safe to run on every startup.

-- gen_random_uuid() lives in the pgcrypto extension on older PostgreSQL and is
-- built-in from PG13+. Enable it defensively so the DEFAULT below always works.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
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

CREATE INDEX IF NOT EXISTS idx_users_status  ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_email   ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at DESC);

CREATE TABLE IF NOT EXISTS user_apps (
  user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id  VARCHAR(80) NOT NULL,

  PRIMARY KEY (user_id, app_id)
);

-- Reverse lookup: which users have access to a given app.
CREATE INDEX IF NOT EXISTS idx_user_apps_app_id ON user_apps (app_id);
