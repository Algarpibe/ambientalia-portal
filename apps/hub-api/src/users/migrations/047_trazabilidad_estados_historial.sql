-- Migration 047: Trazabilidad Mantenimientos Clientes - historial de estados.
--
-- Para descontar del plazo el tiempo en standby hay que saber cuanto estuvo
-- cada ticket en cada estado, y la replica de tickets solo trae el estado de
-- ahora. Asi que el portal lo mide el mismo, de aqui en adelante: hub-api mira
-- cada pocos minutos el estado de los tickets sin cerrar y apunta aqui los
-- cambios que ve (registrarEstados en trazabilidad/repo.ts).
--
-- Una fila = un tramo: el ticket `numero` estuvo en el estado `clave` desde
-- `desde` hasta `hasta`. `hasta` NULL = sigue en ese estado. Un ticket tiene
-- como mucho UN tramo abierto: lo garantiza el indice unico parcial, que es
-- tambien lo que hace segura la escritura cuando dos procesos apuntan a la vez.
-- Cuando el ticket se cierra (o desaparece de la replica) su tramo abierto se
-- cierra y no se abre otro.
--
-- `desde_real` dice si `desde` es un cambio de estado que el portal vio de
-- verdad (TRUE) o la primera vez que vio el ticket, que ya estaba en ese
-- estado (FALSE): entonces `desde` es el instante de esa primera observacion y
-- el comienzo real no se sabe. Lo anterior a la primera fila de un ticket no
-- se puede reconstruir y cuenta como tiempo activo.
--
-- `clave` es el estado normalizado (claveEstadoDesk en trazabilidad/dominio.ts)
-- y `etiqueta`, como se escribia cuando se vio. Dos grafias del mismo estado
-- NO son un cambio. El ROL del estado (cuenta / standby / terminado) no se
-- guarda aqui a proposito: se mira al leer, en portal.tmc_estados_desk, asi que
-- cambiar el rol de un estado reevalua los tramos pasados. Por eso `clave` es
-- TEXT y admite el vacio: aqui se apunta lo que haya, tenga rol o no.
--
-- SIN clave foranea a proposito: la replica de tickets es del worker de
-- zoho-hub y hub-api no crea ni altera nada alli; y el historial de un ticket
-- tiene que sobrevivir a que su fila desaparezca de la replica.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only
-- CREATE ... IF NOT EXISTS here, no seed. Any statement that writes would
-- destroy a history that cannot be rebuilt. plazos.test.ts vigila esta regla.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.tmc_estados_historial (
  id          BIGSERIAL     PRIMARY KEY,
  numero      INTEGER       NOT NULL CHECK (numero > 0),
  clave       TEXT          NOT NULL,
  etiqueta    TEXT          NOT NULL,
  desde       TIMESTAMPTZ   NOT NULL,
  hasta       TIMESTAMPTZ   NULL,
  desde_real  BOOLEAN       NOT NULL,
  CHECK (hasta IS NULL OR hasta >= desde)
);

CREATE UNIQUE INDEX IF NOT EXISTS tmc_estados_historial_abierto_uq
  ON portal.tmc_estados_historial (numero)
  WHERE hasta IS NULL;

CREATE INDEX IF NOT EXISTS tmc_estados_historial_numero_idx
  ON portal.tmc_estados_historial (numero, desde);
