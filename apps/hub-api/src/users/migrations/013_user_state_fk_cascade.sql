-- Migration 013: FK ON DELETE CASCADE para el estado per-usuario (PRIV-812).
-- contabilidad_overrides.updated_by (mig. 007) se creó SIN clave foránea a
-- portal.users. Al borrar un usuario (users.repository.delete) esas filas
-- quedaban huérfanas, una supresión incompleta (Ley 1581, art. 8). Esto añade la
-- FK que user_apps ya tenía (mig. 001), para que el borrado cascada.
-- Nota: esta migración también cubría portal.st_favorites / st_saved_views, de
-- la sub-app salestracker, retirada del portal (ver 014_drop_salestracker.sql).
-- Idempotente: limpia huérfanos preexistentes y añade cada constraint solo si
-- aún no existe (safe en cada arranque).

CREATE SCHEMA IF NOT EXISTS portal;

-- 1) Limpieza defensiva de huérfanos: sin esto, ADD CONSTRAINT fallaría por
--    filas que violan la nueva FK.
UPDATE portal.contabilidad_overrides o
   SET updated_by = NULL
 WHERE o.updated_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM portal.users u WHERE u.id = o.updated_by);

-- 2) Añadir la FK (guardada por nombre para idempotencia).
DO $$
BEGIN
  -- updated_by es un campo de auditoría (quién editó), nullable: SET NULL
  -- preserva el override pero rompe el vínculo con el usuario suprimido.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contabilidad_overrides_updated_by_fk') THEN
    ALTER TABLE portal.contabilidad_overrides
      ADD CONSTRAINT contabilidad_overrides_updated_by_fk
      FOREIGN KEY (updated_by) REFERENCES portal.users(id) ON DELETE SET NULL;
  END IF;
END $$;
