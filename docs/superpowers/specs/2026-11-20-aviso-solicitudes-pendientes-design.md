# Portal — aviso de solicitudes de acceso pendientes

**Fecha:** 2026-11-20
**Estado:** implementado en la rama `feat/aviso-pendientes` (plan
`docs/superpowers/plans/2026-11-20-aviso-solicitudes-pendientes.md`); pendiente de fusionar y
desplegar (hub-api primero).
**Depende de:** la gestión de usuarios (`apps/hub-api/src/users/users.router.ts`,
`users.service.ts`, `users.repository.ts`), el menú lateral (`apps/portal/src/components/Sidebar.tsx`)
y el panel de usuarios (`apps/portal/src/pages/admin/AdminUsers.tsx`).

## 1. Objetivo

Que un administrador vea, desde cualquier pantalla del portal, que hay solicitudes de acceso
esperando su aprobación.

Hoy el registro deja la cuenta en `pending` y no avisa a nadie: el admin solo se entera si entra en
«Usuarios» y se fija en la columna Estado.

## 2. Decisiones (cerradas en brainstorming)

- **Dónde:** un contador en el enlace «Usuarios» del menú lateral. Sin aviso en la página de inicio
  ni correo a los admins.
- **Cuándo se actualiza:** al abrir el portal, al volver a la pestaña, después de aprobar o eliminar
  en el panel, y cada 5 minutos mientras la pestaña está visible.
- **De dónde sale el número:** una ruta nueva y dedicada (opción 1). Se descartaron contar sobre la
  lista paginada (baja 50 filas para un número y no ve los pendientes de la página 2) y añadirlo a
  `/api/users/me` (la llaman todos los usuarios, no solo los admins).

## 3. hub-api

| Pieza | Cambio |
|---|---|
| `users.repository.ts` | `countPending(): Promise<number>` → `SELECT count(*)::int AS total FROM portal.users WHERE status = 'pending'` |
| `users.service.ts` | `countPending()` delega en el repositorio |
| `users.router.ts` | `GET /api/users/pending-count` con `requireAdmin` → `200 { pending: n }` |

- Sin sesión → 401; con sesión de lector → 403 (lo que ya hace `requireAdmin`).
- La clave de la respuesta va en inglés (`pending`), como el resto de la API de usuarios (`users`,
  `total`, `registration_pending`).
- La ruta pasa por el limitador de `/users/*` (20 peticiones por minuto por IP). No hay
  `GET /api/users/:id`, así que `pending-count` no choca con ninguna ruta existente.
- Sin migración ni índice: la tabla tiene una docena de filas.
- No se audita: es una lectura.

## 4. Portal

### 4.1 Hook `usePendingUsersCount(enabled: boolean): number`

Archivo nuevo `apps/portal/src/hooks/usePendingUsersCount.ts`, siguiendo el patrón de
`useProfile.ts`:

- Exporta `PENDING_USERS_CHANGED = 'pending-users-changed'` y `notifyPendingUsersChanged()`, que
  lanza ese evento en `window` (igual que `PROFILE_UPDATED` / `notifyProfileUpdated`).
- Con `enabled === false` no hace ninguna petición y devuelve 0.
- Con `enabled === true` llama a `GET /api/users/pending-count` con `authFetch`:
  1. al montarse;
  2. cada 5 minutos, solo si `document.visibilityState === 'visible'`;
  3. en `visibilitychange` cuando la pestaña vuelve a estar visible, salvo que la última consulta
     tenga menos de 30 segundos (para que cambiar de pestaña a menudo no gaste el límite de 20
     peticiones por minuto que comparten las acciones del panel);
  4. al recibir `PENDING_USERS_CHANGED`, siempre.
- Una respuesta que no es 200, un cuerpo sin `pending` numérico o un fallo de red se ignoran en
  silencio: el hook conserva el último valor bueno (0 al empezar). Un 429 pasajero no hace parpadear
  el contador. No limpia el token ni redirige: eso sigue siendo cosa de quien hace las acciones.
- Al desmontarse quita el intervalo y los dos listeners.

### 4.2 `Sidebar.tsx`

- `const pendientes = usePendingUsersCount(role === 'admin')`. El hook vive en `Sidebar`, que se
  monta una sola vez (el panel móvil reutiliza el mismo componente), así que hay un único sondeo.
- Con `pendientes > 0`:
  - **Menú desplegado:** un globo rojo a la derecha de «Usuarios» con el número; con más de 9
    muestra `9+`.
  - **Menú plegado:** un punto rojo en la esquina superior derecha del icono.
  - El enlace lleva `aria-label` «Usuarios, 1 solicitud pendiente» / «Usuarios, N solicitudes
    pendientes»; con el menú plegado, el `title` dice lo mismo. El globo y el punto llevan
    `aria-hidden`.
- Con `pendientes === 0` el enlace queda exactamente como hoy.

### 4.3 `AdminUsers.tsx`

- `handleApprove` y `handleDelete` llaman a `notifyPendingUsersChanged()` cuando la petición termina
  bien. Son las dos únicas acciones del panel que pueden cambiar el número de pendientes
  (desactivar y reactivar mueven entre `active` e `inactive`; el rol y las apps no tocan el estado).
- `act` gana un parámetro opcional `onOk` que se ejecuta tras el éxito, para no duplicar su manejo
  de errores. Cada aprobación o borrado cuesta una petición más (la del contador); con 20 por minuto
  sigue habiendo margen para el uso real del panel.

## 5. Tests

- **hub-api** (`users.integration.test.ts`, supertest con el pool falso, sin Docker):
  `GET /api/users/pending-count` → 401 sin token, 403 con lector, 200 con admin y un `pending` que
  cuenta solo las cuentas `pending` (no las `active` ni las `inactive`).
- **Hook** (`usePendingUsersCount.test.ts`, temporizadores falsos): no llama con `enabled` falso;
  llama al montar; vuelve a llamar a los 5 minutos con la pestaña visible y no con la oculta;
  `visibilitychange` respeta los 30 segundos; el evento fuerza la consulta; un error conserva el
  último valor; al desmontar no quedan llamadas.
- **Menú** (`Sidebar.test.tsx`, con el hook simulado): globo con el número para un admin; `9+`
  por encima de 9; punto en plegado; sin globo con 0; un lector no lo ve y el hook recibe `false`.
- **Panel** (`AdminUsers.test.tsx`): aprobar y eliminar con éxito lanzan `PENDING_USERS_CHANGED`;
  un fallo no lo lanza; desactivar no lo lanza.

## 6. Despliegue

hub-api primero, luego el portal (orden por defecto). Si el portal saliera antes, la ruta daría 404,
el hook lo ignoraría y el globo no aparecería: no rompe nada.

## 7. Fuera de alcance

- Filtrar, ordenar o destacar los pendientes dentro de la tabla de usuarios.
- Avisar en la página de inicio o por correo a los admins.
- Un punto en el botón de menú móvil de la barra superior: en el móvil el globo se ve al abrir el
  menú.
