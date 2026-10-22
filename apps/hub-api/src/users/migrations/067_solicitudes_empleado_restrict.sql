-- Migration 067: borrar una ficha de empleado ya no se lleva su histórico (DATA-342).
--
-- La 015 creó `solicitudes_ausencia.empleado_id` con `ON DELETE CASCADE`, y de
-- cada solicitud cuelgan en cascada sus adjuntos (los PDF médicos) y sus
-- propuestas de cambio. Un DELETE de una ficha —hoy solo posible a mano desde
-- psql, ninguna ruta de la API lo hace— borraba en silencio todo el histórico
-- laboral de esa persona. Las bajas ya existen como `fecha_retiro` (035): borrar
-- la ficha no es la forma de dar de baja a nadie, así que la base se niega.
--
-- RESTRICT y no SET NULL: `empleado_id` es NOT NULL, y una solicitud sin
-- empleado no significa nada. Una ficha SIN solicitudes (creada por error) se
-- sigue pudiendo borrar.
--
-- Las otras cascadas de la 015 y la 024 (de la solicitud a sus adjuntos y
-- propuestas) se quedan: el borrado de una solicitud por un admin tiene que
-- llevárselas, y es justo lo que hace `borrarSolicitud`.
--
-- Idempotente y con el mismo patrón que la 028: solo actúa si la clave ajena
-- todavía no es RESTRICT (confdeltype = 'r'). Así, en los arranques siguientes no
-- vuelve a tomar el candado exclusivo de la tabla ni a revalidar todas sus filas.
-- La 015 la sigue creando con CASCADE en una base nueva; esta la corrige justo
-- después.

DO $$
DECLARE
  vieja text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
     WHERE con.conrelid    = 'portal.solicitudes_ausencia'::regclass
       AND con.contype     = 'f'
       AND con.confrelid   = 'portal.empleados'::regclass
       AND con.confdeltype = 'r'
  ) THEN
    FOR vieja IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid  = 'portal.solicitudes_ausencia'::regclass
         AND con.contype   = 'f'
         AND con.confrelid = 'portal.empleados'::regclass
    LOOP
      EXECUTE format('ALTER TABLE portal.solicitudes_ausencia DROP CONSTRAINT %I', vieja);
    END LOOP;

    ALTER TABLE portal.solicitudes_ausencia
      ADD CONSTRAINT solicitudes_ausencia_empleado_fk
      FOREIGN KEY (empleado_id) REFERENCES portal.empleados(id) ON DELETE RESTRICT;
  END IF;
END $$;
