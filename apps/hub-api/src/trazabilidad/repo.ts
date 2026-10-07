/**
 * SQL de Trazabilidad Mantenimientos Clientes (tablas portal.tmc_*, migraciones
 * 042 a 049). Fechas como texto AAAA-MM-DD (`::text`) para no depender del parser de
 * DATE del driver ni de la zona horaria del proceso.
 */

import type { Pool } from '@algarpibe/zoho-sync';
import {
  asignarClaves,
  asuntoSinCodigo,
  claveCliente,
  claveEstadoDesk,
  claveTipoServicio,
  contactoDeTickets,
  contactoEfectivo,
  diasDeTipo,
  esEmailInterno,
  esRolEstado,
  estadoCalibracion,
  etiquetaEstadoDesk,
  modeloDeCodigo,
  nombreContacto,
  normalizarEmail,
  partesDeTipo,
  porOrdenEstadosDesk,
  ROL_POR_DEFECTO,
  tipoEfectivo,
  type ContactoCliente,
  type ContactoEquipo,
  type RolEstado,
  type TicketContacto,
} from './dominio.js';
import { calcularReloj, type IntervaloEstado } from './plazos.js';
import { resolverRol, type RolApp } from './roles.js';
import {
  TzError,
  errorPlazoDerivado,
  type Actor,
  type CambioContacto,
  type CambioEstadoDesk,
  type CambioPlazo,
  type EquipoVista,
  type EstadoDesk,
  type FilaImportada,
  type Importacion,
  type OrigenCliente,
  type PartePlazo,
  type PlazoServicio,
  type ResumenImportacion,
  type Seguimiento,
  type ServicioVista,
  type TipoServicioOpcion,
  type UsuarioRol,
} from './types.js';

type PoolClient = Awaited<ReturnType<Pool['connect']>>;
type Db = Pick<PoolClient, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

async function withTransaction<T>(db: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const COLS_EQUIPO = `
  e.clave, e.serial, e.cliente, e.marca, e.modelo, e.fecha_factura::text AS fecha_factura, e.hoja_vida,
  e.ultima_entrada::text AS ultima_entrada, e.ultima_calibracion::text AS ultima_calibracion,
  e.entradas_st, e.calibraciones_periodo, e.correctivos_periodo, e.activo`;

/**
 * Equipos activos con su seguimiento, el estado calculado a fecha `hoy` y el
 * ticket abierto en Zoho Desk, si lo hay.
 *
 * El ticket sale de la réplica desk.tickets (la escribe el worker de zoho-hub;
 * aquí sólo se lee) cruzando por serial sin mayúsculas ni espacios. Abierto =
 * cualquier tipo de estado que no sea 'Closed'. El LATERAL con LIMIT 1 se queda
 * con el de número más alto y no multiplica filas. Si la réplica lleva más de
 * un día sin refrescarlo (el worker a veces deja de tocar tickets viejos) no se
 * oculta: se marca «sin confirmar».
 */
export async function listarEquipos(db: Db, hoy: string): Promise<EquipoVista[]> {
  const [{ rows }, deDesk, manuales] = await Promise.all([consultarEquipos(db), contactosDeDesk(db), listarContactos(db)]);
  const manualDe = new Map(manuales.map((m) => [m.clave, m]));
  const porSerial = new Map<string, number>();
  for (const r of rows as Row[]) porSerial.set(r.serial, (porSerial.get(r.serial) ?? 0) + 1);
  return (rows as Row[]).map((r) => ({
    clave: r.clave,
    serial: r.serial,
    cliente: r.cliente,
    marca: r.marca,
    modelo: r.modelo,
    fechaFactura: r.fecha_factura,
    hojaVida: r.hoja_vida,
    ultimaEntrada: r.ultima_entrada,
    ultimaCalibracion: r.ultima_calibracion,
    entradasSt: r.entradas_st,
    calibracionesPeriodo: r.calibraciones_periodo,
    correctivosPeriodo: r.correctivos_periodo,
    ...estadoCalibracion(r.ultima_calibracion, hoy),
    serialRepetido: (porSerial.get(r.serial) ?? 0) > 1,
    seguimiento: r.tiene_seg
      ? {
          enAmbientalia: r.en_ambientalia,
          avisoEnviado: r.aviso_enviado,
          servicioProgramado: r.servicio_programado,
          nota: r.nota,
          actualizadoPor: r.actualizado_por,
          actualizadoEn: r.seg_en,
        }
      : null,
    ticket:
      r.ticket_numero === null || r.ticket_numero === undefined
        ? null
        : { numero: Number(r.ticket_numero), estado: r.ticket_estado, sinConfirmar: r.ticket_sin_confirmar === true },
    contacto: contactoEfectivo(manualDe.get(claveCliente(r.cliente)), deDesk.get(claveSerialDesk(r.serial)) ?? null),
  }));
}

/** El serial tal como casa con Desk: sin espacios alrededor y en mayúsculas (lo mismo que `upper(trim(…))` en SQL). */
const claveSerialDesk = (serial: unknown): string => String(serial ?? '').trim().toUpperCase();

/**
 * El contacto que da Desk para cada serial del inventario activo: el del
 * ticket de número más alto —abierto o cerrado— con un correo que valga.
 *
 * El correo es `raw->>'email'` (el del contacto del ticket) y, si no viene, el
 * de `raw->'contact'`; el nombre, `firstName` + `lastName` de ese contacto. La
 * consulta sólo descarta los tickets sin serial o sin correo: qué correo vale
 * (forma de correo y que no sea de un dominio propio) lo decide
 * `contactoDeTickets` (dominio.ts), con la misma regla que usa la app, y por
 * eso se traen todos los candidatos y no sólo el último: si el más reciente es
 * interno o está mal escrito, se retrocede al anterior.
 */
async function contactosDeDesk(db: Db): Promise<Map<string, ContactoEquipo>> {
  const { rows } = await db.query(
    `SELECT upper(trim(t.serial)) AS serial, t.number,
            COALESCE(NULLIF(trim(t.raw->>'email'), ''), t.raw->'contact'->>'email') AS email,
            t.raw->'contact'->>'firstName' AS nombre, t.raw->'contact'->>'lastName' AS apellido
       FROM desk.tickets t
      WHERE trim(t.serial) <> ''
        AND trim(COALESCE(NULLIF(trim(t.raw->>'email'), ''), t.raw->'contact'->>'email', '')) <> ''
        AND upper(trim(t.serial)) IN (SELECT upper(trim(e.serial)) FROM portal.tmc_equipos e WHERE e.activo)
      ORDER BY t.number DESC NULLS LAST`,
  );
  const porSerial = new Map<string, TicketContacto[]>();
  for (const r of rows as Row[]) {
    const lista = porSerial.get(r.serial) ?? [];
    lista.push({ numero: r.number === null || r.number === undefined ? null : Number(r.number), email: r.email, nombre: r.nombre, apellido: r.apellido });
    porSerial.set(r.serial, lista);
  }
  const out = new Map<string, ContactoEquipo>();
  for (const [serial, tickets] of porSerial) {
    const c = contactoDeTickets(tickets);
    if (c) out.set(serial, c);
  }
  return out;
}

/** Los contactos puestos a mano a clientes (portal.tmc_contactos), por orden alfabético de cliente. */
export async function listarContactos(db: Db): Promise<ContactoCliente[]> {
  const { rows } = await db.query(
    `SELECT clave, cliente, emails, nombre, actualizado_por, actualizado_en::text AS actualizado_en
       FROM portal.tmc_contactos
      ORDER BY cliente, clave`,
  );
  return (rows as Row[]).map((r) => {
    const emails = ((r.emails ?? []) as unknown[]).map(normalizarEmail).filter(Boolean);
    return {
      clave: r.clave,
      cliente: r.cliente,
      nombre: r.nombre ?? '',
      emails,
      internos: emails.filter(esEmailInterno),
      actualizadoPor: r.actualizado_por,
      actualizadoEn: r.actualizado_en,
    };
  });
}

/**
 * Pone a mano el contacto de un cliente y lo firma; con `emails` vacío lo
 * quita (borra la fila: vuelve a valer el contacto de Desk). Casa por
 * `claveCliente`, así que cualquier grafía del nombre toca la misma fila y
 * vale para todos los equipos de ese cliente. Sólo guarda direcciones: de aquí
 * no sale ningún mensaje.
 */
export async function guardarContacto(db: Db, c: CambioContacto, actor: Actor): Promise<void> {
  const clave = claveCliente(c.cliente);
  if (c.emails.length === 0) {
    await db.query(`DELETE FROM portal.tmc_contactos WHERE clave = $1`, [clave]);
    return;
  }
  await db.query(
    `INSERT INTO portal.tmc_contactos (clave, cliente, emails, nombre, actualizado_por_id, actualizado_por, actualizado_en)
     VALUES ($1, $2, $3::text[], $4, $5, $6, NOW())
     ON CONFLICT (clave) DO UPDATE SET
       cliente = EXCLUDED.cliente, emails = EXCLUDED.emails, nombre = EXCLUDED.nombre,
       actualizado_por_id = EXCLUDED.actualizado_por_id, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
    [clave, c.cliente, c.emails, c.nombre, actor.userId, actor.email],
  );
}

function consultarEquipos(db: Db) {
  return db.query(
    `SELECT ${COLS_EQUIPO},
            s.clave IS NOT NULL AS tiene_seg, s.en_ambientalia, s.aviso_enviado::text AS aviso_enviado,
            s.servicio_programado::text AS servicio_programado, s.nota, s.actualizado_por,
            s.actualizado_en::text AS seg_en,
            tk.number AS ticket_numero, tk.status AS ticket_estado, tk.sin_confirmar AS ticket_sin_confirmar
       FROM portal.tmc_equipos e
       LEFT JOIN portal.tmc_seguimiento s ON s.clave = e.clave
       LEFT JOIN LATERAL (
              SELECT t.number, t.status,
                     (t.synced_at IS NULL OR t.synced_at < NOW() - INTERVAL '1 day') AS sin_confirmar
                FROM desk.tickets t
               WHERE t.status_type IS DISTINCT FROM 'Closed'
                 AND trim(t.serial) <> ''
                 AND upper(trim(t.serial)) = upper(trim(e.serial))
               ORDER BY t.number DESC
               LIMIT 1
            ) tk ON TRUE
      WHERE e.activo
      ORDER BY e.cliente, e.serial`,
  );
}

/** Abierto en Desk: cualquier tipo de estado que no sea 'Closed' (también el vacío). */
const TICKET_ABIERTO = `t.status_type IS DISTINCT FROM 'Closed'`;

/** El orden de la pestaña «Configuración»: con plazo primero y, dentro de cada grupo, alfabético. */
const porPlazoYEtiqueta = (a: { dias: number | null; etiqueta: string }, b: { dias: number | null; etiqueta: string }): number =>
  Number(a.dias === null) - Number(b.dias === null) || a.etiqueta.localeCompare(b.etiqueta, 'es');

/**
 * Los días de cada tipo, resueltos a partir de las filas de portal.tmc_plazos.
 * Es el único sitio del repo que traduce «lo guardado» a «lo que vale»: un tipo
 * simple vale lo de su fila y uno compuesto (`TIPOS_COMPUESTOS`, dominio.ts) la
 * suma de sus partes, sin mirar su propia fila. Lista, fecha límite,
 * Configuración y desplegable piden los días aquí, así que no pueden discrepar.
 */
function resolverPlazos(filas: readonly Row[]) {
  const guardados = new Map<string, number | null>(filas.map((r) => [r.clave as string, r.dias_habiles === null ? null : Number(r.dias_habiles)]));
  const etiquetas = new Map<string, string>(filas.map((r) => [r.clave as string, r.etiqueta as string]));
  return {
    /** Días hábiles que valen para el tipo; null = sin plazo. */
    dias: (clave: string): number | null => diasDeTipo(clave, guardados),
    /** Las partes de un tipo compuesto con su plazo de hoy; null si el tipo es simple. */
    partes: (clave: string): PartePlazo[] | null =>
      partesDeTipo(clave)?.map((p) => ({ clave: p, etiqueta: etiquetas.get(p) ?? p, dias: diasDeTipo(p, guardados) })) ?? null,
  };
}

/** Las filas de portal.tmc_plazos como opciones elegibles, más el resolvedor de días de esas mismas filas. */
async function cargarTipos(db: Db): Promise<{ tipos: TipoServicioOpcion[]; plazos: ReturnType<typeof resolverPlazos> }> {
  const { rows } = await db.query(`SELECT clave, etiqueta, dias_habiles FROM portal.tmc_plazos`);
  const plazos = resolverPlazos(rows as Row[]);
  const tipos = (rows as Row[])
    .map((r) => ({ clave: r.clave as string, etiqueta: r.etiqueta as string, dias: plazos.dias(r.clave) }))
    .sort(porPlazoYEtiqueta);
  return { tipos, plazos };
}

/**
 * Los tipos de servicio que se pueden elegir a mano para un ticket: las filas
 * de portal.tmc_plazos (tengan plazo o no), en el orden de «Configuración».
 * `dias` es el plazo que vale: en un tipo compuesto, la suma de sus partes.
 */
export async function listarTiposServicio(db: Db): Promise<TipoServicioOpcion[]> {
  return (await cargarTipos(db)).tipos;
}

/**
 * El cliente de un servicio, por este orden:
 *  (a) el cliente del equipo de portal.tmc_equipos con el mismo serial (sin
 *      mayúsculas ni espacios; con varios, el activo y, si no hay, uno
 *      retirado) — es el nombre con el que se le conoce en la F-ST-022;
 *  (b) la cuenta de Desk (`raw.contact.account.accountName`), que casi nunca viene;
 *  (c) nombre y apellido del contacto del ticket;
 *  (d) el asunto sin el código de servicio: no es un nombre fiable y la app lo
 *      enseña distinto (`clienteDeAsunto`).
 */
function clienteDeServicio(r: Row): { cliente: string; origen: OrigenCliente } {
  const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const equipo = limpio(r.cliente_equipo);
  if (equipo) return { cliente: equipo, origen: 'equipo' };
  const cuenta = limpio(r.cuenta);
  if (cuenta) return { cliente: cuenta, origen: 'cuenta' };
  const contacto = nombreContacto(r.contacto_nombre, r.contacto_apellido);
  if (contacto) return { cliente: contacto, origen: 'contacto' };
  return { cliente: asuntoSinCodigo(r.subject, r.codigo_servicio), origen: 'asunto' };
}

/**
 * Todos los tickets de Desk que no están cerrados —de cualquier marca, con o
 * sin serial: esta vista va de tickets, no de equipos— con su fecha límite a
 * fecha `hoy`.
 *
 * El plazo es alternativo por tipo de servicio, no acumulado: ingreso + los
 * días hábiles configurados para SU tipo (portal.tmc_plazos). El tipo casa por
 * clave normalizada, y eso se hace aquí y no en SQL para no depender de
 * `unaccent`. Sin tipo, o con un tipo sin plazo, el servicio sale «sin plazo».
 *
 * La excepción es un tipo compuesto («Diagnóstico + Calibración»): su plazo es
 * la suma de los de sus partes y el servicio lleva además `tramos`, con el día
 * en que acaba cada parte (el último es la fecha límite).
 *
 * SU tipo es el efectivo (`tipoEfectivo`): el puesto a mano en
 * portal.tmc_servicios_tipo gana al que traiga Desk. El puesto a mano se
 * enseña con la etiqueta que tenga hoy en Configuración (la guardada, si su
 * fila ya no existe).
 *
 * El plazo descuenta el tiempo en pausa (`calcularReloj`, plazos.ts). El rol
 * del estado que el ticket tiene AHORA (portal.tmc_estados_desk, por
 * `claveEstadoDesk`) dice si el reloj corre, está en pausa (standby) o está
 * parado (trabajo terminado); cuánto estuvo en cada estado sale de sus tramos
 * en portal.tmc_estados_historial, leídos con el rol que cada estado tiene
 * hoy. Aquí sólo se lee: quien apunta los tramos es `registrarEstados`.
 *
 * El ingreso es la fecha de creación que trae el ticket o, si falta, el día en
 * Colombia de created_time. El cliente lo resuelve `clienteDeServicio`: el del
 * equipo del inventario con ese serial y, si no, lo que viaje en `raw`.
 */
export async function listarServicios(db: Db, hoy: string): Promise<ServicioVista[]> {
  const [{ rows }, { tipos, plazos }, conRol, historial] = await Promise.all([
    db.query(
      `SELECT t.number, t.subject, t.status, t.serial, t.codigo_servicio, t.tipo_servicio,
              COALESCE(t.fecha_creacion_ticket, (t.created_time AT TIME ZONE 'America/Bogota')::date)::text AS ingreso,
              (t.synced_at IS NULL OR t.synced_at < NOW() - INTERVAL '1 day') AS sin_confirmar,
              eq.cliente AS cliente_equipo,
              t.raw->'contact'->'account'->>'accountName' AS cuenta,
              t.raw->'contact'->>'firstName' AS contacto_nombre, t.raw->'contact'->>'lastName' AS contacto_apellido,
              m.clave AS manual_clave, m.etiqueta AS manual_etiqueta, m.actualizado_por AS manual_por,
              m.actualizado_en::text AS manual_en
         FROM desk.tickets t
         LEFT JOIN portal.tmc_servicios_tipo m ON m.numero = t.number
         LEFT JOIN LATERAL (
                SELECT e.cliente
                  FROM portal.tmc_equipos e
                 WHERE trim(t.serial) <> ''
                   AND upper(trim(e.serial)) = upper(trim(t.serial))
                 ORDER BY e.activo DESC, e.clave
                 LIMIT 1
              ) eq ON TRUE
        WHERE ${TICKET_ABIERTO}
        ORDER BY t.number DESC`,
    ),
    cargarTipos(db),
    db.query(`SELECT clave, rol FROM portal.tmc_estados_desk`),
    // Los instantes viajan como milisegundos desde la época: sin depender del parser de fechas del driver.
    db.query(
      `SELECT h.numero, h.clave, h.desde_real,
              (extract(epoch FROM h.desde) * 1000)::float8 AS desde_ms,
              (extract(epoch FROM h.hasta) * 1000)::float8 AS hasta_ms
         FROM portal.tmc_estados_historial h
        WHERE h.numero IN (SELECT t.number FROM desk.tickets t WHERE ${TICKET_ABIERTO})`,
    ),
  ]);
  const porClave = new Map(tipos.map((t) => [t.clave, t]));
  const roles = new Map<string, RolEstado>();
  for (const r of conRol.rows as Row[]) if (esRolEstado(r.rol)) roles.set(r.clave, r.rol);
  const rolDe = (clave: string): RolEstado => roles.get(clave) ?? ROL_POR_DEFECTO;
  const tramosDe = new Map<number, IntervaloEstado[]>();
  for (const r of historial.rows as Row[]) {
    const numero = Number(r.numero);
    const lista = tramosDe.get(numero) ?? [];
    lista.push({
      clave: r.clave,
      desde: Math.round(Number(r.desde_ms)),
      hasta: r.hasta_ms === null ? null : Math.round(Number(r.hasta_ms)),
      desdeReal: r.desde_real === true,
    });
    tramosDe.set(numero, lista);
  }
  return (rows as Row[]).map((r) => {
    const manualClave: string | null = r.manual_clave ?? null;
    const tipoDesk = String(r.tipo_servicio ?? '').trim();
    const manual = manualClave === null ? null : (porClave.get(manualClave)?.etiqueta ?? r.manual_etiqueta);
    const { tipo: tipoServicio, origen: tipoOrigen } = tipoEfectivo(manual, tipoDesk);
    const claveTipo = claveTipoServicio(tipoServicio);
    const plazoDias = plazos.dias(claveTipo);
    const partes = plazos.partes(claveTipo);
    const { cliente, origen: clienteOrigen } = clienteDeServicio(r);
    const numero = Number(r.number);
    const reloj = calcularReloj({
      ingreso: r.ingreso,
      dias: plazoDias,
      partes,
      hoy,
      rolActual: rolDe(claveEstadoDesk(r.status)),
      intervalos: tramosDe.get(numero) ?? [],
      rolDe,
    });
    return {
      numero,
      asunto: String(r.subject ?? '').trim(),
      cliente,
      clienteOrigen,
      clienteDeAsunto: clienteOrigen === 'asunto',
      serial: String(r.serial ?? '').trim(),
      modelo: modeloDeCodigo(r.codigo_servicio),
      tipoServicio,
      tipoOrigen,
      tipoDesk,
      tipoManual: tipoOrigen === 'manual' && manualClave !== null ? { clave: manualClave, por: r.manual_por, en: r.manual_en } : null,
      estado: r.status,
      ingreso: r.ingreso,
      plazoDias,
      ...reloj,
      sinConfirmar: r.sin_confirmar === true,
    };
  });
}

/**
 * Los plazos configurables: las filas de portal.tmc_plazos más cualquier tipo
 * de servicio que aparezca en un ticket abierto y todavía no tenga fila (sale
 * sin plazo, para que se le pueda poner uno). Con plazo primero y, dentro de
 * cada grupo, por orden alfabético.
 */
export async function listarPlazos(db: Db): Promise<PlazoServicio[]> {
  const [guardados, enTickets] = await Promise.all([
    db.query(`SELECT clave, etiqueta, dias_habiles, actualizado_por, actualizado_en::text AS actualizado_en FROM portal.tmc_plazos`),
    db.query(
      `SELECT m.clave AS manual_clave, trim(t.tipo_servicio) AS tipo, count(*)::int AS n
         FROM desk.tickets t
         LEFT JOIN portal.tmc_servicios_tipo m ON m.numero = t.number
        WHERE ${TICKET_ABIERTO} AND (m.clave IS NOT NULL OR trim(t.tipo_servicio) <> '')
        GROUP BY 1, 2
        ORDER BY min(t.number)`,
    ),
  ]);
  const plazos = resolverPlazos(guardados.rows as Row[]);
  const m = new Map<string, PlazoServicio>();
  for (const r of guardados.rows as Row[]) {
    m.set(r.clave, {
      clave: r.clave,
      etiqueta: r.etiqueta,
      dias: plazos.dias(r.clave),
      derivadoDe: plazos.partes(r.clave),
      ticketsAbiertos: 0,
      actualizadoPor: r.actualizado_por,
      actualizadoEn: r.actualizado_en,
    });
  }
  // Cada ticket cuenta en su tipo efectivo: el puesto a mano si lo hay y, si
  // no, el de Desk. Varias grafías del mismo tipo suman en una sola fila; la
  // etiqueta de un tipo nuevo es la del ticket más antiguo que lo trae.
  for (const r of enTickets.rows as Row[]) {
    if (r.manual_clave !== null) {
      // Un tipo puesto a mano siempre sale de una fila de tmc_plazos; si ya no está, no se inventa otra.
      const p = m.get(r.manual_clave);
      if (p) p.ticketsAbiertos += Number(r.n);
      continue;
    }
    const clave = claveTipoServicio(r.tipo);
    if (!clave) continue;
    const p = m.get(clave) ?? {
      clave,
      etiqueta: r.tipo,
      dias: plazos.dias(clave),
      derivadoDe: plazos.partes(clave),
      ticketsAbiertos: 0,
      actualizadoPor: null,
      actualizadoEn: null,
    };
    p.ticketsAbiertos += Number(r.n);
    m.set(clave, p);
  }
  return [...m.values()].sort(porPlazoYEtiqueta);
}

/**
 * Pone a mano (o quita, con `tipo` null) el tipo de servicio de un ticket y lo
 * firma. El ticket tiene que existir en la réplica de Desk (404) y el tipo
 * tiene que ser, por clave normalizada, uno de los de portal.tmc_plazos (400).
 * Se guarda la clave y la etiqueta de esa fila, no lo que se haya tecleado.
 * Quitar borra la fila: vuelve a valer el tipo de Desk.
 */
export async function fijarTipoServicio(db: Db, numero: number, tipo: string | null, actor: Actor): Promise<void> {
  const ticket = await db.query(`SELECT 1 FROM desk.tickets t WHERE t.number = $1`, [numero]);
  if (ticket.rows.length === 0) throw new TzError('not_found', 404, 'Ese ticket no está en Zoho Desk.');
  if (tipo === null) {
    await db.query(`DELETE FROM portal.tmc_servicios_tipo WHERE numero = $1`, [numero]);
    return;
  }
  const clave = claveTipoServicio(tipo);
  const { rows } = await db.query(`SELECT etiqueta FROM portal.tmc_plazos WHERE clave = $1`, [clave]);
  if (!clave || rows.length === 0) {
    throw new TzError('invalid_input', 400, 'Ese tipo de servicio no está en Configuración.', 'tipo');
  }
  await db.query(
    `INSERT INTO portal.tmc_servicios_tipo (numero, clave, etiqueta, actualizado_por_id, actualizado_por, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (numero) DO UPDATE SET
       clave = EXCLUDED.clave, etiqueta = EXCLUDED.etiqueta, actualizado_por_id = EXCLUDED.actualizado_por_id,
       actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
    [numero, clave, (rows[0] as Row).etiqueta, actor.userId, actor.email],
  );
}

/**
 * Fija (o vacía, con `dias` null) el plazo de un tipo de servicio y lo firma.
 * Si el tipo ya tiene fila, su etiqueta se conserva: sólo cambia el plazo.
 * Un tipo compuesto no tiene plazo propio (es la suma de sus partes): 400, y
 * no se escribe nada. `parsePlazo` ya lo corta antes; aquí se repite para que
 * ningún otro camino pueda guardarle días.
 */
export async function guardarPlazo(db: Db, c: CambioPlazo, actor: Actor): Promise<void> {
  if (partesDeTipo(claveTipoServicio(c.tipo))) throw errorPlazoDerivado(c.tipo);
  await db.query(
    `INSERT INTO portal.tmc_plazos (clave, etiqueta, dias_habiles, actualizado_por_id, actualizado_por, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (clave) DO UPDATE SET
       dias_habiles = EXCLUDED.dias_habiles, actualizado_por_id = EXCLUDED.actualizado_por_id,
       actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
    [claveTipoServicio(c.tipo), c.tipo.trim(), c.dias, actor.userId, actor.email],
  );
}

/** Suma un voto a `valor` y devuelve el mapa (recuento de grafías o de tipos de un estado). */
function votar(votos: Map<string, number>, valor: string, n: number): Map<string, number> {
  votos.set(valor, (votos.get(valor) ?? 0) + n);
  return votos;
}

/** El valor más votado; a igualdad, el primero por orden alfabético. Null si no hay votos. */
function masVotado(votos: Map<string, number>): string | null {
  let mejor: string | null = null;
  for (const [valor, n] of votos) {
    const m = mejor === null ? -1 : votos.get(mejor)!;
    if (n > m || (n === m && valor.localeCompare(mejor!, 'es') < 0)) mejor = valor;
  }
  return mejor;
}

/**
 * Los estados de Desk con su rol en el reloj del plazo (bloque «Estados de
 * Desk» de «Configuración»): todos los que existen en desk.tickets —de
 * cualquier ticket, cerrados incluidos— más los que ya estén guardados en
 * portal.tmc_estados_desk aunque ningún ticket los tenga ahora.
 *
 * Casan por `claveEstadoDesk`, y eso se hace aquí y no en SQL (sin `unaccent`):
 * varias grafías del mismo estado suman en una sola fila, que se enseña con la
 * grafía más usada y con el tipo de Desk de la mayoría de sus tickets. Sólo
 * cuentan como abiertos los tickets sin cerrar. Un estado sin fila guardada
 * vale «cuenta»: nada nace en standby ni terminado. Leer no escribe.
 */
export async function listarEstadosDesk(db: Db): Promise<EstadoDesk[]> {
  const [guardados, enTickets] = await Promise.all([
    db.query(`SELECT clave, etiqueta, rol, actualizado_por, actualizado_en::text AS actualizado_en FROM portal.tmc_estados_desk`),
    db.query(
      `SELECT t.status AS estado, t.status_type AS tipo, count(*)::int AS n,
              (count(*) FILTER (WHERE ${TICKET_ABIERTO}))::int AS abiertos
         FROM desk.tickets t
        GROUP BY t.status, t.status_type`,
    ),
  ]);
  const m = new Map<string, EstadoDesk>();
  for (const r of guardados.rows as Row[]) {
    m.set(r.clave, {
      clave: r.clave,
      etiqueta: r.etiqueta,
      tipoDesk: null,
      ticketsAbiertos: 0,
      rol: esRolEstado(r.rol) ? r.rol : ROL_POR_DEFECTO,
      actualizadoPor: r.actualizado_por,
      actualizadoEn: r.actualizado_en,
    });
  }
  const grafias = new Map<string, Map<string, number>>();
  const tipos = new Map<string, Map<string, number>>();
  for (const r of enTickets.rows as Row[]) {
    const clave = claveEstadoDesk(r.estado);
    if (!clave) continue;
    const e = m.get(clave) ?? { clave, etiqueta: '', tipoDesk: null, ticketsAbiertos: 0, rol: ROL_POR_DEFECTO, actualizadoPor: null, actualizadoEn: null };
    e.ticketsAbiertos += Number(r.abiertos);
    m.set(clave, e);
    grafias.set(clave, votar(grafias.get(clave) ?? new Map(), etiquetaEstadoDesk(r.estado), Number(r.n)));
    const tipo = String(r.tipo ?? '').trim();
    if (tipo) tipos.set(clave, votar(tipos.get(clave) ?? new Map(), tipo, Number(r.n)));
  }
  // Lo que diga Desk hoy manda sobre la etiqueta guardada; el tipo sólo lo sabe Desk.
  for (const [clave, e] of m) {
    e.etiqueta = masVotado(grafias.get(clave) ?? new Map()) ?? e.etiqueta;
    e.tipoDesk = masVotado(tipos.get(clave) ?? new Map());
  }
  return [...m.values()].sort(porOrdenEstadosDesk);
}

/**
 * Elige el rol de un estado de Desk (cuenta, standby o terminado) y lo firma.
 * Casa por clave normalizada, así que cualquier grafía toca la misma fila;
 * vale también un estado que ningún ticket use todavía. Volver a «cuenta» no
 * borra la fila: queda quién lo hizo y cuándo. Un rol que no sea de los tres
 * lo rechaza la tabla (y antes, `parseEstadoDesk`).
 *
 * No toca el historial: los tramos guardan el estado, no el rol, así que el
 * cambio vale también hacia atrás desde la lectura siguiente.
 */
export async function guardarEstadoDesk(db: Db, c: CambioEstadoDesk, actor: Actor): Promise<void> {
  await db.query(
    `INSERT INTO portal.tmc_estados_desk (clave, etiqueta, rol, actualizado_por_id, actualizado_por, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (clave) DO UPDATE SET
       etiqueta = EXCLUDED.etiqueta, rol = EXCLUDED.rol, actualizado_por_id = EXCLUDED.actualizado_por_id,
       actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
    [claveEstadoDesk(c.estado), etiquetaEstadoDesk(c.estado), c.rol, actor.userId, actor.email],
  );
}

/**
 * Apunta en portal.tmc_estados_historial los cambios de estado de los tickets
 * de Desk. La réplica sólo trae el estado de AHORA, así que el tiempo en cada
 * estado lo mide el portal: esta función se llama cada pocos minutos
 * (registro-estados.ts) y deja, por ticket sin cerrar, un tramo abierto con su
 * estado.
 *
 *  - ticket sin tramo abierto → abre uno, marcado como «no se vio empezar»
 *    (`desde_real` FALSE): es la primera vez que se ve, ya estaba así;
 *  - ticket cuyo estado ya no es el de su tramo abierto → cierra ese tramo y
 *    abre otro en el mismo instante, éste sí como cambio visto;
 *  - ticket cerrado en Desk, o que ya no está en la réplica → cierra su tramo
 *    y no abre otro.
 *
 * El estado casa por `claveEstadoDesk` (por eso se compara aquí y no en SQL):
 * otra grafía del mismo estado no es un cambio. El rol del estado no se
 * apunta: se mira al leer.
 *
 * Idempotente y segura con llamadas a la vez. Todo va en una transacción que
 * primero se pone en fila con un bloqueo de la base (la segunda llamada espera
 * a la primera y ya no encuentra nada que apuntar); y, aun sin él, las
 * escrituras no pisan: sólo se cierra un tramo que siga abierto y el alta se
 * apoya en el índice único parcial (un tramo abierto por ticket) con
 * ON CONFLICT DO NOTHING. Devuelve cuántos tramos abrió y cuántos cerró.
 */
export async function registrarEstados(db: Pool): Promise<{ abiertos: number; cerrados: number }> {
  return withTransaction(db, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('portal.tmc_estados_historial'))`);
    // El instante de esta pasada, tomado YA con el bloqueo (NOW() es el del BEGIN, anterior a la espera: una
    // pasada que esperó podría cerrar un tramo antes de su comienzo). Como texto, para no perder microsegundos;
    // el mismo valor cierra el tramo viejo y abre el nuevo, así que no queda hueco entre los dos.
    const reloj = await c.query(`SELECT clock_timestamp()::text AS ahora`);
    const instante: string = (reloj.rows[0] as Row).ahora;
    const tickets = await c.query(`SELECT t.number, t.status FROM desk.tickets t WHERE ${TICKET_ABIERTO} AND t.number IS NOT NULL AND t.number > 0`);
    const abiertos = await c.query(`SELECT id::text AS id, numero, clave FROM portal.tmc_estados_historial WHERE hasta IS NULL`);

    const ahora = new Map<number, string>((tickets.rows as Row[]).map((r) => [Number(r.number), String(r.status ?? '')]));
    const cerrar: string[] = [];
    const enSuEstado = new Set<number>();
    const cambian = new Set<number>();
    for (const r of abiertos.rows as Row[]) {
      const numero = Number(r.numero);
      const estado = ahora.get(numero);
      if (estado !== undefined && claveEstadoDesk(estado) === r.clave) enSuEstado.add(numero);
      else {
        cerrar.push(r.id);
        if (estado !== undefined) cambian.add(numero);
      }
    }
    const abrir = [...ahora].filter(([numero]) => !enSuEstado.has(numero));

    let cerrados = 0;
    if (cerrar.length > 0) {
      const r = await c.query(`UPDATE portal.tmc_estados_historial SET hasta = GREATEST($2::timestamptz, desde) WHERE id = ANY($1::bigint[]) AND hasta IS NULL`, [cerrar, instante]);
      cerrados = r.rowCount ?? 0;
    }
    let nuevos = 0;
    if (abrir.length > 0) {
      const r = await c.query(
        `INSERT INTO portal.tmc_estados_historial (numero, clave, etiqueta, desde, hasta, desde_real)
         SELECT x.numero, x.clave, x.etiqueta, $5::timestamptz, NULL, x.desde_real
           FROM unnest($1::int[], $2::text[], $3::text[], $4::boolean[]) AS x(numero, clave, etiqueta, desde_real)
         ON CONFLICT (numero) WHERE hasta IS NULL DO NOTHING`,
        [abrir.map(([numero]) => numero), abrir.map(([, e]) => claveEstadoDesk(e)), abrir.map(([, e]) => etiquetaEstadoDesk(e)), abrir.map(([numero]) => cambian.has(numero)), instante],
      );
      nuevos = r.rowCount ?? 0;
    }
    return { abiertos: nuevos, cerrados };
  });
}

const COLS_IMPORT =`id, archivo, total, nuevos, actualizados, retirados, por, en::text AS en`;
const toImport = (r: Row): ResumenImportacion => ({
  id: Number(r.id),
  archivo: r.archivo,
  total: r.total,
  nuevos: r.nuevos,
  actualizados: r.actualizados,
  retirados: r.retirados,
  por: r.por,
  en: r.en,
});

export async function ultimaImportacion(db: Db): Promise<ResumenImportacion | null> {
  const { rows } = await db.query(`SELECT ${COLS_IMPORT} FROM portal.tmc_importaciones ORDER BY id DESC LIMIT 1`);
  return rows[0] ? toImport(rows[0]) : null;
}

/** Campos que vienen de la hoja, en el orden en que se comparan y se escriben. */
function valores(f: FilaImportada): (string | number | null)[] {
  return [
    f.serial, f.cliente, f.marca, f.modelo, f.fechaFactura, f.hojaVida, f.ultimaEntrada, f.ultimaCalibracion,
    f.entradasSt, f.calibracionesPeriodo, f.correctivosPeriodo,
  ];
}
function valoresFila(r: Row): (string | number | null)[] {
  return [
    r.serial, r.cliente, r.marca, r.modelo, r.fecha_factura, r.hoja_vida, r.ultima_entrada, r.ultima_calibracion,
    r.entradas_st, r.calibraciones_periodo, r.correctivos_periodo,
  ];
}

/**
 * Aplica (o simula, con `simular`) una importación de la F-ST-022:
 *  - fila nueva → alta;
 *  - fila existente con cambios, o retirada antes y que vuelve → actualización;
 *  - equipo activo que ya no está en el archivo → se marca inactivo (no se
 *    borra: su seguimiento sigue ahí si vuelve en otra importación).
 * El seguimiento (avisos, notas, «en Ambientalia») no se toca nunca.
 */
export async function importar(db: Pool, imp: Importacion, actor: Actor, simular: boolean): Promise<ResumenImportacion> {
  const claves = asignarClaves(imp.filas.map((f) => f.serial));
  const plan = async (c: Db) => {
    const { rows } = await c.query(`SELECT ${COLS_EQUIPO} FROM portal.tmc_equipos e ${simular ? '' : 'FOR UPDATE'}`);
    const previo = new Map<string, Row>((rows as Row[]).map((r) => [r.clave, r]));
    let nuevos = 0;
    let actualizados = 0;
    const cambian: number[] = [];
    imp.filas.forEach((f, i) => {
      const p = previo.get(claves[i]);
      if (!p) {
        nuevos++;
        cambian.push(i);
      } else if (!p.activo || JSON.stringify(valoresFila(p)) !== JSON.stringify(valores(f))) {
        actualizados++;
        cambian.push(i);
      }
    });
    const enArchivo = new Set(claves);
    const retirar = [...previo.values()].filter((r) => r.activo && !enArchivo.has(r.clave)).map((r) => r.clave as string);
    return { nuevos, actualizados, cambian, retirar };
  };

  const resumenBase = (p: { nuevos: number; actualizados: number; retirar: string[] }) => ({
    archivo: imp.archivo,
    total: imp.filas.length,
    nuevos: p.nuevos,
    actualizados: p.actualizados,
    retirados: p.retirar.length,
    por: actor.email,
  });

  if (simular) {
    const p = await plan(db);
    return { id: null, ...resumenBase(p), en: new Date().toISOString() };
  }

  return withTransaction(db, async (c) => {
    const p = await plan(c);
    const { rows } = await c.query(
      `INSERT INTO portal.tmc_importaciones (archivo, total, nuevos, actualizados, retirados, por_id, por)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS_IMPORT}`,
      [imp.archivo, imp.filas.length, p.nuevos, p.actualizados, p.retirar.length, actor.userId, actor.email],
    );
    const imp_ = toImport(rows[0]);
    if (p.cambian.length) {
      const col = (k: number) => p.cambian.map((i) => valores(imp.filas[i])[k]);
      await c.query(
        `INSERT INTO portal.tmc_equipos
           (clave, serial, cliente, marca, modelo, fecha_factura, hoja_vida, ultima_entrada, ultima_calibracion,
            entradas_st, calibraciones_periodo, correctivos_periodo, activo, importacion_id, actualizado_en)
         SELECT t.*, TRUE, $13::bigint, NOW()
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::date[], $7::text[],
                       $8::date[], $9::date[], $10::int[], $11::int[], $12::int[]) AS t
         ON CONFLICT (clave) DO UPDATE SET
           serial = EXCLUDED.serial, cliente = EXCLUDED.cliente, marca = EXCLUDED.marca, modelo = EXCLUDED.modelo,
           fecha_factura = EXCLUDED.fecha_factura, hoja_vida = EXCLUDED.hoja_vida,
           ultima_entrada = EXCLUDED.ultima_entrada, ultima_calibracion = EXCLUDED.ultima_calibracion,
           entradas_st = EXCLUDED.entradas_st, calibraciones_periodo = EXCLUDED.calibraciones_periodo,
           correctivos_periodo = EXCLUDED.correctivos_periodo, activo = TRUE,
           importacion_id = EXCLUDED.importacion_id, actualizado_en = NOW()`,
        [p.cambian.map((i) => claves[i]), ...Array.from({ length: 11 }, (_, k) => col(k)), imp_.id],
      );
    }
    if (p.retirar.length) {
      await c.query(
        `UPDATE portal.tmc_equipos SET activo = FALSE, importacion_id = $2, actualizado_en = NOW() WHERE clave = ANY($1::text[])`,
        [p.retirar, imp_.id],
      );
    }
    return imp_;
  });
}

async function existeActivo(db: Db, clave: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM portal.tmc_equipos WHERE clave = $1 AND activo`, [clave]);
  return rows.length > 0;
}

/** Guarda el seguimiento completo de un equipo (alta o reemplazo). */
export async function guardarSeguimiento(db: Db, clave: string, s: Seguimiento, actor: Actor): Promise<void> {
  if (!(await existeActivo(db, clave))) throw new TzError('not_found', 404, 'Ese equipo no está en el inventario.');
  await db.query(
    `INSERT INTO portal.tmc_seguimiento
       (clave, en_ambientalia, aviso_enviado, servicio_programado, nota, actualizado_por_id, actualizado_por, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (clave) DO UPDATE SET
       en_ambientalia = EXCLUDED.en_ambientalia, aviso_enviado = EXCLUDED.aviso_enviado,
       servicio_programado = EXCLUDED.servicio_programado, nota = EXCLUDED.nota,
       actualizado_por_id = EXCLUDED.actualizado_por_id, actualizado_por = EXCLUDED.actualizado_por,
       actualizado_en = NOW()`,
    [clave, s.enAmbientalia, s.avisoEnviado, s.servicioProgramado, s.nota, actor.userId, actor.email],
  );
}

/**
 * Registra el aviso al cliente en varios equipos a la vez. Sólo toca la fecha
 * del aviso: el resto del seguimiento de cada equipo se conserva.
 */
export async function registrarAvisos(db: Db, claves: string[], fecha: string, actor: Actor): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO portal.tmc_seguimiento (clave, aviso_enviado, actualizado_por_id, actualizado_por, actualizado_en)
     SELECT e.clave, $2::date, $3, $4, NOW() FROM portal.tmc_equipos e WHERE e.clave = ANY($1::text[]) AND e.activo
     ON CONFLICT (clave) DO UPDATE SET
       aviso_enviado = EXCLUDED.aviso_enviado, actualizado_por_id = EXCLUDED.actualizado_por_id,
       actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
    [claves, fecha, actor.userId, actor.email],
  );
  return rowCount ?? 0;
}

// ── Roles de la app (portal.tmc_user_roles, migración 049) ──────────────────
// Aquí sólo el SQL: qué puede cada rol lo decide roles.ts, y quién puede
// repartirlos (los administradores del portal), el router.

/** El rol guardado de un usuario, tal cual; `null` si no tiene fila (el dominio lo resuelve a LECTOR). */
export async function rolDeUsuario(db: Db, userId: string): Promise<string | null> {
  const { rows } = await db.query('SELECT role FROM portal.tmc_user_roles WHERE user_id = $1', [userId]);
  return rows[0]?.role ?? null;
}

/** Pone (o cambia) el rol de un usuario y lo firma. Una fila por usuario. */
export async function guardarRol(db: Db, userId: string, rol: RolApp, actor: Actor): Promise<void> {
  await db.query(
    `INSERT INTO portal.tmc_user_roles (user_id, role, actualizado_por_id, actualizado_por, actualizado_en)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       role = EXCLUDED.role, actualizado_por_id = EXCLUDED.actualizado_por_id,
       actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
    [userId, rol, actor.userId, actor.email],
  );
}

export async function existeUsuario(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM portal.users WHERE id = $1', [userId]);
  return rows.length > 0;
}

/**
 * La gente a la que se le puede ver o repartir rol: quien tiene la app
 * asignada, quien ya tiene un rol guardado (aunque le hayan quitado la app) y
 * los administradores del portal, que entran en todas las apps sin tenerla
 * asignada. Por nombre. `admin` avisa de que esa persona lo puede todo tenga
 * el rol que tenga.
 */
export async function listarUsuariosRol(db: Db, appId: string): Promise<UsuarioRol[]> {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.status, u.role AS portal_role, r.role
       FROM portal.users u
       LEFT JOIN portal.tmc_user_roles r ON r.user_id = u.id
      WHERE r.user_id IS NOT NULL
         OR u.role = 'admin'
         OR EXISTS (SELECT 1 FROM portal.user_apps a WHERE a.user_id = u.id AND a.app_id = $1)
      ORDER BY u.full_name, u.email`,
    [appId],
  );
  return (rows as Row[]).map((r) => ({
    userId: r.id,
    fullName: r.full_name,
    email: r.email,
    status: r.status,
    admin: r.portal_role === 'admin',
    role: resolverRol(r.role),
  }));
}
