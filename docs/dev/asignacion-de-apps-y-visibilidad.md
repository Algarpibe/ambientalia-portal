# Asignación de apps y visibilidad en el portal

Documenta dos comportamientos que sorprenden al asignar/registrar aplicaciones en el
portal. Ninguno es un bug: son consecuencias del diseño actual (JWT + listas del
frontend). Se dejan documentados en vez de "arreglados" por decisión de producto.

## 1. Una app recién asignada NO aparece hasta que el usuario vuelve a entrar

**Síntoma:** un admin marca una app para un usuario en *Admin → Usuarios → Asignar apps*
y guarda, pero al usuario (con sesión abierta) la app le sigue sin aparecer en el
sidebar ni en `/aplicaciones`.

**Causa raíz:** la lista de apps del usuario viaja **dentro del JWT**, y el token solo
se emite en el login.

- Al asignar se escribe la tabla `portal.user_apps` (BD). ✔ eso queda guardado.
- Pero el portal **no lee las apps de la BD**: las decodifica del campo `apps[]` del
  JWT guardado en `localStorage` (`apps/portal/src/hooks/useAuth.ts` →
  `readAuthState()` / `sanitizeApps(payload.apps)`).
- El JWT **solo se genera en `/api/login`** (`apps/hub-api/src/auth.ts`, única llamada
  a `issueTokenForUser`). No hay endpoint de refresh/`me`.
- `useAuth` nunca vuelve a pedir un token nuevo al servidor; solo re-decodifica el que
  ya hay. El TTL del token es **30 días** (`JWT_TTL`, por defecto `'30d'`).

Por tanto el `apps[]` del token queda "congelado" desde el último login. Todo lo que
filtra por apps asignadas (sidebar, `/aplicaciones`, guards de ruta, widgets del
dashboard) usa ese valor viejo.

**Workaround (comportamiento esperado hoy):** el usuario debe **cerrar sesión y volver
a entrar**. El nuevo login emite un token fresco que lee el `user_apps` actualizado.

**Arreglo de raíz (no implementado, decisión de dejarlo documentado):** añadir un
endpoint `GET /api/auth/refresh` (`requireAuth`) que relea el usuario + su `user_apps`
y devuelva un token nuevo con `issueTokenForUser`, y que el portal lo llame al cargar
(guardando el token con `setToken`). Así las apps recién asignadas aparecerían en el
siguiente refresco de página sin necesidad de re-login.

## 2. Una app recién *registrada* también necesita su tarjeta en `/aplicaciones`

**Síntoma:** una app nueva funciona por su ruta y se puede asignar, pero no aparece
como tarjeta en el panel `/aplicaciones`.

**Causa:** el grid de `/aplicaciones` (`apps/portal/src/pages/Aplicaciones.tsx`) NO se
arma desde el catálogo `apps/portal/src/lib/apps.ts`, sino desde una **lista
hardcodeada** (`aplicaciones: AppConfig[]`) con icono, color y descripción por app.
El catálogo `apps.ts` alimenta el sidebar, el guard y el modal de asignación, pero NO
esa página.

## Checklist: registrar una app nueva para que se vea en TODAS partes

1. `apps/portal/src/lib/apps.ts` → entrada en `APPS` (`id` = carpeta del monorepo =
   string de `requireApp`).
2. `apps/portal/src/App.tsx` → import lazy + `<Route>` con `<AppGuard appId="...">`.
3. `apps/portal/src/pages/Aplicaciones.tsx` → objeto en `aplicaciones[]` (icono +
   descripción + color + path). **← el que se suele olvidar.**
4. `Dockerfile` → `COPY apps/<app>/package*.json ./apps/<app>/`.
4b. `apps/portal/tailwind.config.js` → añadir `"../<app>/src/**/*.{js,ts,jsx,tsx}"` al `content`. **← el otro que se olvida.** Sin esto, las clases que SOLO usa esa app se purgan: la app parece estilada (por solape con otras sub-apps) pero las clases únicas salen invisibles (p. ej. colores/tamaños concretos). Costó un rato con las "luces" de OV pendientes.
5. Backend: guard `requireApp('<id>')` en los endpoints de datos de la app.
6. Asignar la app a los usuarios en *Admin → Usuarios* (escribe `user_apps` → JWT).
7. Los usuarios ya logueados: **cerrar sesión y volver a entrar** (ver punto 1).
