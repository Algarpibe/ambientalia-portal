-- Migration 046: Trazabilidad Mantenimientos Clientes - rol de cada estado de Zoho.
--
-- Cada estado de un ticket tiene un rol en el reloj del plazo, y solo uno:
--   cuenta    - el tiempo en ese estado corre. Es el de partida.
--   standby   - reloj en PAUSA: el ticket esta parado porque depende de una
--               decision del cliente o de un servicio externo. Los dias habiles
--               que pasa asi no cuentan y la fecha limite se corre.
--   terminado - reloj PARADO: el trabajo tecnico esta hecho (por facturar, por
--               entregar). El ticket se juzga por el dia en que llego ahi.
-- Esta tabla guarda ese rol, una fila por estado. Se elige en la pestana
-- «Configuracion» y se aplica en «Servicios». Los valores son los de
-- ROLES_ESTADO en trazabilidad/dominio.ts (plazos.test.ts vigila que coincidan).
--
-- El rol NO se copia al historial de estados (migracion 047): alli se apunta
-- en que estado estuvo cada ticket y el rol se mira al leer, con lo que diga
-- esta tabla en ese momento. Cambiar el rol de un estado reevalua el pasado.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only
-- CREATE ... IF NOT EXISTS here. No seed on purpose: every status starts as
-- 'cuenta' and nothing is pre-marked (the "On Hold" type of the ticketing
-- tool is only a hint: a status can be on hold there without being a customer
-- wait). Any statement that writes would wipe or rewrite what users chose by
-- hand on the next restart. plazos.test.ts vigila esta regla.
--
-- `clave` es el estado normalizado (claveEstadoDesk en trazabilidad/dominio.ts:
-- sin mayusculas, sin tildes y sin espacios repetidos) y con ella casan los
-- tickets. SIN clave foranea a proposito: la replica de tickets es del worker
-- de zoho-hub y hub-api no crea ni altera nada alli. Se puede elegir el rol de
-- un estado antes de que ningun ticket lo use, y si un estado deja de usarse su
-- fila se queda aqui, inofensiva. `etiqueta` es como se escribia el estado al
-- elegirlo. Solo hay fila para los estados que alguien ha tocado: los demas
-- valen 'cuenta' sin estar en la tabla. Volver a 'cuenta' no borra la fila:
-- queda quien lo hizo.
-- actualizado_* firma el cambio (id + correo, sin clave foranea a portal.users,
-- como en la 042, la 043 y la 044).

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_estados_desk (
  clave               VARCHAR(80)   PRIMARY KEY CHECK (clave <> ''),
  etiqueta            VARCHAR(80)   NOT NULL,
  rol                 VARCHAR(10)   NOT NULL DEFAULT 'cuenta' CHECK (rol IN ('cuenta', 'standby', 'terminado')),
  actualizado_por_id  UUID          NULL,
  actualizado_por     VARCHAR(254)  NOT NULL,
  actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
