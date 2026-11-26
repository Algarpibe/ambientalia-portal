import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached } from '../cache.js';
import { leerHechosZoho, nitBase, type HechosZoho } from './clientes.js';

const APP_ID = 'laboratorios-ambientales';
const CACHE_KEY = 'laboratorios:clientes';

/** Tope de NIT por petición. La app envía unos 85. */
export const MAX_NITS = 500;

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
 * solo los NIT pedidos: desde aquí no se puede sacar la lista de clientes.
 */
export function createLaboratoriosRouter(db: Pool): Router {
  const router = Router();

  router.post('/laboratorios/clientes', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    const nits = leerNits(req.body);
    if (nits === null) return void res.status(400).json({ error: 'nits inválidos' });
    try {
      const hechos = await cached(CACHE_KEY, () => leerHechosZoho(db));
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
