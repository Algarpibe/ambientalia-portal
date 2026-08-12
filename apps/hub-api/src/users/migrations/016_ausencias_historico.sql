-- Migration 016: hueco para el histórico que hasta ahora solo vivía en las
-- cuatro pestañas de la hoja `consulta_vacaciones`.
--
-- SOLO DDL, a propósito. `initDb()` re-ejecuta todas las migraciones en cada
-- arranque y no hay tabla de control, así que las 53 filas del histórico NO
-- pueden venir en un INSERT aquí: se leerían y reinsertarían en cada despliegue.
-- Entran una sola vez por el endpoint de importación, desde el navegador.
-- Idempotente: safe en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- ── Medios días ────────────────────────────────────────────────────────────
-- La columna nació INTEGER porque el formulario solo pide días completos, pero
-- el histórico trae un 6.5 real (y las hojas de año están llenas de 0.5). Con
-- INTEGER habría que falsear el dato o redondearlo, y cualquier cálculo de
-- saldo posterior arrancaría descuadrado.
-- El ALTER no admite IF NOT EXISTS, así que se guarda mirando el tipo actual.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'portal'
       AND table_name   = 'solicitudes_ausencia'
       AND column_name  = 'dias_habiles'
       AND data_type    = 'integer'
  ) THEN
    ALTER TABLE portal.solicitudes_ausencia
      ALTER COLUMN dias_habiles TYPE NUMERIC(4,1);
  END IF;
END $$;

-- ── De dónde salió cada fila ───────────────────────────────────────────────
-- `hoja` = importada del Excel histórico; `portal` = nacida en la app. Permite
-- reimportar sin poder tocar nunca lo que creó el portal, y saber qué parte del
-- registro es anterior a la app.
ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'portal';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'solicitudes_origen_check') THEN
    ALTER TABLE portal.solicitudes_ausencia
      ADD CONSTRAINT solicitudes_origen_check CHECK (origen IN ('portal', 'hoja'));
  END IF;
END $$;

-- Notas al margen que la hoja llevaba en una octava columna sin cabecera
-- («Se solicitaron 2 pero el día 13 se anula por incapacidad»), la explicación
-- del «1*», y el nombre del PDF de las incapacidades antiguas — cuyos ficheros
-- siguen en Drive, aquí solo queda la referencia.
ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS observaciones TEXT;

-- ── Reimportar el mismo Excel no debe duplicar nada ────────────────────────
-- Único PARCIAL, solo sobre lo importado. Si fuera un único normal, prohibiría
-- algo perfectamente legal en la app: pedir el mismo rango dos veces (una
-- rechazada y otra reenviada). La colisión entre el histórico y lo que ya creó
-- el portal la resuelve el NOT EXISTS del propio INSERT, no este índice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_hoja_unica
  ON portal.solicitudes_ausencia (empleado_id, tipo, fecha_inicio, fecha_fin)
  WHERE origen = 'hoja';

CREATE INDEX IF NOT EXISTS idx_solicitudes_origen ON portal.solicitudes_ausencia (origen);
