-- Migración 036: hora de inicio y de fin opcionales en un permiso.
--
-- Un permiso casi nunca es un día entero: es «me voy dos horas al médico el
-- martes por la mañana». Hasta ahora esa hora se escribía en Comentarios, y en
-- el Google Calendar del equipo el permiso se pintaba como un evento de día
-- completo, indistinguible de unas vacaciones.
--
-- Las dos columnas son NULL por defecto, así que ninguna solicitud existente
-- cambia: un permiso sin horas sigue siendo un permiso de día completo.

ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS hora_inicio TIME,
  ADD COLUMN IF NOT EXISTS hora_fin    TIME;

-- Los CHECK no admiten IF NOT EXISTS, así que se comprueba antes. Mismo patrón
-- que la 029.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.solicitudes_ausencia'::regclass
       AND conname  = 'solicitudes_horas_coherentes'
  ) THEN
    ALTER TABLE portal.solicitudes_ausencia
      ADD CONSTRAINT solicitudes_horas_coherentes
      CHECK (
        (hora_inicio IS NULL AND hora_fin IS NULL)
        OR (hora_inicio IS NOT NULL AND hora_fin IS NOT NULL
            AND hora_fin > hora_inicio
            AND fecha_inicio = fecha_fin)
      );
  END IF;
END $$;
