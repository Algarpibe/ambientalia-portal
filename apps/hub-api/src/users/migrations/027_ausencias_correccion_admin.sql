-- Migración 027: el CHECK de `evento` admite la corrección del registro general.
--
-- El evento `correccion_admin` lo emite `repo.actualizarSolicitud` cuando un
-- admin corrige desde *Registro general* una solicitud que ya estaba en Google.
-- Sin esta migración, ese INSERT rebota contra el CHECK DENTRO de la transacción
-- de la corrección, y el ROLLBACK se lleva también el UPDATE: el admin ve un 500
-- y su corrección no se guarda. Es exactamente lo que pasó con la 024/025.
--
-- El ANCHO no hace falta tocarlo, y se dice explícito porque esa fue la mitad
-- que se olvidó en la 024: la 025 dejó la columna en VARCHAR(40) y
-- `correccion_admin` mide 17. CHECK y ancho son dos restricciones distintas.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- La guarda mira el CONTENIDO del constraint, no su nombre, por lo mismo que
-- documenta la 024: el constraint ya existe con ese nombre desde la 018, así que
-- preguntar por el nombre daría siempre verdad y el bloque no se ejecutaría
-- nunca. Sería un no-op silencioso que solo se descubriría al reventar el primer
-- INSERT real, dentro de una transacción.
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.ausencias_outbox'::regclass
       AND conname  = 'outbox_evento_check'
       AND pg_get_constraintdef(oid) LIKE '%correccion_admin%'
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
                        'correccion_admin'));
  END IF;
END $$;
