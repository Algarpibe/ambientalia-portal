# Integración de salestracker en el Portal — Diseño

- **Fecha:** 2026-07-19
- **Estado:** Diseño aprobado, pendiente de plan de implementación
- **App origen:** `apps/salestracker` (Next.js 16, full-stack)
- **App destino:** nueva sub-app Vite React `apps/salestracker` (patrón del portal)

## Contexto

`salestracker` (paquete `salestracker-pro`) es un dashboard comercial para Ambientalia
S.A.S.: lee ventas (facturas, órdenes de venta, backlog) de la réplica `zoho-hub` y
muestra tablas, KPIs, gráficos, forecast y análisis de margen/rentabilidad.

Hoy es una app **full-stack Next.js 16** (App Router, React 19, Tailwind v4), con:
- BD Postgres propia + Drizzle ORM (separada de hub-api).
- Autenticación propia (better-auth, bcrypt, flujo de aprobación, roles admin/editor/lector).
- ~16 Server Actions como capa de datos.
- Deploy Docker standalone propio (puerto 3000).

El resto de apps del portal siguen un patrón **radicalmente distinto**: SPAs de Vita React
sin backend propio, montadas como componentes React perezosos dentro del bundle único del
portal, que leen el JWT compartido de `localStorage` y llaman a **hub-api** (Express) para
todos los datos. Nunca tocan una BD directamente.

### Decisiones tomadas (brainstorming)

1. **Enfoque:** reescritura completa a sub-app Vite (no iframe, no servicio aparte).
2. **Auth/roles:** acceso = el admin del portal asigna la app `salestracker` al usuario. Se
   **elimina** el auto-registro y el flujo de aprobación. La escritura se controla con el rol
   del portal (`admin`/`editor` pueden editar categorías y agrupaciones; el resto, solo lectura).
3. **Estado escribible:** las tablas de configuración/estado (categorías, agrupaciones,
   favoritos, vistas guardadas) migran a la **Postgres de usuarios de hub-api**. Las ventas en
   vivo siguen leyéndose de `zoho-hub` (solo lectura).

## Arquitectura objetivo

`salestracker` pasa a ser un workspace igual que `contabilidad`: SPA de Vite React que exporta
por defecto un `App`, montada de forma perezosa en el portal en `/salestracker/*` detrás de
`<AppGuard appId="salestracker">`. **Sin Next.js, sin Server Actions, sin BD propia, sin auth
propia.**

| Aspecto | Hoy (Next.js) | Después (patrón del portal) |
|---|---|---|
| Rutas | App Router, grupo `(dashboard)` | rutas de `react-router` dentro de la sub-app |
| Capa de datos | ~16 Server Actions (Drizzle) | `fetch` → endpoints `/api/salestracker/*` en hub-api, vía TanStack Query |
| Ventas en vivo | SQL de `hub-*.ts` sobre `zoho-hub` | el mismo SQL trasladado a un router de hub-api (`getHubPool()` al mismo `zoho-hub`) |
| Estado escribible | Postgres propia | nuevas tablas en la Postgres de usuarios de hub-api, con endpoints CRUD |
| Auth | better-auth + middleware + guards | JWT compartido del portal en `localStorage`; `requireAuth`+`requireApp('salestracker')` en servidor |

**Ventaja clave:** el SQL analítico pesado (backlog, margen, Pareto, estacionalidad, forecast)
es portable casi literal, porque tanto la app vieja como hub-api consultan el mismo esquema de
`zoho-hub`. La reescritura es sobre todo *transporte* (Server Action → REST) y *cascarón*
(App Router → react-router, better-auth → JWT), no volver a derivar la lógica de negocio.

## Componente A — Backend en hub-api (`createSalestrackerRouter`)

Sigue el patrón de `createContabilidadRouter`/`createWoSalesRouter`. Dos familias de endpoints
bajo `/api/salestracker`, todas detrás de `requireAuth` + `requireApp('salestracker')`.

### A.1 Lectura (desde `zoho-hub`, con `cached()` TTL 2 min)

Un endpoint por cada server action de datos actual. SQL copiado de los `hub-*.ts` existentes:

- `GET /api/salestracker/sales` — totales por categoría/tipo/período (INVOICE / SALES_ORDER / BACKLOG).
- `GET /api/salestracker/item-sales` — ventas por artículo/SKU.
- `GET /api/salestracker/customer-sales` — ventas por cliente.
- `GET /api/salestracker/customer-item` — matriz cliente × artículo.
- `GET /api/salestracker/margin` — margen/rentabilidad (por cliente, por artículo, scatter).
- `GET /api/salestracker/category-month` — serie categoría × mes.
- `GET /api/salestracker/customer-month` — serie cliente × mes.

### A.2 Escritura (Postgres de usuarios del portal, según rol)

Nuevas tablas + endpoints CRUD. Escritura requiere rol `admin`/`editor`; lectura solo requiere
la app asignada.

- `categories`, `category_groups`, `category_group_mappings` (CRUD) — impulsan los rollups de ventas.
- `favorites` (por usuario).
- `saved_views` (por usuario).

Migración nueva en `apps/hub-api/src/salestracker/*.sql`, copiada a `dist` como el resto de
migraciones (recordar el gotcha del `.sql` en `dist`).

> Nota de datos: hoy `sales_records` local + vistas (`v_monthly_totals`, `v_annual_by_category`)
> solo se usan como *fallback* cuando `HUB_DB_URL` no está. Con hub-api siempre apuntando a
> `zoho-hub`, ese fallback no se porta; se documenta como descartado.

## Componente B — Frontend (la sub-app Vite)

- Portar las páginas del grupo `(dashboard)` a rutas de react-router: **home, tablas, articulos,
  clientes, clientes/:customer, cliente-articulo, analytics, categories**.
- **Eliminar:** pestaña de seguridad de `/settings`, `/admin/users`, y páginas de auth
  (`login` / `register` / `waiting-approval`) — de todo eso se encarga el portal.
- **Conservar tal cual:** recharts, TanStack Table/Query, paleta cmdk, sonner, export con
  exceljs, y toda la lógica pura de `src/lib/*` (analytics/forecast/compare) con su suite de
  Vitest — son funciones puras, se mueven sin tocar.
- **Cliente de API:** replica `contabilidad/src/api.ts` — base `VITE_HUB_API_URL`,
  `Authorization: Bearer <ambientalia_token>` desde `localStorage`.

### B.1 Alineación de estilos (la parte no-datos más delicada)

salestracker usa **Tailwind v4** (`@tailwindcss/postcss`); el portal compila las sub-apps con
su propio Tailwind (config estilo v3 + content globs). La sub-app debe **adoptar el Tailwind y
los estilos compartidos del portal**, y su content glob se agrega en
`apps/portal/tailwind.config.js`. Los componentes base-ui/shadcn pueden requerir arreglos de
clases bajo el Tailwind del portal.

## Componente C — Registro en el portal (checklist estándar)

Ver `docs/dev/asignacion-de-apps-y-visibilidad.md` y `docs/dev/conectar-una-app-a-zoho-hub.md`.

1. `apps/portal/src/lib/apps.ts` — entrada en `APPS` con `id: 'salestracker'`.
2. `apps/portal/src/App.tsx` — import lazy + `<Route path="/salestracker/*">` envuelto en `<AppGuard appId="salestracker">`.
3. `apps/portal/src/pages/Aplicaciones.tsx` — agregar la tarjeta (lista hardcodeada aparte, fácil de olvidar).
4. `Dockerfile` raíz — `COPY apps/salestracker/package*.json ./apps/salestracker/`.
5. `apps/portal/tailwind.config.js` — agregar `"../salestracker/src/**/*.{js,ts,jsx,tsx}"` a `content`.
6. Backend: proteger endpoints con `requireApp('salestracker')`.
7. Asignar la app a usuarios en Admin → Usuarios. **Redeploy de hub-api** (los endpoints nuevos
   no salen con un deploy solo del portal). Los usuarios ya logueados deben salir y entrar para
   ver la app (el claim `apps[]` se hornea en el JWT al login).

## Gotcha crítico — repo git anidado

`apps/salestracker` **contiene su propio `.git`** (es un repo independiente); el monorepo lo ve
como `?? apps/salestracker/` sin trackear su contenido. La nueva sub-app Vite **no puede** vivir
con ese `.git` anidado dentro del monorepo.

**Plan:** extraer/mover la app Next actual a una ruta de referencia fuera del árbol trackeable
(p. ej. `reference/salestracker-next/`, o un backup fuera del repo) — o eliminar el `.git`
anidado tras respaldar — y construir la sub-app Vite limpia en `apps/salestracker`, ya trackeada
por el monorepo. Confirmar el estado del repo anidado antes de mover nada.

## Orden de entrega (por fases, no big-bang)

La app Next vieja se mantiene como **oráculo de paridad** hasta alcanzar equivalencia.

1. **Cascarón + columna de datos** — esqueleto del router de hub-api + endpoint `sales`;
   cascarón de la sub-app, ruteo, cliente de API, cableado del JWT, registro en el portal.
   Objetivo: un gráfico real de punta a punta dentro del portal.
2. **Páginas core** — home (dashboard KPIs), tablas, articulos, clientes (+ drill-down
   `clientes/:customer`), cliente-articulo. Portar cada server action → endpoint según lo
   necesite su página.
3. **Analítica pesada** — analytics / margen / forecast (el SQL más denso + lógica de `lib`).
4. **Config y estado** — gestión de categorías/agrupaciones + endpoints de escritura de
   favoritos/vistas guardadas.
5. **Cutover** — chequeo de paridad contra la app Next; luego retirar la BD de salestracker,
   better-auth y (cuando se decida) su servicio de EasyPanel.

## Riesgos / puntos a vigilar

- **Superficie grande** (~9 páginas, ~16 rutas de datos). Mitigación: faseo + app Next viva como oráculo.
- **Tailwind v4 → v3** y componentes base-ui/shadcn pueden necesitar arreglos de clases.
- **Repo git anidado** en `apps/salestracker` (ver arriba) — resolver antes de crear la sub-app.
- **Contabilizar cada server action** para no dejar ninguna ruta de datos fuera del port.
- **Sin secretos en el bundle:** las credenciales de BD quedan en hub-api; nada sensible viaja
  al navegador. Verificar que ninguna lógica server-only se filtre al frontend.

## Criterios de éxito

- La app aparece como tarjeta/ruta en el portal y se abre con el JWT compartido, sin segundo login.
- Todas las páginas migradas muestran los mismos datos que la app Next (paridad verificada).
- Las categorías/agrupaciones, favoritos y vistas guardadas persisten vía hub-api.
- El rol del portal controla lectura vs. escritura.
- La suite de Vitest de `src/lib/*` pasa en la nueva sub-app.
- Un solo build/deploy: la sub-app viaja en el bundle del portal; hub-api expone los endpoints nuevos.
