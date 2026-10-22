# DATA-332 — Separar el rol de migración del de las peticiones

Hasta ahora, un solo rol (el de `HUB_DB_URL`) hacía dos cosas: aplicaba el DDL
de todas las migraciones en cada arranque y atendía todas las peticiones. Si
algún día apareciera una inyección SQL, el atacante tendría `DROP TABLE`.

Con la separación activada, cada rol hace una sola cosa:

| Variable | Rol | Qué puede hacer | Cuándo se usa |
|---|---|---|---|
| `HUB_MIGRATION_DB_URL` | El de siempre, dueño de `portal` | DDL en `portal` | Solo al arrancar: migraciones y seed |
| `HUB_DB_URL` | `portal_app` (nuevo) | Leer y escribir filas en `portal`; leer `books`, `crm` y `desk` | Todas las peticiones |

`portal_app` no puede crear, alterar, borrar ni vaciar tablas. Lo prueba
`apps/hub-api/src/db.roles.db.test.ts` contra un Postgres real, con un rol de
migración que no es superusuario, igual que en producción.

## Qué hace el código y qué hay que hacer a mano

- **El código (ya desplegado):** si existe `HUB_MIGRATION_DB_URL`, las
  migraciones la usan; si no, todo sigue como antes. La migración 068 da a
  `portal_app` sus permisos sobre `portal` en cada arranque, así que las tablas
  de migraciones futuras le llegan solas. Mientras `portal_app` no exista, la
  068 no hace nada.
- **A mano, una sola vez (pasos 1 a 3):** crear `portal_app`, porque hace falta
  `CREATEROLE`, y darle lectura sobre la réplica de Zoho. Esas tablas son del
  worker de zoho-sync, así que solo su dueño o un superusuario puede dar
  permisos sobre ellas.

Conviene hacerlo **en la misma ventana que la rotación de secretos**: allí ya
se cambian `HUB_DB_URL` y las contraseñas.

## Paso 1 — Comprobar quién es dueño de qué (solo lectura)

Ejecuta esto conectado como administrador:

```sql
\c zoho-hub
-- Dueño de las tablas de portal: debe salir UNA sola fila, la del rol de
-- HUB_DB_URL de hoy. Ese rol pasa a ser el de migración.
SELECT tableowner, count(*) FROM pg_tables WHERE schemaname = 'portal' GROUP BY 1;
-- Lo mismo para las secuencias de portal.
SELECT pg_get_userbyid(c.relowner) AS dueno, count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'portal' AND c.relkind = 'S' GROUP BY 1;
-- Dueño de la réplica: lo necesitas en el paso 2.
SELECT schemaname, tableowner, count(*) FROM pg_tables
 WHERE schemaname IN ('books', 'crm', 'desk') GROUP BY 1, 2 ORDER BY 1;
-- Que portal_app no exista ya.
SELECT rolname FROM pg_roles WHERE rolname = 'portal_app';
```

**Para aquí si:**

- Las tablas o secuencias de `portal` tienen **más de un dueño**. El rol de
  migración no podría dar permisos sobre las que no son suyas (Postgres no da
  error, solo un aviso), y `portal_app` fallaría en esas tablas.
- El dueño de `portal` **no** es el rol de `HUB_DB_URL` de hoy.

## Paso 2 — Crear `portal_app` y darle la réplica

Sustituye `<dueno_replica>` por el dueño que salió en el paso 1. Si hay varios,
repite la línea de `ALTER DEFAULT PRIVILEGES` una vez por cada uno.

```sql
\c zoho-hub
CREATE ROLE portal_app LOGIN;
-- Pide la contraseña sin que quede escrita en el historial de psql.
\password portal_app
GRANT CONNECT ON DATABASE "zoho-hub" TO portal_app;

-- La réplica de Zoho, solo lectura.
GRANT USAGE ON SCHEMA books, crm, desk TO portal_app;
GRANT SELECT ON ALL TABLES IN SCHEMA books, crm, desk TO portal_app;
-- Para las tablas que el worker cree más adelante.
ALTER DEFAULT PRIVILEGES FOR ROLE <dueno_replica> IN SCHEMA books, crm, desk
  GRANT SELECT ON TABLES TO portal_app;
```

`portal` no hace falta: lo da la migración 068 en el siguiente arranque.

## Paso 3 — Activarlo en EasyPanel (servicio hub-api, «Entorno»)

1. Crea `HUB_MIGRATION_DB_URL` con **el valor actual de `HUB_DB_URL`**, el del
   rol dueño de `portal`.
2. Cambia `HUB_DB_URL` para que apunte a `portal_app`, con la contraseña del
   paso 2. El host, el puerto y la base no cambian.
3. Despliega. En el log del arranque tiene que salir
   `Migraciones con su propio rol (HUB_MIGRATION_DB_URL).`
4. Comprueba `https://api.ambientalia.cloud/health`. Después entra en el portal
   y abre una app de cada tipo: ausencias (escribe en `portal`) e inventario o
   conciliación (leen la réplica).

## Paso 4 — Comprobar los permisos (solo lectura)

```sql
\c zoho-hub
-- Tablas que portal_app NO puede leer. Debe salir 0.
SELECT count(*) FROM pg_tables
 WHERE schemaname IN ('portal', 'books', 'crm', 'desk')
   AND NOT has_table_privilege('portal_app', format('%I.%I', schemaname, tablename), 'SELECT');
-- Escribe en portal, pero no puede vaciar ni escribir en la réplica.
-- Esperado: t, f, f.
SELECT has_table_privilege('portal_app', 'portal.users', 'INSERT')    AS escribe_portal,
       has_table_privilege('portal_app', 'portal.users', 'TRUNCATE')  AS vacia_portal,
       has_table_privilege('portal_app', 'books.invoices', 'INSERT')  AS escribe_replica;
```

## Marcha atrás

En EasyPanel, devuelve a `HUB_DB_URL` el valor que ahora tiene
`HUB_MIGRATION_DB_URL`, borra `HUB_MIGRATION_DB_URL` y despliega. Todo vuelve a
funcionar como antes del paso 3. El rol `portal_app` puede quedarse: sin
conexiones que lo usen, no hace nada.
