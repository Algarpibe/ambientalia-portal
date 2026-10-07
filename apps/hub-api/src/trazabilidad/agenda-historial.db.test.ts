import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearPoolDesk2 } from '../db-desk2.js';
import { asegurarDesk2, asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import type { EtapaAgenda } from './dominio.js';
import { crearFuenteAgenda } from './fuente.js';
import * as repo from './repo.js';

// Lote 4b de la agenda del taller contra Postgres: el historial PROPIO de la
// agenda (migración 054), que se apunta desde la fuente principal y nunca en
// respaldo, y el cierre automático de las asignaciones en esa misma pasada.
// El historial de «Servicios» (tmc_estados_historial, desde la réplica) sigue
// aparte y con su propio bloqueo. Números de ticket ficticios.

let hub: Pool;
let admin2: Pool;
let lector: Pool;
let caida: Pool; // una «principal» configurada que no contesta: puerto cerrado

const HOY = '2026-10-06';
const AHORA = Date.UTC(2026, 9, 6, 13, 30, 0);
const actor = { userId: '00000000-0000-4000-8000-000000000001', email: 'director@ambientalia.com.co' };

const leer = (fichero: string) => readFileSync(fileURLToPath(new URL(`../users/migrations/${fichero}`, import.meta.url)), 'utf8');
const SQL_050 = leer('050_trazabilidad_estados_categoria.sql');
const SQL_051 = leer('051_trazabilidad_agenda_config.sql');
const SQL_054 = leer('054_trazabilidad_agenda_historial.sql');

const principal = () => crearFuenteAgenda({ hub, desk2: () => lector, ahora: () => AHORA });
const respaldo = () => crearFuenteAgenda({ hub, desk2: () => null, ahora: () => AHORA });
const principalCaida = () => crearFuenteAgenda({ hub, desk2: () => caida, ahora: () => AHORA });
const pasada = () => repo.registrarEstadosAgenda(hub, principal());

const ticket = (numero: number, estado: string, remision: string | null = null) =>
  admin2.query(
    `INSERT INTO desk.tickets (id, number, status, status_type, classification, tipo_servicio, fecha_remision_entrada, synced_at)
     VALUES ($1, $2, $3, 'Open', 'Equipo Para Servicio', 'Diagnostico', $4, '2026-10-06T13:00:00Z')`,
    [`z-${numero}`, numero, estado, remision],
  );
const mover = (numero: number, estado: string) => admin2.query(`UPDATE desk.tickets SET status = $2 WHERE number = $1`, [numero, estado]);
/** Un ticket en la RÉPLICA, la que lee «Servicios». */
const enReplica = (numero: number, estado: string) =>
  hub.query(`INSERT INTO desk.tickets (number, subject, status, status_type, synced_at) VALUES ($1, 'Servicio', $2, 'Open', '2026-10-06T13:00:00Z')`, [numero, estado]);

async function sembrar(): Promise<void> {
  await ticket(2001, 'Rev./Diagnostico', '2026-09-01');
  await ticket(2002, 'Rev./Diagnostico', '2026-09-02');
  await ticket(2003, 'Notificado', '2026-09-03');
  await ticket(2004, 'Rev./Diagnostico', '2026-09-04');
  await ticket(2010, 'En Proceso');
  await ticket(2020, 'Notificación cliente');
}

interface Tramo {
  numero: number;
  clave: string;
  abierto: boolean;
  desde_real: boolean;
  desde: string;
  hasta: string | null;
}
const tramos = async (tabla: 'tmc_agenda_historial' | 'tmc_estados_historial') =>
  (await hub.query(`SELECT numero, clave, hasta IS NULL AS abierto, desde_real, desde::text AS desde, hasta::text AS hasta FROM portal.${tabla} ORDER BY numero, desde, id`)).rows as Tramo[];
const deAgenda = () => tramos('tmc_agenda_historial');
const resumen = (ts: Tramo[]) => ts.map((t) => [t.numero, t.clave, t.abierto, t.desde_real]);
const asignaciones = async () =>
  (
    await hub.query(
      `SELECT numero, etapa, puesto, hasta IS NULL AS vigente, hasta::text AS hasta, cierre, cierre_motivo, cerrado_por FROM portal.tmc_agenda_asignaciones ORDER BY id`,
    )
  ).rows as { numero: number; etapa: string; puesto: number; vigente: boolean; hasta: string | null; cierre: string | null; cierre_motivo: string | null; cerrado_por: string | null }[];
const vigentes = async () => (await asignaciones()).filter((a) => a.vigente).map((a) => a.numero);
const asignar = (numero: number, etapa: EtapaAgenda, puesto: number) => repo.asignar(hub, principal(), { numero, etapa, puesto, motivo: 'reparto de prueba' }, actor, HOY);
const fila = async (etapa: EtapaAgenda) => (await repo.leerAgenda(hub, principal(), HOY)).etapas.find((e) => e.etapa === etapa)!.fila.map((t) => [t.numero, t.motivo]);

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  const urls = await asegurarDesk2(hub);
  admin2 = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
  const muerta = new URL(urls.urlLector);
  muerta.port = '1';
  caida = crearPoolDesk2(muerta.toString());
});
afterAll(async () => {
  await Promise.all([caida?.end(), lector?.end(), admin2?.end(), hub?.end()]);
});
beforeEach(async () => {
  await hub.query(
    `TRUNCATE desk.tickets, portal.tmc_agenda_historial, portal.tmc_estados_historial, portal.tmc_agenda_asignaciones, portal.tmc_agenda_flujo,
              portal.tmc_servicios_tipo, portal.tmc_estados_desk, portal.tmc_agenda_etapas, portal.tmc_agenda_duraciones RESTART IDENTITY`,
  );
  await hub.query(SQL_050);
  await hub.query(SQL_051);
  await admin2.query('TRUNCATE desk.tickets, desk.ticket_transitions, public.calendario_cierres RESTART IDENTITY');
});

describe('migración 054: el historial de la agenda', () => {
  it('no siembra nada, y ejecutarla dos veces más no falla ni toca lo apuntado', async () => {
    expect(await deAgenda()).toEqual([]);
    await sembrar();
    await pasada();
    await mover(2001, 'Notificación cliente');
    await pasada();
    const antes = await deAgenda();
    expect(antes).toHaveLength(7);
    await hub.query(SQL_054);
    await hub.query(SQL_054);
    expect(await deAgenda()).toEqual(antes);
  });

  it('como mucho un tramo abierto por ticket, y ninguno acaba antes de empezar', async () => {
    const ins = (hasta: string | null) =>
      hub.query(`INSERT INTO portal.tmc_agenda_historial (numero, clave, etiqueta, desde, hasta, desde_real) VALUES (2001, 'ingresado', 'Ingresado', '2026-10-01T00:00:00Z', $1, FALSE)`, [hasta]);
    await ins(null);
    await expect(ins(null)).rejects.toMatchObject({ code: '23505', constraint: 'tmc_agenda_historial_abierto_uq' });
    await ins('2026-10-02T00:00:00Z');
    await expect(ins('2026-09-30T00:00:00Z')).rejects.toMatchObject({ code: '23514' });
  });
});

describe('primer arranque', () => {
  beforeEach(sembrar);

  it('la primera pasada apunta cada ticket como «ya estaba así»: no inventa cambios ni vueltas de standby, y no cierra lo recién asignado', async () => {
    await asignar(2001, 'diagnostico', 1);
    await asignar(2010, 'proceso', 1);
    // El historial de «Servicios» vio al 2002 en standby: no es el de la agenda, no cuenta.
    await hub.query(
      `INSERT INTO portal.tmc_estados_historial (numero, clave, etiqueta, desde, hasta, desde_real) VALUES
         (2002, 'notificacion cliente', 'Notificación cliente', '2026-10-01T15:00:00Z', '2026-10-05T15:00:00Z', FALSE),
         (2002, 'rev./diagnostico', 'Rev./Diagnostico', '2026-10-05T15:00:00Z', NULL, TRUE)`,
    );
    const servicios = await tramos('tmc_estados_historial');
    expect(await pasada()).toEqual({ fuente: 'principal', abiertos: 6, cerrados: 0, asignacionesCerradas: 0 });
    expect(resumen(await deAgenda())).toEqual([
      [2001, 'rev./diagnostico', true, false],
      [2002, 'rev./diagnostico', true, false],
      [2003, 'notificado', true, false],
      [2004, 'rev./diagnostico', true, false],
      [2010, 'en proceso', true, false],
      [2020, 'notificacion cliente', true, false],
    ]);
    expect(await vigentes()).toEqual([2001, 2010]);
    expect(await fila('diagnostico')).toEqual([[2002, 'remision'], [2003, 'remision'], [2004, 'remision']]);
    // La pasada de la agenda no toca el historial de «Servicios».
    expect(await tramos('tmc_estados_historial')).toEqual(servicios);
    // Sin cambios no escribe nada.
    expect(await pasada()).toEqual({ fuente: 'principal', abiertos: 0, cerrados: 0, asignacionesCerradas: 0 });
  });
});

describe('cierre automático de las asignaciones', () => {
  beforeEach(async () => {
    await sembrar();
    await asignar(2001, 'diagnostico', 1);
    await asignar(2002, 'diagnostico', 2);
    await asignar(2003, 'diagnostico', 3);
    await asignar(2010, 'proceso', 1);
    await pasada();
  });

  it('a standby, a fin de taller, a otra etapa y cerrado: las cuatro se cierran solas, con el instante en que se detecta', async () => {
    await mover(2001, 'Notificación cliente');
    await mover(2002, 'Por Facturar');
    await mover(2003, 'En Proceso');
    await admin2.query(`UPDATE desk.tickets SET status = 'Finalizado', status_type = 'Closed' WHERE number = 2010`);
    expect(await pasada()).toEqual({ fuente: 'principal', abiertos: 3, cerrados: 4, asignacionesCerradas: 4 });
    const filas = await asignaciones();
    expect(filas.map((a) => [a.numero, a.vigente, a.cierre, a.cierre_motivo, a.cerrado_por])).toEqual([
      [2001, false, 'estado', null, null],
      [2002, false, 'estado', null, null],
      [2003, false, 'estado', null, null],
      [2010, false, 'estado', null, null],
    ]);
    // El mismo instante cierra el tramo, abre el nuevo y cierra la asignación.
    const h = await deAgenda();
    const instante = h.find((t) => t.numero === 2001 && t.abierto)!.desde;
    expect(h.filter((t) => !t.abierto).map((t) => t.hasta)).toEqual([instante, instante, instante, instante]);
    expect(filas.map((a) => a.hasta)).toEqual([instante, instante, instante, instante]);
    expect(resumen(h.filter((t) => t.abierto && [2001, 2002, 2003].includes(t.numero)))).toEqual([
      [2001, 'notificacion cliente', true, true],
      [2002, 'por facturar', true, true],
      [2003, 'en proceso', true, true],
    ]);
    // Los puestos quedan libres de verdad: se pueden volver a dar.
    await asignar(2004, 'diagnostico', 1);
    await asignar(2003, 'proceso', 1);
    expect(await vigentes()).toEqual([2004, 2003]);
  });

  it('cambiar de estado dentro de la misma etapa no la cierra; un ticket que desaparece de la principal, sí', async () => {
    await mover(2001, 'Notificado');
    await mover(2003, 'Rev./Diagnostico');
    expect(await pasada()).toEqual({ fuente: 'principal', abiertos: 2, cerrados: 2, asignacionesCerradas: 0 });
    expect(await vigentes()).toEqual([2001, 2002, 2003, 2010]);
    await admin2.query(`DELETE FROM desk.tickets WHERE number = 2002`);
    expect(await pasada()).toEqual({ fuente: 'principal', abiertos: 0, cerrados: 1, asignacionesCerradas: 1 });
    expect(await vigentes()).toEqual([2001, 2003, 2010]);
  });

  it('quien sale a standby y vuelve entra al final de la fila de su etapa, y ya sin puesto', async () => {
    await mover(2001, 'Servicio externo');
    await pasada();
    await mover(2001, 'Rev./Diagnostico');
    await pasada();
    expect(await vigentes()).toEqual([2002, 2003, 2010]);
    expect(await fila('diagnostico')).toEqual([[2004, 'remision'], [2001, 'vuelta_standby']]);
  });
});

describe('en respaldo o con la principal caída no se apunta ni se cierra nada', () => {
  beforeEach(async () => {
    await sembrar();
    await asignar(2001, 'diagnostico', 1);
    await pasada();
    // La réplica cuenta otra cosa: no tiene el 2001 y da al 2002 por «Por Facturar».
    await enReplica(2002, 'Por Facturar');
    await enReplica(884, 'Ingresado');
  });

  it.each([
    ['sin la variable', respaldo],
    ['con la principal configurada pero sin contestar', principalCaida],
  ])('%s: la lectura de la réplica no se toma por «todos cerrados»', async (_nombre, fuente) => {
    const antes = [await deAgenda(), await asignaciones()];
    expect(await repo.registrarEstadosAgenda(hub, fuente())).toEqual({ fuente: 'respaldo', abiertos: 0, cerrados: 0, asignacionesCerradas: 0 });
    expect([await deAgenda(), await asignaciones()]).toEqual(antes);
    // «Servicios» sigue apuntando lo suyo, desde la réplica, como siempre.
    expect(await repo.registrarEstados(hub)).toEqual({ abiertos: 2, cerrados: 0 });
    expect(resumen(await tramos('tmc_estados_historial'))).toEqual([[884, 'ingresado', true, false], [2002, 'por facturar', true, false]]);
    expect([await deAgenda(), await asignaciones()]).toEqual(antes);
  });

  it('al volver la principal, la pasada sigue donde estaba: sólo apunta lo que de verdad cambió', async () => {
    await repo.registrarEstadosAgenda(hub, respaldo());
    await mover(2001, 'Notificación cliente');
    expect(await pasada()).toEqual({ fuente: 'principal', abiertos: 1, cerrados: 1, asignacionesCerradas: 1 });
  });

  it('si la principal contesta que no hay ninguno abierto, eso sí cierra', async () => {
    await admin2.query('TRUNCATE desk.tickets');
    expect(await pasada()).toEqual({ fuente: 'principal', abiertos: 0, cerrados: 6, asignacionesCerradas: 1 });
  });
});

describe('pasadas a la vez', () => {
  beforeEach(sembrar);

  it('varias de la agenda a la vez: cada cambio y cada cierre se apunta una sola vez', async () => {
    const suma = (rs: { abiertos: number; cerrados: number; asignacionesCerradas: number }[]) =>
      rs.reduce((s, r) => [s[0] + r.abiertos, s[1] + r.cerrados, s[2] + r.asignacionesCerradas], [0, 0, 0]);
    expect(suma(await Promise.all([pasada(), pasada(), pasada(), pasada()]))).toEqual([6, 0, 0]);
    await asignar(2001, 'diagnostico', 1);
    await mover(2001, 'Notificación cliente');
    await mover(2004, 'Notificado');
    expect(suma(await Promise.all([pasada(), pasada(), pasada(), pasada()]))).toEqual([2, 2, 1]);
    const h = await deAgenda();
    expect(h.filter((t) => t.abierto)).toHaveLength(6);
    expect(h).toHaveLength(8);
    expect(await vigentes()).toEqual([]);
  });

  it('la de «Servicios» y la de la agenda a la vez: cada una apunta en su tabla lo que dice SU base', async () => {
    await enReplica(2001, 'Por Facturar');
    await enReplica(884, 'Ingresado');
    const [s1, a1, s2, a2] = await Promise.all([repo.registrarEstados(hub), pasada(), repo.registrarEstados(hub), pasada()]);
    expect([s1.abiertos + s2.abiertos, a1.abiertos + a2.abiertos]).toEqual([2, 6]);
    expect(resumen(await tramos('tmc_estados_historial'))).toEqual([[884, 'ingresado', true, false], [2001, 'por facturar', true, false]]);
    expect((await deAgenda()).map((t) => t.numero)).toEqual([2001, 2002, 2003, 2004, 2010, 2020]);
    expect((await deAgenda())[0].clave).toBe('rev./diagnostico');
  });

  it('cada una con su bloqueo: la de «Servicios» no espera a la de la agenda, ni al revés', async () => {
    await enReplica(884, 'Ingresado');
    const retener = async (tabla: string) => {
      const c = await hub.connect();
      await c.query('BEGIN');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [tabla]);
      return async () => {
        await c.query('ROLLBACK');
        c.release();
      };
    };
    // Con el bloqueo de la agenda cogido por otro, «Servicios» pasa y la agenda espera.
    let soltar = await retener('portal.tmc_agenda_historial');
    expect(await repo.registrarEstados(hub)).toEqual({ abiertos: 1, cerrados: 0 });
    let acabada = false;
    const enEspera = pasada().then((r) => {
      acabada = true;
      return r;
    });
    await new Promise((ok) => setTimeout(ok, 300));
    expect(acabada).toBe(false);
    await soltar();
    expect((await enEspera).abiertos).toBe(6);
    // Y con el de «Servicios» cogido, la agenda pasa.
    soltar = await retener('portal.tmc_estados_historial');
    await mover(2001, 'Notificado');
    expect(await pasada()).toMatchObject({ abiertos: 1, cerrados: 1 });
    await soltar();
  });
});
