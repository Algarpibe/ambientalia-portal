-- Migration 079: constancia de aceptación de las condiciones de uso y de la
-- política de tratamiento de datos del portal (Ley 1581 de 2012, Decreto 1377 de
-- 2013; spec docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md).
--
-- Una fila por usuario y versión aceptada: es la prueba de la autorización. Solo
-- usuario, versión y fecha: el texto publicado promete «fecha y versión», y guardar
-- más (dirección de red, navegador) obligaría a declararlo en el §2.2 del texto.
--   · PRIMARY KEY (user_id, version): aceptar dos veces la misma versión no duplica
--     nada. hub-api inserta con ON CONFLICT DO NOTHING, así que la fecha que queda
--     es la de la primera aceptación.
--   · ON DELETE CASCADE: borrar la cuenta borra sus aceptaciones, coherente con la
--     supresión de los datos.
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque. No siembra nada.

CREATE TABLE IF NOT EXISTS portal.terms_acceptances (
  user_id      UUID NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  version      TEXT NOT NULL,
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

-- DATA-332: el rol de las peticiones lee y añade aceptaciones, nunca las cambia ni
-- las borra: es la prueba de la autorización y no debe poder alterarla una
-- inyección SQL. SELECT hace falta también para el ON CONFLICT (user_id, version)
-- del INSERT. El ON DELETE CASCADE desde portal.users corre con los permisos del
-- dueño de la tabla, así que borrar una cuenta sigue arrastrando sus aceptaciones
-- sin que portal_app tenga DELETE.
-- La 068 re-concede SELECT, INSERT, UPDATE y DELETE sobre TODAS las tablas del
-- esquema en cada arranque, y corre ANTES que esta: de ahí el GRANT y luego el
-- REVOKE (mismo patrón que la 070). No hay secuencia: la clave es (user_id, version).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT ON portal.terms_acceptances TO portal_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON portal.terms_acceptances FROM portal_app;
  END IF;
END $$;
