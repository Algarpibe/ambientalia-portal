import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { festivosDelEje } from './plazos.js';
import * as repo from './repo.js';
import { TzError, esClave, parseAvisos, parseImportacion, parsePlazo, parseSeguimiento, type Actor } from './types.js';

// Router de «Trazabilidad Mantenimientos Clientes» (GRIMM EDM 180). Se monta
// bajo /api. Sin cached(): el seguimiento cambia con cada aviso que se registra.
//
// Permisos: cualquiera con la app asignada lee, importa, registra seguimiento
// y cambia los plazos; cada importación y cada cambio quedan firmados con el
// correo de quien lo hizo (tmc_importaciones, tmc_seguimiento.actualizado_por,
// tmc_plazos.actualizado_por).

export const APP_ID = 'trazabilidad-mantenimientos';

function sendError(res: Response, e: unknown, ctx: string): void {
  if (e instanceof TzError) {
    res.status(e.status).json({ error: e.code, message: e.messageEs, field: e.field });
    return;
  }
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

function actorOf(req: Request): Actor {
  const p = getPayload(req);
  return { userId: p?.user_id ? String(p.user_id) : null, email: String(p?.sub ?? '').toLowerCase() };
}

/** ?hoy=AAAA-MM-DD para consultar a otra fecha; por defecto, hoy en Colombia. */
function hoyOf(req: Request): string {
  const h = req.query.hoy;
  if (h === undefined) return hoyEnColombia();
  if (typeof h !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(h)) {
    throw new TzError('invalid_input', 400, 'La fecha «hoy» no es válida (AAAA-MM-DD).', 'hoy');
  }
  return h;
}

export function createTrazabilidadRouter(db: Pool): Router {
  const router = Router();
  const gated = [requireAuth, requireApp(APP_ID)] as const;

  const route =
    (ctx: string, fn: (req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        res.json(await fn(req));
      } catch (e) {
        sendError(res, e, ctx);
      }
    };

  router.get(
    '/trazabilidad/equipos',
    ...gated,
    route('tmc_equipos', async (req) => {
      const hoy = hoyOf(req);
      const [equipos, ultimaImportacion] = await Promise.all([repo.listarEquipos(db, hoy), repo.ultimaImportacion(db)]);
      return { hoy, equipos, ultimaImportacion };
    }),
  );

  // ?simular=1 devuelve el recuento (nuevos / actualizados / retirados) sin escribir nada.
  router.post(
    '/trazabilidad/importaciones',
    ...gated,
    route('tmc_importar', async (req) => {
      const imp = parseImportacion(req.body);
      return repo.importar(db, imp, actorOf(req), req.query.simular === '1');
    }),
  );

  router.put(
    '/trazabilidad/seguimiento/:clave',
    ...gated,
    route('tmc_seguimiento', async (req) => {
      const clave = req.params.clave;
      if (!esClave(clave)) throw new TzError('invalid_input', 400, 'Clave de equipo no válida.', 'clave');
      await repo.guardarSeguimiento(db, clave, parseSeguimiento(req.body), actorOf(req));
      return { ok: true };
    }),
  );

  router.post(
    '/trazabilidad/avisos',
    ...gated,
    route('tmc_avisos', async (req) => {
      const { claves, fecha } = parseAvisos(req.body);
      return { actualizados: await repo.registrarAvisos(db, claves, fecha, actorOf(req)) };
    }),
  );

  // Tickets de Desk sin cerrar con su plazo. `festivos` son los del tramo que
  // pinta el calendario de barras, para que la app sombree los días no hábiles.
  router.get(
    '/trazabilidad/servicios',
    ...gated,
    route('tmc_servicios', async (req) => {
      const hoy = hoyOf(req);
      const servicios = await repo.listarServicios(db, hoy);
      return { hoy, servicios, festivos: festivosDelEje(hoy, servicios.map((s) => s.fechaLimite)) };
    }),
  );

  router.get(
    '/trazabilidad/plazos',
    ...gated,
    route('tmc_plazos', async () => ({ plazos: await repo.listarPlazos(db) })),
  );

  // Un tipo de servicio por petición: {tipo, dias}; dias vacío = sin plazo.
  // Devuelve la lista entera ya actualizada.
  router.put(
    '/trazabilidad/plazos',
    ...gated,
    route('tmc_plazo', async (req) => {
      await repo.guardarPlazo(db, parsePlazo(req.body), actorOf(req));
      return { plazos: await repo.listarPlazos(db) };
    }),
  );

  return router;
}
