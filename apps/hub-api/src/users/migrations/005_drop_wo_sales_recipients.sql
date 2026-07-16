-- Los destinatarios del correo dejaron de ser una lista propia: ahora son los usuarios
-- del portal con la app WO-sales asignada (portal.users + portal.user_apps). La tabla
-- wo_sales_recipients queda sin uso y se elimina. wo_sales_email_estado se mantiene:
-- sigue guardando el hash del último envío confirmado.
DROP TABLE IF EXISTS portal.wo_sales_recipients;
