/**
 * Rutas de «Equipos en taller» (§3.3 del diseño). Se montan bajo /api; todas van
 * detrás de `requireAuth` + `requireApp('equipos-taller')` (los admin pasan).
 *
 *   GET    /equipos-taller                  foto, ajustes, corridas, incidente, configuración y permisos
 *   POST   /equipos-taller/actualizar       202 · 409 si ya corre · 503 sin configurar
 *   PUT    /equipos-taller/ajustes/:clave   ← { t, m? }   (edita_ajustes o admin)
 *   DELETE /equipos-taller/ajustes/:clave   204           (edita_ajustes o admin)
 *   GET    /equipos-taller/llaves           (admin)
 *   PUT    /equipos-taller/llaves/:userId   ← { editaAjustes, recibeAlertas } (admin)
 *   POST   /equipos-taller/sync/{listado,texto,fin}   n8n, con token de máquina y sin sesión (router-sync.ts)
 *
 * Express 4: un rechazo de promesa no llega solo al manejador de errores, así que
 * cada ruta va envuelta (`ruta`). Un error nuestro es 500 genérico y Sentry; nunca
 * detalles internos.
 */
import { Router, type Request, type Response } from 'express';
import { getPayload, requireApp, requireAuth } from '../auth.js';
import { captureError } from '../sentry.js';
import { ajusteValido, APP_ID, claveValida, type RespuestaEquipos } from './contrato.js';
import { MINUTOS_ABANDONO, type RepoEquipos } from './repo.js';
import type { ServicioEquipos } from './servicio.js';
import type { RepoSync } from './repo-sync.js';
import { createEquiposSyncRouter } from './router-sync.js';

export interface DepsRouter {
  repo: RepoEquipos;
  servicio: ServicioEquipos;
  /** La copia de Drive que manda n8n. */
  sync: RepoSync;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErrorRuta extends Error {
  readonly status: number;
  readonly cuerpo: Record<string, unknown>;
  constructor(status: number, cuerpo: Record<string, unknown>) {
    super(String(cuerpo.error));
    this.status = status;
    this.cuerpo = cuerpo;
  }
}

/** Una corrida «en curso» más vieja que el plazo de abandono es una huérfana (el proceso murió): no bloquea. */
const enCursoVigente = (c: { enCurso: boolean; inicio: string } | null): boolean =>
  c?.enCurso === true && Date.now() - Date.parse(c.inicio) < MINUTOS_ABANDONO * 60_000;

export function createEquiposTallerRouter(deps: DepsRouter): Router {
  const router = Router();
  // Las rutas de n8n: sin sesión ni app; las guarda su token (EQUIPOS_SYNC_TOKEN).
  router.use(createEquiposSyncRouter(deps.sync));
  const gated = [requireAuth, requireApp(APP_ID)] as const;
  const quien = (req: Request) => {
    const p = getPayload(req);
    return { userId: p?.user_id ? String(p.user_id) : null, email: String(p?.sub ?? '').toLowerCase(), esAdmin: p?.role === 'admin' };
  };
  const ruta = (ctx: string, fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorRuta) {
        res.status(e.status).json(e.cuerpo);
        return;
      }
      console.error(`${ctx} error`, e);
      captureError(e, { endpoint: ctx });
      res.status(500).json({ error: 'internal error' });
    }
  };
  /** Ajustes: la llave `edita_ajustes` o ser admin. */
  const exigirEditar = async (req: Request) => {
    const q = quien(req);
    if (q.esAdmin) return q;
    if (!(await deps.repo.llavesDe(q.userId)).editaAjustes) throw new ErrorRuta(403, { error: 'sin_llave', message: 'Hace falta la llave «edita ajustes».' });
    return q;
  };
  const exigirAdmin = (req: Request) => {
    const q = quien(req);
    if (!q.esAdmin) throw new ErrorRuta(403, { error: 'forbidden' });
    return q;
  };

  router.get('/equipos-taller', ...gated, ruta('equipos_estado', async (req, res) => {
    const q = quien(req);
    // `ultima` es la última corrida TERMINADA: si fuera la que está en curso, el aviso de foto vieja
    // desaparecería mientras corre (hasta 180 min tras una caída). «actualizando» sí mira la que corre.
    const [snap, ajustes, enCurso, ultima, ultimaBuena, incidente, llaves, configurado] = await Promise.all([
      deps.repo.leerFoto(), deps.repo.leerAjustes(), deps.repo.ultimaCorrida(), deps.repo.ultimaCorridaTerminada(), deps.repo.ultimaCorridaBuena(), deps.repo.incidenteAbierto(), deps.repo.llavesDe(q.userId), deps.servicio.configurado(),
    ]);
    const cuerpo: RespuestaEquipos = {
      snap,
      ajustes,
      actualizando: deps.servicio.actualizando() || enCursoVigente(enCurso),
      configurado,
      ultima,
      ultimaBuena,
      // El error de la alerta puede traer detalle del webhook: solo lo ve un admin.
      incidente: incidente && !q.esAdmin ? { ...incidente, alertaUltimoError: null } : incidente,
      permisos: { ...llaves, esAdmin: q.esAdmin, puedeEditar: q.esAdmin || llaves.editaAjustes },
    };
    res.set('Cache-Control', 'no-store').json(cuerpo);
  }));

  router.post('/equipos-taller/actualizar', ...gated, ruta('equipos_actualizar', async (req, res) => {
    const e = await deps.servicio.lanzar('boton', quien(req).userId);
    if (e === 'sin_configurar') res.status(503).json({ error: 'sin_configurar', message: 'Falta la primera sincronización con n8n' });
    else if (e === 'ocupado') res.status(409).json({ estado: 'ocupado', message: 'Ya se está actualizando' });
    else res.status(202).json({ estado: 'iniciada' });
  }));

  router.put('/equipos-taller/ajustes/:clave', ...gated, ruta('equipos_ajuste_guardar', async (req, res) => {
    const q = await exigirEditar(req);
    const clave = String(req.params.clave);
    const b = (req.body ?? {}) as { t?: unknown; m?: unknown };
    if (!ajusteValido(clave, b.t) || (b.m !== undefined && typeof b.m !== 'string')) throw new ErrorRuta(400, { error: 'invalid_input', message: 'Ajuste no válido' });
    const ajuste = await deps.repo.guardarAjuste(clave, { t: b.t, m: (b.m ?? '').slice(0, 300) }, { userId: q.userId, usuario: q.email });
    res.json({ ajuste });
  }));

  router.delete('/equipos-taller/ajustes/:clave', ...gated, ruta('equipos_ajuste_borrar', async (req, res) => {
    await exigirEditar(req);
    const clave = String(req.params.clave);
    if (!claveValida(clave)) throw new ErrorRuta(400, { error: 'invalid_input', message: 'Clave no válida' });
    await deps.repo.borrarAjuste(clave);
    res.status(204).end();
  }));

  router.get('/equipos-taller/llaves', ...gated, ruta('equipos_llaves_listar', async (req, res) => {
    exigirAdmin(req);
    res.set('Cache-Control', 'no-store').json(await deps.repo.listarLlaves());
  }));

  router.put('/equipos-taller/llaves/:userId', ...gated, ruta('equipos_llaves_guardar', async (req, res) => {
    const q = exigirAdmin(req);
    const userId = String(req.params.userId);
    const b = (req.body ?? {}) as { editaAjustes?: unknown; recibeAlertas?: unknown };
    if (!UUID.test(userId) || typeof b.editaAjustes !== 'boolean' || typeof b.recibeAlertas !== 'boolean') {
      throw new ErrorRuta(400, { error: 'invalid_input', message: 'Llaves no válidas' });
    }
    const u = await deps.repo.guardarLlaves(userId, { editaAjustes: b.editaAjustes, recibeAlertas: b.recibeAlertas }, q.email);
    if (!u) throw new ErrorRuta(404, { error: 'not_found', message: 'Usuario no encontrado' });
    res.json(u);
  }));

  return router;
}
