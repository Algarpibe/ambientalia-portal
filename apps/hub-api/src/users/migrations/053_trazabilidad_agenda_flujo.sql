-- Migration 053: Trazabilidad Mantenimientos Clientes - agenda del taller:
-- flujo marcado a mano por ticket.
--
-- tmc_agenda_flujo: el flujo ('servicio' / 'equipo_nuevo', FLUJOS_AGENDA en
--   trazabilidad/dominio.ts) que alguien le marco a un ticket. Solo se marca
--   cuando la fuente de tickets no trae su clasificacion; con ella, manda ella.
--   Una fila por ticket marcado, firmada; quitar la marca borra la fila y
--   vuelve a valer el flujo de la fuente. Mismo patron que la 044.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only CREATE ...
-- IF NOT EXISTS, no seed. Never add a statement that fails or changes data on
-- a second run. agenda-asignaciones.test.ts vigila esta regla.
--
-- Sin claves foraneas. Nada de esto toca la replica de tickets ni la base de
-- la herramienta de tickets.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_agenda_flujo (
  numero              INTEGER       PRIMARY KEY CHECK (numero > 0),
  flujo               VARCHAR(12)   NOT NULL CHECK (flujo IN ('servicio', 'equipo_nuevo')),
  actualizado_por_id  UUID          NULL,
  actualizado_por     VARCHAR(254)  NOT NULL,
  actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
