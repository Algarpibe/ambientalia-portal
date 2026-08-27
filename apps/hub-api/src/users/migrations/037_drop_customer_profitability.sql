-- Migration 037: retirar la sub-app "Rentabilidad de Clientes" del portal.
-- Esa informacion ya se obtiene por otras vias dentro del portal, asi que la
-- app deja de existir: se van su workspace, su endpoint /api/profitability/data
-- y sus cinco puntos de registro en el portal.
--
-- A diferencia de la 014 (salestracker), esta app NO tenia tablas propias: leia
-- books.items y books.invoice_line_items, que son de la replica de Zoho y las
-- siguen usando Contabilidad, WO-sales y las demas. Aqui no se dropea nada de
-- esquema; solo quedan por limpiar las asignaciones a usuarios, que de otro
-- modo seguirian concediendo acceso a una app inexistente.
--
-- Idempotente: en una base sin esas filas el DELETE es no-op. Importa, porque
-- hub-api no lleva tabla de tracking y db.ts re-ejecuta todas las migraciones
-- en cada arranque.

-- app_id es texto libre, sin enum ni FK contra un catalogo.
DELETE FROM portal.user_apps WHERE app_id = 'customer-profitability';
