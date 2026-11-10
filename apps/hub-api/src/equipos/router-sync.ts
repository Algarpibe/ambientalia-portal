/**
 * Rutas por las que n8n («Equipos · Sincronizar remisiones») manda la copia de Drive
 * (§3.3 del diseño, revisión del 10/11/2026). Se montan bajo /api, dentro del router de
 * «Equipos en taller». NO llevan sesión: las protege el token de máquina
 * (`EQUIPOS_SYNC_TOKEN`, cabecera `X-Equipos-Sync-Token`; sin la variable, 401 a todo),
 * con el mismo patrón que WO-sales y Ausencias.
 *
 *   POST /equipos-taller/sync/listado  ← { pasada, carpeta, archivos: [{ id, titulo }] }  → 200 { faltaTexto } · 409
 *   POST /equipos-taller/sync/texto    ← { id, texto } | { id, error: { status } }        → 204 · 404
 *   POST /equipos-taller/sync/fin      ← { pasada, conteos }                              → 200 { ok } · 404 · 409
 *
 * 400 si el cuerpo no vale, con un mensaje fijo que nunca repite lo recibido. Un error
 * nuestro es un 500 genérico y va a Sentry.
 */
import { Router, type Request, type Response } from 'express';
import { requireCronToken } from '../auth.js';
import { captureError } from '../sentry.js';
import type { RepoSync } from './repo-sync.js';
import { validarFin, validarListado, validarTexto } from './sync.js';

const tokenSync = requireCronToken({ env: 'EQUIPOS_SYNC_TOKEN', header: 'X-Equipos-Sync-Token' });

export function createEquiposSyncRouter(sync: RepoSync): Router {
  const router = Router();
  const ruta = (ctx: string, fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`${ctx} error`, e);
      captureError(e, { endpoint: ctx });
      res.status(500).json({ error: 'internal error' });
    }
  };
  const invalido = (res: Response, message: string) => {
    res.status(400).json({ error: 'invalid_input', message });
  };
  const pasadaCerrada = { error: 'pasada_cerrada', message: 'Esa pasada ya terminó' };

  router.post('/equipos-taller/sync/listado', tokenSync, ruta('equipos_sync_listado', async (req, res) => {
    const v = validarListado(req.body);
    if (!v.ok) return invalido(res, v.error);
    const r = await sync.registrarListado(v.valor.pasada, v.valor.carpeta, v.valor.archivos);
    if (r.estado === 'ok') res.json({ faltaTexto: r.faltaTexto });
    else if (r.estado === 'pasada_cerrada') res.status(409).json(pasadaCerrada);
    else if (r.estado === 'pasada_en_curso') res.status(409).json({ error: 'pasada_en_curso', message: 'Hay otra pasada sin terminar' });
    else {
      res.status(409).json({
        error: 'listado_sospechoso',
        message: 'El listado borraría ' + r.bajas + ' de ' + r.vivos + ' archivos de la carpeta: no se aplica',
        bajas: r.bajas,
        vivos: r.vivos,
      });
    }
  }));

  router.post('/equipos-taller/sync/texto', tokenSync, ruta('equipos_sync_texto', async (req, res) => {
    const v = validarTexto(req.body);
    if (!v.ok) return invalido(res, v.error);
    if (await sync.guardarTexto(v.valor.id, v.valor.resultado)) res.status(204).end();
    else res.status(404).json({ error: 'desconocido', message: 'Ese archivo no está en la copia (o su carpeta no lleva texto)' });
  }));

  router.post('/equipos-taller/sync/fin', tokenSync, ruta('equipos_sync_fin', async (req, res) => {
    const v = validarFin(req.body);
    if (!v.ok) return invalido(res, v.error);
    const r = await sync.cerrarPasada(v.valor.pasada, v.valor.conteos);
    if (r === 'cerrada') res.json({ ok: true });
    else if (r === 'desconocida') res.status(404).json({ error: 'pasada_desconocida', message: 'No hay ninguna pasada con ese id' });
    else if (r === 'ya_cerrada') res.status(409).json(pasadaCerrada);
    else if (r === 'tardia') res.status(409).json({ error: 'pasada_tardia', message: 'La pasada tardó demasiado y se descartó; empiece otra' });
    else res.status(409).json({ error: 'pasada_incompleta', message: 'Falta el listado de alguna carpeta' });
  }));

  return router;
}
