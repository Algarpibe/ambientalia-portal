import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { aplicarMigraciones } from '../db.js';
import { poolDePrueba } from '../test-db/harness.js';
import { CATALOGO_ESTADOS_AGENDA, categoriaDeEstado, claveEstadoDesk, duracionDeEtapa, type CategoriaAgenda, type EtapaAgenda } from './dominio.js';
import * as repo from './repo.js';
import { TzError } from './types.js';

// La configuración de la agenda del taller contra Postgres: las migraciones
// 050 y 051 (que se repiten en cada arranque) y el SQL que lee y guarda la
// categoría de cada estado, los puestos y las duraciones. Datos ficticios.

let db: Pool;
const actor = { userId: '00000000-0000-4000-8000-000000000001', email: 'st@ambientalia.com.co' };
const otro = { userId: '00000000-0000-4000-8000-000000000002', email: 'direccion@ambientalia.com.co' };
const SEMILLA = 'semilla (migracion 050)';

const leer = (fichero: string) => readFileSync(fileURLToPath(new URL(`../users/migrations/${fichero}`, import.meta.url)), 'utf8');
const SQL_050 = leer('050_trazabilidad_estados_categoria.sql');
const SQL_051 = leer('051_trazabilidad_agenda_config.sql');

const estados = async () =>
  (
    await db.query(
      `SELECT clave, etiqueta, rol, categoria, etapa, actualizado_por_id::text AS por_id, actualizado_por, actualizado_en::text AS en
         FROM portal.tmc_estados_desk ORDER BY clave`,
    )
  ).rows as { clave: string; etiqueta: string; rol: string; categoria: string | null; etapa: string | null; por_id: string | null; actualizado_por: string; en: string }[];
const estado = async (clave: string) => (await estados()).find((e) => e.clave === clave);
const etapas = async () => (await db.query(`SELECT etapa, etiqueta, orden, puestos, actualizado_por FROM portal.tmc_agenda_etapas ORDER BY orden`)).rows;
const duraciones = async () => (await db.query(`SELECT etapa, tipo, dias_habiles AS dias, actualizado_por FROM portal.tmc_agenda_duraciones ORDER BY etapa, tipo`)).rows;
const error400 = (campo: string) => expect.objectContaining({ status: 400, field: campo });

beforeAll(async () => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
// Cada prueba empieza como una base recién migrada: sin nada elegido y con las semillas puestas.
beforeEach(async () => {
  await db.query('TRUNCATE portal.tmc_estados_desk, portal.tmc_agenda_etapas, portal.tmc_agenda_duraciones');
  await db.query(SQL_050);
  await db.query(SQL_051);
});

describe('migración 050: categoría y etapa de cada estado', () => {
  it('sobre una tabla vacía siembra los 23 estados de la propuesta, todos con el papel «cuenta» y firmados por la semilla', async () => {
    const filas = await estados();
    expect(filas).toHaveLength(23);
    const esperado = CATALOGO_ESTADOS_AGENDA.map((e) => ({ clave: claveEstadoDesk(e.estado), etiqueta: e.estado, categoria: e.categoria, etapa: e.etapa })).sort((a, b) => (a.clave < b.clave ? -1 : 1));
    expect(filas.map(({ clave, etiqueta, categoria, etapa }) => ({ clave, etiqueta, categoria, etapa }))).toEqual(esperado);
    for (const f of filas) expect(f).toMatchObject({ rol: 'cuenta', por_id: null, actualizado_por: SEMILLA });
  });

  it('ejecutarla otra vez, y otra con todas las migraciones, no cambia ni una fila', async () => {
    const antes = await estados();
    await db.query(SQL_050);
    await db.query(SQL_050);
    await aplicarMigraciones(db);
    expect(await estados()).toEqual(antes);
  });

  it('al llegar a una base que ya tenía papeles elegidos (sin las columnas): rellena la categoría y NO toca el papel ni su firma', async () => {
    // Como producción antes de este lote: la tabla de la 046, con los cuatro papeles elegidos a mano.
    await db.query('TRUNCATE portal.tmc_estados_desk');
    await db.query('ALTER TABLE portal.tmc_estados_desk DROP COLUMN categoria, DROP COLUMN etapa');
    await repo.guardarEstadoDesk(db, { estado: 'Notificación cliente', rol: 'standby' }, actor);
    await repo.guardarEstadoDesk(db, { estado: 'Por Facturar', rol: 'terminado' }, actor);
    await repo.guardarEstadoDesk(db, { estado: 'Rev./Diagnostico', rol: 'standby' }, otro);
    await repo.guardarEstadoDesk(db, { estado: 'Estado inventado', rol: 'terminado' }, actor);
    const previas = (await db.query(`SELECT clave, rol, actualizado_por, actualizado_en::text AS en FROM portal.tmc_estados_desk ORDER BY clave`)).rows;

    await db.query(SQL_050);
    await db.query(SQL_050);

    expect(await estados()).toHaveLength(24);
    for (const p of previas) expect(await estado(p.clave)).toMatchObject({ rol: p.rol, actualizado_por: p.actualizado_por, en: p.en });
    expect(await estado('notificacion cliente')).toMatchObject({ categoria: 'standby', etapa: null, rol: 'standby' });
    expect(await estado('por facturar')).toMatchObject({ categoria: 'fin', etapa: null, rol: 'terminado' });
    // El papel «standby» de Rev./Diagnostico se queda aunque su categoría sea de etapa activa: son dos cosas.
    expect(await estado('rev./diagnostico')).toMatchObject({ categoria: 'activa', etapa: 'diagnostico', rol: 'standby', actualizado_por: otro.email });
    // Un estado que no está en la propuesta se queda sin categoría.
    expect(await estado('estado inventado')).toMatchObject({ categoria: null, etapa: null, rol: 'terminado' });
  });

  it('una categoría ya elegida no se pisa, se ejecute las veces que se ejecute', async () => {
    await repo.guardarCategoriaEstado(db, { estado: 'Ingresado', categoria: 'fuera', etapa: null }, actor);
    await repo.guardarCategoriaEstado(db, { estado: 'Notificado', categoria: 'standby', etapa: null }, actor);
    await repo.guardarCategoriaEstado(db, { estado: 'Por Entregar', categoria: 'activa', etapa: 'verificacion' }, actor);
    const antes = await estados();
    await db.query(SQL_050);
    await aplicarMigraciones(db);
    await db.query(SQL_050);
    expect(await estados()).toEqual(antes);
    expect(await estado('ingresado')).toMatchObject({ categoria: 'fuera', actualizado_por: actor.email });
    expect(await estado('notificado')).toMatchObject({ categoria: 'standby', etapa: null });
    expect(await estado('por entregar')).toMatchObject({ categoria: 'activa', etapa: 'verificacion' });
  });

  it('las columnas son las de la 046 más las dos nuevas, y la tabla rechaza una categoría o una etapa que no cuadren', async () => {
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'portal' AND table_name = 'tmc_estados_desk'`);
    expect(cols.rows.map((r: { column_name: string }) => r.column_name).sort()).toEqual(['actualizado_en', 'actualizado_por', 'actualizado_por_id', 'categoria', 'clave', 'etapa', 'etiqueta', 'rol']);
    const poner = (categoria: string | null, etapa: string | null) => db.query(`UPDATE portal.tmc_estados_desk SET categoria = $1, etapa = $2 WHERE clave = 'ingresado'`, [categoria, etapa]);
    await expect(poner('otra', null)).rejects.toThrow();
    await expect(poner('activa', 'pintura')).rejects.toThrow();
    await expect(poner('activa', null)).rejects.toThrow();
    await expect(poner('standby', 'proceso')).rejects.toThrow();
    await expect(poner(null, 'proceso')).rejects.toThrow();
    await poner('activa', 'proceso');
    await poner(null, null);
    expect(await estado('ingresado')).toMatchObject({ categoria: null, etapa: null });
  });
});

describe('categoría y etapa de un estado: leer y guardar', () => {
  it('leerCategoriasEstados da lo guardado por clave, y con ello `categoriaDeEstado` resuelve cualquier grafía', async () => {
    const guardadas = await repo.leerCategoriasEstados(db);
    expect(guardadas.size).toBe(23);
    expect(guardadas.get('rev./diagnostico')).toEqual({ categoria: 'activa', etapa: 'diagnostico' });
    await repo.guardarCategoriaEstado(db, { estado: 'Ingresado', categoria: 'fuera', etapa: null }, actor);
    expect(categoriaDeEstado('  INGRESADO ', await repo.leerCategoriasEstados(db))).toEqual({ categoria: 'fuera', etapa: null });
  });

  it('un estado con fila pero sin categoría no sale en lo guardado: vale la propuesta o, si no está en ella, ninguna', async () => {
    await repo.guardarEstadoDesk(db, { estado: 'Estado inventado', rol: 'standby' }, actor);
    await db.query(`UPDATE portal.tmc_estados_desk SET categoria = NULL, etapa = NULL WHERE clave = 'en proceso'`);
    const guardadas = await repo.leerCategoriasEstados(db);
    expect(guardadas.has('estado inventado')).toBe(false);
    expect(guardadas.has('en proceso')).toBe(false);
    expect(categoriaDeEstado('Estado inventado', guardadas)).toBeNull();
    expect(categoriaDeEstado('En Proceso', guardadas)).toEqual({ categoria: 'activa', etapa: 'proceso' });
  });

  it('guardar la categoría firma el cambio y NO toca el papel del reloj', async () => {
    await repo.guardarEstadoDesk(db, { estado: 'Por Facturar', rol: 'terminado' }, otro);
    await repo.guardarCategoriaEstado(db, { estado: ' por  FACTURAR ', categoria: 'standby', etapa: null }, actor);
    expect(await estado('por facturar')).toMatchObject({ rol: 'terminado', categoria: 'standby', etapa: null, por_id: actor.userId, actualizado_por: actor.email });
    expect(await estados()).toHaveLength(23);
  });

  it('y elegir el papel no toca la categoría', async () => {
    await repo.guardarCategoriaEstado(db, { estado: 'Ingresado', categoria: 'activa', etapa: 'proceso' }, actor);
    await repo.guardarEstadoDesk(db, { estado: 'Ingresado', rol: 'standby' }, otro);
    expect(await estado('ingresado')).toMatchObject({ rol: 'standby', categoria: 'activa', etapa: 'proceso', actualizado_por: otro.email });
  });

  it('vale un estado que aún no tiene fila: nace con el papel «cuenta»', async () => {
    await repo.guardarCategoriaEstado(db, { estado: 'Estado  Inventado', categoria: 'activa', etapa: 'verificacion' }, actor);
    expect(await estado('estado inventado')).toMatchObject({ etiqueta: 'Estado Inventado', rol: 'cuenta', categoria: 'activa', etapa: 'verificacion', actualizado_por: actor.email });
  });

  it('400 y nada escrito con una categoría o una etapa que no existen, que no cuadran, o sin estado', async () => {
    const antes = await estados();
    const guardar = (estadoDesk: string, categoria: string, etapa: string | null) =>
      repo.guardarCategoriaEstado(db, { estado: estadoDesk, categoria: categoria as CategoriaAgenda, etapa: etapa as EtapaAgenda | null }, actor);
    await expect(guardar('Ingresado', 'otra', null)).rejects.toEqual(error400('categoria'));
    await expect(guardar('Ingresado', 'activa', null)).rejects.toEqual(error400('etapa'));
    await expect(guardar('Ingresado', 'activa', 'pintura')).rejects.toEqual(error400('etapa'));
    await expect(guardar('Ingresado', 'standby', 'proceso')).rejects.toEqual(error400('etapa'));
    await expect(guardar('   ', 'standby', null)).rejects.toEqual(error400('estado'));
    await expect(guardar('Ingresado', 'otra', null)).rejects.toBeInstanceOf(TzError);
    expect(await estados()).toEqual(antes);
  });
});

describe('migración 051: puestos y duraciones', () => {
  it('siembra los puestos y la duración por defecto de cada etapa, sin firma', async () => {
    expect(await etapas()).toEqual([
      { etapa: 'diagnostico', etiqueta: 'Diagnóstico', orden: 1, puestos: 3, actualizado_por: null },
      { etapa: 'proceso', etiqueta: 'Proceso', orden: 2, puestos: 4, actualizado_por: null },
      { etapa: 'verificacion', etiqueta: 'Verificación', orden: 3, puestos: 2, actualizado_por: null },
    ]);
    expect(await duraciones()).toEqual([
      { etapa: 'diagnostico', tipo: '*', dias: 3, actualizado_por: null },
      { etapa: 'proceso', tipo: '*', dias: 4, actualizado_por: null },
      { etapa: 'verificacion', tipo: '*', dias: 1, actualizado_por: null },
    ]);
  });

  it('lo editado sobrevive a ejecutarla otra vez: ni pisa puestos o duraciones, ni resucita una fila quitada, ni borra una añadida', async () => {
    await repo.guardarPuestosEtapa(db, { etapa: 'diagnostico', puestos: 5 }, actor);
    await repo.guardarPuestosEtapa(db, { etapa: 'verificacion', puestos: 0 }, actor);
    await repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: '*', dias: 9 }, actor);
    await repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: 'Calibración', dias: 2 }, actor);
    await repo.guardarDuracionEtapa(db, { etapa: 'diagnostico', tipo: 'Mantenimiento', dias: 6 }, actor);
    await repo.guardarDuracionEtapa(db, { etapa: 'diagnostico', tipo: 'Mantenimiento', dias: null }, actor);
    const antes = [await etapas(), await duraciones()];
    await db.query(SQL_051);
    await db.query(SQL_051);
    await aplicarMigraciones(db);
    expect([await etapas(), await duraciones()]).toEqual(antes);
    expect(antes[0]).toMatchObject([{ puestos: 5, actualizado_por: actor.email }, { puestos: 4, actualizado_por: null }, { puestos: 0, actualizado_por: actor.email }]);
    expect(antes[1]).toMatchObject([
      { etapa: 'diagnostico', tipo: '*', dias: 3 },
      { etapa: 'proceso', tipo: '*', dias: 9, actualizado_por: actor.email },
      { etapa: 'proceso', tipo: 'calibracion', dias: 2 },
      { etapa: 'verificacion', tipo: '*', dias: 1 },
    ]);
  });

  it('las tablas rechazan una etapa que no existe, puestos o días fuera de rango y un tipo vacío', async () => {
    await expect(db.query(`INSERT INTO portal.tmc_agenda_etapas (etapa, etiqueta, orden, puestos) VALUES ('pintura', 'Pintura', 4, 1)`)).rejects.toThrow();
    await expect(db.query(`UPDATE portal.tmc_agenda_etapas SET puestos = 51 WHERE etapa = 'proceso'`)).rejects.toThrow();
    await expect(db.query(`UPDATE portal.tmc_agenda_etapas SET puestos = -1 WHERE etapa = 'proceso'`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO portal.tmc_agenda_duraciones (etapa, tipo, dias_habiles) VALUES ('pintura', '*', 1)`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO portal.tmc_agenda_duraciones (etapa, tipo, dias_habiles) VALUES ('proceso', '', 1)`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO portal.tmc_agenda_duraciones (etapa, tipo, dias_habiles) VALUES ('proceso', 'calibracion', 0)`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO portal.tmc_agenda_duraciones (etapa, tipo, dias_habiles) VALUES ('proceso', 'calibracion', 366)`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO portal.tmc_agenda_duraciones (etapa, tipo, dias_habiles) VALUES ('proceso', '*', 2)`)).rejects.toThrow();
  });
});

describe('puestos y duraciones: leer y guardar', () => {
  it('leerConfigAgenda: las etapas en su orden con sus puestos, y las duraciones con la «*» primero en cada etapa', async () => {
    await repo.guardarDuracionEtapa(db, { etapa: 'diagnostico', tipo: 'Mantenimiento', dias: 6 }, actor);
    await repo.guardarDuracionEtapa(db, { etapa: 'diagnostico', tipo: ' Calibración ', dias: 2 }, actor);
    const config = await repo.leerConfigAgenda(db);
    expect(config.etapas).toEqual([
      { etapa: 'diagnostico', etiqueta: 'Diagnóstico', orden: 1, puestos: 3, actualizadoPor: null, actualizadoEn: null },
      { etapa: 'proceso', etiqueta: 'Proceso', orden: 2, puestos: 4, actualizadoPor: null, actualizadoEn: null },
      { etapa: 'verificacion', etiqueta: 'Verificación', orden: 3, puestos: 2, actualizadoPor: null, actualizadoEn: null },
    ]);
    expect(config.duraciones.map((d) => [d.etapa, d.tipo, d.dias, d.actualizadoPor])).toEqual([
      ['diagnostico', '*', 3, null],
      ['diagnostico', 'calibracion', 2, actor.email],
      ['diagnostico', 'mantenimiento', 6, actor.email],
      ['proceso', '*', 4, null],
      ['verificacion', '*', 1, null],
    ]);
    // Lo leído es lo que usa la regla de la duración.
    expect(duracionDeEtapa(config.duraciones, 'diagnostico', 'Calibración', 'Mantenimiento')).toMatchObject({ dias: 2, origen: 'tipo' });
    expect(duracionDeEtapa(config.duraciones, 'proceso', null, 'Mantenimiento')).toMatchObject({ dias: 4, origen: 'defecto' });
  });

  it('guardar los puestos de una etapa los cambia y lo firma con id, correo y fecha; el resto no se toca', async () => {
    await repo.guardarPuestosEtapa(db, { etapa: 'proceso', puestos: 6 }, actor);
    const { etapas: e } = await repo.leerConfigAgenda(db);
    expect(e.map((x) => [x.etapa, x.puestos, x.actualizadoPor])).toEqual([['diagnostico', 3, null], ['proceso', 6, actor.email], ['verificacion', 2, null]]);
    expect(e[1].actualizadoEn).toEqual(expect.any(String));
    expect((await db.query(`SELECT actualizado_por_id::text AS id FROM portal.tmc_agenda_etapas WHERE etapa = 'proceso'`)).rows[0].id).toBe(actor.userId);
  });

  it('si a la tabla le falta la fila de una etapa, guardar sus puestos la crea con la etiqueta y el orden del dominio', async () => {
    await db.query(`DELETE FROM portal.tmc_agenda_etapas WHERE etapa = 'verificacion'`);
    await repo.guardarPuestosEtapa(db, { etapa: 'verificacion', puestos: 1 }, actor);
    expect((await etapas())[2]).toEqual({ etapa: 'verificacion', etiqueta: 'Verificación', orden: 3, puestos: 1, actualizado_por: actor.email });
  });

  it('400 y nada escrito con una etapa que no existe o unos puestos que no son un entero de 0 a 50', async () => {
    const antes = await etapas();
    await expect(repo.guardarPuestosEtapa(db, { etapa: 'pintura' as EtapaAgenda, puestos: 2 }, actor)).rejects.toEqual(error400('etapa'));
    for (const puestos of [-1, 51, 2.5, Number.NaN]) await expect(repo.guardarPuestosEtapa(db, { etapa: 'proceso', puestos }, actor)).rejects.toEqual(error400('puestos'));
    expect(await etapas()).toEqual(antes);
  });

  it('guardar una duración: una fila por etapa y tipo (por su clave), que se reescribe y se vuelve a firmar', async () => {
    await repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: 'Calibración', dias: 2 }, actor);
    await repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: '  CALIBRACION ', dias: 5 }, otro);
    await repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: ' * ', dias: 7 }, otro);
    expect(await duraciones()).toEqual([
      { etapa: 'diagnostico', tipo: '*', dias: 3, actualizado_por: null },
      { etapa: 'proceso', tipo: '*', dias: 7, actualizado_por: otro.email },
      { etapa: 'proceso', tipo: 'calibracion', dias: 5, actualizado_por: otro.email },
      { etapa: 'verificacion', tipo: '*', dias: 1, actualizado_por: null },
    ]);
  });

  it('sin días se quita la fila del tipo, y la etapa vuelve a su «*»; quitar una que no existe no es un error', async () => {
    await repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: 'Calibración', dias: 2 }, actor);
    await repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: 'calibracion', dias: null }, actor);
    await repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: 'Garantía', dias: null }, actor);
    expect((await duraciones()).map((d: { tipo: string }) => d.tipo)).toEqual(['*', '*', '*']);
  });

  it('la «*» de una etapa no se puede quitar (D9): 400 y la fila sigue', async () => {
    await expect(repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: '*', dias: null }, actor)).rejects.toEqual(error400('dias'));
    expect(await duraciones()).toHaveLength(3);
  });

  it('400 y nada escrito con una etapa que no existe, sin tipo o con días que no son un entero de 1 a 365', async () => {
    const antes = await duraciones();
    await expect(repo.guardarDuracionEtapa(db, { etapa: 'pintura' as EtapaAgenda, tipo: '*', dias: 2 }, actor)).rejects.toEqual(error400('etapa'));
    await expect(repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: '   ', dias: 2 }, actor)).rejects.toEqual(error400('tipo'));
    for (const dias of [0, 366, 1.5, Number.NaN]) await expect(repo.guardarDuracionEtapa(db, { etapa: 'proceso', tipo: 'Calibración', dias }, actor)).rejects.toEqual(error400('dias'));
    expect(await duraciones()).toEqual(antes);
  });
});
