-- Migration 061: Trazabilidad Mantenimientos Clientes - marcas en seguimiento,
-- por marca (lote 9f).
--
-- Decision de Alfonso (17/10/2026): las demas marcas entran en Resumen,
-- Equipos, Calendario y Avisos POR MARCA, con un interruptor por marca que
-- enciende o apaga quien tiene inventario.write (Director Tecnico; los
-- administradores, todo), con motivo. GRIMM EDM 180 esta siempre incluido y
-- no tiene interruptor (su columna de la 058 sigue siendo la que lo dice).
--
-- La inclusion se DERIVA al leer (inventario.ts, EN_INVENTARIO): un equipo
-- esta en el inventario si esta en seguimiento o si la clave de su marca
-- esta aqui con incluida = TRUE. No se copia nada a los equipos.
--
-- tmc_marcas: una fila por marca que alguien ha tocado. Sin fila = apagada.
--   clave     la marca normalizada (sin mayusculas, tildes ni espacios de
--             mas: «HORIBA» y «Horiba» son la misma).
--   marca     como se escribia al cambiarla (la forma mas escrita).
--   incluida  si esta encendida.
--   motivo, por_id, por, en   la firma del ultimo cambio.
-- tmc_marcas_cambios: un apunte por cada vez que se enciende o se apaga una
--   marca, con su motivo, su firma y lo que hizo (cuantos equipos, cuantas
--   filas de partida nacieron y cuantas calibraciones sueltas se enlazaron).
--   No se cambia ni se borra.
-- Solo marcas, recuentos y la firma: ningun dato de los equipos. No es una
-- tabla de mensajes: incluir una marca no manda nada a nadie.
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Only CREATE ...
-- IF NOT EXISTS and NO SEED: al desplegar todas las marcas quedan apagadas y
-- nada cambia. marcas.test.ts vigila esta regla.

CREATE TABLE IF NOT EXISTS portal.tmc_marcas (
  clave     VARCHAR(60)   PRIMARY KEY,
  marca     VARCHAR(60)   NOT NULL,
  incluida  BOOLEAN       NOT NULL,
  motivo    TEXT          NOT NULL CHECK (btrim(motivo) <> ''),
  por_id    UUID          NULL,
  por       VARCHAR(254)  NOT NULL,
  en        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal.tmc_marcas_cambios (
  id         BIGSERIAL     PRIMARY KEY,
  clave      VARCHAR(60)   NOT NULL,
  marca      VARCHAR(60)   NOT NULL,
  accion     VARCHAR(8)    NOT NULL CHECK (accion IN ('incluir', 'excluir')),
  motivo     TEXT          NOT NULL CHECK (btrim(motivo) <> ''),
  equipos    INTEGER       NOT NULL,
  partidas   INTEGER       NOT NULL,
  enlazadas  INTEGER       NOT NULL,
  por_id     UUID          NULL,
  por        VARCHAR(254)  NOT NULL,
  en         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
