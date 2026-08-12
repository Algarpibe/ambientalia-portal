import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, requireAdmin, requireCronToken, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { festivosColombia } from './festivos.js';
import { contarDiasHabiles } from './dias-habiles.js';
import * as repo from './repo.js';
import * as service from './service.js';
import { AusenciaError, type Sesion } from './service.js';

// Router de la app «Vacaciones y Permisos». Sustituye al flujo de n8n
// «Solicitud vacaciones_permisos_compensatorios_incapacidades 1.5».
//
// NO se usa cached(): son datos transaccionales. Una bandeja de aprobación que
// enseña el estado de hace dos minutos hace que alguien apruebe dos veces.

const APP_ID = 'ausencias';

/** Auth máquina-a-máquina para n8n, con su propio secreto y su propia cabecera. */
const cronAuth = requireCronToken({ env: 'AUSENCIAS_CRON_TOKEN', header: 'X-Ausencias-Cron-Token' });

/**
 * Traduce a HTTP. Un AusenciaError es un error del que llama y viaja tal cual
 * (con su código y su campo); cualquier otra cosa es un fallo nuestro y se
 * reporta a Sentry como 500 genérico, sin filtrar detalles internos.
 */
function sendError(res: Response, e: unknown, ctx: string): void {
  if (e instanceof AusenciaError) {
    res.status(e.status).json({ error: e.code, field: e.field });
    return;
  }
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

function sesionDe(req: Request): Sesion {
  const p = getPayload(req);
  return {
    email: String(p?.sub ?? '').toLowerCase(),
    userId: p?.user_id ? String(p.user_id) : null,
    esAdmin: p?.role === 'admin',
  };
}

export function createAusenciasRouter(db: Pool): Router {
  const router = Router();
  const gated = [requireAuth, requireApp(APP_ID)] as const;

  /**
   * Todo lo que la app necesita al arrancar: quién soy como empleado, si tengo
   * bandeja de aprobación y los festivos con los que el formulario calcula los
   * días hábiles en vivo. Se mandan los del año en curso y los dos siguientes
   * para que una solicitud a caballo entre años no descuadre el contador.
   */
  router.get('/ausencias/contexto', ...gated, async (req: Request, res: Response) => {
    try {
      const sesion = sesionDe(req);
      // Escribe en un GET, a sabiendas: si la ficha no se creara aquí, la app
      // cargaría sin las pestañas de solicitud y el usuario no tendría forma de
      // entender por qué. Es un upsert idempotente, no un efecto sorpresa.
      const empleado = await repo.asegurarEmpleado(db, sesion.userId, sesion.email);
      const anio = new Date().getUTCFullYear();
      const festivos = [anio, anio + 1, anio + 2].flatMap((a) => [...festivosColombia(a)]).sort();
      res.json({
        empleado,
        // El correo de la sesión: si no hay ficha de empleado, la UI lo enseña
        // para que se sepa exactamente qué correo hay que dar de alta.
        email: sesion.email,
        esAdmin: sesion.esAdmin,
        // Se deduce del maestro, no se declara en ningún sitio: alguien puede
        // ser aprobador de otros sin estar dado de alta como empleado.
        esAprobador: sesion.esAdmin || (await repo.esAprobadorDeAlguien(db, sesion.email)),
        festivos,
      });
    } catch (e) {
      sendError(res, e, 'ausencias_contexto');
    }
  });

  router.post('/ausencias/solicitudes', ...gated, async (req: Request, res: Response) => {
    try {
      const solicitud = await service.crearSolicitud(db, sesionDe(req), req.body);
      res.status(201).json(solicitud);
    } catch (e) {
      sendError(res, e, 'ausencias_crear');
    }
  });

  router.get('/ausencias/mis-solicitudes', ...gated, async (req: Request, res: Response) => {
    try {
      res.json({ solicitudes: await service.misSolicitudes(db, sesionDe(req)) });
    } catch (e) {
      sendError(res, e, 'ausencias_mis_solicitudes');
    }
  });

  router.get('/ausencias/pendientes', ...gated, async (req: Request, res: Response) => {
    try {
      res.json({ solicitudes: await service.pendientesDeAprobar(db, sesionDe(req)) });
    } catch (e) {
      sendError(res, e, 'ausencias_pendientes');
    }
  });

  router.post('/ausencias/solicitudes/:id/decision', ...gated, async (req: Request, res: Response) => {
    try {
      res.json(await service.decidir(db, sesionDe(req), req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_decision');
    }
  });

  /** Días hábiles de un rango. El formulario lo usa para el contador en vivo. */
  router.get('/ausencias/dias-habiles', ...gated, (req: Request, res: Response) => {
    try {
      const desde = String(req.query.desde ?? '');
      const hasta = String(req.query.hasta ?? '');
      res.json({ diasHabiles: contarDiasHabiles(desde, hasta) });
    } catch (e) {
      // Aquí un error solo puede venir de un rango mal formado: es un 400, no un 500.
      res.status(400).json({ error: 'rango_invalido', detalle: (e as Error).message });
    }
  });

  router.get('/ausencias/adjuntos/:id', ...gated, async (req: Request, res: Response) => {
    try {
      const adjunto = await repo.adjuntoPorId(db, req.params.id);
      if (!adjunto) return void res.status(404).json({ error: 'no_encontrado' });
      if (!service.puedeVerAdjunto(sesionDe(req), adjunto)) {
        // 404 y no 403: quien no tiene nada que ver con la solicitud tampoco
        // debería poder confirmar que ese adjunto existe.
        return void res.status(404).json({ error: 'no_encontrado' });
      }
      res.setHeader('Content-Type', adjunto.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${adjunto.nombreArchivo}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(adjunto.contenido);
    } catch (e) {
      sendError(res, e, 'ausencias_adjunto');
    }
  });

  // ── Maestro de empleados (solo admin) ────────────────────────────────────

  router.get('/ausencias/empleados', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({ empleados: await repo.listarEmpleados(db) });
    } catch (e) {
      sendError(res, e, 'ausencias_empleados');
    }
  });

  router.post('/ausencias/empleados/import', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const filas = service.validarFilasEmpleados(req.body);
      res.json(await repo.importarEmpleados(db, filas));
    } catch (e) {
      sendError(res, e, 'ausencias_empleados_import');
    }
  });

  /** Alta en bloque desde los usuarios del portal que ya tienen la app asignada. */
  router.post('/ausencias/empleados/sincronizar', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await repo.sincronizarDesdeUsuarios(db, APP_ID));
    } catch (e) {
      sendError(res, e, 'ausencias_empleados_sincronizar');
    }
  });

  // ── Para n8n (auth por token de cron, no JWT) ────────────────────────────
  //
  // Mismo contrato que WO-sales: /pendiente entrega el trabajo SIN darlo por
  // hecho, y solo /confirmado avanza el estado. Si Gmail falla a mitad, el
  // ciclo siguiente lo reintenta.

  router.get('/ausencias/n8n/pendiente', cronAuth, async (_req: Request, res: Response) => {
    try {
      const eventos = await repo.eventosPendientes(db);
      res.json({ hay: eventos.length > 0, eventos });
    } catch (e) {
      sendError(res, e, 'ausencias_n8n_pendiente');
    }
  });

  /** El PDF crudo, para que n8n lo suba a Drive sin pasarlo por base64 en JSON. */
  router.get('/ausencias/n8n/adjunto/:id', cronAuth, async (req: Request, res: Response) => {
    try {
      const adjunto = await repo.adjuntoPorId(db, req.params.id);
      if (!adjunto) return void res.status(404).json({ error: 'no_encontrado' });
      res.setHeader('Content-Type', adjunto.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${adjunto.nombreArchivo}"`);
      res.send(adjunto.contenido);
    } catch (e) {
      sendError(res, e, 'ausencias_n8n_adjunto');
    }
  });

  router.post('/ausencias/n8n/confirmado', cronAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body as { ids?: unknown; adjuntos?: unknown } | undefined;
      const ids = Array.isArray(body?.ids)
        ? (body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      if (ids.length === 0) return void res.status(400).json({ error: 'ids requeridos' });

      // Opcional: los ficheros que n8n acaba de dejar en Drive. Guardar el id
      // permite localizarlos después aunque alguien mueva la carpeta.
      if (Array.isArray(body?.adjuntos)) {
        for (const a of body.adjuntos as { id?: unknown; driveFileId?: unknown }[]) {
          if (typeof a?.id === 'string' && typeof a?.driveFileId === 'string') {
            await repo.marcarAdjuntoEnDrive(db, a.id, a.driveFileId);
          }
        }
      }

      res.json({ confirmados: await repo.confirmarEventos(db, ids) });
    } catch (e) {
      sendError(res, e, 'ausencias_n8n_confirmado');
    }
  });

  return router;
}
