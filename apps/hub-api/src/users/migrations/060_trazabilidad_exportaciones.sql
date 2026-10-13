-- Migration 060: Trazabilidad Mantenimientos Clientes - registro de las
-- exportaciones de la F-ST-022 (lote 9e).
--
-- La Excel F-ST-022 ya no se sube: la hoja esta congelada y el portal la
-- releva. Desde este lote se puede EXPORTAR (un .xlsx con las seis columnas de
-- la hoja y sus valores de hoy). Un fichero exportado sale del portal y
-- circula, asi que cada exportacion deja aqui su apunte, para saber que copia
-- anda por ahi: quien, cuando, a que dia, cuantas filas y de que congelacion.
--
-- tmc_exportaciones: una fila por exportacion. No se cambia ni se borra.
--   congelacion_id  la congelacion vigente de la que parte (NULL si no habia).
--   hoy             el dia (en Colombia) de los valores del fichero.
--   filas           filas de equipo de la hoja principal.
--   retirados       lo retirado a mano, que va en su hoja aparte.
--   archivo         el nombre con que se sirvio.
--   sha256          la huella del fichero tal como salio (una copia sin
--                   tocar se reconoce por ella).
--   por_id, por, en la firma. Las personas, id + correo, sin clave foranea.
-- Solo recuentos y la firma: ningun dato de los equipos.
--
-- No habia donde apuntarlo: las demas tablas de auditoria del modulo son de
-- una operacion concreta (sincronizar el maestro, traer calibraciones,
-- retirar) con su propia forma. No es una tabla de mensajes: no hay a quien
-- mandarle nada ni nada que salga despues.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only CREATE ...
-- IF NOT EXISTS, no seed. Never add a statement that fails or changes data on
-- a second run. exportacion.test.ts vigila esta regla.

CREATE TABLE IF NOT EXISTS portal.tmc_exportaciones (
  id             BIGSERIAL     PRIMARY KEY,
  congelacion_id BIGINT        NULL,
  hoy            DATE          NOT NULL,
  filas          INTEGER       NOT NULL,
  retirados      INTEGER       NOT NULL,
  archivo        VARCHAR(120)  NOT NULL,
  sha256         CHAR(64)      NOT NULL,
  por_id         UUID          NULL,
  por            VARCHAR(254)  NOT NULL,
  en             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
