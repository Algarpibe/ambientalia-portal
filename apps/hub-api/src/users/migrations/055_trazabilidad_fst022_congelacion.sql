-- Migration 055: Trazabilidad Mantenimientos Clientes - congelacion de la
-- hoja F-ST-022 (lote 9a).
--
-- La Excel deja de ser la fuente. Antes se guarda la hoja ENTERA tal cual
-- (todas las marcas, tambien los datos sucios), como punto de partida.
--
-- tmc_fst022_congelaciones: una fila por congelacion: fichero (nombre y sha256,
--   que calcula el navegador), hoja, sus filas de titulos tal cual (`cabeceras`),
--   recuentos y quien la hizo. Como mucho UNA vigente (indice unico parcial).
--   Volver a congelar no borra la anterior: deja de ser la vigente y se apunta
--   quien la reemplazo, cuando y por que.
--
-- tmc_fst022_congelada: las filas de la hoja que traen algo, por su numero de
--   fila de Excel. `celdas` es el array posicional de la fila: texto, numero,
--   booleano, null (vacia) o un objeto {v, t, enlace} para una fecha
--   (t = fecha, v = AAAA-MM-DD), un error de Excel (t = error, v = su texto) o
--   una celda con hipervinculo (enlace). Lo demas se DERIVA para consultar:
--   `es_equipo` (frente a titulos, pie de totales o valores sueltos),
--   `serial_norm` (mayusculas y sin espacios alrededor, como lo cruza el portal
--   con los tickets) y `clave_equipo` (la de tmc_equipos, solo si la
--   importacion de siempre acepta la fila).
--   INMUTABLE: solo se insertan, al congelar, y se leen. Ningun codigo las
--   cambia ni las borra (fst022.test.ts lo vigila leyendo el fuente).
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only CREATE ...
-- IF NOT EXISTS, no seed. Never add a statement that fails or changes data on
-- a second run. fst022.test.ts vigila esta regla. La unica clave foranea es la
-- de cada fila a su congelacion; las personas, id + correo, sin clave foranea.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_fst022_congelaciones (
  id                  BIGSERIAL     PRIMARY KEY,
  archivo             VARCHAR(255)  NOT NULL,
  sha256              VARCHAR(64)   NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  hoja                VARCHAR(100)  NOT NULL,
  fila_cabecera       INTEGER       NOT NULL CHECK (fila_cabecera > 0),
  cabeceras           JSONB         NOT NULL CHECK (jsonb_typeof(cabeceras) = 'array'),
  total_filas         INTEGER       NOT NULL CHECK (total_filas > 0),
  total_columnas      INTEGER       NOT NULL CHECK (total_columnas > 0),
  filas_guardadas     INTEGER       NOT NULL CHECK (filas_guardadas > 0),
  filas_equipo        INTEGER       NOT NULL CHECK (filas_equipo >= 0),
  filas_con_serial    INTEGER       NOT NULL CHECK (filas_con_serial >= 0),
  filas_edm180        INTEGER       NOT NULL CHECK (filas_edm180 >= 0),
  problemas           JSONB         NOT NULL,
  vigente             BOOLEAN       NOT NULL DEFAULT TRUE,
  motivo              VARCHAR(500)  NULL,
  por_id              UUID          NULL,
  por                 VARCHAR(254)  NOT NULL,
  en                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  reemplazada_por_id  UUID          NULL,
  reemplazada_por     VARCHAR(254)  NULL,
  reemplazada_en      TIMESTAMPTZ   NULL,
  reemplazada_motivo  VARCHAR(500)  NULL,
  CONSTRAINT tmc_fst022_vigente_o_reemplazada CHECK (
    (vigente AND reemplazada_en IS NULL AND reemplazada_por IS NULL AND reemplazada_motivo IS NULL)
    OR (NOT vigente AND reemplazada_en IS NOT NULL AND reemplazada_por IS NOT NULL AND reemplazada_motivo IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tmc_fst022_congelaciones_vigente_uq ON portal.tmc_fst022_congelaciones (vigente) WHERE vigente;

CREATE TABLE IF NOT EXISTS portal.tmc_fst022_congelada (
  congelacion_id  BIGINT       NOT NULL REFERENCES portal.tmc_fst022_congelaciones (id),
  fila            INTEGER      NOT NULL CHECK (fila > 0),
  celdas          JSONB        NOT NULL CHECK (jsonb_typeof(celdas) = 'array'),
  es_equipo       BOOLEAN      NOT NULL,
  serial_norm     TEXT         NULL,
  clave_equipo    TEXT         NULL,
  PRIMARY KEY (congelacion_id, fila)
);

CREATE INDEX IF NOT EXISTS tmc_fst022_congelada_serial_idx ON portal.tmc_fst022_congelada (congelacion_id, serial_norm);
