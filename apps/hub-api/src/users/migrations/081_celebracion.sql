-- Migration 081: invitación al almuerzo de fin de año (spec
-- docs/superpowers/specs/2026-11-26-invitacion-fin-de-ano-design.md).
--
--   · celebracion_confirmaciones: una respuesta por persona y evento (sí/no, menú,
--     mensaje). hub-api la crea o la reemplaza con ON CONFLICT (evento, user_id).
--   · celebracion_votos: las cualidades que cada persona vota a cada compañero
--     (hasta 3, tope que pone el servicio porque la lista vive en su config).
--     Anónimo para los compañeros: la página nunca dice quién votó; la fila guarda
--     el votante solo para que nadie vote dos veces.
--   · ON DELETE CASCADE, como user_apps y terms_acceptances: borrar la cuenta
--     borra sus respuestas y sus votos (los dados y los recibidos).
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque. No siembra nada.

CREATE TABLE IF NOT EXISTS portal.celebracion_confirmaciones (
  evento          TEXT        NOT NULL,
  user_id         UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  asiste          BOOLEAN     NOT NULL,
  preferencia     TEXT        NULL,
  mensaje         TEXT        NULL CHECK (mensaje IS NULL OR char_length(mensaje) <= 200),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (evento, user_id),
  CHECK (asiste OR preferencia IS NULL)
);

CREATE TABLE IF NOT EXISTS portal.celebracion_votos (
  evento      TEXT        NOT NULL,
  votante_id  UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  votado_id   UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  cualidad    TEXT        NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (evento, votante_id, votado_id, cualidad),
  CONSTRAINT celebracion_votos_no_propio CHECK (votante_id <> votado_id)
);

-- El muro cuenta los votos de cada votado.
CREATE INDEX IF NOT EXISTS idx_celebracion_votos_votado ON portal.celebracion_votos (evento, votado_id);

-- DATA-332: la 068 re-concede SELECT, INSERT, UPDATE y DELETE sobre TODAS las
-- tablas del esquema en cada arranque y corre ANTES que esta; de ahí el GRANT y
-- luego el REVOKE (mismo patrón que la 079). Las respuestas se crean y se
-- reemplazan, nunca se borran; los votos se borran y se vuelven a insertar,
-- nunca se editan. No hay secuencias: las claves son compuestas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE ON portal.celebracion_confirmaciones TO portal_app;
    REVOKE DELETE, TRUNCATE ON portal.celebracion_confirmaciones FROM portal_app;
    GRANT SELECT, INSERT, DELETE ON portal.celebracion_votos TO portal_app;
    REVOKE UPDATE, TRUNCATE ON portal.celebracion_votos FROM portal_app;
  END IF;
END $$;
