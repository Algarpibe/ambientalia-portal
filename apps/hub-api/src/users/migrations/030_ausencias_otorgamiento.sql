-- Migración 030: el compensatorio se puede pedir, no solo gastar.
--
-- Hasta ahora la bolsa de compensatorios (029) solo se llenaba tecleando su
-- total en la pestaña Saldos, que es corregir una foto y no otorgar: no queda
-- quién lo concedió, ni cuándo, ni por qué. El tipo `otorgamiento` convierte eso
-- en una solicitud como las demás — el trabajador la pide, su jefe la firma— y
-- al aprobarse SUMA días a la bolsa en vez de restarlos.
--
-- ⚠️ Un otorgamiento NO es una ausencia, y esa es toda la dificultad de la
-- feature. No ocupa agenda, no va al Google Calendar y NO va a la hoja que
-- consulta nomina. Nada de eso lo impone esta migracion: se impone en el codigo,
-- y esta escrito en `construirPayload`, `ocupaAgenda`, `ausenciasEntre` y los dos
-- predicados de correccion de `types.ts`.
--
-- Las columnas se reutilizan, no se estrenan:
--   `dias_habiles` = dias CONCEDIDOS, siempre positivo. Nunca negativo: eso
--     envenenaria los totales del registro general y el CSV que sustituye al
--     Excel de nomina, que no tienen columna de signo. El signo lo pone el
--     calculo del saldo, sumando este tipo aparte.
--   `fecha_inicio` = `fecha_fin` = el dia del trabajo extra que se compensa.
--     Esta en el PASADO, siempre: se pide despues de haber trabajado.
--   `comentarios` = el motivo, que es lo que el jefe juzga.
--
-- ⚠️ Y por eso el saldo NO puede filtrar los otorgamientos por `fecha_inicio`
-- como hace con los otros dos tipos: esa fecha es anterior al corte casi
-- siempre, y el dia concedido no contaria nunca, en silencio. Se filtran por
-- `created_at`, que es cuando el otorgamiento entro en juego. Ver `saldo.ts`.
--
-- El CHECK de `evento` del outbox NO hace falta tocarlo, y se dice explicito
-- porque ampliarlo es el reflejo aprendido de las 024/025/027/028: un
-- otorgamiento reutiliza `creada`, `aprobacion`, `aprobada` y `rechazada`, que
-- existen desde la 015.
--
-- El ANCHO tampoco: `tipo` es VARCHAR(20) y `otorgamiento` mide 12. Se comprueba
-- y se dice porque la 024 amplio un CHECK y se dejo el ancho, y el 22001 que
-- salio de ahi hizo ROLLBACK del trabajo de un usuario en produccion.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- ── El CHECK de `tipo` admite el otorgamiento ──────────────────────────────
-- El CHECK de la 015 se creó inline, así que su nombre lo puso Postgres y no
-- conviene fiarse del literal: se localiza por la COLUMNA que restringe
-- (`conkey`), que es exacto — a diferencia de un LIKE sobre
-- `pg_get_constraintdef`, que podría pillar de rebote otro CHECK que mencionara
-- la palabra.
--
-- La guarda va por el nombre NUEVO, igual que en la 018 y al contrario que en
-- las 027/028: aquí ese nombre todavía no existe, así que preguntarlo es exacto
-- y deja el bloque en un no-op a partir del segundo arranque. Sin ella, cada
-- boot tomaría un ACCESS EXCLUSIVE y revalidaría la tabla entera para volver a
-- poner el mismo CHECK.
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.solicitudes_ausencia'::regclass
       AND conname  = 'solicitudes_tipo_check'
  ) THEN
    FOR viejo IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = 'portal.solicitudes_ausencia'::regclass
         AND con.contype  = 'c'
         AND con.conkey   = ARRAY[(SELECT a.attnum
                                     FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname  = 'tipo')]::int2[]
    LOOP
      EXECUTE format('ALTER TABLE portal.solicitudes_ausencia DROP CONSTRAINT %I', viejo);
    END LOOP;

    ALTER TABLE portal.solicitudes_ausencia
      ADD CONSTRAINT solicitudes_tipo_check
      CHECK (tipo IN ('vacaciones', 'permiso', 'compensatorio', 'incapacidad', 'otorgamiento'));
  END IF;
END $$;
