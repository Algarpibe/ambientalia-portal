-- Migration 077: tokens de restablecimiento de contraseña (recuperación por correo).
--
-- Cada fila es un enlace «restablecer contraseña» enviado por correo. Solo se
-- guarda la huella SHA-256 (hex) del token: el token en claro viaja en el enlace
-- y en ningún otro sitio, así que con acceso a la BD no se puede reconstruir un
-- enlace válido.
--
-- `used_at` marca un token gastado o anulado (al pedir otro, o al restablecer):
-- en los dos casos deja de valer. Las horas las pone hub-api (reloj inyectable),
-- no now() de la BD.
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque.

CREATE TABLE IF NOT EXISTS portal.password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Los frenos por cuenta (último enlace y cuántos en la última hora) leen por aquí.
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
  ON portal.password_reset_tokens (user_id, created_at DESC);

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da. La
-- 068 concede ALL TABLES, pero corre antes que esta en el mismo arranque. No hay
-- secuencia que conceder: el id es UUID.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.password_reset_tokens TO portal_app;
  END IF;
END $$;
