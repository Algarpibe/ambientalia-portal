-- Migration 044: Trazabilidad Mantenimientos Clientes - tipo de servicio puesto a mano.
--
-- La replica de tickets de Zoho llega sin tipo de servicio (el worker de
-- zoho-hub aun no trae ese campo), asi que ningun ticket abierto tenia plazo.
-- Esta tabla guarda el tipo que alguien elige a mano en la pestana «Servicios»,
-- por numero de ticket. Cuando hay fila, MANDA sobre el tipo que traiga la
-- replica; al quitarlo se borra la fila y vuelve a valer el de la replica.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only
-- CREATE ... IF NOT EXISTS here: no seed, no INSERT/UPDATE/DELETE, no DROP, no
-- ALTER. Any statement that writes would wipe or rewrite what users set by
-- hand on the next restart. plazos.test.ts vigila esta regla.
--
-- `numero` es el numero del ticket en Zoho. SIN clave foranea a proposito: la
-- replica es del worker de zoho-hub y hub-api no crea ni altera nada alli; si
-- un ticket desaparece de la replica, su fila aqui queda huerfana e inofensiva.
-- `clave` es el tipo normalizado (claveTipoServicio en trazabilidad/dominio.ts),
-- el mismo valor que portal.tmc_plazos.clave, tambien sin clave foranea: la
-- API solo deja elegir tipos que existan en tmc_plazos. `etiqueta` es como se
-- llamaba ese tipo al elegirlo, por si su fila de tmc_plazos dejara de existir.
-- actualizado_* firma el cambio (id + correo sin FK a portal.users, como en la
-- 042 y la 043).

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_servicios_tipo (
  numero              INTEGER       PRIMARY KEY CHECK (numero > 0),
  clave               VARCHAR(80)   NOT NULL CHECK (clave <> ''),
  etiqueta            VARCHAR(80)   NOT NULL,
  actualizado_por_id  UUID          NULL,
  actualizado_por     VARCHAR(254)  NOT NULL,
  actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
