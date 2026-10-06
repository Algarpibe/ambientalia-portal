/**
 * SQL de Trazabilidad Mantenimientos Clientes (tablas portal.tmc_*, migraciones
 * 042 y 043). Fechas como texto AAAA-MM-DD (`::text`) para no depender del parser de
 * DATE del driver ni de la zona horaria del proceso.
 */

import type { Pool } from '@algarpibe/zoho-sync';
import { asignarClaves, asuntoSinCodigo, claveTipoServicio, estadoCalibracion, modeloDeCodigo } from './dominio.js';
import { calcularPlazo } from './plazos.js';
import {
  TzError,
  type Actor,
  type CambioPlazo,
  type EquipoVista,
  type FilaImportada,
  type Importacion,
  type PlazoServicio,
  type ResumenImportacion,
  type Seguimiento,
  type ServicioVista,
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
  const { rows } = await db.query(
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
  }));
}

/** Abierto en Desk: cualquier tipo de estado que no sea 'Closed' (también el vacío). */
const TICKET_ABIERTO = `t.status_type IS DISTINCT FROM 'Closed'`;

/** Plazo configurado (días hábiles) de cada tipo de servicio, por clave normalizada. */
async function plazosPorClave(db: Db): Promise<Map<string, number>> {
  const { rows } = await db.query(`SELECT clave, dias_habiles FROM portal.tmc_plazos WHERE dias_habiles IS NOT NULL`);
  return new Map((rows as Row[]).map((r) => [r.clave as string, Number(r.dias_habiles)]));
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
 * El ingreso es la fecha de creación que trae el ticket o, si falta, el día en
 * Colombia de created_time. El cliente es la cuenta de Desk que viaja en `raw`
 * y, si no viene, el asunto sin el código de servicio.
 */
export async function listarServicios(db: Db, hoy: string): Promise<ServicioVista[]> {
  const [{ rows }, plazos] = await Promise.all([
    db.query(
      `SELECT t.number, t.subject, t.status, t.serial, t.codigo_servicio, t.tipo_servicio,
              COALESCE(t.fecha_creacion_ticket, (t.created_time AT TIME ZONE 'America/Bogota')::date)::text AS ingreso,
              (t.synced_at IS NULL OR t.synced_at < NOW() - INTERVAL '1 day') AS sin_confirmar,
              t.raw->'contact'->'account'->>'accountName' AS cuenta
         FROM desk.tickets t
        WHERE ${TICKET_ABIERTO}
        ORDER BY t.number DESC`,
    ),
    plazosPorClave(db),
  ]);
  return (rows as Row[]).map((r) => {
    const tipoServicio = String(r.tipo_servicio ?? '').trim();
    const plazoDias = plazos.get(claveTipoServicio(tipoServicio)) ?? null;
    const cuenta = String(r.cuenta ?? '').trim();
    return {
      numero: Number(r.number),
      asunto: String(r.subject ?? '').trim(),
      cliente: cuenta || asuntoSinCodigo(r.subject, r.codigo_servicio),
      clienteDeAsunto: !cuenta,
      serial: String(r.serial ?? '').trim(),
      modelo: modeloDeCodigo(r.codigo_servicio),
      tipoServicio,
      estado: r.status,
      ingreso: r.ingreso,
      plazoDias,
      ...calcularPlazo(r.ingreso, plazoDias, hoy),
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
      `SELECT trim(t.tipo_servicio) AS tipo, count(*)::int AS n
         FROM desk.tickets t
        WHERE ${TICKET_ABIERTO} AND trim(t.tipo_servicio) <> ''
        GROUP BY 1
        ORDER BY min(t.number)`,
    ),
  ]);
  const m = new Map<string, PlazoServicio>();
  for (const r of guardados.rows as Row[]) {
    m.set(r.clave, {
      clave: r.clave,
      etiqueta: r.etiqueta,
      dias: r.dias_habiles === null ? null : Number(r.dias_habiles),
      ticketsAbiertos: 0,
      actualizadoPor: r.actualizado_por,
      actualizadoEn: r.actualizado_en,
    });
  }
  // Varias grafías del mismo tipo suman en una sola fila; la etiqueta de un
  // tipo nuevo es la del ticket más antiguo que lo trae.
  for (const r of enTickets.rows as Row[]) {
    const clave = claveTipoServicio(r.tipo);
    if (!clave) continue;
    const p = m.get(clave) ?? { clave, etiqueta: r.tipo, dias: null, ticketsAbiertos: 0, actualizadoPor: null, actualizadoEn: null };
    p.ticketsAbiertos += Number(r.n);
    m.set(clave, p);
  }
  return [...m.values()].sort(
    (a, b) => Number(a.dias === null) - Number(b.dias === null) || a.etiqueta.localeCompare(b.etiqueta, 'es'),
  );
}

/**
 * Fija (o vacía, con `dias` null) el plazo de un tipo de servicio y lo firma.
 * Si el tipo ya tiene fila, su etiqueta se conserva: sólo cambia el plazo.
 */
export async function guardarPlazo(db: Db, c: CambioPlazo, actor: Actor): Promise<void> {
  await db.query(
    `INSERT INTO portal.tmc_plazos (clave, etiqueta, dias_habiles, actualizado_por_id, actualizado_por, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (clave) DO UPDATE SET
       dias_habiles = EXCLUDED.dias_habiles, actualizado_por_id = EXCLUDED.actualizado_por_id,
       actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
    [claveTipoServicio(c.tipo), c.tipo.trim(), c.dias, actor.userId, actor.email],
  );
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
