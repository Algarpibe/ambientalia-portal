import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { festivosDelEje } from './plazos.js';
import * as repo from './repo.js';
import {
  TzError,
  esClave,
  parseAvisos,
  parseImportacion,
  parseNumeroTicket,
  parsePlazo,
  parseSeguimiento,
  parseTipoManual,
  type Actor,
} from './types.js';

// Router de «Trazabilidad Mantenimientos Clientes» (GRIMM EDM 180). Se monta
// bajo /api. Sin cached(): el seguimiento cambia con cada aviso que se registra.
//
// Permisos: cualquiera con la app asignada lee, importa, registra seguimiento,
// cambia los plazos y pone a mano el tipo de servicio de un ticket; cada
// importación y cada cambio quedan firmados con el correo de quien lo hizo
// (tmc_importaciones, tmc_seguimiento.actualizado_por,
// tmc_plazos.actualizado_por, tmc_servicios_tipo.actualizado_por).

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
  // pinta el calendario de barras, para que la app sombree los días no hábiles;
  // `tipos`, los que se pueden elegir a mano para un ticket.
  const servicios = async (hoy: string) => {
    const [lista, tipos] = await Promise.all([repo.listarServicios(db, hoy), repo.listarTiposServicio(db)]);
    return { hoy, servicios: lista, festivos: festivosDelEje(hoy, lista.map((s) => s.fechaLimite)), tipos };
  };

  router.get(
    '/trazabilidad/servicios',
    ...gated,
    route('tmc_servicios', (req) => servicios(hoyOf(req))),
  );

  // Tipo de servicio puesto a mano a un ticket: {tipo}; null o vacío lo quita
  // y vuelve a valer el de Desk. Devuelve lo mismo que el GET, ya actualizado:
  // un cambio de tipo mueve fecha límite, contadores y festivos del eje.
  router.put(
    '/trazabilidad/servicios/:numero/tipo',
    ...gated,
    route('tmc_servicio_tipo', async (req) => {
      const numero = parseNumeroTicket(req.params.numero);
      const { tipo } = parseTipoManual(req.body);
      const hoy = hoyOf(req);
      await repo.fijarTipoServicio(db, numero, tipo, actorOf(req));
      return servicios(hoy);
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
