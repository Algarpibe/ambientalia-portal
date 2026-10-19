import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { captureError } from './sentry.js';

/**
 * INFRA-532 — `GET /health`, el único endpoint anónimo que toca la BD.
 *
 * Antes hacía tres `count(*)` sobre `crm.deals`, `books.invoices` y
 * `desk.tickets`: un recorrido completo de cada tabla por llamada, en el mismo
 * pool que usan el login y `requireAuth`. Y como vive fuera de `/api/`, no lo
 * cubría el limitador global. Martillearlo sin credenciales bastaba para dejar
 * sin conexiones a todo el backend (la cadena INFRA-532 → DATA-331).
 *
 * Ahora pregunta al catálogo (`to_regclass`), que contesta sin leer ninguna
 * fila, y lleva su propio límite por IP. Sigue fallando si falta alguno de los
 * tres esquemas de la réplica, que es lo que el `count(*)` comprobaba de rebote.
 */

/** Llamadas por minuto y por IP. Sobra para un monitor; corta un bucle. */
export const HEALTH_MAX_POR_MINUTO = 30;

/** Lo único que necesita del pool. Se pasa como función para no crearlo antes de `initDb`. */
type Consultable = { query: (sql: string) => Promise<{ rows: unknown[] }> };

const SQL_SALUD = `SELECT to_regclass('crm.deals') IS NOT NULL
                      AND to_regclass('books.invoices') IS NOT NULL
                      AND to_regclass('desk.tickets') IS NOT NULL AS ok`;

export function createHealthRouter(db: () => Consultable): Router {
  const router = Router();
  router.get(
    '/health',
    rateLimit({ windowMs: 60_000, max: HEALTH_MAX_POR_MINUTO, standardHeaders: true, legacyHeaders: false }),
    async (_req, res) => {
      try {
        const { rows } = await db().query(SQL_SALUD);
        if ((rows[0] as { ok?: boolean } | undefined)?.ok !== true) {
          throw new Error('faltan esquemas de la réplica (crm/books/desk)');
        }
        res.json({ ok: true });
      } catch (e) {
        // Endpoint anónimo: el error crudo del driver puede llevar el host. Se
        // apunta en el servidor y fuera sale un mensaje fijo.
        console.error('health check failed', e);
        captureError(e, { endpoint: 'health' });
        res.status(500).json({ ok: false, error: 'hub unreachable' });
      }
    },
  );
  return router;
}
