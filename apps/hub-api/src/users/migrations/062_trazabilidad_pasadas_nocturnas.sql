-- Migration 062: Trazabilidad Mantenimientos Clientes - pasadas nocturnas
-- (lote 10).
--
-- Decision de Alfonso: las dos pasadas que eran solo a mano (sincronizar el
-- maestro de equipos y traer las calibraciones desde Desk 2.0) salen solas
-- cada noche a las 02:00 de Colombia. Se aplican SOLO si el plan es «limpio»
-- (pasadas-nocturnas.ts); lo demas se retiene para que lo mire una persona y
-- lo aplique con el boton de siempre. Lo que se aplica deja su auditoria de
-- siempre (tmc_maestro_sincronizaciones / tmc_calibraciones_pasadas), firmada
-- «Pasada automatica».
--
-- tmc_pasadas_nocturnas: un apunte por dia (en Colombia) y tipo.
--   fecha      el dia en Colombia de la pasada.
--   tipo       'maestro' o 'calibraciones'.
--   resultado  'en_curso' (se reclamo el dia y aun no acabo), 'aplicada',
--              'sin_cambios' (el plan no escribia nada), 'retenida' (hay que
--              revisarlo: `motivos`), 'no_disponible' (Desk 2.0 no contesto)
--              o 'error' (el detalle va al registro del servidor).
--   motivos    lista de textos en espanol: por que se retuvo, o que paso.
--   huella, recuentos   los del plan evaluado (NULL si no hubo plan).
--   pasada_id  el id de la fila de auditoria si se aplico (sin clave foranea).
--   empezo, termino     cuando; en curso si y solo si no ha terminado.
-- UNIQUE (fecha, tipo): el dia se reclama con un INSERT ... ON CONFLICT DO
-- NOTHING, asi que dos instancias de hub-api no hacen la misma pasada dos
-- veces. Solo la escribe pasadas-nocturnas-repo.ts. Solo recuentos y textos:
-- ningun cliente ni serial, y no es una tabla de mensajes.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only CREATE ...
-- IF NOT EXISTS, no seed. pasadas-nocturnas-repo.test.ts vigila esta regla.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_pasadas_nocturnas (
  id         BIGSERIAL     PRIMARY KEY,
  fecha      DATE          NOT NULL,
  tipo       VARCHAR(16)   NOT NULL CHECK (tipo IN ('maestro', 'calibraciones')),
  resultado  VARCHAR(16)   NOT NULL CHECK (resultado IN ('en_curso', 'aplicada', 'sin_cambios', 'retenida', 'no_disponible', 'error')),
  motivos    JSONB         NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(motivos) = 'array'),
  huella     VARCHAR(64)   NULL,
  recuentos  JSONB         NULL,
  pasada_id  BIGINT        NULL,
  empezo     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  termino    TIMESTAMPTZ   NULL,
  CONSTRAINT tmc_pasadas_nocturnas_dia_uq UNIQUE (fecha, tipo),
  CONSTRAINT tmc_pasadas_nocturnas_termino CHECK ((resultado = 'en_curso') = (termino IS NULL))
);
