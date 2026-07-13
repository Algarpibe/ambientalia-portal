import type { Pool } from '@algarpibe/zoho-sync';

// Seed inicial de la tabla `users` a partir de la variable de entorno legacy
// AUTH_USERS ("email1:hashBcrypt1,email2:hashBcrypt2"), el mismo formato que
// parsea auth.ts. Migra el modelo estático de env-vars al modelo dinámico en BD
// sin perder el acceso existente.
//
// Reglas (design.md / tasks.md 1.2):
//   - El primer usuario de la lista recibe role='admin'; el resto, role='reader'.
//   - Todos entran con status='active' (ya eran usuarios operativos).
//   - El password_hash de AUTH_USERS ya es bcrypt → se inserta tal cual.
//   - full_name no existe en AUTH_USERS → se deriva de la parte local del email.
//   - ON CONFLICT (email) DO NOTHING → idempotente y seguro de re-ejecutar.

interface SeedUser {
  email: string;
  passwordHash: string;
  role: 'admin' | 'reader';
}

/** Parsea AUTH_USERS preservando el orden (el primero será admin). */
export function parseAuthUsers(raw: string | undefined): SeedUser[] {
  const users: SeedUser[] = [];
  (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair, index) => {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        const email = pair.slice(0, idx).toLowerCase().trim();
        const passwordHash = pair.slice(idx + 1).trim();
        if (email && passwordHash) {
          users.push({ email, passwordHash, role: index === 0 ? 'admin' : 'reader' });
        }
      }
    });
  return users;
}

/** Deriva un nombre legible de la parte local del email (fallback de full_name). */
function fullNameFromEmail(email: string): string {
  const local = email.split('@')[0] || email;
  return local.slice(0, 255);
}

/**
 * Inserta en `users` los usuarios definidos en AUTH_USERS. Idempotente: los
 * emails ya presentes se ignoran (ON CONFLICT DO NOTHING). No modifica usuarios
 * existentes ni sus roles/estados.
 */
export async function seedUsersFromEnv(pool: Pool): Promise<void> {
  const seedUsers = parseAuthUsers(process.env.AUTH_USERS);
  if (seedUsers.length === 0) return;

  for (const user of seedUsers) {
    await pool.query(
      `INSERT INTO portal.users (full_name, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (email) DO NOTHING`,
      [fullNameFromEmail(user.email), user.email, user.passwordHash, user.role],
    );
  }
}
