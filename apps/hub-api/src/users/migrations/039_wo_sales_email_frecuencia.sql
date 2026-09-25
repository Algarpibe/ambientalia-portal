-- Frecuencia de envío del correo de WO-sales por destinatario (la configura un admin).
-- Sin fila = 'inmediato' (el comportamiento de siempre). `ultimo_corte` es la última
-- franja de envío ya procesada (ver hub-api/src/wo-sales/frecuencia.ts).
CREATE TABLE IF NOT EXISTS portal.wo_sales_email_frecuencia (
  email        text PRIMARY KEY,
  frecuencia   text NOT NULL DEFAULT 'inmediato'
               CHECK (frecuencia IN ('inmediato', 'diario', 'semanal', 'fin_de_mes', 'nunca')),
  hora         smallint CHECK (hora BETWEEN 0 AND 23),
  dia_semana   smallint CHECK (dia_semana BETWEEN 1 AND 7),
  ultimo_corte timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
