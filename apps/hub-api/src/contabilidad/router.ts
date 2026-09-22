import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, requireAdmin, getPayload, userHasApp } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached, clearCache, clearCacheKey } from '../cache.js';
import { getContabilidadData, upsertCartera, upsertBudget, ANIO_MINIMO } from './source.js';
import { getOVPendientesFacturables, type OVPendienteFacturable } from './ovPendientes.js';
import { getFacturasPorEntregar } from './entregasPendientes.js';
import { getDetalleFactura, getDetalleOV, type DetalleOV } from './detalle.js';
import { getAnticiposEnlazados, conAnticipo, type AnticiposEnlazados, type AnticipoDeOV } from './anticipos.js';

const APP_ID = 'contabilidad';
const CACHE_KEY = 'contabilidad:facturas';
const CARTERA_MAX = 1000; // tope defensivo para una nota de texto libre
const APP_ID_OV = 'ov-pendientes'; // app que solo ve el listado de OV pendientes
const ANIO_DEFECTO = 2026;

// El año se acota por abajo a ANIO_MINIMO: los datos anteriores están incompletos en la
// réplica y no deben consultarse ni siquiera manipulando la URL (?year=2020).
function parseAnio(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < ANIO_MINIMO || n > 2100) return null;
  return n;
}

function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

const CACHE_ANTICIPOS = 'contabilidad:anticipos';

// Los anticipos son información de cobro: solo los ve quien tiene Contabilidad, o un admin.
// La app `ov-pendientes` existe precisamente para quien no debe ver la facturación, así que a
// ella ni siquiera se le envían. Usa `userHasApp`, la misma regla que aplica `requireApp`, para
// que las dos no puedan divergir en silencio si esa regla cambia.
function veAnticipos(req: Request): boolean {
  return userHasApp(getPayload(req), APP_ID);
}

function logAnticiposError(e: unknown): void {
  console.error('contabilidad_anticipos error', e);
  captureError(e, { endpoint: 'contabilidad_anticipos' });
}

async function leerAnticipos(db: Pool): Promise<AnticiposEnlazados> {
  return cached(CACHE_ANTICIPOS, () => getAnticiposEnlazados(db));
}

// Los anticipos NUNCA pueden tumbar la tabla de OV ni su detalle. La promesa cubre la lectura
// Y la fusión posterior: las dos van dentro del MISMO try/catch, así que un fallo en
// cualquiera de las dos (p. ej. el worker aún no creó books.retainer_invoices, o algo
// inesperado en conAnticipo) degrada a "sin anticipos" en vez de tumbar la respuesta entera.
// Antes solo la lectura estaba protegida; la fusión corría fuera, dentro únicamente del
// try/catch genérico del handler, que sí convierte cualquier excepción en un 500 para toda
// la respuesta — derrotando la promesa para el caso en que fallara justo la fusión.
async function ordenesConAnticipo(
  db: Pool,
  orders: OVPendienteFacturable[],
  req: Request,
): Promise<OVPendienteFacturable[]> {
  if (!veAnticipos(req)) return orders;
  try {
    const enl = await leerAnticipos(db);
    // conAnticipo devuelve copias: `orders` es el array cacheado que comparten las dos apps.
    return orders.map((o) => conAnticipo(o, enl));
  } catch (e) {
    logAnticiposError(e);
    return orders;
  }
}

// Misma barrera que ordenesConAnticipo, para el detalle de una OV.
async function detalleConAnticipos(
  db: Pool,
  detalle: DetalleOV,
  req: Request,
): Promise<DetalleOV | (DetalleOV & { anticipos: AnticipoDeOV[] })> {
  if (!veAnticipos(req)) return detalle;
  try {
    const enl = await leerAnticipos(db);
    return { ...detalle, anticipos: enl.porOV.get(detalle.numero)?.anticipos ?? [] };
  } catch (e) {
    logAnticiposError(e);
    return detalle;
  }
}

export function createContabilidadRouter(db: Pool): Router {
  const router = Router();

  router.get('/contabilidad/facturas', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const anio = req.query.year === undefined ? ANIO_DEFECTO : parseAnio(req.query.year);
      if (anio === null) return void res.status(400).json({ error: 'year inválido' });
      const data = await cached(`${CACHE_KEY}:${anio}`, () => getContabilidadData(db, anio));
      res.json(data);
    } catch (e) {
      sendError(res, e, 'contabilidad_facturas');
    }
  });

  router.put('/contabilidad/cartera/:invoiceNumber', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const cartera = (req.body as { cartera?: unknown }).cartera;
      if (typeof cartera !== 'string') {
        return void res.status(400).json({ error: 'cartera (string) requerido' });
      }
      if (cartera.length > CARTERA_MAX) {
        return void res.status(400).json({ error: `cartera demasiado larga (máx ${CARTERA_MAX} caracteres)` });
      }
      const userId = getPayload(req)?.user_id ?? null;
      await upsertCartera(db, req.params.invoiceNumber, cartera, userId ? String(userId) : null);
      clearCache(); // invalida todo el cache; no conocemos aquí el año de la factura
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, 'contabilidad_cartera');
    }
  });

  router.put('/contabilidad/budget/:year', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const anio = parseAnio(req.params.year);
      if (anio === null) return void res.status(400).json({ error: 'year inválido' });
      const presupuesto = (req.body as { presupuesto?: unknown }).presupuesto;
      if (typeof presupuesto !== 'number' || !Number.isFinite(presupuesto) || presupuesto < 0) {
        return void res.status(400).json({ error: 'presupuesto (number >= 0) requerido' });
      }
      const userId = getPayload(req)?.user_id ?? null;
      await upsertBudget(db, anio, presupuesto, userId ? String(userId) : null);
      clearCacheKey(`${CACHE_KEY}:${anio}`);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, 'contabilidad_budget');
    }
  });

  router.get('/contabilidad/ov-pendientes', requireAuth, requireApp(APP_ID, APP_ID_OV), async (req: Request, res: Response) => {
    try {
      const orders = await cached('contabilidad:ov-pendientes', () => getOVPendientesFacturables(db));
      res.json({ orders: await ordenesConAnticipo(db, orders, req) });
    } catch (e) {
      sendError(res, e, 'contabilidad_ov_pendientes');
    }
  });

  // Parte de trabajo para bodega: SOLO las facturas con mercancía sin empaquetar. Sin
  // importes ni cartera, porque lo consume también la app `ov-pendientes`, asignada a
  // quien no debe ver la facturación.
  router.get('/contabilidad/facturas-por-entregar', requireAuth, requireApp(APP_ID, APP_ID_OV), async (_req: Request, res: Response) => {
    try {
      const facturas = await cached('contabilidad:facturas-por-entregar', () => getFacturasPorEntregar(db));
      res.json({ facturas });
    } catch (e) {
      sendError(res, e, 'contabilidad_facturas_por_entregar');
    }
  });

  router.get('/contabilidad/factura/:numero', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const d = await getDetalleFactura(db, req.params.numero);
      if (!d) return void res.status(404).json({ error: 'factura no encontrada' });
      res.json(d);
    } catch (e) {
      sendError(res, e, 'contabilidad_detalle_factura');
    }
  });

  router.get('/contabilidad/ov/:numero', requireAuth, requireApp(APP_ID, APP_ID_OV), async (req: Request, res: Response) => {
    try {
      const d = await getDetalleOV(db, req.params.numero);
      if (!d) return void res.status(404).json({ error: 'ov no encontrada' });
      res.json(await detalleConAnticipos(db, d, req));
    } catch (e) {
      sendError(res, e, 'contabilidad_detalle_ov');
    }
  });

  // Anticipos que no se pudieron enlazar con una OV, o con saldo sin aplicar en una OV ya
  // cerrada. Solo Contabilidad: es información de cobro.
  router.get('/contabilidad/anticipos-atencion', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try {
      const enl = await cached(CACHE_ANTICIPOS, () => getAnticiposEnlazados(db));
      res.json({ anticipos: enl.atencion });
    } catch (e) {
      sendError(res, e, 'contabilidad_anticipos_atencion');
    }
  });

  return router;
}
