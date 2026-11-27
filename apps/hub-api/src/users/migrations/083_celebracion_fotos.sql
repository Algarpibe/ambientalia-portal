-- Migration 083: foto graciosa del almuerzo de fin de año
-- (spec docs/superpowers/specs/2026-11-26-invitacion-fin-de-ano-design.md,
-- ampliación del 2026-11-27).
--
--   · celebracion_fotos: la foto graciosa que cada persona sube para el muro del
--     evento (data URL, ya reducida por el portal). Es obligatoria para poder
--     responder a la invitación. Es DISTINTA de la foto de perfil (users.avatar):
--     subirla no toca el perfil.
--   · Una foto por persona y evento; subir otra la reemplaza.
--   · ON DELETE CASCADE, como el resto de las tablas de la 081: borrar la cuenta
--     borra su foto.
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque. No siembra nada.

CREATE TABLE IF NOT EXISTS portal.celebracion_fotos (
  evento         TEXT        NOT NULL,
  user_id        UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  foto           TEXT        NOT NULL,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (evento, user_id)
);

-- DATA-332: la 068 re-concede SELECT, INSERT, UPDATE y DELETE sobre TODAS las
-- tablas del esquema en cada arranque y corre ANTES que esta; de ahí el GRANT y
-- luego el REVOKE (mismo patrón que la 081 y la 082). Las fotos se insertan y se
-- reemplazan, nunca se borran. No hay secuencias: la clave es compuesta.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE ON portal.celebracion_fotos TO portal_app;
    REVOKE DELETE, TRUNCATE ON portal.celebracion_fotos FROM portal_app;
  END IF;
END $$;
