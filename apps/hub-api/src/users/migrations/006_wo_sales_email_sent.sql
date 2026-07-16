-- Seguimiento del correo POR DESTINATARIO. Antes había un solo hash global
-- (wo_sales_email_estado): el archivo se enviaba solo cuando cambiaba su contenido, así
-- que un usuario recién añadido no recibía nada hasta que se modificara una OV. Ahora
-- cada destinatario guarda el hash del último archivo que recibió confirmado; se le
-- envía cuando ese hash ≠ el actual. Un usuario nuevo no tiene fila (hash NULL) → queda
-- pendiente → recibe el archivo actual en el siguiente ciclo, sin esperar un cambio y
-- sin reenviar a quien ya lo tenía.
--
-- No se siembra: al primer arranque la tabla está vacía, así que los destinatarios
-- actuales quedan pendientes y reciben el archivo una vez. Es un único reenvío inocuo
-- (el mismo archivo de pedidos) y confirma el nuevo mecanismo en vivo.
CREATE TABLE IF NOT EXISTS portal.wo_sales_email_sent (
  email   text PRIMARY KEY,
  hash    text,
  sent_at timestamptz NOT NULL DEFAULT now()
);
