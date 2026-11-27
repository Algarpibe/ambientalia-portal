import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { CelebracionRepository } from './repository.js';

// Repositorio contra Postgres de verdad (testcontainers, con todas las
// migraciones aplicadas). Vigila que el SQL haga lo mismo que FakeStore.

const DOMINIO = '@celebracion.test';
const EVENTO = 'evento-de-prueba';
const AHORA = new Date('2026-12-01T15:00:00Z');

let db: Pool;
let repo: CelebracionRepository;

beforeAll(() => {
  db = poolDePrueba();
  repo = new CelebracionRepository(db);
});

afterAll(async () => {
  await db.query('DELETE FROM portal.users WHERE email LIKE $1', ['%' + DOMINIO]);
  await db?.end();
});

beforeEach(async () => {
  // ON DELETE CASCADE se lleva sus respuestas y sus votos.
  await db.query('DELETE FROM portal.users WHERE email LIKE $1', ['%' + DOMINIO]);
});

async function usuario(nombre: string, status = 'active', avatar: string | null = null): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status, avatar)
     VALUES ($1, $2, 'x', 'reader', $3, $4) RETURNING id`,
    [nombre, nombre.toLowerCase().replace(/\s+/g, '.') + DOMINIO, status, avatar],
  );
  return (rows[0] as { id: string }).id;
}

describe('CelebracionRepository', () => {
  it('listarEquipo trae los activos con su avatar y deja fuera a los inactivos', async () => {
    const ana = await usuario('Ana Ruiz', 'active', 'data:image/jpeg;base64,AAAA');
    const diana = await usuario('Diana Prieto', 'inactive');
    const equipo = await repo.listarEquipo();
    expect(equipo).toContainEqual({ userId: ana, nombre: 'Ana Ruiz', avatar: 'data:image/jpeg;base64,AAAA' });
    expect(equipo.some((m) => m.userId === diana)).toBe(false);
    expect(await repo.esUsuarioActivo(ana)).toBe(true);
    expect(await repo.esUsuarioActivo(diana)).toBe(false);
  });

  it('guardarConfirmacion crea y luego reemplaza la respuesta', async () => {
    const ana = await usuario('Ana Ruiz');
    await repo.guardarConfirmacion(EVENTO, ana, { asiste: true, preferencia: 'general', mensaje: 'Hola' }, AHORA);
    const despues = new Date('2026-12-02T15:00:00Z');
    await repo.guardarConfirmacion(EVENTO, ana, { asiste: false, preferencia: null, mensaje: null }, despues);
    expect(await repo.confirmacionDe(EVENTO, ana)).toEqual({
      userId: ana,
      asiste: false,
      preferencia: null,
      mensaje: null,
      actualizadoEn: despues,
    });
    expect(await repo.listarConfirmaciones(EVENTO)).toHaveLength(1);
    expect(await repo.confirmacionDe('otro-evento', ana)).toBeNull();
  });

  it('la BD rechaza preferencia sin asistir y mensajes de más de 200', async () => {
    const ana = await usuario('Ana Ruiz');
    await expect(
      db.query(
        `INSERT INTO portal.celebracion_confirmaciones (evento, user_id, asiste, preferencia) VALUES ($1, $2, false, 'general')`,
        [EVENTO, ana],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query(`INSERT INTO portal.celebracion_confirmaciones (evento, user_id, asiste, mensaje) VALUES ($1, $2, false, $3)`, [
        EVENTO,
        ana,
        'a'.repeat(201),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('reemplazarVotos sustituye los votos de votante a votado y contarVotos los agrupa', async () => {
    const ana = await usuario('Ana Ruiz');
    const bruno = await usuario('Bruno Díaz');
    const carla = await usuario('Carla Gómez');
    await repo.reemplazarVotos(EVENTO, ana, bruno, ['Empatía', 'Liderazgo', 'Compromiso'], AHORA);
    await repo.reemplazarVotos(EVENTO, ana, bruno, ['Empatía'], AHORA);
    await repo.reemplazarVotos(EVENTO, carla, bruno, ['Empatía', 'Creatividad'], AHORA);
    expect(await repo.votosDe(EVENTO, ana)).toEqual([{ votadoId: bruno, cualidad: 'Empatía' }]);
    const conteos = (await repo.contarVotos(EVENTO)).filter((c) => c.votadoId === bruno);
    expect(conteos.sort((a, b) => a.cualidad.localeCompare(b.cualidad))).toEqual([
      { votadoId: bruno, cualidad: 'Creatividad', votos: 1 },
      { votadoId: bruno, cualidad: 'Empatía', votos: 2 },
    ]);
    await repo.reemplazarVotos(EVENTO, ana, bruno, [], AHORA);
    expect(await repo.votosDe(EVENTO, ana)).toEqual([]);
  });

  it('contarVotos no cuenta los votos de cuentas inactivas', async () => {
    const bruno = await usuario('Bruno Díaz');
    const diana = await usuario('Diana Prieto');
    await repo.reemplazarVotos(EVENTO, diana, bruno, ['Empatía'], AHORA);
    await db.query(`UPDATE portal.users SET status = 'inactive' WHERE id = $1`, [diana]);
    expect((await repo.contarVotos(EVENTO)).filter((c) => c.votadoId === bruno)).toEqual([]);
  });

  it('la BD impide votarse a uno mismo', async () => {
    const ana = await usuario('Ana Ruiz');
    await expect(repo.reemplazarVotos(EVENTO, ana, ana, ['Empatía'], AHORA)).rejects.toMatchObject({ code: '23514' });
  });

  it('borrar la cuenta borra sus respuestas y sus votos', async () => {
    const ana = await usuario('Ana Ruiz');
    const bruno = await usuario('Bruno Díaz');
    await repo.guardarConfirmacion(EVENTO, ana, { asiste: false, preferencia: null, mensaje: null }, AHORA);
    await repo.reemplazarVotos(EVENTO, ana, bruno, ['Empatía'], AHORA);
    await db.query('DELETE FROM portal.users WHERE id = $1', [ana]);
    expect(await repo.confirmacionDe(EVENTO, ana)).toBeNull();
    expect((await repo.contarVotos(EVENTO)).filter((c) => c.votadoId === bruno)).toEqual([]);
  });

  it('excluir es idempotente, listarExcluidos lo ve por evento y readmitir lo quita', async () => {
    const bruno = await usuario('Bruno Díaz');
    await repo.excluir(EVENTO, bruno, AHORA);
    await repo.excluir(EVENTO, bruno, new Date('2026-12-02T15:00:00Z'));
    expect(await repo.listarExcluidos(EVENTO)).toEqual([bruno]);
    expect(await repo.listarExcluidos('otro-evento')).toEqual([]);
    const { rows } = await db.query(`SELECT excluido_en FROM portal.celebracion_excluidos WHERE user_id = $1`, [bruno]);
    expect(new Date((rows[0] as { excluido_en: Date }).excluido_en)).toEqual(AHORA);
    await repo.readmitir(EVENTO, bruno);
    expect(await repo.listarExcluidos(EVENTO)).toEqual([]);
    await repo.readmitir(EVENTO, bruno);
  });

  it('contarVotos no cuenta los votos de un votante excluido y los recupera al readmitirlo', async () => {
    const ana = await usuario('Ana Ruiz');
    const bruno = await usuario('Bruno Díaz');
    const carla = await usuario('Carla Gómez');
    await repo.reemplazarVotos(EVENTO, ana, carla, ['Empatía'], AHORA);
    await repo.reemplazarVotos(EVENTO, bruno, carla, ['Empatía'], AHORA);
    await repo.excluir(EVENTO, bruno, AHORA);
    expect((await repo.contarVotos(EVENTO)).filter((c) => c.votadoId === carla)).toEqual([
      { votadoId: carla, cualidad: 'Empatía', votos: 1 },
    ]);
    expect(await repo.votosDe(EVENTO, bruno)).toHaveLength(1);
    await repo.readmitir(EVENTO, bruno);
    expect((await repo.contarVotos(EVENTO)).filter((c) => c.votadoId === carla)).toEqual([
      { votadoId: carla, cualidad: 'Empatía', votos: 2 },
    ]);
  });

  it('borrar la cuenta borra su exclusión', async () => {
    const bruno = await usuario('Bruno Díaz');
    await repo.excluir(EVENTO, bruno, AHORA);
    await db.query('DELETE FROM portal.users WHERE id = $1', [bruno]);
    expect(await repo.listarExcluidos(EVENTO)).toEqual([]);
  });

  it('guardarFoto crea y luego reemplaza la foto; listarFotos la ve por evento', async () => {
    const ana = await usuario('Ana Ruiz');
    await repo.guardarFoto(EVENTO, ana, 'data:image/jpeg;base64,AAAA', AHORA);
    await repo.guardarFoto(EVENTO, ana, 'data:image/png;base64,BBBB', new Date('2026-12-02T15:00:00Z'));
    expect(await repo.listarFotos(EVENTO)).toEqual([{ userId: ana, foto: 'data:image/png;base64,BBBB' }]);
    expect(await repo.listarFotos('otro-evento')).toEqual([]);
  });

  it('borrar la cuenta borra su foto', async () => {
    const ana = await usuario('Ana Ruiz');
    await repo.guardarFoto(EVENTO, ana, 'data:image/jpeg;base64,AAAA', AHORA);
    await db.query('DELETE FROM portal.users WHERE id = $1', [ana]);
    expect(await repo.listarFotos(EVENTO)).toEqual([]);
  });

  // Los permisos de portal_app sobre las tablas de la 081 se comprueban solo en
  // db.roles.db.test.ts: aquí el rol no existe al migrar y no se darían.
});
