import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { getDesk2Pool } from '../db-desk2.js';
import { crearFuenteAgenda, recuentoPorEstado, type FuenteAgenda } from './fuente.js';
import { festivosDelEje } from './plazos.js';
import { registrarEstadosSinFallar } from './registro-estados.js';
import * as repo from './repo.js';
import { ETIQUETA_ROL_APP, permisosDe, puede, resolverRol, type Permiso, type RolApp } from './roles.js';
import {
  TzError,
  esClave,
  parseAvisos,
  parseContacto,
  parseEstadoDesk,
  parseImportacion,
  parseNumeroTicket,
  parsePlazo,
  parseRolApp,
  parseSeguimiento,
  parseTipoManual,
  parseUserId,
  type Actor,
  type MiRol,
} from './types.js';

// Router de «Trazabilidad Mantenimientos Clientes» (GRIMM EDM 180). Se monta
// bajo /api. Sin cached(): el seguimiento cambia con cada aviso que se registra.
//
// Permisos: leer (los GET) está abierto a cualquiera con la app asignada. Cada
// ruta que escribe pide además un permiso de la matriz de roles.ts, según el
// rol de la persona en portal.tmc_user_roles (sin fila = LECTOR, que no cambia
// nada): se registra con `escritura(permiso, …)`, que lo comprueba antes de
// validar y antes de cualquier consulta de negocio, y responde 403 en español.
// Los administradores del portal lo pueden todo y son los únicos que reparten
// roles (`soloAdmin`). router.test.ts falla si una ruta que escribe se registra
// sin una de las dos. Cada importación y cada cambio quedan firmados con el
// correo de quien lo hizo (tmc_importaciones, tmc_seguimiento.actualizado_por,
// tmc_plazos.actualizado_por, tmc_servicios_tipo.actualizado_por,
// tmc_estados_desk.actualizado_por, tmc_contactos.actualizado_por,
// tmc_user_roles.actualizado_por).

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

/** Administrador del portal: lo dice la base en cada petición (requireAuth pisa el `role` del token). */
function esAdminPortal(req: Request): boolean {
  return getPayload(req)?.role === 'admin';
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

/**
 * `fuente` es de dónde lee la agenda del taller (fuente.ts). Por defecto, la
 * base de Desk 2.0 si hay `DESK2_DB_URL` y, si no (o si falla), la réplica de
 * `db`; las pruebas pasan la suya.
 */
export function createTrazabilidadRouter(db: Pool, fuente: FuenteAgenda = crearFuenteAgenda({ hub: db, desk2: getDesk2Pool })): Router {
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

  /** El rol de quien pide, leído de portal.tmc_user_roles. Sin fila (o sin id en el token) es LECTOR. */
  const rolDe = async (req: Request): Promise<RolApp> => {
    const { userId } = actorOf(req);
    return userId ? resolverRol(await repo.rolDeUsuario(db, userId)) : resolverRol(null);
  };

  /**
   * Una ruta que escribe: antes de nada —de validar y de cualquier consulta de
   * negocio— comprueba que quien pide tiene ese permiso. Un administrador del
   * portal pasa sin que haga falta mirar su rol.
   */
  const escritura = (permiso: Permiso, ctx: string, fn: (req: Request) => Promise<unknown>) =>
    route(ctx, async (req) => {
      if (!esAdminPortal(req)) {
        const rol = await rolDe(req);
        if (!puede(rol, permiso)) {
          throw new TzError('forbidden_role', 403, `Tu rol en Trazabilidad (${ETIQUETA_ROL_APP[rol]}) no permite hacer este cambio. Pide a un administrador del portal que te asigne el rol que necesitas.`);
        }
      }
      return fn(req);
    });

  /** Una ruta de reparto de roles: sólo para administradores del portal, tenga quien pide el rol que tenga. */
  const soloAdmin = (ctx: string, fn: (req: Request) => Promise<unknown>) =>
    route(ctx, async (req) => {
      if (!esAdminPortal(req)) {
        throw new TzError('forbidden_admin', 403, 'Sólo un administrador del portal puede ver y repartir los roles de Trazabilidad.');
      }
      return fn(req);
    });

  // ── Roles ────────────────────────────────────────────────────────────────

  // Quién soy en la app: mi rol y lo que puedo hacer. Con `permissions` la app
  // oculta o desactiva lo que no toca; la guarda de verdad es `escritura`.
  router.get(
    '/trazabilidad/roles/me',
    ...gated,
    route('tmc_roles_me', async (req): Promise<MiRol> => {
      const { userId, email } = actorOf(req);
      const admin = esAdminPortal(req);
      const role = await rolDe(req);
      return { userId: userId ?? '', email, role, admin, permissions: permisosDe(role, admin), canManageRoles: admin };
    }),
  );

  // La gente con la app (más quien ya tiene rol y los administradores) y su rol.
  router.get(
    '/trazabilidad/roles',
    ...gated,
    soloAdmin('tmc_roles', async () => ({ usuarios: await repo.listarUsuariosRol(db, APP_ID) })),
  );

  // Pone el rol de una persona: {role}. LECTOR también se guarda (queda quién lo dejó así).
  // A un administrador del portal no se le pone rol: ya lo puede todo, así que
  // el rol no cambiaría nada y quedaría un dato que engaña (409).
  router.put(
    '/trazabilidad/roles/:userId',
    ...gated,
    soloAdmin('tmc_rol', async (req) => {
      const userId = parseUserId(req.params.userId);
      const { role } = parseRolApp(req.body);
      const usuario = await repo.usuarioPortal(db, userId);
      if (!usuario) throw new TzError('not_found', 404, 'Ese usuario no existe en el portal.');
      if (usuario.admin) {
        throw new TzError('usuario_admin', 409, 'Esa persona es administrador del portal: ya tiene todos los permisos y no lleva rol en esta app.');
      }
      await repo.guardarRol(db, userId, role, actorOf(req));
      return { userId, role };
    }),
  );

  // El inventario: equipos con su estado, su seguimiento, su ticket abierto y
  // su contacto, más los contactos puestos a mano a clientes (`contactos`), que
  // la app necesita enteros para simular a quién iría cada aviso.
  const inventario = async (hoy: string) => {
    const [equipos, ultimaImportacion, contactos] = await Promise.all([repo.listarEquipos(db, hoy), repo.ultimaImportacion(db), repo.listarContactos(db)]);
    return { hoy, equipos, ultimaImportacion, contactos };
  };

  router.get(
    '/trazabilidad/equipos',
    ...gated,
    route('tmc_equipos', async (req) => inventario(hoyOf(req))),
  );

  // Contacto puesto a mano a un cliente: {cliente, emails[], nombre?}; con
  // `emails` vacío se quita y vuelve a valer el de Desk. Devuelve lo mismo que
  // el GET de equipos, ya actualizado. Sólo guarda a quién se le escribiría:
  // esta API no manda ningún correo (el aviso automático es una simulación).
  router.put(
    '/trazabilidad/contactos',
    ...gated,
    escritura('contactos.write', 'tmc_contacto', async (req) => {
      const cambio = parseContacto(req.body);
      const hoy = hoyOf(req);
      await repo.guardarContacto(db, cambio, actorOf(req));
      return inventario(hoy);
    }),
  );

  // ?simular=1 devuelve el recuento (nuevos / actualizados / retirados) sin escribir nada.
  router.post(
    '/trazabilidad/importaciones',
    ...gated,
    escritura('importar', 'tmc_importar', async (req) => {
      const imp = parseImportacion(req.body);
      return repo.importar(db, imp, actorOf(req), req.query.simular === '1');
    }),
  );

  router.put(
    '/trazabilidad/seguimiento/:clave',
    ...gated,
    escritura('seguimiento.write', 'tmc_seguimiento', async (req) => {
      const clave = req.params.clave;
      if (!esClave(clave)) throw new TzError('invalid_input', 400, 'Clave de equipo no válida.', 'clave');
      await repo.guardarSeguimiento(db, clave, parseSeguimiento(req.body), actorOf(req));
      return { ok: true };
    }),
  );

  router.post(
    '/trazabilidad/avisos',
    ...gated,
    escritura('avisos.write', 'tmc_avisos', async (req) => {
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

  // Antes de leer se apuntan los cambios de estado de los tickets, para que las
  // pausas estén al día sin esperar a la pasada del programador. Es «si se
  // puede»: si falla se apunta el error y la petición sigue con lo que haya.
  // No repite una pasada recién hecha ni se solapa con la del programador
  // (registro-estados.ts).
  router.get(
    '/trazabilidad/servicios',
    ...gated,
    route('tmc_servicios', async (req) => {
      const hoy = hoyOf(req);
      await registrarEstadosSinFallar(db);
      return servicios(hoy);
    }),
  );

  // Tipo de servicio puesto a mano a un ticket: {tipo}; null o vacío lo quita
  // y vuelve a valer el de Desk. Devuelve lo mismo que el GET, ya actualizado:
  // un cambio de tipo mueve fecha límite, contadores y festivos del eje.
  router.put(
    '/trazabilidad/servicios/:numero/tipo',
    ...gated,
    escritura('servicios.tipo.write', 'tmc_servicio_tipo', async (req) => {
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
    escritura('config.write', 'tmc_plazo', async (req) => {
      await repo.guardarPlazo(db, parsePlazo(req.body), actorOf(req));
      return { plazos: await repo.listarPlazos(db) };
    }),
  );

  // Estados de Desk y su rol en el reloj del plazo: cuenta, standby (en pausa:
  // a la espera del cliente o de un servicio externo) o terminado (parado: el
  // trabajo técnico está hecho). «Servicios» lo aplica al calcular el plazo.
  router.get(
    '/trazabilidad/estados',
    ...gated,
    route('tmc_estados', async () => ({ estados: await repo.listarEstadosDesk(db) })),
  );

  // Un estado por petición: {estado, rol}. Devuelve la lista entera ya actualizada.
  router.put(
    '/trazabilidad/estados',
    ...gated,
    escritura('config.write', 'tmc_estado', async (req) => {
      await repo.guardarEstadoDesk(db, parseEstadoDesk(req.body), actorOf(req));
      return { estados: await repo.listarEstadosDesk(db) };
    }),
  );

  // ── Agenda del taller ────────────────────────────────────────────────────

  // Diagnóstico de la fuente: cuál contesta (Desk 2.0 o la réplica de
  // respaldo) y por qué, su última sincronización y cuántos tickets abiertos
  // hay en cada estado. Sólo recuentos: ni clientes, ni seriales, ni correos.
  // Si Desk 2.0 no contesta responde igual, con el respaldo y su motivo; del
  // error sólo sale el motivo, nunca su texto ni la URL de la conexión.
  router.get(
    '/trazabilidad/agenda/fuente',
    ...gated,
    route('tmc_agenda_fuente', async () => {
      const tickets = await fuente.ticketsAbiertos();
      const estado = await fuente.estadoFuente();
      return { ...estado, abiertos: { total: tickets.length, porEstado: recuentoPorEstado(tickets) } };
    }),
  );

  return router;
}
