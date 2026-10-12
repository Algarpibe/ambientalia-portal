-- Migration 058: Trazabilidad Mantenimientos Clientes - equipos "en
-- seguimiento" (lote 9d-2a).
--
-- tmc_equipos pasa a llevar tambien los equipos de las demas marcas del
-- maestro de Desk 2.0, enlazados para que la pestana "Trazabilidad F-ST-022"
-- muestre su cliente, marca, modelo y serial del maestro. Esos NO entran en
-- Resumen, Equipos, Calendario de calibraciones ni Avisos (ni su simulacion):
--   en_seguimiento  TRUE  = el inventario de siempre (hoy, solo GRIMM EDM 180).
--                   FALSE = enlazado con Desk 2.0, fuera de seguimiento.
-- Lo que ya habia queda en TRUE (el valor por defecto). Solo la sincronizacion
-- con el maestro da de alta filas con FALSE, y ninguna sincronizacion cambia
-- el valor de una fila que ya existe.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only ADD COLUMN
-- IF NOT EXISTS, no seed. Never add a statement that fails or changes data on
-- a second run. seguimiento.test.ts vigila esta regla.

ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS en_seguimiento BOOLEAN NOT NULL DEFAULT TRUE;
