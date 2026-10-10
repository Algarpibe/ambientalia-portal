import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp, getPayload } from '../auth.js';
import { captureError } from '../sentry.js';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { getDesk2Pool } from '../db-desk2.js';
import { detallesDeTickets, huecosDeEtapa, proyectarAgenda, type RespuestaAgenda } from './agenda.js';
import { ejeAgenda } from './agenda-calendario.js';
import { esFechaIso } from './dominio.js';
import { crearFuenteAgenda, recuentoPorEstado, type FuenteAgenda } from './fuente.js';
import { crearLectorMaestro, type LectorMaestro } from './maestro-desk2.js';
import { leerCruceFst022, leerPlanMaestro, sincronizarMaestro } from './maestro-repo.js';
import { festivosDelEje } from './plazos.js';
import { agendaAlDia, registrarEstadosSinFallar } from './registro-estados.js';
import * as repo from './repo.js';
import { ETIQUETA_ROL_APP, permisosDe, puede, resolverRol, type Permiso, type RolApp } from './roles.js';
import {
  TzError,
  esClave,
  parseAsignacion,
  parseAvisos,
  parseCategoriaEstado,
  parseContacto,
  parseDuracionEtapa,
  parseEstadoDesk,
  parseFlujoManual,
  parseHuecos,
  parseHuellaPlan,
  parseLiberacion,
  parseNumeroTicket,
  parsePaginaFst022,
  parsePlazo,
  parsePuestosEtapa,
  parseReparto,
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
// sin una de las dos (o con `retirada`, que no deja pasar a nadie: la subida
// de la Excel, que se quitó el 10/10/2026). Cada cambio queda firmado con el
// correo de quien lo hizo (tmc_seguimiento.actualizado_por,
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
 * El «hoy» de la agenda: como `hoyOf`, y además tiene que ser un día que
 * exista (un 30 de febrero haría proyectar sobre una fecha imposible).
 */
function hoyAgenda(req: Request): string {
  const hoy = hoyOf(req);
  if (!esFechaIso(hoy)) throw new TzError('invalid_input', 400, 'La fecha «hoy» no es válida (AAAA-MM-DD).', 'hoy');
  return hoy;
}

/** Cuántas entradas próximas da GET /agenda/huecos. */
export const HUECOS_PROXIMOS = 5;

export type { RespuestaAgenda };

const AVISO_PASADA_FALLIDA = {
  codigo: 'pasada_fallida',
  mensaje: 'No se pudo comprobar si algún ticket ha cambiado de estado: la agenda puede no estar al día (una asignación de un ticket que ya salió de su etapa puede seguir vigente). Se reintenta sola.',
} as const;

/**
 * `fuente` es de dónde lee la agenda del taller (fuente.ts). Por defecto, la
 * base de Desk 2.0 si hay `DESK2_DB_URL` y, si no (o si falla), la réplica de
 * `db`; las pruebas pasan la suya. `maestro` lee el maestro de equipos de esa
 * misma base de Desk 2.0 (maestro-desk2.ts), aparte de la fuente: no comparten
 * estado, y sin la variable o si falla no hay maestro (nada lo sustituye).
 */
export function createTrazabilidadRouter(db: Pool, fuente: FuenteAgenda = crearFuenteAgenda({ hub: db, desk2: getDesk2Pool }), maestro: LectorMaestro = crearLectorMaestro(getDesk2Pool)): Router {
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
   * Una ruta que pide un permiso: antes de nada —de validar y de cualquier
   * consulta de negocio— comprueba que quien pide lo tiene. Un administrador
   * del portal pasa sin que haga falta mirar su rol. Toda ruta que escribe se
   * registra con su alias `escritura`; `conPermiso`, con ese nombre, es para
   * la única lectura que lo pide (la propuesta de reparto).
   */
  const conPermiso = (permiso: Permiso, ctx: string, fn: (req: Request) => Promise<unknown>) =>
    route(ctx, async (req) => {
      if (!esAdminPortal(req)) {
        const rol = await rolDe(req);
        if (!puede(rol, permiso)) {
          throw new TzError('forbidden_role', 403, `Tu rol en Trazabilidad (${ETIQUETA_ROL_APP[rol]}) no permite hacer este cambio. Pide a un administrador del portal que te asigne el rol que necesitas.`);
        }
      }
      return fn(req);
    });
  const escritura = conPermiso;

  /** Una ruta de reparto de roles: sólo para administradores del portal, tenga quien pide el rol que tenga. */
  const soloAdmin = (ctx: string, fn: (req: Request) => Promise<unknown>) =>
    route(ctx, async (req) => {
      if (!esAdminPortal(req)) {
        throw new TzError('forbidden_admin', 403, 'Sólo un administrador del portal puede ver y repartir los roles de Trazabilidad.');
      }
      return fn(req);
    });

  /**
   * Una ruta retirada: no deja pasar a nadie —tampoco a un administrador— y
   * no mira el cuerpo, el rol ni la base. Sólo contesta 410, en español.
   */
  const retirada = (ctx: string) =>
    route(ctx, async () => {
      throw new TzError('subida_retirada', 410, 'La subida de la Excel F-ST-022 se retiró el 10/10/2026: la hoja está congelada y ya no se importa ni se vuelve a congelar. Lo congelado se consulta en «Administración» → «Configuración».');
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

  // ── F-ST-022: la Excel ya no se sube (retirada el 10/10/2026) ────────────
  //
  // La hoja quedó congelada (tablas tmc_fst022_*) y es el punto de partida
  // firmado: ni se importa ni se vuelve a congelar. Las dos rutas siguen
  // registradas sólo para decírselo, con un 410, a un portal sin actualizar;
  // no hay código detrás que valide ni escriba. El 410 va tras la sesión y la
  // app (401 / 403 como siempre) y vale también con ?simular=1.
  router.post('/trazabilidad/importaciones', ...gated, retirada('tmc_importar'));
  router.post('/trazabilidad/fst022/congelaciones', ...gated, retirada('tmc_fst022_congelar'));

  // Todas las congelaciones, la más reciente primero: metadatos y recuentos.
  router.get(
    '/trazabilidad/fst022/congelaciones',
    ...gated,
    route('tmc_fst022_congelaciones', async () => ({ congelaciones: await repo.listarCongelaciones(db) })),
  );

  // La vigente con sus cabeceras y sus filas, por páginas (?desde=&limite=, 500 por defecto y 1000 como mucho).
  router.get(
    '/trazabilidad/fst022/congelaciones/vigente',
    ...gated,
    route('tmc_fst022_vigente', async (req) => repo.congelacionVigente(db, parsePaginaFst022(req.query))),
  );

  // ── Maestro de equipos desde Desk 2.0 (lote 9b) ──────────────────────────
  //
  // El inventario (tmc_equipos) se alimenta de `desk.equipos`, sólo los GRIMM
  // EDM 180 y sólo A MANO: primero se ve el plan y después, quien puede, lo
  // aplica. No hay sincronización automática ni programador.

  // El plan en recuentos, si el maestro contesta (y si no, por qué: 200 igual)
  // y la última sincronización. Abierto a quien tenga la app: ni clientes ni
  // seriales. A quien puede sincronizar le llega además `detalle`, los cambios
  // uno a uno (con cliente y serial), acotados, para revisarlos antes.
  router.get('/trazabilidad/maestro/plan', ...gated, route('tmc_maestro_plan', async (req) => leerPlanMaestro(db, maestro, esAdminPortal(req) || puede(await rolDe(req), 'maestro.sincronizar'))));

  // Cruce informativo de TODAS las marcas entre la congelación vigente de la
  // F-ST-022 y el maestro: recuentos por marca. No escribe ni decide nada.
  router.get('/trazabilidad/maestro/cruce', ...gated, route('tmc_maestro_cruce', async () => leerCruceFst022(db, maestro)));

  // Aplica el plan de ahora: {huella?}, la del plan que se revisó. 409 si el
  // maestro no contesta (no escribe nunca sin él) o si el plan ya es otro.
  // Devuelve la fila de auditoría que deja (quién, cuándo y recuentos).
  router.post('/trazabilidad/maestro/sincronizar', ...gated, escritura('maestro.sincronizar', 'tmc_maestro_sincronizar', async (req) => sincronizarMaestro(db, maestro, parseHuellaPlan(req.body), actorOf(req))));

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

  // ── Agenda del taller: la agenda, sus asignaciones y su configuración (lote 5) ──
  //
  // Las respuestas llevan números de ticket, estados, fechas y marcas: ni
  // clientes, ni seriales, ni correos. Lo que cambia la agenda devuelve la
  // agenda ya leída otra vez, como hace «Servicios» con su lista.
  //
  // Lote 7 (la pantalla): la agenda —y sólo ella— lleva además `tickets`, la
  // ficha de cada abierto con su ASUNTO (texto de terceros: identifica el
  // equipo; quien lo pinta lo trata como texto), y `eje`, el tramo del
  // calendario con sus festivos y cierres de empresa.

  // D20: antes de servir la agenda, y antes de asignar, repartir o liberar, se
  // lanza la pasada de la agenda (su historial y el cierre de las asignaciones
  // cuyo ticket salió de su etapa), salvo que haya una buena de hace menos de
  // 30 s. Es «si se puede»: si falla, la petición sigue con lo que haya y la
  // respuesta lo avisa (`pasada_fallida`).
  const ponerAlDia = (): Promise<boolean> => agendaAlDia(db, (d) => repo.registrarEstadosAgenda(d, fuente));

  const agenda = async (hoy: string, alDia: boolean): Promise<RespuestaAgenda> => {
    const entrada = await repo.leerEntradaAgenda(db, fuente, hoy);
    const a = proyectarAgenda(entrada);
    return { ...a, avisos: alDia ? a.avisos : [...a.avisos, AVISO_PASADA_FALLIDA], estadoFuente: entrada.estadoFuente, tickets: detallesDeTickets(entrada), eje: ejeAgenda(hoy, entrada.cierres) };
  };

  // Un cambio en la agenda: valida el cuerpo, se pone al día (si toca), escribe
  // y devuelve la agenda. El día es SIEMPRE el de hoy en Colombia: de él sale el
  // día desde el que cuenta la duración que se guarda, así que no se acepta por parámetro.
  const cambio =
    <T>(leer: (req: Request) => T, escribir: (dato: T, actor: Actor, hoy: string) => Promise<unknown>, conPasada = true) =>
    async (req: Request): Promise<RespuestaAgenda> => {
      const dato = leer(req);
      const alDia = !conPasada || (await ponerAlDia());
      const hoy = hoyEnColombia();
      await escribir(dato, actorOf(req), hoy);
      return agenda(hoy, alDia);
    };

  const configuracion = () => repo.leerConfiguracionAgenda(db, fuente);

  // La agenda completa a «hoy»: etapas con sus puestos y su fila, standby, por
  // llegar, recuentos, avisos y el estado de la fuente. Si Desk 2.0 no contesta
  // responde igual, con el respaldo y su motivo.
  router.get(
    '/trazabilidad/agenda',
    ...gated,
    route('tmc_agenda', async (req) => {
      const hoy = hoyAgenda(req);
      return agenda(hoy, await ponerAlDia());
    }),
  );

  // El reparto inicial que se propone (D6). No escribe, pero es el borrador de
  // una decisión del Director Técnico: pide el mismo permiso que confirmarlo.
  router.get(
    '/trazabilidad/agenda/reparto',
    ...gated,
    conPermiso('agenda.reparto', 'tmc_agenda_reparto', async (req) => {
      const hoy = hoyAgenda(req);
      return { hoy, reparto: await repo.proponerRepartoInicial(db, fuente, hoy) };
    }),
  );

  // Confirma el reparto: {reparto: [{numero, etapa, puesto}]}, la propuesta tal
  // cual o ajustada. Todo o nada. Sólo rellena puestos libres (D19): con uno
  // ocupado, 409 que dice cuál; para mover a alguien, liberar y asignar.
  router.post(
    '/trazabilidad/agenda/reparto',
    ...gated,
    escritura('agenda.reparto', 'tmc_agenda_repartir', cambio((req) => parseReparto(req.body), (lineas, actor, hoy) => repo.confirmarRepartoInicial(db, fuente, lineas, actor, hoy))),
  );

  // Da un puesto a un ticket: {numero, etapa, puesto, motivo?}. 409 si el puesto
  // está ocupado o el ticket no está en esa etapa; 400 si no es el primero de la
  // fila y no se dice el motivo.
  router.post(
    '/trazabilidad/agenda/asignaciones',
    ...gated,
    escritura('agenda.asignar', 'tmc_agenda_asignar', cambio((req) => parseAsignacion(req.body), (linea, actor, hoy) => repo.asignar(db, fuente, linea, actor, hoy))),
  );

  // Libera a mano el puesto de un ticket: {numero, motivo}. Va por número de
  // ticket (D18): como mucho hay una asignación vigente por ticket. 404 si no la tiene.
  router.post(
    '/trazabilidad/agenda/liberar',
    ...gated,
    escritura('agenda.liberar', 'tmc_agenda_liberar', cambio((req) => parseLiberacion(req.body), (liberacion, actor) => repo.liberar(db, liberacion, actor))),
  );

  // Marca a mano el flujo de un ticket: {flujo}; null quita la marca. 404 si la
  // fuente no lo trae abierto y 409 si ya trae su clasificación (manda ella).
  router.put(
    '/trazabilidad/agenda/flujo/:numero',
    ...gated,
    escritura('agenda.flujo', 'tmc_agenda_flujo', cambio((req) => ({ numero: parseNumeroTicket(req.params.numero), flujo: parseFlujoManual(req.body) }), ({ numero, flujo }, actor) => repo.marcarFlujo(db, fuente, numero, flujo, actor), false)),
  );

  // Cuándo entraría un equipo que llegara hoy a esa etapa (?etapa=, y ?tipo=
  // para la duración de ese tipo de servicio): las próximas entradas, una tras
  // otra. Sólo lectura; pensado para la futura reserva del cliente.
  router.get(
    '/trazabilidad/agenda/huecos',
    ...gated,
    route('tmc_agenda_huecos', async (req) => {
      const { etapa, tipo } = parseHuecos(req.query);
      const hoy = hoyAgenda(req);
      const entrada = await repo.leerEntradaAgenda(db, fuente, hoy);
      return { hoy, etapa, tipo, ...huecosDeEtapa(entrada, etapa, tipo, HUECOS_PROXIMOS), fuente: entrada.estadoFuente.fuente };
    }),
  );

  // La configuración de la agenda: puestos de cada etapa, duraciones y cada
  // estado con su categoría, sus dos firmas (la de la categoría y la del rol
  // del reloj) y sus tickets abiertos según la fuente de la agenda.
  router.get('/trazabilidad/agenda/configuracion', ...gated, route('tmc_agenda_config', configuracion));

  // Los tres cambios devuelven la configuración entera ya leída otra vez.
  // {etapa, puestos}: reducirlos no desaloja a nadie (los de más quedan «a extinguir»).
  router.put(
    '/trazabilidad/agenda/configuracion/puestos',
    ...gated,
    escritura('config.write', 'tmc_agenda_puestos', async (req) => {
      await repo.guardarPuestosEtapa(db, parsePuestosEtapa(req.body), actorOf(req));
      return configuracion();
    }),
  );

  // {etapa, tipo, dias}: con dias null se quita la fila de ese tipo; la «*» no se quita (400).
  router.put(
    '/trazabilidad/agenda/configuracion/duraciones',
    ...gated,
    escritura('config.write', 'tmc_agenda_duracion', async (req) => {
      await repo.guardarDuracionEtapa(db, parseDuracionEtapa(req.body), actorOf(req));
      return configuracion();
    }),
  );

  // {estado, categoria, etapa?}: la categoría del estado en la agenda, con su
  // firma. No toca el rol del reloj ni la suya: ése sigue en PUT /trazabilidad/estados.
  router.put(
    '/trazabilidad/agenda/configuracion/estados',
    ...gated,
    escritura('config.write', 'tmc_agenda_categoria', async (req) => {
      await repo.guardarCategoriaEstado(db, parseCategoriaEstado(req.body), actorOf(req));
      return configuracion();
    }),
  );

  return router;
}
