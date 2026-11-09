import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import type { CanalAvisos, CorreoAEnviar, EstadoCanal, ResultadoRemision } from './avisos-correo.js';
import { planAvisos } from './dominio.js';
import { registrarAvisos } from './repo.js';

// «Enviar correo» contra Postgres, con las rutas de verdad: sólo la sesión y el canal de salida son de mentira (aquí
// no sale nada a la red ni se lee el entorno). Todo ficticio: clientes, seriales y correos.

const SECRET = 'test-secret-avisos-envios';
process.env.JWT_SECRET = SECRET;
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async () => ({ rows: [{ role: 'admin', status: 'active', apps: ['trazabilidad-mantenimientos'], token_version: 0 }], rowCount: 1 }),
    on: () => {},
  }),
}));
/** Lo que se manda a Sentry: aquí se apunta para mirarlo. */
const capturados = vi.hoisted(() => [] as { e: unknown; contexto?: Record<string, unknown> }[]);
vi.mock('../sentry.js', async (original) => ({ ...(await original<typeof import('../sentry.js')>()), captureError: (e: unknown, contexto?: Record<string, unknown>) => void capturados.push({ e, contexto }) }));
const { createTrazabilidadRouter } = await import('./router.js');

const HOY = hoyEnColombia();
const dia = (delta: number): string => new Date(Date.parse(`${HOY}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
const VENCE_EN_10 = dia(-355); // GRIMM: vence dentro de 10 días → tramo 30
const VENCIO_HACE_35 = dia(-400); // vencida en el último año → tramo «vencida»
const BUZON = 'buzon-prueba@ambientalia.com.co';
const PRUEBA: EstadoCanal = { modo: 'prueba', motivo: null, buzonPrueba: BUZON };
const REAL: EstadoCanal = { modo: 'real', motivo: null, buzonPrueba: null };

let estado: EstadoCanal = PRUEBA;
let contestar: (c: CorreoAEnviar) => Promise<ResultadoRemision> = async () => ({ tipo: 'enviado', messageId: 'msg-ficticio-1' });
const remitidos: CorreoAEnviar[] = [];
const canal: CanalAvisos = {
  estado: () => estado,
  remitir: async (c) => {
    remitidos.push(c);
    return contestar(c);
  },
};

let hub: Pool;
let api: express.Express;
const como = { Authorization: `Bearer ${jwt.sign({ sub: 'comercial@example.com', user_id: '00000000-0000-4000-8000-0000000000c1', token_version: 0 }, SECRET, { algorithm: 'HS256' })}` };
const TARJETA = { claveCliente: 'cliente ficticio a', tramo: 30, equipos: ['18A00001', '18A00002'] };

const enPortal = (clave: string, ultima: string) => hub.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion) VALUES ($1, $1, 'Cliente Ficticio A', 'GRIMM', 'EDM 180C', $2)`, [clave, ultima]);
const enviar = (cuerpo: object = TARJETA) => request(api).post('/api/trazabilidad/avisos/envios').set(como).send(cuerpo);
const resolver = (id: unknown, salio: boolean) => request(api).post(`/api/trazabilidad/avisos/envios/${id}/resolver`).set(como).send({ salio });
const envios = async () => (await request(api).get('/api/trazabilidad/avisos/envios').set(como)).body.envios as { estado: string; tramo: unknown }[];
const registro = async () => (await hub.query(`SELECT modo, tramo, equipos, destinatarios, enviado_a, asunto, estado, message_id, error, dia::text AS dia FROM portal.tmc_avisos_envios ORDER BY id`)).rows as Record<string, unknown>[];
const avisados = async () => (await hub.query(`SELECT clave, aviso_enviado::text AS aviso FROM portal.tmc_seguimiento ORDER BY clave`)).rows;
const plan = async () => {
  const inv = (await request(api).get('/api/trazabilidad/equipos').set(como)).body;
  return planAvisos(inv.equipos, inv.hoy, inv.contactos);
};
/** Lleva los envíos al pasado: como si hubieran pasado `minutos`. */
const atrasar = (minutos: number) => hub.query(`UPDATE portal.tmc_avisos_envios SET creado_en = creado_en - make_interval(mins => $1)`, [minutos]);

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  api = express();
  api.use(express.json());
  api.use('/api', createTrazabilidadRouter(hub, undefined, undefined, undefined, canal));
});
afterAll(async () => {
  await hub?.end();
});
beforeEach(async () => {
  await hub.query('TRUNCATE portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_calibraciones, portal.tmc_avisos_envios, desk.tickets RESTART IDENTITY');
  estado = PRUEBA;
  contestar = async () => ({ tipo: 'enviado', messageId: 'msg-ficticio-1' });
  remitidos.length = 0;
  capturados.length = 0;
  await enPortal('18A00001', VENCE_EN_10);
  await enPortal('18A00002', VENCE_EN_10);
  await hub.query(`INSERT INTO portal.tmc_contactos (clave, cliente, emails, nombre, actualizado_por) VALUES ('cliente ficticio a', 'Cliente Ficticio A', ARRAY['compras@cliente-a.example'], 'Ana Ficticia', 'alguien@example.com')`);
});

describe('enviar el aviso de una tarjeta', () => {
  it('en prueba sale UNA vez y sólo al buzón, con «[PRUEBA]»; el registro guarda a quién iba de verdad y no se marca ningún equipo', async () => {
    const res = await enviar();
    expect([res.status, res.body.estado, res.body.modo]).toEqual([200, 'enviado', 'prueba']);
    expect(remitidos.map((c) => c.para)).toEqual([[BUZON]]);
    expect(remitidos[0].asunto).toBe('[PRUEBA] Último aviso: la calibración de sus monitores GRIMM vence en los próximos 30 días · Cliente Ficticio A');
    expect(remitidos[0].cuerpo.split('\n')[0]).toContain('compras@cliente-a.example');
    expect(await registro()).toEqual([expect.objectContaining({ modo: 'prueba', tramo: '30', equipos: ['18A00001', '18A00002'], destinatarios: ['compras@cliente-a.example'], enviado_a: [BUZON], estado: 'enviado', message_id: 'msg-ficticio-1', dia: HOY })]);
    expect(await avisados()).toEqual([]);
    expect((await plan()).correos.map((c) => c.claveCliente)).toEqual(['cliente ficticio a']); // la tarjeta sigue ahí
  });

  it('el tramo puede llegar como texto («30»): casa con la tarjeta de 30; la fila guarda «30» y la API lo sirve como 30', async () => {
    const res = await enviar({ ...TARJETA, tramo: '30' });
    expect([res.status, res.body.estado, res.body.tramo]).toEqual([200, 'enviado', 30]);
    expect([(await registro())[0].tramo, (await envios())[0].tramo]).toEqual(['30', 30]);
  });

  it('la huella son las CLAVES de los equipos vistos, no sus seriales', async () => {
    await hub.query(`UPDATE portal.tmc_equipos SET serial = 'SER-' || clave`);
    expect((await enviar({ ...TARJETA, equipos: ['SER-18A00001', 'SER-18A00002'] })).body.error).toBe('tarjeta_cambiada');
    expect((await enviar()).body.estado).toBe('enviado');
    expect((await registro()).map((r) => r.equipos)).toEqual([['18A00001', '18A00002']]);
  });

  it('en real sale a sus destinatarios y, en la misma transacción, sus equipos quedan avisados hoy: la tarjeta pasa a «Ya avisados»', async () => {
    estado = REAL;
    const res = await enviar();
    expect([res.status, res.body.estado, res.body.modo]).toEqual([200, 'enviado', 'real']);
    expect(remitidos.map((c) => c.para)).toEqual([['compras@cliente-a.example']]);
    expect(await avisados()).toEqual([{ clave: '18A00001', aviso: HOY }, { clave: '18A00002', aviso: HOY }]);
    const p = await plan();
    expect([p.correos, p.yaAvisados.map((a) => a.equipo.clave).sort()]).toEqual([[], ['18A00001', '18A00002']]);
  });

  it('«vencida» también se envía, con su texto, y una vez avisada sale de las tarjetas', async () => {
    estado = REAL;
    await enPortal('18A00009', VENCIO_HACE_35);
    const res = await enviar({ claveCliente: 'cliente ficticio a', tramo: 'vencida', equipos: ['18A00009'] });
    expect([res.body.estado, res.body.tramo]).toEqual(['enviado', 'vencida']);
    expect(remitidos[0].asunto).toBe('La calibración de su monitor GRIMM está vencida · Cliente Ficticio A');
    expect((await plan()).correos.map((c) => c.tramo)).toEqual([30]);
  });

  it('el servidor vuelve a calcular la tarjeta: si ya no está, 404; si sus equipos no son los vistos, 409; y no sale nada', async () => {
    const otra = await enviar({ ...TARJETA, tramo: 'vencida' });
    expect([otra.status, otra.body.error]).toEqual([404, 'tarjeta_no_encontrada']);
    const menos = await enviar({ ...TARJETA, equipos: ['18A00001'] });
    expect([menos.status, menos.body.error]).toEqual([409, 'tarjeta_cambiada']);
    await enPortal('18A00003', VENCE_EN_10); // entra un equipo nuevo en la tarjeta
    expect((await enviar()).body.error).toBe('tarjeta_cambiada');
    expect([remitidos, await registro()]).toEqual([[], []]);
  });

  it('si sus destinatarios de verdad no son de 1 a 5 correos válidos y distintos: 409 ya en prueba, y ni se apunta ni sale nada', async () => {
    await hub.query(`UPDATE portal.tmc_contactos SET emails = ARRAY['compras@cliente-a.example', 'Compras@Cliente-A.example']`);
    const res = await enviar();
    expect([res.status, res.body.error]).toEqual([409, 'destinatarios_no_validos']);
    expect(res.body.message).toMatch(/contacto .* 5 /);
    expect([remitidos, await registro()]).toEqual([[], []]);
  });

  it('la carrera de dos envíos: si los equipos quedan avisados entre la primera lectura y el apunte, se vuelve a mirar la tarjeta dentro de la transacción del apunte: 404, no sale nada y no queda fila', async () => {
    estado = REAL;
    // Un disparador hace de «el otro envío», que cierra justo antes del apunte de éste: marca sus equipos con el día de la fila.
    // Corre dentro de la transacción del apunte, así que el ROLLBACK lo deshace también; lo que se prueba es el orden: apuntar y LUEGO volver a mirar.
    await hub.query(`CREATE OR REPLACE FUNCTION portal.tmc_prueba_carrera() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO portal.tmc_seguimiento (clave, aviso_enviado, actualizado_por) SELECT unnest(NEW.equipos), NEW.dia, 'otra@example.com'
        ON CONFLICT (clave) DO UPDATE SET aviso_enviado = EXCLUDED.aviso_enviado;
      RETURN NEW; END $$`);
    await hub.query('CREATE TRIGGER tmc_prueba_carrera BEFORE INSERT ON portal.tmc_avisos_envios FOR EACH ROW EXECUTE FUNCTION portal.tmc_prueba_carrera()');
    try {
      const res = await enviar();
      expect([res.status, res.body.error]).toEqual([404, 'tarjeta_no_encontrada']);
      expect([remitidos, await registro(), await avisados()]).toEqual([[], [], []]);
    } finally {
      await hub.query('DROP TRIGGER IF EXISTS tmc_prueba_carrera ON portal.tmc_avisos_envios');
      await hub.query('DROP FUNCTION IF EXISTS portal.tmc_prueba_carrera()');
    }
  });

  it('la carrera de verdad, con dos conexiones: B espera a que A cierre y, al ver sus equipos ya marcados, se deshace: 404, sin correo y sin fila', async () => {
    estado = REAL;
    const { rows: [deA] } = await hub.query(
      `INSERT INTO portal.tmc_avisos_envios (dia, por, modo, clave_cliente, cliente, tramo, equipos, destinatarios, enviado_a, asunto)
       VALUES ($1, 'a@example.com', 'real', 'cliente ficticio a', 'Cliente Ficticio A', '30', ARRAY['18A00001', '18A00002'], ARRAY['compras@cliente-a.example'], ARRAY['compras@cliente-a.example'], 'Asunto ficticio') RETURNING id`,
      [HOY],
    );
    const a = await hub.connect(); // el cierre de A, sin confirmar todavía
    try {
      await a.query('BEGIN');
      await a.query(`UPDATE portal.tmc_avisos_envios SET estado = 'enviado', message_id = 'msg-de-a', terminado_en = NOW() WHERE id = $1`, [deA.id]);
      await registrarAvisos(a, ['18A00001', '18A00002'], HOY, { userId: null, email: 'a@example.com' });
      const b = enviar().then((r) => r);
      let esperando = false; // B, bloqueado en su INSERT por la fila de A
      for (let i = 0; !esperando && i < 500; i++) {
        esperando = (await hub.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'INSERT INTO portal.tmc_avisos_envios%'`)).rows.length > 0;
        if (!esperando) await new Promise((r) => setTimeout(r, 10));
      }
      expect(esperando).toBe(true);
      await a.query('COMMIT');
      const res = await b;
      expect([res.status, res.body.error]).toEqual([404, 'tarjeta_no_encontrada']);
      expect([remitidos.length, (await registro()).map((r) => r.estado)]).toEqual([0, ['enviado']]);
    } finally {
      await a.query('ROLLBACK').catch(() => undefined); // si ya se confirmó, no hace nada
      a.release();
    }
  });

  it('si el canal revienta, cuenta como sin respuesta: sigue en curso («sin confirmar») y va a Sentry sin el texto del error', async () => {
    estado = REAL;
    contestar = async () => {
      throw new Error('fallo ficticio con token-ficticio');
    };
    const res = await enviar();
    expect([res.status, res.body.estado, (await registro())[0].estado]).toEqual([200, 'sin_confirmar', 'en_curso']);
    expect(capturados.map((c) => c.contexto)).toEqual([{ endpoint: 'tmc_aviso_remitir', envio: res.body.id }]);
    expect(JSON.stringify(capturados.map((c) => [String(c.e), c.contexto]))).not.toContain('token-ficticio');
  });

  it('apagado: 409 y no se apunta nada', async () => {
    estado = { modo: 'apagado', motivo: 'sin_valor', buzonPrueba: null };
    const res = await enviar();
    expect([res.status, res.body.error]).toEqual([409, 'envio_apagado']);
    expect([remitidos, await registro()]).toEqual([[], []]);
  });

  it('doble clic o dos personas a la vez: el segundo recibe 409 mientras el primero está en curso, y sale un solo correo', async () => {
    let soltar: () => void = () => {};
    const puerta = new Promise<void>((r) => (soltar = r));
    contestar = async () => {
      await puerta;
      return { tipo: 'enviado', messageId: 'msg-ficticio-1' };
    };
    const primero = enviar().then((r) => r);
    for (let i = 0; remitidos.length === 0 && i < 500; i++) await new Promise((r) => setTimeout(r, 10));
    const segundo = await enviar();
    expect([segundo.status, segundo.body.error]).toEqual([409, 'ya_enviando']);
    soltar();
    expect((await primero).body.estado).toBe('enviado');
    expect(remitidos).toHaveLength(1);
  });

  it('el canal lo rechaza: «fallido» con su motivo, nada marcado, y se puede volver a intentar', async () => {
    estado = REAL;
    contestar = async () => ({ tipo: 'rechazado', motivo: 'Destinatario no permitido (ficticio).' });
    const res = await enviar();
    expect([res.status, res.body.estado, res.body.error]).toEqual([200, 'fallido', 'Destinatario no permitido (ficticio).']);
    expect(await avisados()).toEqual([]);
    contestar = async () => ({ tipo: 'enviado', messageId: 'msg-ficticio-2' });
    expect((await enviar()).body.estado).toBe('enviado');
    expect((await registro()).map((r) => r.estado)).toEqual(['fallido', 'enviado']);
  });

  it('sin respuesta: «sin confirmar», no deja reenviar, y a los 2 minutos «Sí salió» lo da por enviado y, en real, marca con el día del envío', async () => {
    estado = REAL;
    contestar = async () => ({ tipo: 'sin_respuesta' });
    const res = await enviar();
    expect([res.status, res.body.estado]).toEqual([200, 'sin_confirmar']);
    expect((await enviar()).body.error).toBe('ya_enviando');
    expect((await resolver(res.body.id, true)).body.error).toBe('no_sin_confirmar'); // aún puede estar saliendo
    expect((await envios())[0].estado).toBe('en_curso');
    await atrasar(3);
    expect((await envios())[0].estado).toBe('sin_confirmar');
    const si = await resolver(res.body.id, true);
    expect([si.status, si.body.estado, si.body.resueltoPor]).toEqual([200, 'enviado', 'comercial@example.com']);
    expect(await avisados()).toEqual([{ clave: '18A00001', aviso: HOY }, { clave: '18A00002', aviso: HOY }]);
    expect((await resolver(res.body.id, false)).status).toBe(409); // ya resuelto
    expect((await resolver(999, false)).status).toBe(404);
  });

  it('«No salió» lo deja «fallido» y la tarjeta se puede volver a enviar', async () => {
    contestar = async () => ({ tipo: 'sin_respuesta' });
    const { body } = await enviar();
    await atrasar(3);
    const no = await resolver(body.id, false);
    expect([no.status, no.body.estado]).toEqual([200, 'fallido']);
    contestar = async () => ({ tipo: 'enviado', messageId: 'msg-ficticio-3' });
    expect((await enviar()).body.estado).toBe('enviado');
    expect(await avisados()).toEqual([]); // en prueba nunca se marca
  });

  it('«Sí salió» en prueba lo da por enviado y no marca nada', async () => {
    contestar = async () => ({ tipo: 'sin_respuesta' });
    const { body } = await enviar();
    await atrasar(3);
    const si = await resolver(body.id, true);
    expect([si.status, si.body.estado, await avisados()]).toEqual([200, 'enviado', []]);
  });

  it('«Sí salió» en real marca SÓLO los equipos apuntados en la fila, con el día de la fila, y nunca echa atrás un aviso más nuevo', async () => {
    estado = REAL;
    contestar = async () => ({ tipo: 'sin_respuesta' });
    const { body } = await enviar();
    await atrasar(3);
    await hub.query(`UPDATE portal.tmc_avisos_envios SET dia = $1`, [dia(-2)]); // un envío de hace dos días
    await enPortal('18A00003', VENCE_EN_10); // entra en la tarjeta después del envío
    await hub.query(`INSERT INTO portal.tmc_seguimiento (clave, aviso_enviado, actualizado_por) VALUES ('18A00001', $1, 'ficha@example.com')`, [HOY]); // y a uno se le avisó después
    expect((await resolver(body.id, true)).body.estado).toBe('enviado');
    expect(await avisados()).toEqual([{ clave: '18A00001', aviso: HOY }, { clave: '18A00002', aviso: dia(-2) }]);
    // Y el que conserva su aviso más nuevo conserva también su firma: no se reescribe quién lo cambió.
    expect((await hub.query('SELECT clave, actualizado_por FROM portal.tmc_seguimiento ORDER BY clave')).rows).toEqual([{ clave: '18A00001', actualizado_por: 'ficha@example.com' }, { clave: '18A00002', actualizado_por: 'comercial@example.com' }]);
  });

  it('una respuesta tardía: si ya se resolvió «No salió», el «enviado» del canal no lo cambia ni marca nada, y queda a la vista en Sentry', async () => {
    estado = REAL;
    let soltar: () => void = () => {};
    const puerta = new Promise<void>((r) => (soltar = r));
    contestar = async () => {
      await puerta;
      return { tipo: 'enviado', messageId: 'msg-tardio' };
    };
    const primero = enviar().then((r) => r);
    for (let i = 0; remitidos.length === 0 && i < 500; i++) await new Promise((r) => setTimeout(r, 10));
    await atrasar(3);
    const id = Number((await hub.query('SELECT id FROM portal.tmc_avisos_envios')).rows[0].id);
    expect((await resolver(id, false)).body.estado).toBe('fallido');
    soltar();
    expect([(await primero).body.estado, await avisados()]).toEqual(['fallido', []]);
    expect(capturados.map((c) => c.contexto)).toEqual([{ endpoint: 'tmc_aviso_enviado_tardio', envio: id, messageId: 'msg-tardio' }]);
  });

  it('si la transacción final falla, el correo salió pero queda «sin confirmar» y no se marca nada', async () => {
    estado = REAL;
    await hub.query(`CREATE OR REPLACE FUNCTION portal.tmc_prueba_falla() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo ficticio'; END $$`);
    await hub.query('CREATE TRIGGER tmc_prueba_falla BEFORE INSERT ON portal.tmc_seguimiento FOR EACH ROW EXECUTE FUNCTION portal.tmc_prueba_falla()');
    try {
      const res = await enviar();
      expect([res.status, res.body.estado]).toEqual([200, 'sin_confirmar']);
      expect([remitidos.length, (await registro())[0].estado, await avisados()]).toEqual([1, 'en_curso', []]);
    } finally {
      await hub.query('DROP TRIGGER IF EXISTS tmc_prueba_falla ON portal.tmc_seguimiento');
      await hub.query('DROP FUNCTION IF EXISTS portal.tmc_prueba_falla()');
    }
  });
});

describe('la migración 069', () => {
  const SQL_069 = readFileSync(fileURLToPath(new URL('../users/migrations/069_trazabilidad_avisos_envios.sql', import.meta.url)), 'utf8');

  it('volver a ejecutarla (cada arranque) no toca lo apuntado', async () => {
    await enviar();
    const antes = await registro();
    await hub.query(SQL_069);
    await hub.query(SQL_069);
    expect(await registro()).toEqual(antes);
  });

  it('la base no admite dos «en curso» del mismo cliente y tramo', async () => {
    const fila = `INSERT INTO portal.tmc_avisos_envios (dia, por, modo, clave_cliente, cliente, tramo, equipos, destinatarios, enviado_a, asunto)
                  VALUES (CURRENT_DATE, 'x@example.com', 'prueba', 'cliente ficticio a', 'Cliente Ficticio A', '30', ARRAY['18A00001'], ARRAY['compras@cliente-a.example'], ARRAY['${BUZON}'], 'Asunto ficticio')`;
    await hub.query(fila);
    await expect(hub.query(fila)).rejects.toMatchObject({ code: '23505' });
  });
});
