-- Destinatarios del correo automático de WO-sales, configurables desde la app.
CREATE TABLE IF NOT EXISTS portal.wo_sales_recipients (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL UNIQUE,   -- sin duplicados: no reenviar dos veces al mismo
  nombre      TEXT        NOT NULL,
  activo      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estado del envío: una única fila (id=1). ultimo_hash = huella del último archivo
-- CONFIRMADO como enviado. Sirve para no reenviar lo mismo y para no perder un envío
-- si el correo falla (el hash solo avanza al confirmar).
CREATE TABLE IF NOT EXISTS portal.wo_sales_email_estado (
  id              INTEGER     PRIMARY KEY CHECK (id = 1),
  ultimo_hash     TEXT,
  ultimo_envio_at TIMESTAMPTZ
);
