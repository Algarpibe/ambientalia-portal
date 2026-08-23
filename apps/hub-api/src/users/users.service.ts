import bcrypt from 'bcryptjs';
import type { UserRepository } from './users.repository.js';
import type { PaginatedUsers, RegisterInput, UserPublic, UserRole, SelfProfile } from './users.types.js';

// Lógica de negocio del módulo user-management. Valida entradas, aplica reglas
// (rol por defecto al aprobar, auto-protección del admin) y traduce fallos a
// errores de dominio (UserError) que el router mapea a códigos HTTP.

const BCRYPT_COST = 12; // Requirement 1.3: coste mínimo 12
const MIN_PASSWORD_LENGTH = 8; // Requirement 1.6
const MAX_FULL_NAME_LENGTH = 100; // Requirement 1.7 (form de registro)
const MAX_EMAIL_LENGTH = 254; // Requirement 1.1 / RFC 5321
const USERS_PER_PAGE = 50; // Requirement 2.1

/** Error de dominio con código estable + status HTTP y (opcional) campo afectado. */
export class UserError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly field?: string,
  ) {
    super(code);
    this.name = 'UserError';
  }
}

/** Valida el email según una aproximación pragmática a RFC 5321. */
export function isValidEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const e = email.trim();
  if (e.length === 0 || e.length > MAX_EMAIL_LENGTH) return false;
  // Exactamente un @, local y dominio no vacíos, dominio con al menos un punto.
  if (!/^[^\s@"]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  const local = e.slice(0, e.indexOf('@'));
  if (local.length > 64) return false; // RFC 5321 límite del local-part
  return true;
}

/** Valida y normaliza el input de registro; lanza UserError (400) si algo falla. */
export function validateRegisterInput(input: RegisterInput): RegisterInput {
  const fullName = String(input?.fullName ?? '').trim();
  if (fullName.length < 1 || fullName.length > MAX_FULL_NAME_LENGTH) {
    throw new UserError('invalid_full_name', 400, 'fullName');
  }
  if (!isValidEmail(input?.email)) {
    throw new UserError('invalid_email', 400, 'email');
  }
  const password = String(input?.password ?? '');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError('password_too_short', 400, 'password');
  }
  return { fullName, email: input.email.trim().toLowerCase(), password };
}

/** Código de violación de unicidad de PostgreSQL. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  /**
   * Registro por autoservicio. Valida, hashea con bcrypt (coste ≥ 12) y crea el
   * usuario en estado `pending` (default de BD). Lanza 409 si el email ya existe.
   */
  async register(input: RegisterInput): Promise<UserPublic> {
    const clean = validateRegisterInput(input);

    // Pre-chequeo explícito; la unique constraint cubre la carrera concurrente.
    if (await this.repo.findByEmail(clean.email)) {
      throw new UserError('email_already_registered', 409, 'email');
    }

    const hash = await bcrypt.hash(clean.password, BCRYPT_COST);
    try {
      return await this.repo.create(clean, hash);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new UserError('email_already_registered', 409, 'email');
      }
      throw err;
    }
  }

  /** Aprueba un usuario pending → active con rol `reader` por defecto (Req 3.1). */
  async approve(id: string): Promise<UserPublic> {
    const withStatus = await this.repo.updateStatus(id, 'active');
    if (!withStatus) throw new UserError('user_not_found', 404);
    const updated = await this.repo.updateRole(id, 'reader');
    // updateRole no debería fallar si updateStatus encontró la fila; por robustez:
    if (!updated) throw new UserError('user_not_found', 404);
    return updated;
  }

  /** Desactiva un usuario (active → inactive). Auto-protección del admin (Req 2.7). */
  async deactivate(id: string, requesterId: string): Promise<UserPublic> {
    if (id === requesterId) throw new UserError('cannot_modify_own_account', 403);
    const updated = await this.repo.updateStatus(id, 'inactive');
    if (!updated) throw new UserError('user_not_found', 404);
    return updated;
  }

  /** Reactiva un usuario (inactive → active), conservando su rol previo (Req 2.5). */
  async reactivate(id: string): Promise<UserPublic> {
    const updated = await this.repo.updateStatus(id, 'active');
    if (!updated) throw new UserError('user_not_found', 404);
    return updated;
  }

  /** Cambia el rol de un usuario. Valida el rol; 404 si no existe (Req 3.2). */
  async changeRole(id: string, role: UserRole): Promise<UserPublic> {
    if (role !== 'admin' && role !== 'reader') {
      throw new UserError('invalid_role', 400, 'role');
    }
    const updated = await this.repo.updateRole(id, role);
    if (!updated) throw new UserError('user_not_found', 404);
    return updated;
  }

  /** Elimina un usuario de forma permanente. Auto-protección del admin (Req 2.6/2.7). */
  async delete(id: string, requesterId: string): Promise<void> {
    if (id === requesterId) throw new UserError('cannot_modify_own_account', 403);
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new UserError('user_not_found', 404);
  }

  /** Reemplaza el conjunto de apps del usuario. 404 si el usuario no existe (Req 4.2). */
  async setApps(id: string, appIds: string[]): Promise<string[]> {
    if (!Array.isArray(appIds)) throw new UserError('invalid_apps', 400, 'apps');
    if (!(await this.repo.findById(id))) throw new UserError('user_not_found', 404);
    return this.repo.setApps(id, appIds);
  }

  /** Devuelve las apps asignadas a un usuario. 404 si no existe (Req 4.1). */
  async getUserApps(id: string): Promise<string[]> {
    if (!(await this.repo.findById(id))) throw new UserError('user_not_found', 404);
    return this.repo.getApps(id);
  }

  /** Devuelve la proyección pública de un usuario; 404 si no existe. */
  async getUser(id: string): Promise<UserPublic> {
    const u = await this.repo.findById(id);
    if (!u) throw new UserError('user_not_found', 404);
    const { password_hash, ...pub } = u;
    void password_hash;
    return pub;
  }

  /** Lista paginada de usuarios (50 por página, Req 2.1). */
  async listUsers(page: number): Promise<PaginatedUsers> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    return this.repo.listPaginated(safePage, USERS_PER_PAGE);
  }

  /** Perfil propio del usuario autenticado; 404 si no existe. */
  async getSelfProfile(id: string): Promise<SelfProfile> {
    const profile = await this.repo.getSelfProfile(id);
    if (!profile) throw new UserError('user_not_found', 404);
    return profile;
  }

  // No hay updateName: el nombre se valida y se graba una sola vez, al
  // registrarse (ver `register`, que sigue usando MAX_FULL_NAME_LENGTH).

  /** Actualiza el avatar propio (data URL de imagen, tamaño acotado). */
  async updateAvatar(id: string, avatar: string): Promise<void> {
    const value = String(avatar ?? '');
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(value)) {
      throw new UserError('invalid_avatar', 400, 'avatar');
    }
    if (value.length > 1_500_000) {
      // ~1.1 MB de imagen; el cliente ya redimensiona a un thumbnail pequeño.
      throw new UserError('avatar_too_large', 400, 'avatar');
    }
    if (!(await this.repo.updateAvatar(id, value))) {
      throw new UserError('user_not_found', 404);
    }
  }

  /** Preferencias de UI del propio usuario. */
  async getPreferences(id: string): Promise<Record<string, unknown>> {
    const prefs = await this.repo.getPreferences(id);
    if (prefs === null) throw new UserError('user_not_found', 404);
    return prefs;
  }

  /**
   * Fusiona un parche en las preferencias. Es un merge (no un reemplazo) para que
   * cada app escriba su clave sin pisar las de las demás.
   */
  async updatePreferences(id: string, patch: unknown): Promise<Record<string, unknown>> {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new UserError('invalid_preferences', 400, 'preferences');
    }
    // Techo de cordura: esto guarda config de UI (unos pocos KB), no datos.
    if (JSON.stringify(patch).length > 100_000) {
      throw new UserError('preferences_too_large', 400, 'preferences');
    }
    const prefs = await this.repo.mergePreferences(id, patch as Record<string, unknown>);
    if (prefs === null) throw new UserError('user_not_found', 404);
    return prefs;
  }

  /** Cambia la contraseña del propio usuario, verificando la actual (Req 3.5/3.6). */
  async changePassword(id: string, currentPwd: string, newPwd: string): Promise<void> {
    const user = await this.repo.findById(id);
    if (!user) throw new UserError('user_not_found', 404);

    const ok = await bcrypt.compare(String(currentPwd ?? ''), user.password_hash);
    if (!ok) throw new UserError('invalid_current_password', 400, 'currentPassword');

    if (String(newPwd ?? '').length < MIN_PASSWORD_LENGTH) {
      throw new UserError('password_too_short', 400, 'newPassword');
    }
    const hash = await bcrypt.hash(newPwd, BCRYPT_COST);
    // `updatePassword` incrementa `token_version` en la MISMA sentencia
    // (SEC-220): cambiar la contraseña invalida las sesiones vivas, que es
    // justo lo que espera quien la cambia porque sospecha que se la robaron.
    await this.repo.updatePassword(id, hash);
  }

  /**
   * Cierra la sesión invalidando TODOS los tokens vivos del usuario (SEC-220).
   *
   * Es global a propósito, no por-dispositivo: quien pulsa «cerrar sesión» en
   * una herramienta interna espera dejar de estar dentro, no dejar de estarlo
   * solo en la pestaña que tiene delante. Distinguir dispositivos exigiría un
   * identificador por sesión y una tabla donde llevarlas, y el caso que de
   * verdad importa —«me he dejado la sesión abierta en otro sitio»— es
   * precisamente el que el logout global resuelve y el por-dispositivo no.
   */
  async logout(id: string): Promise<void> {
    if (!(await this.repo.bumpTokenVersion(id))) throw new UserError('user_not_found', 404);
  }
}
