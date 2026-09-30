-- Migration 041: retirar la herramienta "Ventas por Articulos" del portal.
-- Se van su workspace (apps/product-sales) y sus puntos de registro en el
-- portal. Era una herramienta 100 % de frontend (procesaba ficheros subidos por
-- el usuario), sin tablas ni endpoint en hub-api: aqui solo quedan por limpiar
-- las asignaciones a usuarios, que de otro modo seguirian concediendo acceso a
-- una app inexistente.
--
-- Idempotente: en una base sin esas filas el DELETE es no-op. Importa, porque
-- hub-api no lleva tabla de tracking y db.ts re-ejecuta todas las migraciones
-- en cada arranque.

-- app_id es texto libre, sin enum ni FK contra un catalogo.
DELETE FROM portal.user_apps WHERE app_id = 'product-sales';
