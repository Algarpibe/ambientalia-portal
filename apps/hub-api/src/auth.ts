import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getHubPool } from './db.js';
import { UserRepository } from './users/users.repository.js';
import type { JwtPayload, UserRole } from './users/users.types.js';

// Adjuntamos el payload verificado del JWT a req.user para que los middlewares
// de autorización (requireAdmin, requireOwnerOrAdmin) lo lean sin re-verificar.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// Auth real server-side (SEC-001/SEC-003). Login por credenciales → JWT firmado.
// Usuarios en el entorno: AUTH_USERS = "email1:hashBcrypt1,email2:hashBcrypt2"
// (los hashes bcrypt no contienen ',' ni ':', así que el parseo es seguro).

const JWT_SECRET = process.env.JWT_SECRET || '';
// Sesión de 30 días por defecto: es una herramienta interna y molestaba tener que
// reloguear a diario (el token vivía 8h). Como cada petición revalida que el usuario
// siga `active` en la BD —y desde SEC-224 relee también su rol y sus apps—, un
// token largo NO impide cortar ni recortar el acceso al instante: desactivar,
// degradar o retirar una app surten efecto en la petición siguiente. Lo que un
// TTL largo sí alarga es la vida de un token ROBADO (ver SEC-220: no hay
// invalidación). Sobrescribible con JWT_TTL (formato de
// jsonwebtoken: '8h', '7d', '30d'…).
const TOKEN_TTL = process.env.JWT_TTL || '30d';

if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET no configurado — el login JWT está deshabilitado.');
}

function loadUsers(): Map<string, string> {
  const users = new Map<string, string>();
  (process.env.AUTH_USERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        users.set(pair.slice(0, idx).toLowerCase().trim(), pair.slice(idx + 1).trim());
      }
    });
  return users;
}
const USERS = loadUsers();

// SEC-214 — hash bcrypt fijo para ejecutar SIEMPRE un compare (también cuando el
// email no existe en AUTH_USERS), igualando el tiempo de respuesta y evitando la
// enumeración de usuarios por timing.
const DUMMY_HASH = bcrypt.hashSync('sec214-timing-safe-dummy', 10);

export async function verifyCredentials(email: string, password: string): Promise<boolean> {
  const hash = USERS.get(String(email || '').toLowerCase().trim());
  try {
    // Comparamos siempre (contra DUMMY_HASH si el usuario no existe): el coste del
    // bcrypt.compare no debe depender de si el email está o no en AUTH_USERS.
    const ok = await bcrypt.compare(String(password || ''), hash ?? DUMMY_HASH);
    return hash ? ok : false;
  } catch {
    return false;
  }
}

function signToken(payload: Record<string, unknown>): string {
  const options: jwt.SignOptions = { expiresIn: TOKEN_TTL as jwt.SignOptions['expiresIn'] };
  return jwt.sign(payload, JWT_SECRET, options);
}

/** Token legacy con solo `sub` (retrocompatibilidad; sigue usándose en tests). */
export function issueToken(email: string): string {
  return signToken({ sub: String(email).toLowerCase().trim() });
}

/** Token extendido para un usuario de BD: `{ sub, user_id, role, apps }` (Req 3.3, 4.3). */
export function issueTokenForUser(
  user: { id: string; email: string; role: UserRole },
  apps: string[],
): string {
  return signToken({
    sub: user.email.toLowerCase().trim(),
    user_id: user.id,
    role: user.role,
    apps,
  });
}

export interface LoginResult {
  ok: boolean;
  token?: string;
  status?: number; // HTTP a devolver cuando ok === false
  error?: string;
}

/**
 * Autentica un login (Req 2.8, 3.3, 4.3, 6.2). Intenta primero el modelo de BD;
 * si el email no existe en `users`, cae al fallback `AUTH_USERS`.
 *  - Usuario de BD no `active`         → 403 "account not approved".
 *  - Credenciales incorrectas          → 401 "invalid credentials".
 *  - OK (BD)   → JWT extendido con user_id/role/apps (apps desde user_apps).
 *  - OK (fallback) → JWT con role 'reader' y apps [] (sin user_id).
 *
 * Un error de BD se propaga (el handler responde 500): el fallback es solo para
 * usuarios ausentes de la BD, no para suplantar el chequeo de estado si la BD
 * está caída (evita que un usuario desactivado entre por AUTH_USERS).
 */
export async function loginUser(email: string, password: string): Promise<LoginResult> {
  const em = String(email || '').toLowerCase().trim();
  const pw = String(password || '');

  const repo = new UserRepository(getHubPool());
  const dbUser = await repo.findByEmail(em);

  if (dbUser) {
    if (dbUser.status !== 'active') {
      return { ok: false, status: 403, error: 'account not approved' };
    }
    if (!(await bcrypt.compare(pw, dbUser.password_hash))) {
      return { ok: false, status: 401, error: 'invalid credentials' };
    }
    const apps = await repo.getApps(dbUser.id);
    return { ok: true, token: issueTokenForUser(dbUser, apps) };
  }

  // Fallback AUTH_USERS: usuarios aún no migrados a BD → rol reader, sin apps.
  if (await verifyCredentials(em, pw)) {
    return { ok: true, token: signToken({ sub: em, role: 'reader', apps: [] }) };
  }

  return { ok: false, status: 401, error: 'invalid credentials' };
}

/**
 * Auth de los endpoints de datos. Requiere `Authorization: Bearer <jwt>` válido.
 *
 * Además de verificar la firma, adjunta el payload a `req.user`. Si el token
 * corresponde a un usuario de BD (payload con `user_id`), lee su fila y:
 *   - exige que siga `active` (Req 2.4/2.8): si no, 401 en la petición
 *     siguiente, sin esperar a que expire el JWT;
 *   - **sobrescribe `role` y `apps` con lo que dice la BD** (SEC-224), de modo
 *     que `requireAdmin`/`requireApp` decidan sobre el estado de hoy y no sobre
 *     el que se firmó al entrar.
 *
 * Los tokens legacy del fallback `AUTH_USERS` (sin `user_id`) pasan directo,
 * preservando la migración. No es un agujero de SEC-224: se firman con
 * `role: 'reader'` y `apps: []` (o sin rol alguno), así que `requireAdmin` y
 * `requireApp` los rechazan igual. Su problema es otro, y es SEC-220.
 *
 * Nota: las rutas sin token / token inválido / legacy resuelven en el prefijo
 * síncrono (antes de cualquier `await`); solo el chequeo de BD es asíncrono.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !JWT_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  let payload: JwtPayload;
  try {
    // SEC-213 — fijar el algoritmo (los tokens se firman con HS256). Evita que un
    // token con `alg` distinto ('none' o asimétrico) sea aceptado.
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.user = payload;

  // Token legacy (fallback AUTH_USERS): sin user_id → no hay fila en BD que
  // consultar. Se acepta tal cual para no romper el fallback durante la migración.
  if (!payload.user_id) {
    next();
    return;
  }

  // Token de usuario de BD. De la fila sale lo que decide QUÉ puede hacer, no
  // solo si sigue activo: el JWT dice quién eres, la BD dice qué puedes.
  //
  // SEC-224 — hasta aquí el rol y las apps salían del payload firmado en el
  // login, y como el token no se reemite nunca, degradar a alguien o retirarle
  // una app no surtía efecto hasta que expiraba (30 días). La consulta ya se
  // hacía para comprobar `status`; solo hubo que ampliarla con las apps y usar
  // el `role` que `findById` ya traía y se tiraba.
  //
  // Va en UNA consulta y no en dos: `portal.user_apps` tiene PRIMARY KEY
  // (user_id, app_id), así que el LEFT JOIN entra por índice y no añade viaje.
  try {
    const { rows } = await getHubPool().query(
      `SELECT u.role,
              u.status,
              COALESCE(
                array_agg(ua.app_id ORDER BY ua.app_id) FILTER (WHERE ua.app_id IS NOT NULL),
                '{}'::text[]
              ) AS apps
         FROM portal.users u
         LEFT JOIN portal.user_apps ua ON ua.user_id = u.id
        WHERE u.id = $1
        GROUP BY u.role, u.status`,
      [String(payload.user_id)],
    );
    const user = rows[0] as { role?: UserRole; status?: string; apps?: string[] } | undefined;
    if (!user || user.status !== 'active') {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // Se PISA lo que venía firmado. Si la fila llegara incompleta se cae del
    // lado seguro: sin rol no eres admin, sin apps no tienes ninguna.
    req.user.role = user.role as UserRole;
    req.user.apps = user.apps ?? [];
    next();
  } catch (err) {
    // Fail-closed: si no podemos verificar el estado, denegamos (y logueamos).
    console.error('requireAuth: fallo al verificar estado del usuario', err);
    res.status(401).json({ error: 'unauthorized' });
  }
}

/** Devuelve el payload del JWT ya verificado (adjuntado por requireAuth), o null. */
export function getPayload(req: Request): JwtPayload | null {
  return req.user ?? null;
}

/**
 * Requiere JWT válido + usuario activo (vía requireAuth) + `role === 'admin'`.
 * Sin token / inválido / inactivo → 401 (lo maneja requireAuth); autenticado
 * pero sin rol admin → 403 (Req 2.9, 2.10, 5.1). Los tokens legacy sin `role`
 * no son admin y por tanto reciben 403.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    if (req.user?.role === 'admin') {
      next();
    } else {
      res.status(403).json({ error: 'forbidden' });
    }
  });
}

/**
 * Exige que el JWT tenga `appId` en `apps[]`. Se usa detrás de `requireAuth`
 * (este middleware asume que `req.user` ya fue adjuntado).
 *
 * La autorización por app nació siendo solo UX en el frontend (ver `AppGuard`,
 * cuyo propio comentario dice que la verificación real vive en el backend). Ya
 * vive: desde SEC-210/211 la comprueban en el servidor TODOS los endpoints de
 * datos —los 7 de `data.router.ts`, los 6 de contabilidad, los 5 de WO-sales y
 * los de ausencias—, cada uno con su `requireApp` o con `requireAdmin`. WO-sales
 * fue el primero porque expone el NIT de cada cliente (dato personal, Ley 1581).
 * Ver docs/PRIVACY-RETENTION.md.
 *
 * `admin` tiene bypass (igual que `requireAdmin`/`requireOwnerOrAdmin`): un
 * admin gestiona el acceso de todas las apps y no depende de tener la app
 * asignada en su propio JWT.
 */
export function requireApp(appId: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = getPayload(req);
    if (user?.role === 'admin' || user?.apps?.includes(appId)) {
      next();
      return;
    }
    res.status(403).json({ error: 'forbidden' });
  };
}

/**
 * Requiere JWT válido + usuario activo (vía requireAuth) y que el recurso sea
 * del propio usuario (`user_id === :id`) O que el solicitante sea `admin`
 * (Req 3.5, 3.6). En otro caso → 403.
 *
 * Los IDs son UUID (strings): se comparan como strings, NO con parseInt.
 */
export async function requireOwnerOrAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    const isOwner = req.user?.user_id != null && String(req.user.user_id) === String(req.params.id);
    const isAdmin = req.user?.role === 'admin';
    if (isOwner || isAdmin) {
      next();
    } else {
      res.status(403).json({ error: 'forbidden' });
    }
  });
}

/**
 * Auth máquina-a-máquina para los endpoints que consume n8n. No es JWT de usuario:
 * compara una cabecera secreta contra una variable de entorno. Fail-closed: si el
 * secreto no está configurado, no pasa nadie.
 *
 * Se puede usar de dos formas, y ambas siguen siendo middleware:
 *   requireCronToken                                       → WO-sales (por defecto)
 *   requireCronToken({ env: 'X_TOKEN', header: 'X-Algo' })  → otra automatización
 *
 * El caso por defecto conserva WO_SALES_CRON_TOKEN / X-WO-Sales-Cron-Token para no
 * tocar ni el código ni la configuración de WO-sales, que ya está en producción.
 */
interface CronTokenOpts {
  env?: string;
  header?: string;
}

function checkCronToken(req: Request, res: Response, next: NextFunction, opts: CronTokenOpts): void {
  const esperado = process.env[opts.env ?? 'WO_SALES_CRON_TOKEN'];
  const recibido = req.header(opts.header ?? 'X-WO-Sales-Cron-Token');
  if (esperado && recibido && recibido === esperado) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

export function requireCronToken(opts: CronTokenOpts): (req: Request, res: Response, next: NextFunction) => void;
export function requireCronToken(req: Request, res: Response, next: NextFunction): void;
export function requireCronToken(
  a: CronTokenOpts | Request,
  b?: Response,
  c?: NextFunction,
): void | ((req: Request, res: Response, next: NextFunction) => void) {
  // Distinguimos las dos firmas por la aridad: como middleware siempre llegan
  // los tres argumentos de Express; como fábrica, solo el objeto de opciones.
  if (b === undefined) {
    const opts = (a ?? {}) as CronTokenOpts;
    return (req, res, next) => checkCronToken(req, res, next, opts);
  }
  checkCronToken(a as Request, b, c as NextFunction, {});
}
