-- Migration 073: «Equipos en taller», la corrida de cada hora (origen 'sincronizacion').
--
-- Se retira el botón «Actualizar información»: la pantalla se actualiza sola. Cada vez que
-- n8n cierra una pasada de la copia de Drive (POST /api/equipos-taller/sync/fin), hub-api
-- lanza una corrida con origen 'sincronizacion'. La diaria ('programada') no cambia.
-- 'boton' se queda en el CHECK: hay filas viejas con ese origen.
--
-- ⚠️ NO siembra nada: initDb() re-ejecuta las migraciones en cada arranque.
-- Solo DDL idempotente.

CREATE SCHEMA IF NOT EXISTS portal;

-- El CHECK de `origen` lo creó la 071 en línea, sin nombre: Postgres lo llamó
-- `equipos_ejecucion_origen_check`. La guarda mira su CONTENIDO y no solo su nombre (como
-- la 030 y la 033): el nombre ya existe, así que preguntar solo por él daría siempre verdad
-- y el bloque no se ejecutaría nunca. Y no se borra por nombre: se quitan TODOS los CHECK de
-- la columna `origen` (y solo de ella), se llamen como se llamen, y se pone uno con nombre.
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.equipos_ejecucion'::regclass
       AND conname  = 'equipos_ejecucion_origen_check'
       AND pg_get_constraintdef(oid) LIKE '%sincronizacion%'
  ) THEN
    FOR viejo IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = 'portal.equipos_ejecucion'::regclass
         AND con.contype  = 'c'
         AND con.conkey   = ARRAY[(SELECT a.attnum
                                     FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname  = 'origen')]::int2[]
    LOOP
      EXECUTE format('ALTER TABLE portal.equipos_ejecucion DROP CONSTRAINT %I', viejo);
    END LOOP;

    ALTER TABLE portal.equipos_ejecucion
      ADD CONSTRAINT equipos_ejecucion_origen_check
      CHECK (origen IN ('programada', 'boton', 'sincronizacion'));
  END IF;
END $$;
