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
//
// La ÚNICA fuente de usuarios es `portal.users`. El fallback por AUTH_USERS que
// vivió aquí durante la migración se retiró el 2026-08-23: no quedaban usuarios
// que dependieran de él, emitía tokens sin `user_id` que se saltaban el chequeo
// de BD entero (el agujero irrevocable de SEC-220), y su hash bcrypt de coste 10
// era un secreto más que rotar.
//
// AUTH_USERS SIGUE existiendo, pero solo como provisioning: `seed-from-env.ts`
// la lee al arrancar para poder crear el primer admin de una base nueva. Es
// necesaria porque `/api/auth/register` crea usuarios `pending` y hace falta un
// admin para aprobarlos: sin seed, una BD recreada desde cero se queda sin nadie
// que pueda entrar. Procedimiento: ponerla, arrancar una vez, vaciarla.

const JWT_SECRET = process.env.JWT_SECRET || '';
// Sesión de 7 días. Era de 30 —herramienta interna, molestaba reloguear a
// diario— y se bajó con SEC-220, cuando dejó de ser gratis: cada petición
// revalida contra la BD el estado, el rol, las apps y ahora la `token_version`,
// así que desactivar, degradar, retirar una app, cambiar la contraseña o cerrar
// sesión surten efecto en la petición siguiente. Lo único que el TTL sigue
// gobernando es cuánto vive un token que nadie ha invalidado; 7 días es un
// compromiso entre no reloguear a diario y no dejar suelto un mes un token del
// que nadie sospecha. Sobrescribible con JWT_TTL ('8h', '7d', '30d'…).
const TOKEN_TTL = process.env.JWT_TTL || '7d';

if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET no configurado — el login JWT está deshabilitado.');
}

// SEC-214 — hash bcrypt fijo contra el que comparar cuando el email NO existe,
// para que el coste de la respuesta no delate si la cuenta es real. Vivía en
// `verifyCredentials`, que se retiró con el fallback; se queda aquí porque la
// defensa era de `loginUser`, no del fallback: sin ella, un correo inexistente
// respondería al instante y uno real costaría un bcrypt.compare.
const DUMMY_HASH = bcrypt.hashSync('sec214-timing-safe-dummy', 10);

function signToken(payload: Record<string, unknown>): string {
  const options: jwt.SignOptions = { expiresIn: TOKEN_TTL as jwt.SignOptions['expiresIn'] };
  return jwt.sign(payload, JWT_SECRET, options);
}

/**
 * Token de un usuario de BD: `{ sub, user_id, role, apps, token_version }`.
 *
 * `role` y `apps` viajan solo para que el navegador pinte la interfaz sin una
 * segunda llamada: la autorización REAL los relee de la BD en cada petición
 * (SEC-224). `token_version` es lo contrario — es la copia firmada que
 * `requireAuth` compara contra la fila para saber si esta sesión sigue siendo
 * válida (SEC-220).
 */
export function issueTokenForUser(
  user: { id: string; email: string; role: UserRole; token_version?: number },
  apps: string[],
): string {
  return signToken({
    sub: user.email.toLowerCase().trim(),
    user_id: user.id,
    role: user.role,
    apps,
    token_version: user.token_version ?? 0,
  });
}

export interface LoginResult {
  ok: boolean;
  token?: string;
  status?: number; // HTTP a devolver cuando ok === false
  error?: string;
}

/**
 * Autentica un login (Req 2.8, 3.3, 4.3, 6.2) contra `portal.users`, que es la
 * única fuente de usuarios.
 *  - Usuario no `active`      → 403 "account not approved".
 *  - Credenciales incorrectas → 401 "invalid credentials".
 *  - Email inexistente        → 401 "invalid credentials", pero DESPUÉS de un
 *    bcrypt.compare contra DUMMY_HASH (SEC-214): sin él, la respuesta llegaría
 *    al instante y el tiempo delataría qué correos existen.
 *  - OK → JWT con user_id, role, apps y token_version.
 *
 * Un error de BD se propaga y el handler responde 500. Es deliberado: sin BD no
 * hay forma de saber si alguien sigue activo, y adivinar sería peor que fallar.
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

  // SEC-214 — el email no existe, pero se paga igualmente un bcrypt.compare
  // antes de responder. El resultado se descarta: lo que importa es el tiempo.
  await bcrypt.compare(pw, DUMMY_HASH);
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
 *   - compara la `token_version` firmada con la de la fila (SEC-220): si no
 *     coinciden, la sesión fue invalidada por un cambio de contraseña o un
 *     logout y se responde 401.
 *
 * Ya NO hay excepciones: todo token que llegue aquí pasa por la BD. La rama que
 * dejaba pasar a los tokens sin `user_id` (fallback AUTH_USERS) se retiró con el
 * propio fallback — era el único camino que se saltaba estas comprobaciones, y
 * por tanto el único imposible de revocar.
 *
 * Nota: las rutas sin token o con token inválido resuelven en el prefijo
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

  // Sin `user_id` no hay fila que consultar y, por tanto, nada que verificar:
  // ni estado, ni rol, ni versión de sesión. Antes esto era la puerta del
  // fallback AUTH_USERS; retirado aquél, un token así solo puede venir de un
  // secreto viejo o de una firma manipulada. Se rechaza.
  if (!payload.user_id) {
    res.status(401).json({ error: 'unauthorized' });
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
      // Las apps salen de una subconsulta ARRAY(...) y NO de un
      // array_agg + LEFT JOIN + GROUP BY, que es como se escribió primero y
      // tumbó la autenticación entera en produccion el 2026-08-23: al añadir
      // `u.token_version` al SELECT sin añadirla al GROUP BY, PostgreSQL
      // rechazó la consulta, `requireAuth` cayó a su rama de error y devolvió
      // 401 a todo el mundo. Los mocks de los tests ignoran el SQL, así que
      // 1011 tests en verde no vieron nada.
      //
      // Sin GROUP BY no hay forma de repetirlo: añadir una columna al SELECT
      // ya no puede invalidar la consulta. `ARRAY(subconsulta)` devuelve `{}`
      // cuando no hay filas, así que tampoco hace falta COALESCE.
      `SELECT u.role,
              u.status,
              u.token_version,
              ARRAY(
                SELECT ua.app_id
                  FROM portal.user_apps ua
                 WHERE ua.user_id = u.id
                 ORDER BY ua.app_id
              ) AS apps
         FROM portal.users u
        WHERE u.id = $1`,
      [String(payload.user_id)],
    );
    const user = rows[0] as
      | { role?: UserRole; status?: string; apps?: string[]; token_version?: number }
      | undefined;
    if (!user || user.status !== 'active') {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // SEC-220 — la sesión vale mientras su versión firmada siga siendo la de la
    // fila. Un token anterior a la migración 034 no trae el campo y se lee como
    // 0, que es lo que la columna vale hasta el primer cambio de contraseña o
    // logout: por eso desplegar esto no desloguea a nadie.
    if ((payload.token_version ?? 0) !== (user.token_version ?? 0)) {
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
// Acepta VARIOS ids: basta con tener una de las apps indicadas. Sirve para recursos
// compartidos por dos apps — p. ej. las OV pendientes, visibles tanto desde Contabilidad
// como desde la app `ov-pendientes`, que se asigna a quien no debe ver la facturación.
export function requireApp(...appIds: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = getPayload(req);
    if (user?.role === 'admin' || appIds.some((id) => user?.apps?.includes(id))) {
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
