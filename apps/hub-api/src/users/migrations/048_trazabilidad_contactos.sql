-- Migration 048: Trazabilidad Mantenimientos Clientes - contacto puesto a mano a un cliente.
--
-- El aviso de vencimiento de calibracion de un equipo iria al contacto del
-- ultimo ticket que abrio su cliente. Esa persona puede no ser quien decide,
-- asi que en la pestana "Avisos a clientes" se le puede poner a mano un
-- contacto al CLIENTE. Cuando hay fila, MANDA sobre el contacto del ticket para
-- todos los equipos de ese cliente; al quitarlo se borra la fila y vuelve a
-- valer el del ticket.
--
-- Hoy esto alimenta una SIMULACION: la app calcula y ensena a quien se le
-- escribiria, y nada mas. Esta tabla solo guarda direcciones; no hay aqui (ni
-- en ninguna otra tabla de este modulo) registro de mensajes ni nada que los
-- mande.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only
-- CREATE ... IF NOT EXISTS here. No seed on purpose: no customer starts with a
-- hand-set contact. Any statement that writes would wipe or rewrite what users
-- set by hand on the next restart. plazos.test.ts vigila esta regla.
--
-- `clave` es el nombre del cliente normalizado (claveCliente en
-- trazabilidad/dominio.ts: sin mayusculas, sin tildes y sin espacios repetidos)
-- y con ella casan los equipos de portal.tmc_equipos, SIN clave foranea a
-- proposito: el cliente es texto libre de la hoja F-ST-022 y no tiene tabla
-- propia; si un cliente deja de aparecer, su fila se queda aqui, inofensiva.
-- `cliente` es el nombre tal como se escribio al guardarlo. `emails` lleva
-- entre uno y cinco correos, ya en minusculas y sin repetir (lo valida la API;
-- el tope es CONTACTO_MAX_EMAILS en trazabilidad/dominio.ts). `nombre` es la
-- persona de contacto, opcional (vacio si no se puso).
-- actualizado_* firma el cambio (id + correo, sin clave foranea a
-- portal.users, como en la 042, la 043, la 044 y la 046).

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_contactos (
  clave               VARCHAR(200)  PRIMARY KEY CHECK (clave <> ''),
  cliente             VARCHAR(200)  NOT NULL,
  emails              TEXT[]        NOT NULL CHECK (cardinality(emails) BETWEEN 1 AND 5),
  nombre              VARCHAR(200)  NOT NULL DEFAULT '',
  actualizado_por_id  UUID          NULL,
  actualizado_por     VARCHAR(254)  NOT NULL,
  actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
