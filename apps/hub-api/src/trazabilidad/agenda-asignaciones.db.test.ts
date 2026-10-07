import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearPoolDesk2 } from '../db-desk2.js';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import type { AgendaTaller } from './agenda.js';
import type { EtapaAgenda } from './dominio.js';
import { crearFuenteAgenda } from './fuente.js';
import * as repo from './repo.js';

// Lote 4 de la agenda del taller contra Postgres: las migraciones 052 y 053
// (que se repiten en cada arranque), las asignaciones de puesto, el reparto
// inicial, la liberación a mano, el flujo marcado a mano y la lectura que lo
// reúne todo. La fuente principal es la imitación de Desk 2.0 del contenedor
// de prueba (asegurarDesk2). Números de ticket ficticios: el repo es público.

let hub: Pool;
let admin2: Pool;
let lector: Pool;

const HOY = '2026-10-06'; // martes; el lunes 12/10/2026 es festivo en Colombia
const AHORA = Date.UTC(2026, 9, 6, 13, 30, 0);
const actor = { userId: '00000000-0000-4000-8000-000000000001', email: 'director@ambientalia.com.co' };
const otro = { userId: '00000000-0000-4000-8000-000000000002', email: 'direccion@ambientalia.com.co' };

const leer = (fichero: string) => readFileSync(fileURLToPath(new URL(`../users/migrations/${fichero}`, import.meta.url)), 'utf8');
const SQL_050 = leer('050_trazabilidad_estados_categoria.sql');
const SQL_051 = leer('051_trazabilidad_agenda_config.sql');
const SQL_052 = leer('052_trazabilidad_agenda_asignaciones.sql');
const SQL_053 = leer('053_trazabilidad_agenda_flujo.sql');

const principal = () => crearFuenteAgenda({ hub, desk2: () => lector, ahora: () => AHORA });
const respaldo = () => crearFuenteAgenda({ hub, desk2: () => null, ahora: () => AHORA });

/** Un ticket en la «base de Desk 2.0». */
const ticket = (numero: number, estado: string, extra: { remision?: string | null; clasificacion?: string | null; tipo?: string | null } = {}) =>
  admin2.query(
    `INSERT INTO desk.tickets (id, number, status, status_type, classification, tipo_servicio, fecha_remision_entrada, synced_at)
     VALUES ($1, $2, $3, 'Open', $4, $5, $6, '2026-10-06T13:00:00Z')`,
    [`z-${numero}`, numero, estado, extra.clasificacion === undefined ? 'Equipo Para Servicio' : extra.clasificacion, extra.tipo === undefined ? 'Diagnostico' : extra.tipo, extra.remision ?? null],
  );

/** Cuatro en Diagnóstico (por fecha de remisión), uno en la fila de entrada que llegó antes, uno en Proceso y uno en standby. */
async function sembrar(): Promise<void> {
  await ticket(2001, 'Rev./Diagnostico', { remision: '2026-09-01' });
  await ticket(2002, 'Rev./Diagnostico', { remision: '2026-09-02' });
  await ticket(2003, 'Notificado', { remision: '2026-09-03' });
  await ticket(2004, 'Rev./Diagnostico', { remision: '2026-09-04' });
  await ticket(2005, 'Ingresado', { remision: '2026-08-01' });
  await ticket(2010, 'En Proceso');
  await ticket(2020, 'Notificación cliente');
}

interface FilaAsignacion {
  numero: number;
  etapa: string;
  puesto: number;
  inicio: string;
  vigente: boolean;
  origen: string;
  sugerido: number | null;
  motivo: string | null;
  asignado_por_id: string | null;
  asignado_por: string;
  cierre: string | null;
  cierre_motivo: string | null;
  cerrado_por_id: string | null;
  cerrado_por: string | null;
}
const asignaciones = async () =>
  (
    await hub.query(
      `SELECT numero, etapa, puesto, inicio::text AS inicio, hasta IS NULL AS vigente, origen, sugerido, motivo,
              asignado_por_id::text AS asignado_por_id, asignado_por, cierre, cierre_motivo, cerrado_por_id::text AS cerrado_por_id, cerrado_por
         FROM portal.tmc_agenda_asignaciones ORDER BY id`,
    )
  ).rows as FilaAsignacion[];
const vigentes = async () => (await asignaciones()).filter((a) => a.vigente).map((a) => [a.numero, a.etapa, a.puesto]);
/** Una asignación metida por SQL, sin pasar por las reglas del repo. */
const insertar = (numero: number, etapa: string, puesto: number, extra: Record<string, unknown> = {}) => {
  const fila: Record<string, unknown> = { numero, etapa, puesto, inicio: HOY, origen: 'fila', asignado_por: actor.email, ...extra };
  const cols = Object.keys(fila);
  return hub.query(`INSERT INTO portal.tmc_agenda_asignaciones (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(fila));
};
const flujos = async () => (await hub.query(`SELECT numero, flujo, actualizado_por_id::text AS por_id, actualizado_por FROM portal.tmc_agenda_flujo ORDER BY numero`)).rows;
const etapaDe = (a: AgendaTaller, etapa: EtapaAgenda) => a.etapas.find((e) => e.etapa === etapa)!;
const fila = (a: AgendaTaller, etapa: EtapaAgenda) => etapaDe(a, etapa).fila.map((t) => t.numero);
const ocupantes = (a: AgendaTaller, etapa: EtapaAgenda) => etapaDe(a, etapa).puestos.map((p) => p.ocupante?.numero ?? null);
const error = (status: number, extra: Record<string, unknown> = {}) => expect.objectContaining({ name: 'TzError', status, ...extra });

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  const urls = await asegurarDesk2(hub);
  admin2 = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
});
afterAll(async () => {
  await Promise.all([lector?.end(), admin2?.end(), hub?.end()]);
});
// Cada prueba empieza como una base recién migrada, con la configuración de partida (3 / 4 / 2 puestos) y sin tickets.
beforeEach(async () => {
  await hub.query(
    `TRUNCATE desk.tickets, portal.tmc_agenda_asignaciones, portal.tmc_agenda_flujo, portal.tmc_agenda_historial, portal.tmc_servicios_tipo,
              portal.tmc_estados_desk, portal.tmc_agenda_etapas, portal.tmc_agenda_duraciones RESTART IDENTITY`,
  );
  await hub.query(SQL_050);
  await hub.query(SQL_051);
  await admin2.query('TRUNCATE desk.tickets, desk.ticket_transitions, public.calendario_cierres RESTART IDENTITY');
});

describe('migraciones 052 y 053', () => {
  it('no siembran nada, y ejecutarlas dos veces más (cada arranque) no falla ni toca lo guardado', async () => {
    expect(await asignaciones()).toEqual([]);
    expect(await flujos()).toEqual([]);
    await insertar(2001, 'diagnostico', 1);
    await insertar(2002, 'diagnostico', 2, { hasta: '2030-01-01T00:00:00Z', cierre: 'manual', cierre_motivo: 'se fue a garantía', cerrado_por: otro.email });
    await hub.query(`INSERT INTO portal.tmc_agenda_flujo (numero, flujo, actualizado_por) VALUES (2001, 'equipo_nuevo', $1)`, [actor.email]);
    const antes = [await asignaciones(), await flujos()];
    for (let i = 0; i < 2; i++) {
      await hub.query(SQL_052);
      await hub.query(SQL_053);
    }
    expect([await asignaciones(), await flujos()]).toEqual(antes);
  });

  it('como mucho una asignación vigente por ticket, y como mucho un ocupante vigente por etapa y puesto', async () => {
    await insertar(2001, 'diagnostico', 1);
    await expect(insertar(2001, 'proceso', 1)).rejects.toMatchObject({ code: '23505', constraint: 'tmc_agenda_asig_ticket_uq' });
    await expect(insertar(2002, 'diagnostico', 1)).rejects.toMatchObject({ code: '23505', constraint: 'tmc_agenda_asig_puesto_uq' });
    // El mismo número de puesto en otra etapa es otro puesto, y una asignación cerrada no ocupa ni ata al ticket.
    await insertar(2002, 'proceso', 1);
    await hub.query(`UPDATE portal.tmc_agenda_asignaciones SET hasta = NOW() + INTERVAL '1 second', cierre = 'estado' WHERE numero = 2001`);
    await insertar(2003, 'diagnostico', 1);
    await insertar(2001, 'verificacion', 2);
    expect(await vigentes()).toEqual([[2002, 'proceso', 1], [2003, 'diagnostico', 1], [2001, 'verificacion', 2]]);
  });

  it('los CHECK: puesto, etapa, origen, cierre con su fecha, motivo al saltarse la fila y al liberar a mano, y el flujo', async () => {
    const mal = (extra: Record<string, unknown>, puesto = 1, etapa = 'diagnostico') => expect(insertar(2001, etapa, puesto, extra)).rejects.toMatchObject({ code: '23514' });
    await mal({}, 0);
    await mal({}, 51);
    await mal({}, 1, 'entrega');
    await mal({ numero: 0 });
    await mal({ origen: 'magia' });
    await mal({ cierre: 'estado' }); // cerrada sin fecha
    await mal({ hasta: '2030-01-01T00:00:00Z' }); // con fecha y sin decir cómo se cerró
    await mal({ hasta: '2030-01-01T00:00:00Z', cierre: 'porque sí' });
    await mal({ hasta: '2000-01-01T00:00:00Z', cierre: 'estado' }); // acaba antes de empezar
    await mal({ sugerido: 2002 }); // se saltó la fila sin motivo
    await mal({ sugerido: 2002, motivo: '   ' });
    await mal({ hasta: '2030-01-01T00:00:00Z', cierre: 'manual' }); // liberada a mano sin motivo ni firma
    await mal({ hasta: '2030-01-01T00:00:00Z', cierre: 'manual', cierre_motivo: ' ', cerrado_por: otro.email });
    await mal({ hasta: '2030-01-01T00:00:00Z', cierre: 'manual', cierre_motivo: 'x' });
    await insertar(2001, 'diagnostico', 1, { sugerido: 2002, motivo: 'urgente para el cliente' });
    await insertar(2002, 'diagnostico', 2, { origen: 'arranque', sugerido: 2001 }); // en el reparto inicial no se pide motivo
    await insertar(2003, 'proceso', 1, { hasta: '2030-01-01T00:00:00Z', cierre: 'reparto' });
    await expect(hub.query(`INSERT INTO portal.tmc_agenda_flujo (numero, flujo, actualizado_por) VALUES (2001, 'garantia', 'x')`)).rejects.toMatchObject({ code: '23514' });
    await expect(hub.query(`INSERT INTO portal.tmc_agenda_flujo (numero, flujo, actualizado_por) VALUES (0, 'servicio', 'x')`)).rejects.toMatchObject({ code: '23514' });
  });
});

describe('asignar', () => {
  beforeEach(sembrar);

  it('al primero de la fila que ya está en la etapa, sin motivo: queda vigente, firmada y ocupando el puesto', async () => {
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 2 }, actor, HOY);
    expect(await asignaciones()).toEqual([
      { numero: 2001, etapa: 'diagnostico', puesto: 2, inicio: HOY, vigente: true, origen: 'fila', sugerido: 2001, motivo: null, asignado_por_id: actor.userId, asignado_por: actor.email, cierre: null, cierre_motivo: null, cerrado_por_id: null, cerrado_por: null },
    ]);
    const a = await repo.leerAgenda(hub, principal(), HOY);
    expect(ocupantes(a, 'diagnostico')).toEqual([null, 2001, null]);
    expect(etapaDe(a, 'diagnostico').puestos[1]).toMatchObject({ inicio: HOY, finEstimado: '2026-10-09', pasadoDeFecha: false });
    // El 2005 sigue delante en la fila (llegó antes), pero espera en la fila de entrada: no se le puede dar puesto.
    expect(fila(a, 'diagnostico')).toEqual([2005, 2002, 2003, 2004]);
  });

  it('rechaza un puesto ocupado, y no escribe nada', async () => {
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, HOY);
    await expect(repo.asignar(hub, principal(), { numero: 2002, etapa: 'diagnostico', puesto: 1 }, actor, HOY)).rejects.toEqual(error(409, { code: 'puesto_ocupado' }));
    expect(await vigentes()).toEqual([[2001, 'diagnostico', 1]]);
  });

  it('a quien no es el primero le exige motivo, y lo guarda con a quién se saltó', async () => {
    await expect(repo.asignar(hub, principal(), { numero: 2003, etapa: 'diagnostico', puesto: 1 }, actor, HOY)).rejects.toEqual(error(400, { field: 'motivo' }));
    await expect(repo.asignar(hub, principal(), { numero: 2003, etapa: 'diagnostico', puesto: 1, motivo: '   ' }, actor, HOY)).rejects.toEqual(error(400, { field: 'motivo' }));
    expect(await asignaciones()).toEqual([]);
    await repo.asignar(hub, principal(), { numero: 2003, etapa: 'diagnostico', puesto: 1, motivo: '  El cliente lo necesita el jueves ' }, actor, HOY);
    expect(await asignaciones()).toMatchObject([{ numero: 2003, puesto: 1, sugerido: 2001, motivo: 'El cliente lo necesita el jueves', origen: 'fila' }]);
    // Con el 2003 ya sentado, el primero vuelve a ser el 2001: no hace falta motivo.
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 3 }, otro, HOY);
    expect((await asignaciones())[1]).toMatchObject({ numero: 2001, sugerido: 2001, motivo: null, asignado_por: otro.email });
  });

  it('falla si el ticket no está en esa etapa según la fuente: otra etapa, fila de entrada, standby o desconocido', async () => {
    const pide = (numero: number, etapa: EtapaAgenda) => repo.asignar(hub, principal(), { numero, etapa, puesto: 1, motivo: 'da igual' }, actor, HOY);
    await expect(pide(2010, 'diagnostico')).rejects.toEqual(error(409, { code: 'ticket_fuera_de_etapa' }));
    await expect(pide(2001, 'proceso')).rejects.toEqual(error(409, { code: 'ticket_fuera_de_etapa' }));
    await expect(pide(2005, 'diagnostico')).rejects.toEqual(error(409, { code: 'ticket_fuera_de_etapa' }));
    await expect(pide(2020, 'diagnostico')).rejects.toEqual(error(409, { code: 'ticket_fuera_de_etapa' }));
    await expect(pide(9999, 'diagnostico')).rejects.toEqual(error(409, { code: 'ticket_fuera_de_etapa' }));
    expect(await asignaciones()).toEqual([]);
  });

  it('el puesto tiene que estar dentro de los configurados para la etapa, y la entrada se valida antes de leer nada', async () => {
    const pide = (cambio: Record<string, unknown>) => repo.asignar(hub, principal(), cambio as never, actor, HOY);
    await expect(pide({ numero: 2001, etapa: 'diagnostico', puesto: 4 })).rejects.toEqual(error(400, { field: 'puesto' }));
    await expect(pide({ numero: 2001, etapa: 'diagnostico', puesto: 0 })).rejects.toEqual(error(400, { field: 'puesto' }));
    await expect(pide({ numero: 2001, etapa: 'entrega', puesto: 1 })).rejects.toEqual(error(400, { field: 'etapa' }));
    await expect(pide({ numero: 1.5, etapa: 'diagnostico', puesto: 1 })).rejects.toEqual(error(400, { field: 'numero' }));
    await expect(pide({ numero: 2001, etapa: 'diagnostico', puesto: 1, motivo: 'x'.repeat(501) })).rejects.toEqual(error(400, { field: 'motivo' }));
    await repo.guardarPuestosEtapa(hub, { etapa: 'diagnostico', puestos: 4 }, actor);
    await pide({ numero: 2001, etapa: 'diagnostico', puesto: 4 });
    expect(await vigentes()).toEqual([[2001, 'diagnostico', 4]]);
  });

  it('un ticket con puesto no coge otro, tampoco si su asignación quedó atrás al cambiar de etapa: hay que liberarla', async () => {
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, HOY);
    await expect(repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 2 }, actor, HOY)).rejects.toEqual(error(409, { code: 'ticket_con_puesto' }));
    // El ticket pasa a Proceso; su asignación de Diagnóstico sigue vigente hasta la siguiente pasada de la agenda.
    await admin2.query(`UPDATE desk.tickets SET status = 'En Proceso' WHERE number = 2001`);
    await expect(repo.asignar(hub, principal(), { numero: 2001, etapa: 'proceso', puesto: 1, motivo: 'cambió de etapa' }, actor, HOY)).rejects.toEqual(error(409, { code: 'ticket_con_puesto' }));
    await repo.liberar(hub, { numero: 2001, motivo: 'pasó a Proceso' }, actor);
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'proceso', puesto: 1, motivo: 'cambió de etapa' }, actor, HOY);
    expect(await vigentes()).toEqual([[2001, 'proceso', 1]]);
  });

  it('dos peticiones a la vez por el mismo puesto: una lo consigue y la otra recibe el 409', async () => {
    const r = await Promise.allSettled([
      repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, HOY),
      repo.asignar(hub, principal(), { numero: 2002, etapa: 'diagnostico', puesto: 1, motivo: 'a la vez' }, otro, HOY),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toEqual(error(409, { code: 'puesto_ocupado' }));
    expect(await vigentes()).toHaveLength(1);
  });

  it('asignado en un día no hábil, la duración cuenta desde el siguiente hábil (D16)', async () => {
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, '2026-10-10');
    expect((await asignaciones())[0].inicio).toBe('2026-10-13');
  });
});

describe('reparto inicial (D6)', () => {
  beforeEach(sembrar);

  it('proponer no escribe: da los puestos libres de cada etapa en el orden de la proyección', async () => {
    expect(await repo.proponerRepartoInicial(hub, principal(), HOY)).toEqual([
      { numero: 2001, etapa: 'diagnostico', puesto: 1, desde: HOY },
      { numero: 2002, etapa: 'diagnostico', puesto: 2, desde: HOY },
      { numero: 2003, etapa: 'diagnostico', puesto: 3, desde: HOY },
      { numero: 2010, etapa: 'proceso', puesto: 1, desde: HOY },
    ]);
    expect(await asignaciones()).toEqual([]);
  });

  it('confirmar la propuesta la guarda entera, firmada y con origen «arranque»; lo que no cabe queda en la fila', async () => {
    const propuesta = await repo.proponerRepartoInicial(hub, principal(), HOY);
    expect(await repo.confirmarRepartoInicial(hub, principal(), propuesta, actor, HOY)).toBe(4);
    const filas = await asignaciones();
    expect(filas.map((a) => [a.numero, a.etapa, a.puesto, a.inicio, a.origen, a.sugerido, a.asignado_por, a.vigente])).toEqual([
      [2001, 'diagnostico', 1, HOY, 'arranque', 2001, actor.email, true],
      [2002, 'diagnostico', 2, HOY, 'arranque', 2002, actor.email, true],
      [2003, 'diagnostico', 3, HOY, 'arranque', 2003, actor.email, true],
      [2010, 'proceso', 1, HOY, 'arranque', 2010, actor.email, true],
    ]);
    const a = await repo.leerAgenda(hub, principal(), HOY);
    expect(ocupantes(a, 'diagnostico')).toEqual([2001, 2002, 2003]);
    expect(fila(a, 'diagnostico')).toEqual([2005, 2004]);
    expect(etapaDe(a, 'diagnostico').saturacion).toEqual({ ocupados: 3, puestos: 3 });
    // Ya no queda nada que proponer en Diagnóstico ni en Proceso.
    expect(await repo.proponerRepartoInicial(hub, principal(), HOY)).toEqual([]);
  });

  it('ajustada por el Director Técnico: otro ticket en un puesto no pide motivo, y queda a quién se proponía', async () => {
    const n = await repo.confirmarRepartoInicial(hub, principal(), [{ numero: 2004, etapa: 'diagnostico', puesto: 1 }, { numero: 2001, etapa: 'diagnostico', puesto: 3 }], actor, HOY);
    expect(n).toBe(2);
    expect((await asignaciones()).map((a) => [a.numero, a.puesto, a.sugerido, a.motivo, a.origen])).toEqual([[2004, 1, 2001, null, 'arranque'], [2001, 3, 2003, null, 'arranque']]);
    expect(await repo.proponerRepartoInicial(hub, principal(), HOY)).toMatchObject([{ numero: 2002, puesto: 2 }, { numero: 2010, etapa: 'proceso' }]);
  });

  it('todo o nada: si una línea no vale no se guarda ninguna', async () => {
    const confirma = (lineas: { numero: number; etapa: EtapaAgenda; puesto: number }[]) => repo.confirmarRepartoInicial(hub, principal(), lineas, actor, HOY);
    const buena = { numero: 2001, etapa: 'diagnostico' as const, puesto: 1 };
    await expect(confirma([buena, { numero: 2005, etapa: 'diagnostico', puesto: 2 }])).rejects.toEqual(error(409, { code: 'ticket_fuera_de_etapa' }));
    await expect(confirma([buena, { numero: 2002, etapa: 'diagnostico', puesto: 4 }])).rejects.toEqual(error(400, { field: 'puesto' }));
    await expect(confirma([buena, { numero: 2002, etapa: 'diagnostico', puesto: 1 }])).rejects.toEqual(error(400, { field: 'reparto' }));
    await expect(confirma([buena, { numero: 2001, etapa: 'diagnostico', puesto: 2 }])).rejects.toEqual(error(400, { field: 'reparto' }));
    await expect(repo.confirmarRepartoInicial(hub, principal(), 'todo' as never, actor, HOY)).rejects.toEqual(error(400, { field: 'reparto' }));
    expect(await asignaciones()).toEqual([]);
  });

  it('todo o nada también cuando lo que falla es la base: la transacción entera se deshace', async () => {
    // El 2010 está en Proceso pero arrastra una asignación vigente de Diagnóstico que la proyección ya no cuenta:
    // la primera línea se inserta, la segunda choca con el índice único del ticket, y no debe quedar ninguna.
    await insertar(2010, 'diagnostico', 3);
    const lineas = [{ numero: 2001, etapa: 'diagnostico' as const, puesto: 1 }, { numero: 2010, etapa: 'proceso' as const, puesto: 1 }];
    await expect(repo.confirmarRepartoInicial(hub, principal(), lineas, actor, HOY)).rejects.toEqual(error(409, { code: 'ticket_con_puesto' }));
    expect(await vigentes()).toEqual([[2010, 'diagnostico', 3]]);
    // Y con el puesto: la proyección da por libre el 3 de Diagnóstico, que en la tabla sigue ocupado.
    await expect(repo.confirmarRepartoInicial(hub, principal(), [lineas[0], { numero: 2002, etapa: 'diagnostico', puesto: 3 }], actor, HOY)).rejects.toEqual(error(409, { code: 'puesto_ocupado' }));
    expect(await vigentes()).toEqual([[2010, 'diagnostico', 3]]);
  });

  it('sólo rellena puestos libres: un puesto ya ocupado no se pisa', async () => {
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, HOY);
    await expect(repo.confirmarRepartoInicial(hub, principal(), [{ numero: 2002, etapa: 'diagnostico', puesto: 1 }], actor, HOY)).rejects.toEqual(error(409, { code: 'puesto_ocupado' }));
    expect(await repo.confirmarRepartoInicial(hub, principal(), [], actor, HOY)).toBe(0);
    expect(await vigentes()).toEqual([[2001, 'diagnostico', 1]]);
  });
});

describe('liberar (D7)', () => {
  beforeEach(sembrar);

  it('cierra la asignación vigente a mano, con motivo y firma, y el puesto vuelve a estar libre', async () => {
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, HOY);
    await repo.liberar(hub, { numero: 2001, motivo: '  El equipo se devolvió sin reparar ' }, otro);
    expect(await asignaciones()).toMatchObject([
      { numero: 2001, vigente: false, cierre: 'manual', cierre_motivo: 'El equipo se devolvió sin reparar', cerrado_por_id: otro.userId, cerrado_por: otro.email, asignado_por: actor.email },
    ]);
    const { rows } = await hub.query(`SELECT hasta >= desde AS ordenado FROM portal.tmc_agenda_asignaciones`);
    expect(rows).toEqual([{ ordenado: true }]);
    const a = await repo.leerAgenda(hub, principal(), HOY);
    expect(ocupantes(a, 'diagnostico')).toEqual([null, null, null]);
    expect(fila(a, 'diagnostico')).toEqual([2005, 2001, 2002, 2003, 2004]);
    // Vuelve a poderse asignar, y queda la historia: una cerrada y una vigente.
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, HOY);
    expect((await asignaciones()).map((x) => x.vigente)).toEqual([false, true]);
  });

  it('exige motivo, y no hay nada que liberar si el ticket no tiene puesto', async () => {
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, HOY);
    await expect(repo.liberar(hub, { numero: 2001, motivo: '  ' }, actor)).rejects.toEqual(error(400, { field: 'motivo' }));
    await expect(repo.liberar(hub, { numero: 2001 } as never, actor)).rejects.toEqual(error(400, { field: 'motivo' }));
    await expect(repo.liberar(hub, { numero: 2002, motivo: 'no tiene puesto' }, actor)).rejects.toEqual(error(404));
    expect(await vigentes()).toEqual([[2001, 'diagnostico', 1]]);
    await repo.liberar(hub, { numero: 2001, motivo: 'ahora sí' }, actor);
    await expect(repo.liberar(hub, { numero: 2001, motivo: 'otra vez' }, actor)).rejects.toEqual(error(404));
  });
});

describe('flujo marcado a mano (D11)', () => {
  beforeEach(async () => {
    await ticket(2101, 'Ingresado', { clasificacion: null, remision: '2026-09-01' });
    await ticket(2102, 'Ingresado', { clasificacion: 'Equipo Para Servicio', remision: '2026-09-02' });
  });

  it('sólo cuando la fuente no trae clasificación: se guarda firmado y cambia a qué etapa alimenta el ticket', async () => {
    expect(fila(await repo.leerAgenda(hub, principal(), HOY), 'diagnostico')).toEqual([2101, 2102]);
    await repo.marcarFlujo(hub, principal(), 2101, 'equipo_nuevo', actor);
    expect(await flujos()).toEqual([{ numero: 2101, flujo: 'equipo_nuevo', por_id: actor.userId, actualizado_por: actor.email }]);
    const a = await repo.leerAgenda(hub, principal(), HOY);
    expect(fila(a, 'proceso')).toEqual([2101]);
    expect(fila(a, 'diagnostico')).toEqual([2102]);
    await repo.marcarFlujo(hub, principal(), 2101, 'servicio', otro);
    expect(await flujos()).toEqual([{ numero: 2101, flujo: 'servicio', por_id: otro.userId, actualizado_por: otro.email }]);
    // Quitarla vuelve al flujo de la fuente.
    await repo.marcarFlujo(hub, principal(), 2101, null, actor);
    expect(await flujos()).toEqual([]);
  });

  it('con clasificación en la fuente no se marca (409), y una marca anterior deja de valer cuando la fuente la trae', async () => {
    await expect(repo.marcarFlujo(hub, principal(), 2102, 'equipo_nuevo', actor)).rejects.toEqual(error(409, { code: 'flujo_de_la_fuente' }));
    expect(await flujos()).toEqual([]);
    await repo.marcarFlujo(hub, principal(), 2101, 'equipo_nuevo', actor);
    await admin2.query(`UPDATE desk.tickets SET classification = 'Equipo Para Servicio' WHERE number = 2101`);
    expect(fila(await repo.leerAgenda(hub, principal(), HOY), 'diagnostico')).toEqual([2101, 2102]);
    // Quitar la marca se puede siempre.
    await repo.marcarFlujo(hub, principal(), 2101, null, actor);
    expect(await flujos()).toEqual([]);
  });

  it('valida el flujo y el ticket: 400 con un flujo que no existe, 404 si la fuente no lo trae abierto', async () => {
    await expect(repo.marcarFlujo(hub, principal(), 2101, 'garantia' as never, actor)).rejects.toEqual(error(400, { field: 'flujo' }));
    await expect(repo.marcarFlujo(hub, principal(), 0, 'servicio', actor)).rejects.toEqual(error(400, { field: 'numero' }));
    await expect(repo.marcarFlujo(hub, principal(), 9999, 'servicio', actor)).rejects.toEqual(error(404));
    expect(await flujos()).toEqual([]);
  });
});

describe('leerAgenda: todo lo que necesita la proyección, reunido', () => {
  beforeEach(sembrar);

  it('tipo puesto a mano, cierres de empresa, asignaciones vigentes y quién vuelve de standby', async () => {
    await hub.query(`INSERT INTO portal.tmc_servicios_tipo (numero, clave, etiqueta, actualizado_por) VALUES (2002, 'calibracion', 'Calibración', $1)`, [actor.email]);
    await repo.guardarDuracionEtapa(hub, { etapa: 'diagnostico', tipo: 'Calibración', dias: 1 }, actor);
    await admin2.query(`INSERT INTO public.calendario_cierres (fecha) VALUES ('2026-10-07')`);
    // El 2001 tiene puesto; una asignación ya cerrada del 2004 no cuenta.
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, HOY);
    await insertar(2004, 'diagnostico', 2, { hasta: '2030-01-01T00:00:00Z', cierre: 'estado' });
    // El historial de la agenda vio al 2003 volver de «Notificación cliente» a Diagnóstico.
    await hub.query(
      `INSERT INTO portal.tmc_agenda_historial (numero, clave, etiqueta, desde, hasta, desde_real) VALUES
         (2003, 'notificacion cliente', 'Notificación cliente', '2026-10-01T15:00:00Z', '2026-10-05T15:00:00Z', FALSE),
         (2003, 'notificado', 'Notificado', '2026-10-05T15:00:00Z', NULL, TRUE),
         (2002, 'rev./diagnostico', 'Rev./Diagnostico', '2026-10-01T15:00:00Z', NULL, FALSE)`,
    );
    const a = await repo.leerAgenda(hub, principal(), HOY);
    expect(a).toMatchObject({ hoy: HOY, totalAbiertos: 7, fuente: { fuente: 'principal', motivo: null }, avisos: [] });
    const diag = etapaDe(a, 'diagnostico');
    // Con el cierre del miércoles 7: jue 8, vie 9 y mar 13 (el lunes 12 es festivo).
    expect(diag.puestos[0]).toMatchObject({ ocupante: { numero: 2001 }, inicio: HOY, finEstimado: '2026-10-13' });
    expect(diag.fila.map((t) => [t.numero, t.motivo, t.duracionDias, t.entradaPrevista, t.finPrevisto])).toEqual([
      [2005, 'remision', 3, HOY, '2026-10-13'],
      [2002, 'remision', 1, HOY, '2026-10-08'],
      [2004, 'remision', 3, '2026-10-08', '2026-10-14'],
      [2003, 'vuelta_standby', 3, '2026-10-13', '2026-10-16'],
    ]);
    expect(a.standby.map((t) => t.numero)).toEqual([2020]);
    expect(fila(a, 'proceso')).toEqual([2010]);
  });

  it('en respaldo lee la réplica y lo avisa; las asignaciones se conservan aunque la réplica no traiga el ticket', async () => {
    await repo.asignar(hub, principal(), { numero: 2001, etapa: 'diagnostico', puesto: 1 }, actor, HOY);
    await hub.query(`INSERT INTO desk.tickets (number, subject, status, status_type, synced_at) VALUES (2002, 'Servicio', 'Rev./Diagnostico', 'Open', '2026-10-06T13:00:00Z')`);
    const a = await repo.leerAgenda(hub, respaldo(), HOY);
    expect(a.fuente).toMatchObject({ fuente: 'respaldo', motivo: 'sin_variable' });
    expect(a.avisos.map((x) => x.codigo)).toEqual(['fuente_respaldo']);
    expect(etapaDe(a, 'diagnostico').puestos[0].ocupante).toMatchObject({ numero: 2001, estado: null, marcas: { sinDatosFuente: true } });
    expect(fila(a, 'diagnostico')).toEqual([2002]);
  });
});
