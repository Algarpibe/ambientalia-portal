/**
 * La ÚNICA ruta que acepta la llave de kiosco de la TV (§4a del diseño, amenazas T1–T8):
 *
 *   GET /equipos-taller/kiosco/tablero     cabecera X-Kiosk-Token: tvk_…     → 200 RespuestaTablero · 401 · 405 · 429
 *
 * La cadena, en este orden: cabeceras (no-store, no-referrer) → límite de 10 por minuto y IP →
 * solo GET → ni rastro de la llave en la URL → formato de la llave (sin tocar la base) → búsqueda
 * por resumen en la base, EN CADA petición (una llave revocada falla en la siguiente) → tablero.
 * Cualquier fallo de la llave es el MISMO 401 con el mismo cuerpo (no dice si faltaba, estaba mal
 * formada, no existe o fue revocada). La identidad va solo en `res.locals.kiosco`: aquí NO se
 * rellena `req.user`, así que ninguna otra ruta (todas piden JWT) acepta esta llave. El token no
 * se escribe en ningún registro.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { captureError } from '../sentry.js';
import { formatoToken, type ServicioTablero } from './servicio-tablero.js';

export const RUTA_KIOSCO = '/equipos-taller/kiosco/tablero';
/** 10 por minuto y IP: el sondeo de 60 s de varias TV cabe de sobra; una inundación o un tanteo no. */
export const LIMITE_KIOSCO = { windowMs: 60_000, max: 10 } as const;
/** Cualquier rastro de una llave en la URL (también codificada): se rechaza para que no acabe en logs ni en el Referer. */
const LLAVE_EN_URL = /tvk(_|%5f)/i;

export function createEquiposKioscoRouter(servicio: Pick<ServicioTablero, 'validarKiosco' | 'tableroKiosco'>): Router {
  const router = Router();
  const sinAcceso = (res: Response) => res.status(401).json({ error: 'unauthorized' });

  const cabeceras = (_req: Request, res: Response, next: NextFunction) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  };
  const limite = rateLimit({ ...LIMITE_KIOSCO, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests' } });
  const soloGet = (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET') return next();
    res.set('Allow', 'GET').status(405).json({ error: 'method_not_allowed' });
  };
  const guardia = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.header('X-Kiosk-Token');
      if (LLAVE_EN_URL.test(req.originalUrl) || !token || !formatoToken.test(token)) return sinAcceso(res);
      const kiosco = await servicio.validarKiosco(token);
      if (!kiosco) return sinAcceso(res);
      res.locals.kiosco = kiosco;
      next();
    } catch (e) {
      falla(res, e);
    }
  };
  /** Un error nuestro es un 500 genérico: nunca el mensaje (puede traer datos de la base) ni la llave. */
  const falla = (res: Response, e: unknown) => {
    console.error('equipos_kiosco_tablero error (' + String((e as { name?: unknown } | null)?.name ?? 'desconocido').slice(0, 40) + ')');
    captureError(e, { endpoint: 'equipos_kiosco_tablero' });
    res.status(500).json({ error: 'internal error' });
  };

  router.all(RUTA_KIOSCO, cabeceras, limite, soloGet, guardia, async (_req: Request, res: Response) => {
    try {
      res.json(await servicio.tableroKiosco(Date.now()));
    } catch (e) {
      falla(res, e);
    }
  });

  return router;
}
