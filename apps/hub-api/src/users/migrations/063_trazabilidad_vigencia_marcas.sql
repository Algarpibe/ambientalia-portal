-- Migration 063: Trazabilidad Mantenimientos Clientes - vigencia de
-- calibracion por marca (lote 11).
--
-- Decision de Alfonso (18/10/2026): GRIMM se calibra cada 12 meses (365
-- dias, como siempre). Horiba NO tiene plazo fijo: se calibra con el
-- mantenimiento preventivo, cuya frecuencia depende del contrato de cada
-- cliente (un dato que aun no existe; la frecuencia por contrato no esta
-- hecha). Asi que Horiba y las demas marcas empiezan SIN VENCIMIENTO: no
-- vencen, no avisan y no salen en el calendario de proximas calibraciones.
-- Que una marca tenga plazo fijo se elige por marca en «Marcas en
-- seguimiento», con motivo y firma (permiso inventario.write, el de su
-- interruptor).
--
-- tmc_marcas_vigencia: una fila por marca que alguien ha tocado.
--   clave   la marca normalizada (la de tmc_marcas: «HORIBA» = «Horiba»).
--   marca   como se escribia al cambiarla.
--   dias    la vigencia en dias (30..1095); NULL = sin vencimiento.
--   motivo, por_id, por, en   la firma del ultimo cambio.
--   Sin fila manda el CODIGO (vigencia.ts, VIGENCIA_POR_DEFECTO): GRIMM 365,
--   las demas sin vencimiento. GRIMM EDM 180 es fijo (365): no puede tener
--   fila.
-- tmc_marcas_vigencia_cambios: un apunte por cambio, con el valor anterior y
--   el nuevo (NULL = sin vencimiento), el motivo y la firma. No se cambia ni
--   se borra.
-- Solo marcas, dias y la firma: ningun dato de los equipos. No es una tabla
-- de mensajes: cambiar una vigencia no manda nada a nadie.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only CREATE ...
-- IF NOT EXISTS and NO SEED: un arranque nunca pisa lo elegido, y al
-- desplegar nada se guarda (vigencia-repo.test.ts vigila esta regla).

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_marcas_vigencia (
  clave   VARCHAR(60)   PRIMARY KEY,
  marca   VARCHAR(60)   NOT NULL,
  dias    INTEGER       NULL CHECK (dias IS NULL OR dias BETWEEN 30 AND 1095),
  motivo  TEXT          NOT NULL CHECK (btrim(motivo) <> ''),
  por_id  UUID          NULL,
  por     VARCHAR(254)  NOT NULL,
  en      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT tmc_marcas_vigencia_no_edm180 CHECK (clave <> 'grimm edm 180')
);

CREATE TABLE IF NOT EXISTS portal.tmc_marcas_vigencia_cambios (
  id       BIGSERIAL     PRIMARY KEY,
  clave    VARCHAR(60)   NOT NULL,
  marca    VARCHAR(60)   NOT NULL,
  antes    INTEGER       NULL,
  despues  INTEGER       NULL,
  motivo   TEXT          NOT NULL CHECK (btrim(motivo) <> ''),
  por_id   UUID          NULL,
  por      VARCHAR(254)  NOT NULL,
  en       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
