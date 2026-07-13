import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

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
 * Auth de los endpoints de datos. Solo `Authorization: Bearer <jwt>` válido.
 * (La `x-api-key` legacy de la transición se retiró: el portal ya autentica
 * 100% por JWT vía /api/login.)
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token && JWT_SECRET) {
    try {
      jwt.verify(token, JWT_SECRET);
      return next();
    } catch {
      /* token inválido/expirado → 401 abajo */
    }
  }
  res.status(401).json({ error: 'unauthorized' });
}
