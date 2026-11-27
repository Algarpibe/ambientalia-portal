import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireApp, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached } from '../cache.js';
import { leerHechosZoho, nitBase, type HechosZoho } from './clientes.js';

const APP_ID = 'laboratorios-ambientales';
export const CLAVE_CACHE = 'laboratorios:clientes';

/** Tope de NIT por petición. La app envía unos 85; con el límite por usuario, deja el barrido en unos 750 NIT por minuto. */
export const MAX_NITS = 150;

// Por usuario: la app hace una petición al abrir la vista y otra por cada «Reintentar».
export const LIMITE_CLIENTES = { windowMs: 60_000, max: 5 } as const;

export interface ClienteZoho extends HechosZoho {
  nit: string;
}

function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

/**
 * Los NIT base pedidos, sin repetir, o null si el cuerpo no vale: `nits` tiene
 * que ser una lista de como mucho MAX_NITS textos, y cada uno tiene que dar un
 * NIT base de 6 a 10 dígitos.
 */
export function leerNits(cuerpo: unknown): string[] | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const nits = (cuerpo as { nits?: unknown }).nits;
  if (!Array.isArray(nits) || nits.length > MAX_NITS) return null;
  const base = new Set<string>();
  for (const nit of nits) {
    if (typeof nit !== 'string') return null;
    const b = nitBase(nit);
    if (b === null) return null;
    base.add(b);
  }
  return [...base];
}

/**
 * Cruce de los prospectos de la app de Laboratorios ambientales con Zoho Books.
 * El cruce completo se calcula una vez y se cachea, pero cada respuesta lleva
 * solo los NIT pedidos. El servidor no sabe qué NIT son prospectos: el freno al
 * barrido es el volumen, MAX_NITS por petición y LIMITE_CLIENTES por usuario.
 */
export function createLaboratoriosRouter(db: Pool): Router {
  const router = Router();

  // Va detrás de requireAuth: la clave es el usuario, no la IP (el límite global de /api/ es por IP).
  const limite = rateLimit({
    ...LIMITE_CLIENTES,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_requests' },
    keyGenerator: (req) => String(getPayload(req)?.user_id ?? req.ip ?? 'anonimo'),
  });

  router.post('/laboratorios/clientes', requireAuth, requireApp(APP_ID), limite, async (req: Request, res: Response) => {
    try {
      const nits = leerNits(req.body);
      if (nits === null) return void res.status(400).json({ error: 'nits inválidos' });
      const hechos = await cached(CLAVE_CACHE, () => leerHechosZoho(db));
      const clientes: ClienteZoho[] = [];
      for (const nit of nits) {
        const h = hechos.get(nit);
        // Campo a campo, y no con un spread: la respuesta lleva estos cuatro y
        // ninguno más, aunque HechosZoho creciera.
        if (h) clientes.push({ nit, ultimaFactura: h.ultimaFactura, ocmaVendido: h.ocmaVendido, ultimosRepuestos: h.ultimosRepuestos });
      }
      res.json({ clientes });
    } catch (e) {
      sendError(res, e, 'laboratorios_clientes');
    }
  });

  return router;
}
