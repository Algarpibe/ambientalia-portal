-- Migration 069: registro de los avisos a clientes que se envían desde «Avisos a clientes» (Trazabilidad).
--
-- Una fila por cada vez que alguien pulsa «Enviar correo» en una tarjeta (un cliente y un tramo: 90, 60,
-- 30 días o «vencida»). Se apunta ANTES de entregar el correo, como «en_curso», y se cierra con lo que
-- conteste el canal: «enviado» (con el identificador del mensaje) o «fallido» (con el motivo). Un
-- «en_curso» que se queda sin respuesta es lo que la pantalla enseña como «sin confirmar», y lo resuelve
-- una persona (quién y cuándo, en resuelto_*).
--
-- El índice único parcial es el candado contra el doble envío: como mucho UN «en_curso» por cliente y
-- tramo, así que un doble clic o dos personas a la vez dan un 409 al segundo.
--
-- Guarda a quién iba (destinatarios), a quién se mandó (enviado_a: en modo prueba, sólo el buzón de
-- prueba), el asunto y las claves de los equipos; NO guarda el texto. Es un registro, no una cola: nada
-- lo lee para enviar (lo único que envía es la ruta del botón). Sin semilla ni clave foránea.
--
-- Sólo DDL e idempotente: initDb() la re-ejecuta en cada arranque. Da además sus permisos a portal_app
-- (DATA-332) aquí mismo: la 068 corre ANTES que ella en cada arranque, y sin esto la tabla no le
-- llegaría a portal_app hasta el arranque siguiente.

CREATE TABLE IF NOT EXISTS portal.tmc_avisos_envios (
  id              BIGSERIAL    PRIMARY KEY,
  creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  dia             DATE         NOT NULL,
  por_id          UUID         NULL,
  por             VARCHAR(254) NOT NULL,
  modo            VARCHAR(10)  NOT NULL CHECK (modo IN ('prueba', 'real')),
  clave_cliente   VARCHAR(200) NOT NULL CHECK (clave_cliente <> ''),
  cliente         VARCHAR(200) NOT NULL,
  tramo           VARCHAR(10)  NOT NULL CHECK (tramo IN ('90', '60', '30', 'vencida')),
  equipos         TEXT[]       NOT NULL CHECK (cardinality(equipos) > 0),
  destinatarios   TEXT[]       NOT NULL CHECK (cardinality(destinatarios) > 0),
  enviado_a       TEXT[]       NOT NULL CHECK (cardinality(enviado_a) > 0),
  asunto          TEXT         NOT NULL,
  estado          VARCHAR(10)  NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'enviado', 'fallido')),
  message_id      TEXT         NULL,
  error           TEXT         NULL,
  terminado_en    TIMESTAMPTZ  NULL,
  resuelto_por_id UUID         NULL,
  resuelto_por    VARCHAR(254) NULL,
  resuelto_en     TIMESTAMPTZ  NULL,
  CONSTRAINT tmc_avisos_envios_terminado CHECK ((estado = 'en_curso') = (terminado_en IS NULL)),
  CONSTRAINT tmc_avisos_envios_enviado CHECK (estado <> 'enviado' OR message_id IS NOT NULL OR resuelto_en IS NOT NULL),
  CONSTRAINT tmc_avisos_envios_resuelto CHECK ((resuelto_en IS NULL) = (resuelto_por IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS tmc_avisos_envios_en_curso_uq
  ON portal.tmc_avisos_envios (clave_cliente, tramo) WHERE estado = 'en_curso';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.tmc_avisos_envios TO portal_app;
    GRANT USAGE, SELECT ON SEQUENCE portal.tmc_avisos_envios_id_seq TO portal_app;
  END IF;
END $$;
