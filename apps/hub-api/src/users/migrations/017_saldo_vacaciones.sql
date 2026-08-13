-- Migration 017: saldo de vacaciones.
--
-- El saldo NO se recalcula desde la fecha de ingreso: se parte del saldo que hoy
-- vive en la hoja `Total` del Excel y se sigue desde ahí. Como el devengo es
-- proporcional al tiempo y a la misma tasa para todos (1,25 días por mes, sin
-- tramos por antigüedad), es algebraicamente idéntico a recalcularlo desde el
-- ingreso — y ahorra parsear las nueve hojas-calendario 2018-2026 donde viven
-- las vacaciones disfrutadas históricas.
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- `saldo_corte` = días disponibles en `fecha_corte`. A partir de esa fecha se
-- devenga con el tiempo y se descuentan las vacaciones aprobadas.
-- NUMERIC(5,1) y no INTEGER: el histórico trae medios días y el devengo tiene
-- decimales por naturaleza.
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS saldo_corte NUMERIC(5,1);

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS fecha_corte DATE;

-- Las dos o ninguna. Sin esto, un empleado a medio configurar enseñaría un saldo
-- inventado — y como la ficha se crea sola al entrar en la app, «sin configurar»
-- es el estado por defecto de todo el que se da de alta. Es el fallo más probable
-- de esta feature, así que lo impide la BD y no solo la validación.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empleados_saldo_completo') THEN
    ALTER TABLE portal.empleados
      ADD CONSTRAINT empleados_saldo_completo
      CHECK ((saldo_corte IS NULL) = (fecha_corte IS NULL));
  END IF;
END $$;
