-- Migración 018: aprobación en cascada de dos niveles.
--
-- El jefe inmediato firma primero y la solicitud queda en `pendiente_2`; solo la
-- firma de SU superior la pasa a `aprobada`. Quien reporta a la raíz del
-- organigrama se queda con una sola firma, como hasta ahora.
--
-- El árbol NO se guarda aquí: se deriva de `portal.empleados.aprobador_correo`,
-- que pasa a significar «el correo de mi jefe inmediato». Las columnas nuevas de
-- la solicitud son una COPIA CONGELADA del momento del alta, para que un cambio
-- de organigrama a mitad de trámite no mueva una solicitud en vuelo.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- ── El segundo aprobador, congelado ────────────────────────────────────────
-- NULL significa «aquí se acaba el árbol»: una sola firma. Es también el valor
-- de TODAS las filas anteriores a esta migración, y por eso lo que ya estuviera
-- `pendiente` al desplegar se cierra con una firma, exactamente como nació.
ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS segundo_aprobador_correo VARCHAR(254);

-- ── Trazabilidad de la primera firma ───────────────────────────────────────
-- `aprobador_user_id` y `decidida_at` NO cambian de significado: siguen siendo la
-- DECISIÓN FINAL (la que deja la solicitud en `aprobada` o `rechazada`), así que
-- ninguna fila existente pasa a decir otra cosa. La primera firma va aparte.
ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS primera_firma_user_id UUID REFERENCES portal.users(id) ON DELETE SET NULL;

ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS primera_firma_at TIMESTAMPTZ;

-- ── El CHECK de `estado` admite el estado intermedio ───────────────────────
-- El CHECK de 015 se creó inline, así que su nombre lo puso Postgres y no
-- conviene fiarse del literal: se localiza por la COLUMNA que restringe
-- (`conkey`), que es exacto — a diferencia de un LIKE sobre
-- `pg_get_constraintdef`, que podría pillar de rebote otro CHECK que mencionara
-- la palabra.
--
-- La guarda por el nombre NUEVO hace que el bloque entero sea un no-op a partir
-- del segundo arranque: sin ella, cada boot tomaría un ACCESS EXCLUSIVE y
-- revalidaría la tabla entera para volver a poner el mismo CHECK.
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.solicitudes_ausencia'::regclass
       AND conname  = 'solicitudes_estado_check'
  ) THEN
    FOR viejo IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = 'portal.solicitudes_ausencia'::regclass
         AND con.contype  = 'c'
         AND con.conkey   = ARRAY[(SELECT a.attnum
                                     FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname  = 'estado')]::int2[]
    LOOP
      EXECUTE format('ALTER TABLE portal.solicitudes_ausencia DROP CONSTRAINT %I', viejo);
    END LOOP;

    ALTER TABLE portal.solicitudes_ausencia
      ADD CONSTRAINT solicitudes_estado_check
      CHECK (estado IN ('pendiente', 'pendiente_2', 'aprobada', 'rechazada', 'registrada'));
  END IF;
END $$;

-- ── El CHECK de `evento` admite el aviso al segundo aprobador ──────────────
-- Va en la MISMA migración y no en una posterior: si el INSERT del outbox
-- rebotara contra este CHECK, reventaría DENTRO de la transacción de la firma y
-- el ROLLBACK la desharía entera — el jefe pulsaría «Aprobar», vería un 500 y la
-- solicitud seguiría `pendiente` para siempre.
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.ausencias_outbox'::regclass
       AND conname  = 'outbox_evento_check'
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
      CHECK (evento IN ('creada', 'aprobacion', 'aprobacion_2', 'aprobada', 'rechazada', 'registrada'));
  END IF;
END $$;

-- ── Índice del segundo nivel ───────────────────────────────────────────────
-- El de 015 (`idx_solicitudes_aprobador … WHERE estado = 'pendiente'`) sigue
-- siendo exacto y NO se toca: `aprobador_correo` conserva su significado, «quien
-- firma primero». El segundo nivel necesita el suyo, sobre la otra columna y el
-- otro estado.
CREATE INDEX IF NOT EXISTS idx_solicitudes_segundo_aprobador
  ON portal.solicitudes_ausencia (segundo_aprobador_correo)
  WHERE estado = 'pendiente_2';

-- ── Por qué no hay backfill ────────────────────────────────────────────────
-- Esto se re-ejecuta en CADA arranque y no hay tabla de control, así que un
-- UPDATE que rederivara el segundo aprobador se repetiría en cada despliegue y
-- movería solicitudes en vuelo cada vez que alguien tocara el organigrama. Dejar
-- las filas antiguas con `segundo_aprobador_correo IS NULL` es además lo
-- correcto: lo que ya estaba en trámite se cierra con las reglas con las que
-- nació.
