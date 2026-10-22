-- Migration 066: índices sobre lower(correo) para las búsquedas por correo (DATA-343).
--
-- El código compara los correos SIEMPRE en minúsculas —`lower(correo) =
-- lower($1)`, unas treinta consultas en ausencias/repo.ts—, y los índices que
-- había (015, 018, 024 y el de users de la 001) son de la columna tal cual. Un
-- índice sobre `correo` no sirve para buscar por `lower(correo)`: las consultas
-- sobre `empleados` y `users` recorrían la tabla entera.
--
-- Las de solicitudes y propuestas PENDIENTES no: ahí los índices parciales de
-- 015, 018 y 024 (`WHERE estado = 'pendiente'`, `'pendiente_2'`) ya dejan la
-- búsqueda en lo pendiente, que por naturaleza son pocas filas, y comparar el
-- correo sobre ese puñado no cuesta nada. Se probó a añadirles su versión
-- lower(): el planificador seguía eligiendo el parcial de siempre, así que solo
-- habría sumado coste a cada escritura. Por eso no están aquí.
--
-- Índices de expresión y NO normalizar los datos a minúsculas: eso sería un
-- UPDATE en una migración que se re-ejecuta en cada arranque y que tocaría datos
-- de producción; un índice no cambia ni un valor. Los índices de la columna tal
-- cual se quedan: `users.email` lo usa el login (`WHERE email = $1`), y el de
-- `empleados.aprobador_correo` lo volvería a crear la 015 en cada arranque.
--
-- Solo DDL e idempotente: initDb() la re-ejecuta en cada arranque, y si falla
-- hub-api no arranca. CREATE INDEX normal y no CONCURRENTLY: la migración va en
-- una sola sentencia múltiple, que es una transacción implícita, y CONCURRENTLY
-- no puede ir dentro de una. Bloquea las escrituras de cada tabla lo que tarde en
-- construirse su índice, que con estos tamaños es nada.

CREATE INDEX IF NOT EXISTS idx_empleados_correo_lower
  ON portal.empleados (lower(correo));

CREATE INDEX IF NOT EXISTS idx_empleados_aprobador_lower
  ON portal.empleados (lower(aprobador_correo));

CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON portal.users (lower(email));
