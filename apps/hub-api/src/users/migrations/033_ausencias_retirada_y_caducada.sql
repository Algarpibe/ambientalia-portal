-- Migración 033: dos eventos nuevos en el outbox y un estado nuevo de propuesta.
--
-- Los dos cierran los huecos que salieron al verificar qué pasa cuando alguien
-- toca una solicitud que sigue pendiente de firma:
--
--  · `retirada` — el dueño quita su propia solicitud antes de que nadie la
--    firme. Hasta ahora la única salida era pedir una anulación y esperar a que
--    el jefe se la aprobara, incluso sobre algo que nadie había abierto.
--
--  · `caducada` (estado de `solicitud_modificaciones`) y su aviso
--    `modificacion_caducada` — cuando el jefe decide la solicitud, cualquier
--    petición de cambio viva sobre ella deja de poder aplicarse: el testigo
--    triple de `decidirModificacion` compara el estado, y ya no casa. Antes esa
--    petición se quedaba `pendiente` para siempre, y como el índice único
--    parcial solo admite UNA viva por solicitud, dejaba al trabajador sin poder
--    pedir otra. Ahora se cierra sola y se le avisa.
--
-- ⚠️ Sin la mitad del CHECK del outbox, los dos INSERT rebotan DENTRO de su
-- transacción y el ROLLBACK se lleva por delante la escritura buena: quien
-- retira ve un 500 y su solicitud sigue ahí. Es literalmente lo que pasó con la
-- 024/025, y lo que la 027 dejó escrito para que no volviera a pasar.
--
-- El ANCHO no hace falta tocarlo, y se dice explícito porque es la mitad que se
-- olvidó en la 024: la 025 dejó la columna en VARCHAR(40), y el más largo de los
-- dos nuevos (`modificacion_caducada`) mide 21. CHECK y ancho son dos
-- restricciones distintas.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- ── 1. El CHECK de `evento` admite los dos nuevos ──────────────────────────
--
-- La guarda mira el CONTENIDO del constraint y no su nombre, por lo mismo que
-- documentan la 024 y la 027: el constraint existe con ese nombre desde la 018,
-- así que preguntar por el nombre daría siempre verdad y el bloque no se
-- ejecutaría nunca — un no-op silencioso que solo se descubre al reventar el
-- primer INSERT real, dentro de una transacción.
--
-- Se pregunta por `modificacion_caducada` y no por `retirada`: `retirada` es
-- subcadena de nada, pero es una palabra corta y genérica, y un LIKE '%retirada%'
-- casaría también contra un futuro `modificacion_retirada`. El otro es
-- inequívoco, y como los dos entran en la misma sentencia, basta con mirar uno.
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.ausencias_outbox'::regclass
       AND conname  = 'outbox_evento_check'
       AND pg_get_constraintdef(oid) LIKE '%modificacion_caducada%'
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
                        'correccion_admin', 'borrado_admin',
                        'retirada', 'modificacion_caducada'));
  END IF;
END $$;

-- ── 2. El CHECK de `estado` de las propuestas admite `caducada` ────────────
--
-- `caducada` y no reutilizar `retirada`: aquella significa que el AUTOR se echó
-- atrás, y atribuirle al trabajador un cierre que hizo el sistema es la misma
-- clase de mentira que costó cuatro intentos en la columna «Decidida por» del
-- registro. Tampoco `rechazada`, que le atribuiría al jefe un rechazo que no
-- pronunció.
--
-- Igual que `retirada`, una `caducada` no tiene decisor: `quienDecidio` ya
-- devuelve null para todo lo que no sea aprobada o rechazada.
--
-- Y sale del índice único parcial —que solo cuenta las `pendiente`—, que es
-- justo lo que desbloquea a quien quiera pedir otro cambio.
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.solicitud_modificaciones'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) LIKE '%caducada%'
  ) THEN
    FOR viejo IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = 'portal.solicitud_modificaciones'::regclass
         AND con.contype  = 'c'
         AND con.conkey   = ARRAY[(SELECT a.attnum
                                     FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname  = 'estado')]::int2[]
    LOOP
      EXECUTE format('ALTER TABLE portal.solicitud_modificaciones DROP CONSTRAINT %I', viejo);
    END LOOP;

    ALTER TABLE portal.solicitud_modificaciones
      ADD CONSTRAINT modificaciones_estado_check
      CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'retirada', 'caducada'));
  END IF;
END $$;
