-- Migration 065: reserva temporal del correo de WO-sales por destinatario (DATA-339).
--
-- El problema que arregla es el mismo que la 019 cerró en ausencias: el endpoint
-- /wo-sales/email/pendiente decide a quién enviar el archivo leyendo
-- wo_sales_email_sent, pero NO marca nada hasta que n8n llama a /confirmado. Si dos
-- disparadores de n8n piden /pendiente casi a la vez, los dos ven a los mismos
-- destinatarios pendientes y el correo con el xlsx sale dos veces.
--
-- Servir ahora reserva: (email, hash del archivo, instante). Mientras la reserva de
-- ESE mismo hash tenga menos de unos minutos, el destinatario no se vuelve a ofrecer.
-- La propiedad de siempre se conserva: si n8n no confirma, la reserva expira sola y el
-- ciclo siguiente reintenta. Una reserva de OTRO hash no bloquea (el archivo cambió y
-- hay que mandar el nuevo).
--
-- Tabla propia y no una columna en wo_sales_email_sent: un destinatario recién
-- añadido no tiene fila allí, y es justo uno de los que hay que poder reservar.
--
-- Solo DDL e idempotente: initDb() la re-ejecuta en cada arranque, y si falla hub-api
-- no arranca.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.wo_sales_email_reserva (
  email        text        PRIMARY KEY,
  hash         text        NOT NULL,
  reservado_at timestamptz NOT NULL
);
