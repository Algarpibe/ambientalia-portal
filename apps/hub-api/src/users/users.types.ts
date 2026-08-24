// Tipos e interfaces del módulo user-management (hub-api).
// Formas según design.md; nombres según tasks.md 2.1.

export type UserStatus = 'pending' | 'active' | 'inactive';
export type UserRole = 'admin' | 'reader';

/**
 * Fila completa de la tabla `users` tal como vive en BD, incluyendo el
 * `password_hash`. Uso interno (repositorio/servicio); NUNCA se serializa al
 * cliente.
 */
export interface UserRow {
  id: string; // UUID
  full_name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: string; // ISO 8601 (TIMESTAMPTZ)
  /** SEC-220 — se incrementa al cambiar contraseña o cerrar sesión. */
  token_version: number;
}

/**
 * Proyección pública de un usuario (sin `password_hash`). Es lo que devuelven
 * los endpoints de gestión y la lista paginada. Equivale a `UserRecord` de
 * design.md.
 */
export interface UserPublic {
  id: string; // UUID
  full_name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

/** Perfil propio del usuario autenticado (incluye avatar). */
export interface SelfProfile extends UserPublic {
  avatar: string | null;
  /**
   * Las apps asignadas, leídas de `portal.user_apps` en el momento de preguntar.
   *
   * Viajan aquí porque el JWT también las lleva, pero congeladas en el instante
   * del login y sin ninguna vía de refresco: `issueTokenForUser` solo se llama
   * desde `loginUser`. Quien recibía una app con la sesión abierta seguía sin
   * verla en el portal —el icono se pinta desde el token— hasta cerrar sesión o
   * agotar el TTL, aunque el servidor ya la dejara entrar porque SEC-224 relee
   * las apps de la BD en cada petición.
   *
   * Con esto el navegador puede leer la MISMA fuente que la autorización.
   */
  apps: string[];
}

/** Payload de entrada del registro por autoservicio (`POST /api/auth/register`). */
export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
}

/** Resultado paginado de `GET /api/users`. Equivale a `UserListResult`. */
export interface PaginatedUsers {
  users: UserPublic[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Payload del JWT extendido. `sub` sigue siendo el email (retrocompatibilidad
 * con el token previo `{ sub }`); se añaden `user_id`, `role` y `apps`.
 * `iat`/`exp` los añade `jwt.sign` y los rellena `jwt.verify` — opcionales al
 * construir el payload.
 */
export interface JwtPayload {
  sub: string; // email
  user_id: string; // UUID
  role: UserRole;
  apps: string[];
  /**
   * SEC-220 — versión de sesión. Opcional porque los tokens emitidos ANTES de
   * la migración 034 no la llevan; ausente se lee como 0, que es el valor que
   * la columna tiene para todos hasta el primer cambio de contraseña o logout.
   */
  token_version?: number;
  iat?: number;
  exp?: number;
}

/** Operaciones auditables de gestión de usuarios (design.md `AuditOperation`). */
export type AuditOperation =
  | 'register_user'
  | 'approve_user'
  | 'deactivate_user'
  | 'reactivate_user'
  | 'delete_user'
  | 'change_role'
  | 'update_apps';

/** Entrada del log de auditoría (design.md). */
export interface AuditEntry {
  timestamp: string; // ISO 8601 UTC
  adminEmail: string;
  targetEmail: string;
  operation: AuditOperation;
}
