# Implementation Plan: User Management

## Overview

Implementación incremental del sistema de gestión de usuarios para Antigravity Suite. El orden sigue la cadena de dependencias natural: primero la base de datos, luego el backend (Hub_API), y finalmente el frontend (Portal). Cada tarea produce código integrable en el paso siguiente, sin código huérfano.

El lenguaje de implementación es **TypeScript** para ambas capas (hub-api y portal).

---

## Tasks

- [ ] 1. Crear esquema de base de datos y script de migración
  - [x] 1.1 Crear script SQL de migración con tablas `users` y `user_apps`
    - Crear `apps/hub-api/src/users/migrations/001_create_users.sql` con la definición exacta de las tablas, índices y constraints según el diseño
    - No incluir `CREATE SCHEMA`; las tablas se crean en el esquema `public` (el pool de `db.ts` no configura `search_path`)
    - La tabla `users` debe tener: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `full_name VARCHAR(255) NOT NULL`, `email VARCHAR(254) NOT NULL`, `password_hash TEXT NOT NULL`, `role VARCHAR(10) NOT NULL DEFAULT 'reader' CHECK (role IN ('admin','reader'))`, `status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','inactive'))`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `CONSTRAINT users_email_unique UNIQUE (email)`
    - Índices: `CREATE INDEX idx_users_status ON users(status)`, `CREATE INDEX idx_users_email ON users(email)`, `CREATE INDEX idx_users_created ON users(created_at DESC)`
    - La tabla `user_apps` debe tener: `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `app_id VARCHAR(80) NOT NULL`, `PRIMARY KEY (user_id, app_id)`, índice `CREATE INDEX idx_user_apps_app_id ON user_apps(app_id)`
    - _Requirements: 6.1, 4.1_

  - [x] 1.2 Crear script de seed/migración desde `AUTH_USERS`
    - Crear `apps/hub-api/src/users/seed-from-env.ts` que parsea `AUTH_USERS`, inserta usuarios con `role='admin'` el primero y `role='reader'` el resto, `status='active'`, `ON CONFLICT DO NOTHING`
    - El script debe ser seguro para ejecutar múltiples veces (idempotente)
    - _Requirements: 6.1, 6.2_

  - [x] 1.3 Integrar ejecución del script SQL en el arranque de `db.ts`
    - Modificar `apps/hub-api/src/db.ts` para que al inicializar el pool ejecute las migraciones pendientes
    - Verificar que `HUB_DB_URL` está definido; si no, terminar el proceso con mensaje de error en ≤ 5 segundos
    - Si la base de datos no es alcanzable, terminar con mensaje de error
    - _Requirements: 6.3, 6.5_

- [ ] 2. Definir tipos e interfaces TypeScript del módulo de usuarios
  - [x] 2.1 Crear `users/users.types.ts` con todas las interfaces del diseño
    - Definir: `UserStatus`, `UserRole`, `UserRow`, `UserPublic`, `RegisterInput`, `PaginatedUsers`, `JwtPayload`, `AuditEntry`
    - Asegurar que `JwtPayload` extiende la forma actual del token con los campos nuevos: `user_id`, `role`, `apps`
    - _Requirements: 1.1, 3.3, 4.3, 6.1_

- [ ] 3. Implementar `UserRepository` (capa de acceso a datos)
  - [x] 3.1 Crear `users/users.repository.ts` con todas las queries SQL
    - Métodos: `findByEmail(email)`, `findById(id)`, `create(input, hash)`, `updateStatus(id, status)`, `updateRole(id, role)`, `delete(id)`, `setApps(id, appIds)`, `getApps(id)`, `listPaginated(page, perPage)`
    - Todas las queries deben usar parámetros posicionales `$1, $2…` (prevenir SQL injection)
    - Las operaciones que afectan múltiples tablas deben ejecutarse dentro de una transacción con rollback en caso de fallo
    - `delete(id)` borra en `user_apps` y `users` dentro de una transacción (CASCADE garantiza limpieza, pero la transacción protege atomicidad)
    - _Requirements: 6.1, 6.4, 6.6_

  - [x]* 3.2 Escribir test de propiedad para atomicidad de transacciones
    - **Property 12: Atomicidad de escrituras multi-tabla**
    - **Validates: Requirements 6.4, 6.6**
    - Verificar que si un paso de la transacción falla (mock de error en segundo step), la base de datos retorna al estado anterior sin registros parciales

  - [x]* 3.3 Escribir test de propiedad para eliminación permanente y total
    - **Property 7: Eliminación es permanente y total**
    - **Validates: Requirements 2.6**
    - Para cualquier usuario existente, tras `delete(id)`, `findById(id)` retorna `null` y `user_apps` no contiene registros con ese `user_id`

- [ ] 4. Implementar `UserService` (lógica de negocio)
  - [x] 4.1 Crear `users/users.service.ts` con métodos de negocio
    - Métodos: `register(input)`, `approve(id)`, `deactivate(id)`, `reactivate(id)`, `changeRole(id, role)`, `delete(id, requesterId)`, `setApps(id, appIds)`, `listUsers(page)`, `changePassword(id, currentPwd, newPwd)`
    - `register`: validar `full_name` (1–100 chars no solo espacios), `email` RFC 5321, `password` (≥ 8 chars), hashear con bcrypt coste ≥ 12, llamar a `UserRepository.create`
    - `approve`: setear `status='active'`, `role='reader'` (rol por defecto)
    - Auto-protección: `delete` y `deactivate` deben lanzar error si `id === requesterId`
    - _Requirements: 1.2, 1.3, 2.2, 2.3, 2.5, 2.6, 2.7, 3.1, 3.2_

  - [x]* 4.2 Escribir test de propiedad: registro siempre crea usuario pendiente
    - **Property 1: Registro crea usuario en estado pendiente**
    - **Validates: Requirements 1.2, 3.1**
    - Para cualquier combinación válida de `full_name` (1–100 chars), `email` RFC 5321 y `password` (≥ 8 chars), `UserService.register()` debe retornar `status='pending'` y `role='reader'`

  - [x]* 4.3 Escribir test de propiedad: contraseña nunca en texto plano
    - **Property 2: Contraseña nunca almacenada en texto plano**
    - **Validates: Requirements 1.3**
    - Para cualquier contraseña no vacía, el hash resultante no es igual a la contraseña, supera `bcrypt.compare`, y tiene factor de coste ≥ 12

  - [x]* 4.4 Escribir test de propiedad: correo duplicado retorna 409
    - **Property 3: Registro con correo duplicado retorna 409**
    - **Validates: Requirements 1.4**
    - Para cualquier correo ya registrado, un segundo `register` lanza error mapeado a HTTP 409 sin crear un segundo registro

  - [x]* 4.5 Escribir test de propiedad: validación rechaza inputs inválidos
    - **Property 4: Validación de entrada rechaza inputs inválidos**
    - **Validates: Requirements 1.5, 1.6, 1.7**
    - Para cualquier combinación con al menos un campo inválido (correo sin RFC 5321, password < 8 chars, nombre vacío o > 100 chars), `register` lanza error de validación sin crear usuario

  - [x]* 4.6 Escribir test de propiedad: transiciones de estado correctas
    - **Property 5: Aprobación y desactivación producen transiciones de estado correctas**
    - **Validates: Requirements 2.2, 2.3, 2.5, 3.1**
    - pending → `approve` → active con role='reader'; active → `deactivate` → inactive; inactive → `reactivate` → active

  - [x]* 4.7 Escribir test de propiedad: auto-protección del administrador
    - **Property 8: Auto-protección del administrador**
    - **Validates: Requirements 2.7**
    - Para cualquier admin, `delete(id, id)` y `deactivate(id)` donde `requesterId === id` lanzan error mapeado a HTTP 403 sin modificar el estado en BD

  - [x]* 4.8 Escribir test de propiedad: asignación de apps persiste correctamente
    - **Property 10: Asignación de apps persiste correctamente**
    - **Validates: Requirements 4.1, 4.2**
    - Para cualquier usuario activo y cualquier subconjunto válido de app IDs, tras `setApps(id, appIds)`, `getApps(id)` retorna exactamente ese subconjunto

- [x] 5. Checkpoint — Verificar lógica de negocio antes de exponer endpoints
  - Asegurar que todos los tests de `users.service.test.ts` y `users.properties.test.ts` pasan. Consultar al usuario si hay dudas sobre el comportamiento esperado.

- [ ] 6. Implementar `AuditLogger`
  - [x] 6.1 Crear `users/audit.logger.ts` con el método `log(entry: AuditEntry)`
    - La entrada debe contener: `timestamp` (ISO 8601 UTC via `new Date().toISOString()`), `admin_email`, `operation`, `affected_email`
    - Escribir al log del servidor (stdout/console) en formato estructurado JSON
    - _Requirements: 5.5_

  - [x]* 6.2 Escribir test de propiedad: log de auditoría contiene los cuatro campos
    - **Property 13: Log de auditoría contiene los cuatro campos requeridos**
    - **Validates: Requirements 5.5**
    - Para cualquier operación administrativa, la entrada producida por `AuditLogger.log()` contiene `timestamp` ISO 8601 UTC, `admin_email`, `operation` (no vacío), y `affected_email`

- [ ] 7. Implementar middlewares de autorización
  - [x] 7.1 Extender `requireAuth` en `apps/hub-api/src/auth.ts`
    - Después de verificar la firma del JWT, consultar `UserRepository.findById(user_id)` para verificar `status === 'active'`
    - Si `status` es `'inactive'` o `'pending'`, responder HTTP 401
    - Si el JWT es inválido o está ausente, responder HTTP 401
    - _Requirements: 2.4, 2.8, 6.2_

  - [x] 7.2 Crear middleware `requireAdmin` en `apps/hub-api/src/users/users.router.ts`
    - Reutiliza `requireAuth` (encadenado), luego verifica `req.user.role === 'admin'`
    - Si no es admin, responder HTTP 403
    - _Requirements: 2.9, 2.10, 5.1_

  - [x] 7.3 Crear middleware `requireOwnerOrAdmin`
    - Verificar que `req.user.user_id === req.params.id` OR `req.user.role === 'admin'`
    - Si ninguna condición se cumple, responder HTTP 403
    - _Requirements: 3.5, 3.6_

  - [x]* 7.4 Escribir test de propiedad: JWT de usuario inactivo es rechazado
    - **Property 6: JWT de usuario inactivo es rechazado**
    - **Validates: Requirements 2.4, 2.8**
    - Para cualquier usuario con `status !== 'active'`, `requireAuth` devuelve HTTP 401 incluso con JWT criptográficamente válido y no expirado

  - [x]* 7.5 Escribir test de propiedad: autorización lector respeta límite propio/ajeno
    - **Property 11: Autorización lector respeta límite propio/ajeno**
    - **Validates: Requirements 3.5, 3.6**
    - `requireOwnerOrAdmin` retorna 403 si `role='reader'` y `user_id !== :id`; permite el paso si `user_id === :id`

- [ ] 8. Implementar router de usuarios y endpoints REST
  - [x] 8.1 Crear `users/users.router.ts` con el router admin (`/api/users`)
    - `GET /api/users?page=N` → `requireAuth` + `requireAdmin` → `UserService.listUsers(page)` → respuesta paginada
    - `PATCH /api/users/:id/status` → aprobar / desactivar / reactivar según body `{ status }`
    - `PATCH /api/users/:id/role` → cambiar rol según body `{ role }`
    - `PUT /api/users/:id/apps` → asignar apps según body `{ apps: string[] }`
    - `DELETE /api/users/:id` → eliminar usuario (con auto-protección)
    - Llamar a `AuditLogger.log()` en cada operación de mutación
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.2, 4.2, 5.5_

  - [x] 8.2 Añadir endpoint `POST /api/auth/register` al router
    - Sin autenticación requerida
    - Llama a `UserService.register(input)` y responde HTTP 201 con `{ message: "Registration successful. Awaiting admin approval." }`
    - Mapear errores de validación → 400, duplicado → 409
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7_

  - [ ] 8.3 Añadir endpoint `PATCH /api/users/me/password` al self router
    - Proteger con `requireAuth` únicamente (no `requireOwnerOrAdmin`): la ruta usa `/me` sin `:id`, por lo que el target se extrae del `user_id` del JWT; `requireOwnerOrAdmin` dejaría `req.params.id` como `undefined` e impediría que un `reader` cambie su propia contraseña (403 falso positivo)
    - Obtener el usuario con `UserRepository.findById(req.user.user_id)`; si no existe (token legacy sin fila en BD), responder HTTP 404
    - Verificar contraseña actual con `bcrypt.compare` antes de actualizar; si no coincide, responder HTTP 403
    - _Requirements: 3.5, 3.6_

  - [x] 8.4 Extender `/api/login` en `auth.ts` para soportar el modelo de base de datos
    - Intentar primero `UserRepository.findByEmail(email)`; si no existe, usar fallback `AUTH_USERS`
    - Si `status !== 'active'`, responder HTTP 403 `{ error: "account not approved" }`
    - Si credenciales OK: consultar `user_apps`, construir JWT con `{ sub, user_id, role, apps }` y firma con `JWT_SECRET`
    - El JWT de fallback incluye `role: 'reader'`, `apps: []`
    - _Requirements: 2.8, 3.3, 4.3, 6.2_

  - [x]* 8.5 Escribir test de propiedad: JWT incluye role y apps correctos tras login
    - **Property 9: JWT incluye role y apps correctos tras login**
    - **Validates: Requirements 3.3, 4.3, 6.2**
    - Para cualquier usuario activo con apps asignadas, el JWT emitido contiene `sub=email`, `user_id`, `role` y `apps` exactamente igual al conjunto en `user_apps`

- [ ] 9. Configurar rate limiting en Hub_API
  - [x] 9.1 Añadir rate limiting a los endpoints de gestión de usuarios
    - Instalar y configurar `express-rate-limit` (si no está instalado) en `apps/hub-api`
    - `POST /api/auth/register` → 5 req/min por IP
    - `POST /api/login` → verificar que ya existe o añadir 10 req/min por IP
    - `/api/users/*` → 20 req/min por IP
    - Responder HTTP 429 con `{ error: "too many requests" }` al superar el límite
    - _Requirements: 5.4_

- [ ] 10. Registrar nuevas rutas en el servidor principal
  - [x] 10.1 Modificar `apps/hub-api/src/index.ts` para montar los nuevos routers
    - Importar y montar el users router: `app.use('/api', usersRouter)`
    - Verificar que el orden de middlewares es correcto (rate limit antes de auth)
    - _Requirements: 1.2, 2.1, 3.2, 4.2_

- [x] 11. Checkpoint — Verificar endpoints de Hub_API
  - Ejecutar `vitest --run` en `apps/hub-api` para confirmar que todos los tests pasan. Verificar que el servidor arranca y los endpoints responden correctamente con supertest. Consultar al usuario si hay dudas.

- [ ] 12. Implementar `useAuth` hook en el Portal
  - [x] 12.1 Crear `apps/portal/src/hooks/useAuth.ts`
    - Leer el JWT de `localStorage` bajo la clave `ambientalia_token`
    - Decodificar el payload (sin verificar firma) usando `atob` o una librería ligera
    - Retornar `{ isAuthenticated, user_id, email, role, apps }` según `AuthState`
    - Si el token está expirado, ausente o malformado: retornar estado vacío (`isAuthenticated: false`, `apps: []`)
    - Si `apps` del JWT está malformado o no es array: tratar como `[]`
    - _Requirements: 3.4, 4.4, 4.6_

  - [x]* 12.2 Escribir tests unitarios para `useAuth`
    - Parseo correcto de JWT válido con todos los campos
    - Token vacío, expirado y malformado retornan estado vacío
    - Campo `apps` malformado retorna `[]`
    - _Requirements: 3.4, 4.4, 4.6_

- [ ] 13. Implementar guards de ruta en el Portal
  - [x] 13.1 Crear `apps/portal/src/components/RequireAdmin.tsx`
    - Usa `useAuth` para obtener estado de autenticación y rol
    - Si no autenticado → `<Navigate to="/auth" />`
    - Si `role !== 'admin'` → `<Navigate to="/" />`
    - Si `role === 'admin'` → renderiza `children`
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 13.2 Crear `apps/portal/src/components/AppGuard.tsx`
    - Props: `appId: string`, `children: ReactNode`
    - Lee `apps[]` del JWT via `useAuth`
    - Si `appId` no está en `apps[]` → `<Navigate to="/" />` + mostrar toast de acceso no autorizado
    - _Requirements: 4.5_

  - [x]* 13.3 Escribir tests unitarios para `RequireAdmin` y `AppGuard`
    - `RequireAdmin`: usuario sin sesión redirige a `/auth`, lector redirige a `/`, admin renderiza children
    - `AppGuard`: app asignada renderiza children, app no asignada redirige a `/` con notificación
    - _Requirements: 5.1, 5.2, 5.3, 4.5_

- [ ] 14. Extender `Auth.tsx` con el formulario de registro
  - [ ] 14.1 Añadir tab/sección de registro en `apps/portal/src/pages/Auth.tsx`
    - Campos: nombre completo (máx 100 chars), correo electrónico (máx 254 chars), contraseña
    - Validación inline en el cliente antes de enviar (nombre no vacío, email formato básico, password ≥ 8 chars)
    - Llamar a `POST /api/auth/register`; en éxito (201) mostrar mensaje "Tu solicitud está pendiente de aprobación" y NO emitir JWT
    - En respuesta 409: mostrar mensaje inline "Este correo ya está registrado"
    - En respuesta 400: mostrar mensaje de error correspondiente bajo el campo afectado
    - En error de red: mostrar toast de error
    - _Requirements: 1.1, 1.8, 1.9_

- [ ] 15. Implementar página `AdminUsers` y componentes del Panel Admin
  - [ ] 15.1 Crear `apps/portal/src/pages/admin/AdminUsers.tsx`
    - Página principal del panel admin, protegida por `RequireAdmin`
    - Llama a `GET /api/users?page=N` para cargar la lista
    - Paginación de 50 usuarios por página con controles prev/next
    - Muestra: nombre, correo, estado (badge), fecha de registro
    - _Requirements: 2.1_

  - [ ] 15.2 Crear componente `UserTable.tsx` con `UserStatusBadge` y `UserActionsMenu`
    - `UserStatusBadge`: muestra el estado con colores diferenciados (pending, active, inactive)
    - `UserActionsMenu`: menú contextual con acciones según el estado actual del usuario (aprobar, desactivar, reactivar, eliminar, cambiar rol)
    - Las acciones llaman a los endpoints `PATCH /status`, `PATCH /role`, `DELETE` correspondientes
    - Deshabilitar las acciones que apuntarían al propio admin (user_id === JWT user_id)
    - _Requirements: 2.2, 2.3, 2.5, 2.6, 2.7, 3.2_

  - [ ] 15.3 Crear componente `AppAssignModal.tsx`
    - Modal que muestra checkboxes de todas las apps disponibles
    - Precarga el estado actual llamando al estado del usuario
    - Al confirmar, llama a `PUT /api/users/:id/apps`
    - _Requirements: 4.2_

  - [ ]* 15.4 Escribir tests unitarios para `AdminUsers` y componentes
    - `AdminUsers`: renderiza lista de usuarios con datos mock, verifica paginación
    - `UserActionsMenu`: acciones correctas habilitadas/deshabilitadas según estado y propio admin
    - `AppAssignModal`: selección y deselección de apps, llamada al endpoint al confirmar
    - _Requirements: 2.1, 2.2, 4.2_

- [ ] 16. Actualizar `Sidebar.tsx` con navegación condicional
  - [ ] 16.1 Modificar `apps/portal/src/components/Sidebar.tsx`
    - Usar `useAuth` para obtener el rol del usuario actual
    - Si `role === 'admin'`: mostrar enlace al Panel Admin ("Usuarios") en la navegación lateral
    - Si `role !== 'admin'` (incluido `reader` y no autenticado): ocultar el enlace
    - _Requirements: 3.4_

  - [ ]* 16.2 Escribir tests para `Sidebar`
    - Rol admin: enlace "Usuarios" visible
    - Rol reader: enlace "Usuarios" oculto
    - Sin sesión: enlace "Usuarios" oculto
    - _Requirements: 3.4_

- [ ] 17. Registrar rutas del Panel Admin en el router del Portal
  - [ ] 17.1 Añadir ruta `/admin/users` al router de `apps/portal`
    - Envolver `AdminUsers` con `RequireAdmin`
    - Asegurar que `AppGuard` envuelve las rutas de aplicaciones existentes con sus `appId` correspondientes
    - Verificar redirección correcta cuando la sesión expira dentro del panel (detectada por `useAuth`)
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 4.5_

- [ ] 18. Checkpoint final — Integración completa
  - Ejecutar `vitest --run` en `apps/hub-api` y `apps/portal` para confirmar que todos los tests pasan. Verificar que el flujo completo funciona: registro → aprobación → login → JWT con apps → acceso condicional → panel admin. Consultar al usuario si hay dudas o se requieren ajustes.

---

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido.
- Cada tarea referencia los requisitos específicos que implementa para trazabilidad completa.
- Los tests de propiedades usan **fast-check** como única dependencia nueva (`devDependency` en `hub-api`).
- Los checkpoints en los pasos 5, 11 y 18 garantizan validación incremental antes de continuar.
- El fallback `AUTH_USERS` se mantiene operativo durante toda la migración; no se elimina en este plan.
- Las transacciones de BD aseguran que ninguna operación multi-tabla deja el sistema en estado inconsistente.
- Para correr los tests: `vitest --run` (no modo watch) en el directorio del paquete correspondiente.

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["1.3", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "6.1"] },
    { "id": 4, "tasks": ["6.2", "7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3"] },
    { "id": 6, "tasks": ["7.4", "7.5", "8.1", "8.2", "8.3", "8.4"] },
    { "id": 7, "tasks": ["8.5", "9.1"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["12.1"] },
    { "id": 10, "tasks": ["12.2", "13.1", "13.2"] },
    { "id": 11, "tasks": ["13.3", "14.1"] },
    { "id": 12, "tasks": ["15.1", "15.2", "16.1"] },
    { "id": 13, "tasks": ["15.3", "15.4", "16.2"] },
    { "id": 14, "tasks": ["17.1"] }
  ]
}
```
