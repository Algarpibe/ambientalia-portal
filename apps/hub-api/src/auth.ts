import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getHubPool } from './db.js';
import { UserRepository } from './users/users.repository.js';
import type { JwtPayload } from './users/users.types.js';

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
const TOKEN_TTL = process.env.JWT_TTL || '8h';

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

export async function verifyCredentials(email: string, password: string): Promise<boolean> {
  const hash = USERS.get(String(email || '').toLowerCase().trim());
  if (!hash) return false;
  try {
    return await bcrypt.compare(String(password || ''), hash);
  } catch {
    return false;
  }
}

export function issueToken(email: string): string {
  const options: jwt.SignOptions = { expiresIn: TOKEN_TTL as jwt.SignOptions['expiresIn'] };
  return jwt.sign({ sub: String(email).toLowerCase().trim() }, JWT_SECRET, options);
}

/**
 * Auth de los endpoints de datos. Requiere `Authorization: Bearer <jwt>` válido.
 *
 * Además de verificar la firma, adjunta el payload a `req.user`. Si el token
 * corresponde a un usuario de BD (payload con `user_id`), verifica que siga
 * `active` — así un usuario desactivado es rechazado con 401 en su siguiente
 * petición (Req 2.4/2.8) sin esperar a que expire el JWT. Los tokens legacy del
 * fallback `AUTH_USERS` (sin `user_id`) pasan directo, preservando la migración.
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
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
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

  // Token de usuario de BD: exigir que el usuario siga existiendo y esté activo.
  try {
    const repo = new UserRepository(getHubPool());
    const user = await repo.findById(String(payload.user_id));
    if (!user || user.status !== 'active') {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
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
