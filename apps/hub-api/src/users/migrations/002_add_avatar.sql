-- Migration 002: columna de avatar (foto de perfil) en portal.users.
-- Se guarda como data URL base64 de un thumbnail pequeño (el cliente redimensiona
-- antes de subir). Idempotente.
ALTER TABLE portal.users ADD COLUMN IF NOT EXISTS avatar TEXT;
