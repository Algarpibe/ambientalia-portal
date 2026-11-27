-- Migration 082: personas quitadas de la invitación al almuerzo de fin de año
-- (spec docs/superpowers/specs/2026-11-26-invitacion-fin-de-ano-design.md,
-- ampliación del 2026-11-27).
--
--   · celebracion_excluidos: quién NO está invitado a cada evento. El admin
--     quita y readmite desde el panel; quitar no borra nada (respuesta y votos
--     se conservan, solo dejan de contar y de verse), así que readmitir lo
--     devuelve todo tal cual estaba.
--   · ON DELETE CASCADE, como el resto de las tablas de la 081: borrar la cuenta
--     borra su exclusión.
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque. No siembra nada.

CREATE TABLE IF NOT EXISTS portal.celebracion_excluidos (
  evento       TEXT        NOT NULL,
  user_id      UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  excluido_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (evento, user_id)
);

-- DATA-332: la 068 re-concede SELECT, INSERT, UPDATE y DELETE sobre TODAS las
-- tablas del esquema en cada arranque y corre ANTES que esta; de ahí el GRANT y
-- luego el REVOKE (mismo patrón que la 081). Las exclusiones se insertan y se
-- borran, nunca se editan. No hay secuencias: la clave es compuesta.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, DELETE ON portal.celebracion_excluidos TO portal_app;
    REVOKE UPDATE, TRUNCATE ON portal.celebracion_excluidos FROM portal_app;
  END IF;
END $$;
