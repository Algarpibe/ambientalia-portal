-- Migration 075: «Equipos en taller», el tema de la TV se elige en Ajustes.
--
-- · equipos_tablero_config.tema_tv: 'dia' (por defecto), 'noche' o 'auto'. Con 'auto' manda el
--   horario de noche_desde / noche_hasta (hora de Bogotá); con los otros dos, esas horas no se usan.
--   La fila que ya hubiera queda en 'dia'. `?tema=` en la dirección de cada TV sigue mandando.
--
-- ⚠️ NO siembra nada: initDb() re-ejecuta las migraciones en cada arranque. Solo DDL idempotente.
-- Los permisos de portal_app (DATA-332) los dio la 074 sobre la tabla entera: cubren la columna nueva.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.equipos_tablero_config ADD COLUMN IF NOT EXISTS tema_tv text NOT NULL DEFAULT 'dia';

-- El CHECK va aparte y con nombre, y solo si falta: así re-ejecutar la migración no lo duplica.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.equipos_tablero_config'::regclass
       AND conname  = 'equipos_tablero_tema_tv_check'
  ) THEN
    ALTER TABLE portal.equipos_tablero_config
      ADD CONSTRAINT equipos_tablero_tema_tv_check
      CHECK (tema_tv IN ('dia', 'noche', 'auto'));
  END IF;
END $$;
