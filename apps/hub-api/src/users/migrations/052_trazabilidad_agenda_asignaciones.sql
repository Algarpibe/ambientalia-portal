-- Migration 052: Trazabilidad Mantenimientos Clientes - agenda del taller:
-- asignaciones de puesto.
--
-- tmc_agenda_asignaciones: que ticket ocupa (u ocupo) que puesto de que etapa.
--   Una fila por asignacion; `hasta` NULL = vigente. No se borra ninguna: al
--   cerrarse queda la historia de quien la hizo, quien la cerro y por que.
--
--   numero    ticket (sin clave foranea: la fuente de tickets es otra base)
--   etapa     las de ETAPAS_AGENDA en trazabilidad/dominio.ts
--   puesto    numero del puesto dentro de la etapa, desde 1 (tope PUESTOS_MAX).
--             Que no pase de los puestos CONFIGURADOS de la etapa lo comprueba
--             la app al asignar: aqui solo va el tope absoluto, porque reducir
--             los puestos no desaloja a nadie.
--   desde     instante en que se asigno
--   inicio    dia desde el que cuenta la duracion (siempre habil)
--   hasta     instante en que se cerro; NULL = vigente
--   origen    'fila' (una a una) o 'arranque' (reparto inicial)
--   sugerido  el ticket que proponia la fila en ese momento
--   motivo    por que se eligio a otro: obligatorio con origen 'fila' si
--             `sugerido` no es el propio ticket
--   cierre    como se cerro: 'estado' (sola, al salir el ticket de la etapa),
--             'manual' (liberada a mano: con motivo y firma) o 'reparto'
--             (reemplazada por un reparto)
--
-- Dos indices unicos parciales sobre las vigentes: como mucho una asignacion
-- por ticket y como mucho un ocupante por etapa y puesto.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only CREATE ...
-- IF NOT EXISTS, no seed: nothing is assigned until someone does it from the
-- app, and a restart never touches what is stored. Never add a statement that
-- fails or changes data on a second run. agenda-asignaciones.test.ts vigila
-- esta regla.
--
-- Sin claves foraneas. Nada de esto toca la replica de tickets ni la base de
-- la herramienta de tickets.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_agenda_asignaciones (
  id               BIGSERIAL     PRIMARY KEY,
  numero           INTEGER       NOT NULL CHECK (numero > 0),
  etapa            VARCHAR(12)   NOT NULL CHECK (etapa IN ('diagnostico', 'proceso', 'verificacion')),
  puesto           INTEGER       NOT NULL CHECK (puesto BETWEEN 1 AND 50),
  desde            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  inicio           DATE          NOT NULL,
  hasta            TIMESTAMPTZ   NULL,
  origen           VARCHAR(12)   NOT NULL CHECK (origen IN ('fila', 'arranque')),
  sugerido         INTEGER       NULL,
  motivo           VARCHAR(500)  NULL,
  asignado_por_id  UUID          NULL,
  asignado_por     VARCHAR(254)  NOT NULL,
  cierre           VARCHAR(12)   NULL CHECK (cierre IN ('estado', 'manual', 'reparto')),
  cierre_motivo    VARCHAR(500)  NULL,
  cerrado_por_id   UUID          NULL,
  cerrado_por      VARCHAR(254)  NULL,
  CONSTRAINT tmc_agenda_asig_fechas_ck CHECK (hasta IS NULL OR hasta >= desde),
  CONSTRAINT tmc_agenda_asig_cierre_ck CHECK ((hasta IS NULL) = (cierre IS NULL)),
  CONSTRAINT tmc_agenda_asig_motivo_ck CHECK (origen <> 'fila' OR sugerido IS NULL OR sugerido = numero OR btrim(COALESCE(motivo, '')) <> ''),
  CONSTRAINT tmc_agenda_asig_manual_ck CHECK (cierre IS DISTINCT FROM 'manual' OR (btrim(COALESCE(cierre_motivo, '')) <> '' AND cerrado_por IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_ticket_uq ON portal.tmc_agenda_asignaciones (numero) WHERE hasta IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_puesto_uq ON portal.tmc_agenda_asignaciones (etapa, puesto) WHERE hasta IS NULL;
CREATE INDEX IF NOT EXISTS tmc_agenda_asig_numero_idx ON portal.tmc_agenda_asignaciones (numero, desde);
