-- Migración 025: `evento` del outbox necesita más de 20 caracteres.
--
-- La 024 amplió el CHECK de `evento` con los tres avisos de modificación, pero
-- NO tocó el ANCHO de la columna, que la 015 dejó en VARCHAR(20). Son dos
-- restricciones distintas: el CHECK dice qué valores valen, el tipo dice cuánto
-- caben. Los tres nombres nuevos se pasan:
--
--   modificacion_solicitada  → 23
--   modificacion_rechazada   → 23
--   modificacion_aprobada    → 21
--
-- El resultado fue un 22001 («value too long») al INSERTAR el aviso, DENTRO de
-- la transacción que crea la propuesta, así que el ROLLBACK se llevaba también
-- la propuesta: el trabajador veía un 500 y no se guardaba nada. Visto en
-- producción el 2026-08-17, en la primera petición real.
--
-- No lo cazó nadie porque el ensayo de la 024 solo ejecutó DDL —nunca insertó
-- una fila con un evento largo— y los tests del módulo corren contra un doble
-- in-memory, no contra Postgres. Es el hueco que documenta «Lo que ningún test
-- protege» en docs/dev/app-ausencias.md.
--
-- VARCHAR(40) y no 30: deja sitio para el siguiente nombre compuesto sin volver
-- a pasar por aquí. En Postgres el `n` de un VARCHAR es solo una restricción,
-- no reserva espacio, así que ampliarlo no cuesta nada en disco.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- La guarda mira el ancho ACTUAL, no un nombre de constraint: a partir del
-- segundo arranque la columna ya mide 40, no se entra, y no se vuelve a tomar
-- el ACCESS EXCLUSIVE sobre una tabla que n8n consulta cada minuto.
--
-- Ensanchar un VARCHAR no reescribe la tabla (Postgres lo evita desde la 9.2),
-- pero el ALTER sigue pidiendo el candado exclusivo, y esa tabla es justo la
-- que más se consulta.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'portal'
       AND table_name   = 'ausencias_outbox'
       AND column_name  = 'evento'
       AND character_maximum_length < 40
  ) THEN
    ALTER TABLE portal.ausencias_outbox
      ALTER COLUMN evento TYPE VARCHAR(40);
  END IF;
END $$;
