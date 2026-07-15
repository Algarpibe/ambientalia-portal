-- Migration 003: preferencias de UI por usuario en portal.users.
-- Blob JSON libre cuya forma la decide el cliente (p. ej. el orden y la visibilidad
-- de las columnas del análisis de inventario, por pestaña). Vive en el perfil y no
-- en localStorage para que siga al usuario entre navegadores y equipos.
-- Idempotente.
ALTER TABLE portal.users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
