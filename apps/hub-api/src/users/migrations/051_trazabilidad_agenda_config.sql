-- Migration 051: Trazabilidad Mantenimientos Clientes - agenda del taller:
-- puestos por etapa y duraciones por etapa y tipo de servicio.
--
-- tmc_agenda_etapas: cuantos puestos simultaneos tiene cada etapa del taller
--   (la capacidad). Una fila por etapa; `orden` es el del recorrido.
-- tmc_agenda_duraciones: cuantos dias habiles ocupa un puesto de una etapa un
--   servicio de un tipo. `tipo` es la clave del tipo de servicio
--   (claveTipoServicio en trazabilidad/dominio.ts) o '*', la fila POR DEFECTO
--   de la etapa: la que vale para un ticket sin tipo o con un tipo que no
--   tiene fila propia. La '*' de cada etapa no se borra desde la app.
--
-- No se reutiliza portal.tmc_plazos: aquel es el plazo comprometido con el
-- cliente por tipo de servicio; esto es cuanto se ocupa un puesto en cada etapa.
--
-- Las etapas son las de ETAPAS_AGENDA en trazabilidad/dominio.ts y los topes,
-- PUESTOS_MAX y PLAZO_MIN_DIAS / PLAZO_MAX_DIAS (agenda-config.test.ts vigila
-- que coincidan).
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. The tables are
-- CREATE ... IF NOT EXISTS and both seeds are INSERT ... ON CONFLICT DO
-- NOTHING, so what is edited from the app is never overwritten by a restart.
-- Never add a statement that fails or changes data on a second run.
-- agenda-config.test.ts vigila esta regla.
--
-- Semilla: los valores de ejemplo del analisis (Diagnostico 3 puestos y 3
-- dias, Proceso 4 y 4, Verificacion 2 y 1). De las duraciones solo se siembra
-- la '*'. actualizado_* queda NULL en las filas sembradas y se rellena cuando
-- alguien las edita (id + correo, sin clave foranea, como en la 043).
--
-- Sin claves foraneas, como el resto de tablas tmc_* de configuracion. Nada de
-- esto toca la replica de tickets ni la base de la herramienta de tickets.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_agenda_etapas (
  etapa               VARCHAR(12)   PRIMARY KEY CHECK (etapa IN ('diagnostico', 'proceso', 'verificacion')),
  etiqueta            VARCHAR(40)   NOT NULL,
  orden               SMALLINT      NOT NULL,
  puestos             INTEGER       NOT NULL CHECK (puestos BETWEEN 0 AND 50),
  actualizado_por_id  UUID          NULL,
  actualizado_por     VARCHAR(254)  NULL,
  actualizado_en      TIMESTAMPTZ   NULL
);

CREATE TABLE IF NOT EXISTS portal.tmc_agenda_duraciones (
  etapa               VARCHAR(12)   NOT NULL CHECK (etapa IN ('diagnostico', 'proceso', 'verificacion')),
  tipo                VARCHAR(80)   NOT NULL CHECK (tipo <> ''),
  dias_habiles        INTEGER       NOT NULL CHECK (dias_habiles BETWEEN 1 AND 365),
  actualizado_por_id  UUID          NULL,
  actualizado_por     VARCHAR(254)  NULL,
  actualizado_en      TIMESTAMPTZ   NULL,
  PRIMARY KEY (etapa, tipo)
);

INSERT INTO portal.tmc_agenda_etapas (etapa, etiqueta, orden, puestos) VALUES
  ('diagnostico', 'Diagnóstico', 1, 3),
  ('proceso', 'Proceso', 2, 4),
  ('verificacion', 'Verificación', 3, 2)
ON CONFLICT (etapa) DO NOTHING;

INSERT INTO portal.tmc_agenda_duraciones (etapa, tipo, dias_habiles) VALUES
  ('diagnostico', '*', 3),
  ('proceso', '*', 4),
  ('verificacion', '*', 1)
ON CONFLICT (etapa, tipo) DO NOTHING;
