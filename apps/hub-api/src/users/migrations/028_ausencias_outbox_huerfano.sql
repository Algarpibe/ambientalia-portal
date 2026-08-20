-- Migración 028: una fila del outbox puede sobrevivir a su solicitud.
--
-- Borrar una solicitud desde *Registro general* tiene que poder dejar dicho el
-- borrado de su evento del Google Calendar. Con `ON DELETE CASCADE` eso era
-- imposible por construcción: el DELETE de la solicitud se llevaba por delante
-- la fila que acababa de encolar el borrado, y el evento se quedaba huérfano en
-- el calendario de Staff para siempre.
--
-- Que el huérfano funcione no es una apuesta: `eventosPendientes` NO hace JOIN
-- con `solicitudes_ausencia` —lee solo del outbox y devuelve `payload`, que es
-- autocontenido— y `/ausencias/n8n/confirmado` confirma por el `id` del outbox,
-- no por `solicitud_id`. Nadie usa esa columna para entregar ni para confirmar.
--
-- `SET NULL` y no quitar la clave ajena: asi el NULL SIGNIFICA algo legible en el
-- dato —«su solicitud ya no existe»— y el INSERT sigue validando que el id
-- exista. Lo unico que se relaja es que pasa al borrar.
--
-- El ancho de `evento` no hace falta tocarlo: la 025 lo dejo en VARCHAR(40) y
-- `borrado_admin` mide 13. Se dice explicito porque esa fue la mitad que se
-- olvido en la 024.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- ── 1. `solicitud_id` deja de ser NOT NULL ─────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'portal'
       AND table_name   = 'ausencias_outbox'
       AND column_name  = 'solicitud_id'
       AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE portal.ausencias_outbox ALTER COLUMN solicitud_id DROP NOT NULL;
  END IF;
END $$;

-- ── 2. La clave ajena pasa de CASCADE a SET NULL ───────────────────────────
--
-- La guarda mira `confdeltype`, que es el COMPORTAMIENTO al borrar ('c' =
-- cascade, 'n' = set null), y no el nombre del constraint. El nombre lo puso
-- Postgres solo (`ausencias_outbox_solicitud_id_fkey`) y darlo por bueno es la
-- misma trampa que documenta la 024: una guarda por un nombre que no es el real
-- deja el bloque sin ejecutarse y no avisa.
--
-- El bucle se acota a la clave ajena de ESTA columna via `conkey`, no a todas
-- las de la tabla: hoy solo hay una, pero borrar por tipo cualquier clave ajena
-- futura seria un efecto que nadie ha pedido.
DO $$
DECLARE
  vieja text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid    = 'portal.ausencias_outbox'::regclass
       AND contype     = 'f'
       AND confdeltype = 'n'
  ) THEN
    FOR vieja IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = 'portal.ausencias_outbox'::regclass
         AND con.contype  = 'f'
         AND con.conkey   = ARRAY[(SELECT a.attnum
                                     FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname  = 'solicitud_id')]::int2[]
    LOOP
      EXECUTE format('ALTER TABLE portal.ausencias_outbox DROP CONSTRAINT %I', vieja);
    END LOOP;

    ALTER TABLE portal.ausencias_outbox
      ADD CONSTRAINT ausencias_outbox_solicitud_fk
      FOREIGN KEY (solicitud_id) REFERENCES portal.solicitudes_ausencia(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. El CHECK de `evento` admite `borrado_admin` ─────────────────────────
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.ausencias_outbox'::regclass
       AND conname  = 'outbox_evento_check'
       AND pg_get_constraintdef(oid) LIKE '%borrado_admin%'
  ) THEN
    FOR viejo IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = 'portal.ausencias_outbox'::regclass
         AND con.contype  = 'c'
         AND con.conkey   = ARRAY[(SELECT a.attnum
                                     FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname  = 'evento')]::int2[]
    LOOP
      EXECUTE format('ALTER TABLE portal.ausencias_outbox DROP CONSTRAINT %I', viejo);
    END LOOP;

    ALTER TABLE portal.ausencias_outbox
      ADD CONSTRAINT outbox_evento_check
      CHECK (evento IN ('creada', 'aprobacion', 'aprobacion_2', 'aprobada', 'rechazada', 'registrada',
                        'modificacion_solicitada', 'modificacion_aprobada', 'modificacion_rechazada',
                        'correccion_admin', 'borrado_admin'));
  END IF;
END $$;
