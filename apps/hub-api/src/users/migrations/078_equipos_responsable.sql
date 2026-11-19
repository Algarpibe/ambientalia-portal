-- Migration 078: «Equipos en taller», responsable asignado desde la tabla
-- (docs/superpowers/specs/2026-11-19-equipos-responsable-design.md).
--
-- Una fila por VISITA: la clave «SERIAL|AAAA-MM-DD» de claveFila (núcleo), sin las variantes
-- «*SERIAL» ni «pdf:» de equipos_ajuste. Tabla propia, no equipos_ajuste: su clave es PRIMARY KEY
-- y una visita con un ajuste no podría tener además responsable (D3). La siguiente visita del
-- mismo equipo empieza sin asignación (D2).
--   · user_id: a quién se asignó. Se guarda la cuenta y no el nombre: «Mis equipos» la reconoce
--     por el usuario y un cambio de nombre no la deja huérfana. Si el usuario se borra, se borran
--     sus asignaciones; si solo se desactiva o pierde la app, la fila se conserva y deja de contar
--     hasta que la recupere (eso lo filtra repo.listarResponsables, no la base) (D6).
--   · asignado_por / asignado_por_id: quién asignó, con su nombre de ese momento.
--
-- La clasificación de cada hora no toca esta tabla: solo reescribe foto, exits y ent.
-- ⚠️ NO siembra nada: initDb() re-ejecuta las migraciones en cada arranque. Solo DDL idempotente.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.equipos_responsable (
  clave            text        PRIMARY KEY
                               CHECK (clave ~ '^[A-Z0-9]{3,20}\|\d{4}-\d{2}-\d{2}$'),
  user_id          uuid        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  asignado_por_id  uuid        NULL REFERENCES portal.users(id) ON DELETE SET NULL,
  asignado_por     text        NOT NULL,
  asignado_en      timestamptz NOT NULL DEFAULT now()
);

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da. La 068 concede
-- ALL TABLES, pero corre antes que esta en el mismo arranque. No hay secuencia: la clave es texto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.equipos_responsable TO portal_app;
  END IF;
END $$;
