import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, requireAdmin, requireCronToken, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { festivosColombia } from './festivos.js';
import { contarDiasHabiles } from './dias-habiles.js';
import { validarEdicionSolicitud } from './historico.js';
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
      // El saldo es un campo accesorio de un payload que la app necesita para
      // arrancar: si `saldoDeSesion` lanza, se registra el error pero NO se deja
      // que tumbe el contexto entero, o nadie podría ni abrir la app (sin
      // `empleado`, sin `festivos`, sin `esAprobador`). `null` ya es un valor
      // legítimo del contrato («no hay saldo que enseñar»), así que la app
      // arranca con la tarjeta de saldo vacía en vez de no arrancar. Es la
      // decisión contraria a la de GET /ausencias/saldos (ver su JSDoc), y a
      // propósito: allí el saldo ES la respuesta entera, así que camuflar un
      // fallo con una lista incompleta sería mentir por omisión; aquí es un
      // extra dentro de un contexto que tiene que arrancar de todos modos.
      let saldo: Awaited<ReturnType<typeof service.saldoDeSesion>> | null = null;
      if (empleado) {
        try {
          saldo = await service.saldoDeSesion(db, empleado);
        } catch (e) {
          console.error('ausencias_contexto_saldo error', e);
          captureError(e, { endpoint: 'ausencias_contexto_saldo' });
        }
      }
      res.json({
        empleado,
        // El nombre de quien aprueba, para poder decir «Fulano recibirá el aviso»
        // en vez de soltarle un buzón a quien manda la solicitud. Null si ese
        // correo no tiene ficha activa —el aprobador por defecto puede no
        // tenerla—, y entonces la app cae de vuelta al correo.
        aprobadorNombre: empleado ? await repo.nombreDeCorreo(db, empleado.aprobadorCorreo) : null,
        // El correo de la sesión: si no hay ficha de empleado, la UI lo enseña
        // para que se sepa exactamente qué correo hay que dar de alta.
        email: sesion.email,
        esAdmin: sesion.esAdmin,
        // Se deduce del maestro, no se declara en ningún sitio: alguien puede
        // ser aprobador de otros sin estar dado de alta como empleado.
        esAprobador: sesion.esAdmin || (await repo.esAprobadorDeAlguien(db, sesion.email)),
        // Pliega admin dentro, igual que `esAprobador`: así la app decide la
        // pestaña con un solo booleano y no replica la regla en el navegador.
        esVisorAdjuntos: sesion.esAdmin || (await repo.esVisorDeAdjuntos(db, sesion.email)),
        festivos,
        // Viaja aquí y no en un endpoint aparte para que el formulario pueda
        // enseñar el saldo sin una segunda llamada al abrir la app.
        saldo,
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

  /**
   * El historial de decisiones de quien pregunta. Sin `requireAdmin` y sin guard
   * de aprobador: va acotado a su propio correo, así que quien no apruebe a nadie
   * recibe una lista vacía en vez de un 403 que no aportaría nada.
   */
  router.get('/ausencias/decididas', ...gated, async (req: Request, res: Response) => {
    try {
      res.json({ solicitudes: await service.decididasPorMi(db, sesionDe(req)) });
    } catch (e) {
      sendError(res, e, 'ausencias_decididas');
    }
  });

  router.post('/ausencias/solicitudes/:id/decision', ...gated, async (req: Request, res: Response) => {
    try {
      res.json(await service.decidir(db, sesionDe(req), req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_decision');
    }
  });

  /**
   * El dueño pide que se le cambien las fechas o se le anule una solicitud ya
   * enviada. Bajo `...gated` y sin `requireAdmin`: es la vía del TRABAJADOR, y
   * el servicio comprueba que la solicitud sea suya. Un admin que quiera
   * corregir una fila a mano tiene el `PATCH`, que no manda correos.
   */
  router.post('/ausencias/solicitudes/:id/modificaciones', ...gated, async (req: Request, res: Response) => {
    try {
      res.status(201).json(await service.pedirModificacion(db, sesionDe(req), req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_pedir_modificacion');
    }
  });

  /**
   * El autor se echa atrás.
   *
   * `POST .../retirar` y NO `DELETE /modificaciones/:id`: la fila no se borra,
   * pasa a `retirada` y sigue ahí. Un `DELETE` que no borra sorprende a quien
   * lea este router dentro de seis meses.
   */
  router.post('/ausencias/modificaciones/:id/retirar', ...gated, async (req: Request, res: Response) => {
    try {
      res.json(await service.retirarModificacion(db, sesionDe(req), req.params.id));
    } catch (e) {
      sendError(res, e, 'ausencias_retirar_modificacion');
    }
  });

  /**
   * La bandeja de cambios del jefe.
   *
   * Sin `requireAdmin` y sin guard de aprobador, igual que `/ausencias/decididas`:
   * va acotada al propio correo, así que quien no tenga ninguna propuesta que
   * decidir recibe una lista vacía en vez de un 403 que no aportaría nada.
   *
   * Devuelve `solicitudes`, cada una con su `modificacionPendiente` colgada por
   * el `LEFT JOIN`: la propuesta sola no dice de quién es ni de qué tipo, y una
   * bandeja hecha con propuestas sueltas necesitaría una consulta por fila.
   *
   * Cada fila trae `puedoDecidirla`, el `esMiTurno` de esta bandeja: puede ser
   * `false` (la raíz del organigrama sobre su propia solicitud, o un admin que
   * las ve todas), y entonces la fila se pinta apagada en vez de ofrecer un
   * botón que responde 403.
   */
  router.get('/ausencias/modificaciones/pendientes', ...gated, async (req: Request, res: Response) => {
    try {
      res.json({ solicitudes: await service.modificacionesPendientes(db, sesionDe(req)) });
    } catch (e) {
      sendError(res, e, 'ausencias_modificaciones_pendientes');
    }
  });

  /**
   * El jefe aprueba o rechaza el cambio. Mismo cuerpo que la decisión de una
   * solicitud (`{ aprueba, motivo? }`) para que la interfaz reutilice el código.
   *
   * Decide una sola persona: el decisor congelado en la propuesta, o un admin.
   * No hay segunda firma para la modificación.
   */
  router.post('/ausencias/modificaciones/:id/decision', ...gated, async (req: Request, res: Response) => {
    try {
      res.json(await service.decidirModificacion(db, sesionDe(req), req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_decidir_modificacion');
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

  /**
   * Las solicitudes con PDF, para administración. Bajo `...gated` y con el 403 en
   * el servicio, como `/ausencias/saldos`: quién puede verlo es una regla de
   * negocio (`portal.empleados.ve_adjuntos`), no un rol del portal.
   */
  router.get('/ausencias/adjuntos', ...gated, async (req: Request, res: Response) => {
    try {
      res.json({ solicitudes: await service.solicitudesConAdjunto(db, sesionDe(req)) });
    } catch (e) {
      sendError(res, e, 'ausencias_adjuntos');
    }
  });

  router.get('/ausencias/adjuntos/:id', ...gated, async (req: Request, res: Response) => {
    try {
      const adjunto = await repo.adjuntoPorId(db, req.params.id);
      if (!adjunto) return void res.status(404).json({ error: 'no_encontrado' });
      const sesion = sesionDe(req);
      if (!service.puedeVerAdjunto(sesion, adjunto, await repo.esVisorDeAdjuntos(db, sesion.email))) {
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

  /** El maestro con el árbol ya resuelto: cada fila trae su segunda firma. */
  router.get('/ausencias/empleados', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({ empleados: await service.empleadosConJefatura(db) });
    } catch (e) {
      sendError(res, e, 'ausencias_empleados');
    }
  });

  /**
   * Cambia el jefe inmediato de alguien. No manda ningún correo, igual que fijar
   * el saldo: mover el organigrama no es decidir nada sobre una solicitud.
   *
   * Las solicitudes ya en vuelo NO se mueven: llevan sus dos firmantes congelados
   * desde el alta.
   */
  router.put('/ausencias/empleados/:id/jefe', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarJefe(db, req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_jefe');
    }
  });

  /**
   * Cambia a quién se pone en copia de los correos de alguien. No manda ningún
   * correo, igual que cambiar el jefe o fijar el saldo: configurar no es decidir
   * nada sobre una solicitud.
   *
   * Al contrario que los firmantes, la copia NO se congela en el alta: se lee al
   * notificar, así que este cambio afecta también a las solicitudes que ya estén
   * en trámite. Es lo que se quiere — corregir una copia mal puesta tiene que
   * arreglar lo que aún no ha salido.
   */
  router.put('/ausencias/empleados/:id/copia', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarCopia(db, req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_copia');
    }
  });

  /**
   * Enciende o apaga la segunda firma de alguien. Solo admin.
   *
   * Las solicitudes ya en vuelo NO se mueven: cada una lleva congelado desde el
   * alta si su segundo nivel firma o solo se entera del resultado.
   */
  router.put('/ausencias/empleados/:id/segunda-firma', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarSegundaFirma(db, req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_segunda_firma');
    }
  });

  /**
   * Da o quita la llave maestra de los adjuntos. Solo admin, y **queda
   * registrado**: es lo único que dice quién dio acceso a datos de salud desde
   * que la lista salió del código.
   */
  router.put('/ausencias/empleados/:id/visor', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarVisor(db, sesionDe(req), req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_visor');
    }
  });

  // ── Histórico de la hoja (solo admin) ───────────────────────────────────

  /**
   * Importa el histórico leído del Excel en el navegador. Con `dryRun: true` no
   * escribe: devuelve el mismo recuento para que la UI lo enseñe antes.
   */
  router.post('/ausencias/historico/import', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.importarHistorico(db, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_historico_import');
    }
  });

  /** Todas las solicitudes de la compañía: la vista que sustituye a la hoja. */
  router.get('/ausencias/historico', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({ solicitudes: await repo.todasLasSolicitudes(db) });
    } catch (e) {
      sendError(res, e, 'ausencias_historico');
    }
  });

  /**
   * Corrige una solicitud del registro. No manda correos: para aprobar o
   * rechazar está la bandeja, que es donde sí se avisa. Ver repo.actualizarSolicitud.
   */
  router.patch('/ausencias/solicitudes/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const campos = validarEdicionSolicitud(req.body);
      const actualizada = await repo.actualizarSolicitud(db, req.params.id, campos);
      // Sin fila: o no existe la solicitud, o el empleado al que se reasigna no
      // existe. Los dos son un 404 desde el punto de vista de quien llama.
      if (!actualizada) return void res.status(404).json({ error: 'no_encontrada' });
      console.log(
        JSON.stringify({
          event: 'ausencias_solicitud_editada',
          timestamp: new Date().toISOString(),
          adminEmail: sesionDe(req).email,
          solicitudId: actualizada.id,
          empleado: actualizada.empleadoNombre,
          tipo: actualizada.tipo,
          fechas: `${actualizada.fechaInicio}..${actualizada.fechaFin}`,
          dias: actualizada.diasHabiles,
          estado: actualizada.estado,
        }),
      );
      res.json(actualizada);
    } catch (e) {
      sendError(res, e, 'ausencias_editar_solicitud');
    }
  });

  /**
   * Borra una solicitud. Es irreversible y toca el registro de la compañía, así
   * que queda constancia de quién la borró y de qué era: no hay tabla de
   * auditoría en el proyecto, pero el log de hub-api sí se conserva.
   */
  router.delete('/ausencias/solicitudes/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const borrada = await repo.borrarSolicitud(db, req.params.id);
      if (!borrada) return void res.status(404).json({ error: 'no_encontrada' });
      console.log(
        JSON.stringify({
          event: 'ausencias_solicitud_borrada',
          timestamp: new Date().toISOString(),
          adminEmail: sesionDe(req).email,
          solicitudId: borrada.id,
          empleado: borrada.empleadoNombre,
          tipo: borrada.tipo,
          fechas: `${borrada.fechaInicio}..${borrada.fechaFin}`,
          origen: borrada.origen,
        }),
      );
      res.json({ ok: true, borrada });
    } catch (e) {
      sendError(res, e, 'ausencias_borrar_solicitud');
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

  // ── Saldos ───────────────────────────────────────────────────────────────

  /**
   * El saldo de quien pregunta, y nada más. Existe para el widget del dashboard
   * del portal: `/ausencias/contexto` ya trae este dato, pero arrastra con él los
   * festivos de tres años y dos consultas más que un indicador no necesita, y la
   * home del portal lo pagaría en cada carga.
   *
   * Mantiene el `asegurarEmpleado` del contexto a sabiendas de que es un UPSERT
   * dentro de un GET. Es idempotente, y sin él quien acaba de ser dado de alta
   * vería «sin configurar» en el widget hasta la primera vez que abriera la app
   * — un mensaje que le mandaría a administración sin que hubiera nada que
   * arreglar.
   *
   * Si el cálculo lanza sale un 500, no un saldo en blanco: aquí el saldo ES la
   * respuesta. Mismo criterio que `/ausencias/saldos` y el contrario al de
   * `/ausencias/contexto` (ver el JSDoc de las dos).
   */
  router.get('/ausencias/mi-saldo', ...gated, async (req: Request, res: Response) => {
    try {
      const sesion = sesionDe(req);
      const empleado = await repo.asegurarEmpleado(db, sesion.userId, sesion.email);
      res.json({ saldo: empleado ? await service.saldoDeSesion(db, empleado) : null });
    } catch (e) {
      sendError(res, e, 'ausencias_mi_saldo');
    }
  });

  /**
   * Los saldos que quien pregunta puede ver: todos si es admin, y solo los de la
   * gente que aprueba si no lo es. Sirve a la bandeja y al panel de saldos.
   *
   * Nota sobre el 500: `service.saldosVisibles` recorre a TODA la plantilla
   * visible y `calcularSaldo` lanza si una fila tuviera una fecha corrupta en
   * BD; eso convierte esa fila envenenada en un 500 para la lista entera, vía
   * el `sendError` genérico de abajo (no se filtra el detalle al cliente, pero
   * el correo del empleado sí queda en el mensaje que llega a Sentry). Se deja
   * así a propósito: `calcularSaldo` ya elige lanzar en vez de devolver un
   * saldo en blanco por la misma razón (ver su JSDoc), y enmascarar la fila
   * mala aquí con datos parciales reintroduciría justo ese silencio para una
   * cifra financiera. Saltar solo esa fila y reportarla (como hace
   * `importarHistorico`) sería el arreglo correcto, pero vive en `combinar()`
   * de service.ts, fuera del alcance de este cambio.
   */
  router.get('/ausencias/saldos', ...gated, async (req: Request, res: Response) => {
    try {
      res.json({ saldos: await service.saldosVisibles(db, sesionDe(req)) });
    } catch (e) {
      sendError(res, e, 'ausencias_saldos');
    }
  });

  /** Fija el punto de corte de un empleado. No manda ningún correo. */
  router.put('/ausencias/empleados/:id/saldo', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarSaldo(db, req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_saldo');
    }
  });

  /**
   * El calendario de un mes. Sigue bajo `...gated` y no `requireAdmin` porque la
   * pestaña la abre cualquiera, pero **el contenido sí va acotado por rol**: un
   * admin ve a toda la plantilla y el resto solo su propia fila. El recorte lo
   * hace el servicio, en el SQL — ver `calendarioDelMes`.
   */
  router.get('/ausencias/calendario', ...gated, async (req: Request, res: Response) => {
    try {
      res.json(await service.calendarioDelMes(db, sesionDe(req), String(req.query.mes ?? '')));
    } catch (e) {
      sendError(res, e, 'ausencias_calendario');
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

  // Aquí estaba `GET /ausencias/n8n/adjunto/:id`, que servía el PDF crudo para que
  // n8n lo subiera a Drive. Se retiró con la copia a Drive: el adjunto se consulta
  // desde el portal (`GET /ausencias/adjuntos/:id`), con permisos de verdad.

  router.post('/ausencias/n8n/confirmado', cronAuth, async (req: Request, res: Response) => {
    try {
      // El cuerpo llevaba también un `adjuntos: [{id, driveFileId}]` opcional. Se
      // ignora sin protestar en vez de rechazarlo: un workflow antiguo que alguien
      // reactive tiene que poder seguir confirmando, que es lo único que importa.
      const body = req.body as { ids?: unknown } | undefined;
      const ids = Array.isArray(body?.ids)
        ? (body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      if (ids.length === 0) return void res.status(400).json({ error: 'ids requeridos' });

      res.json({ confirmados: await repo.confirmarEventos(db, ids) });
    } catch (e) {
      sendError(res, e, 'ausencias_n8n_confirmado');
    }
  });

  return router;
}
