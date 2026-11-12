import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';
import { notasDeAutor, notaDeAutor, insertarNota, actualizarNota, eliminarNota, imagenDeNota } from './repo.js';
import type { NuevaNota } from './types.js';

// Las notas personales del administrador contra Postgres de verdad.
//
// El filtro por autor vive en el SQL de cada consulta, y el doble de
// router.test.ts no ejecuta SQL: si un WHERE pierde el `autor_email`, solo
// este fichero lo caza.

const YO = 'admin@ambientalia.com.co';
const OTRO = 'otro.admin@ambientalia.com.co';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

let db: Pool;
let empleadoId: string;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
  empleadoId = await sembrarEmpleado(db, 'ana@notas.test');
});

const nueva = (over: Partial<NuevaNota> = {}): NuevaNota => ({
  empleadoId,
  categoria: 'retraso',
  fecha: '2026-11-12',
  comentario: 'Llega tarde por cita medica',
  imagen: null,
  ...over,
});

const conImagen = (contenido = JPEG) =>
  nueva({ imagen: { nombreArchivo: 'foto.jpg', mime: 'image/jpeg', contenido } });

describe('insertarNota y notasDeAutor', () => {
  it('guarda la nota con la copia del nombre y nace abierta', async () => {
    const n = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    expect(n).toMatchObject({
      empleadoId,
      empleadoNombre: 'Ana Ruiz',
      categoria: 'retraso',
      fecha: '2026-11-12',
      comentario: 'Llega tarde por cita medica',
      estado: 'abierta',
      resueltaAt: null,
      imagen: null,
    });
    expect(await notasDeAutor(db, YO)).toEqual([n]);
  });

  it('con imagen: la lista trae los metadatos y no los bytes', async () => {
    const n = await insertarNota(db, YO, 'Ana Ruiz', conImagen());
    expect(n.imagen).toMatchObject({ nombreArchivo: 'foto.jpg', mime: 'image/jpeg', bytes: JPEG.length });
    expect(n.imagen).not.toHaveProperty('contenido');
    const img = await imagenDeNota(db, n.id, YO);
    expect(img?.contenido.equals(JPEG)).toBe(true);
    expect(img?.mime).toBe('image/jpeg');
  });

  it('ordena por fecha descendente', async () => {
    await insertarNota(db, YO, 'Ana Ruiz', nueva({ fecha: '2026-11-01' }));
    await insertarNota(db, YO, 'Ana Ruiz', nueva({ fecha: '2026-11-10' }));
    await insertarNota(db, YO, 'Ana Ruiz', nueva({ fecha: '2026-11-05' }));
    expect((await notasDeAutor(db, YO)).map((n) => n.fecha)).toEqual(['2026-11-10', '2026-11-05', '2026-11-01']);
  });
});

describe('CANDADO: cada nota es de quien la escribe', () => {
  let id: string;
  beforeEach(async () => {
    id = (await insertarNota(db, YO, 'Ana Ruiz', conImagen())).id;
  });

  it('otro autor no la lista', async () => {
    expect(await notasDeAutor(db, OTRO)).toEqual([]);
  });

  it('otro autor no la lee', async () => {
    expect(await notaDeAutor(db, id, OTRO)).toBeNull();
  });

  it('otro autor no la edita, ni le quita la imagen', async () => {
    expect(await actualizarNota(db, id, OTRO, { comentario: 'pisado', imagen: null })).toBeNull();
    const mia = await notaDeAutor(db, id, YO);
    expect(mia?.comentario).toBe('Llega tarde por cita medica');
    expect(mia?.imagen).not.toBeNull();
  });

  it('otro autor no la borra', async () => {
    expect(await eliminarNota(db, id, OTRO)).toBe(false);
    expect(await notaDeAutor(db, id, YO)).not.toBeNull();
  });

  it('otro autor no descarga su imagen', async () => {
    expect(await imagenDeNota(db, id, OTRO)).toBeNull();
    expect(await imagenDeNota(db, id, YO)).not.toBeNull();
  });
});

describe('actualizarNota', () => {
  it('resolver fija resuelta_at y reabrir lo vacia', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    const resuelta = await actualizarNota(db, id, YO, { estado: 'resuelta' });
    expect(resuelta?.estado).toBe('resuelta');
    expect(resuelta?.resueltaAt).not.toBeNull();
    const abierta = await actualizarNota(db, id, YO, { estado: 'abierta' });
    expect(abierta).toMatchObject({ estado: 'abierta', resueltaAt: null });
  });

  it('volver a marcarla resuelta conserva la primera fecha de resolucion', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    await actualizarNota(db, id, YO, { estado: 'resuelta' });
    // Se fecha en el pasado a mano: dos NOW() seguidos pueden caer en el mismo
    // milisegundo y el test pasaria aunque se pisara la fecha.
    await db.query(`UPDATE portal.ausencias_notas SET resuelta_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [id]);
    const otraVez = await actualizarNota(db, id, YO, { estado: 'resuelta' });
    expect(otraVez?.resueltaAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('imagen null la quita y una nueva la sustituye', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', conImagen());
    const sinImagen = await actualizarNota(db, id, YO, { imagen: null });
    expect(sinImagen?.imagen).toBeNull();
    expect(await imagenDeNota(db, id, YO)).toBeNull();

    await actualizarNota(db, id, YO, { imagen: { nombreArchivo: 'a.jpg', mime: 'image/jpeg', contenido: JPEG } });
    const otra = await actualizarNota(db, id, YO, { imagen: { nombreArchivo: 'b.png', mime: 'image/png', contenido: PNG } });
    expect(otra?.imagen).toMatchObject({ nombreArchivo: 'b.png', mime: 'image/png', bytes: PNG.length });
    expect((await imagenDeNota(db, id, YO))?.contenido.equals(PNG)).toBe(true);
  });

  it('cambiar de persona guarda el nombre que le pasan', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    const otraFicha = await sembrarEmpleado(db, 'beto@notas.test');
    const n = await actualizarNota(db, id, YO, { empleadoId: otraFicha }, 'Beto Diaz');
    expect(n).toMatchObject({ empleadoId: otraFicha, empleadoNombre: 'Beto Diaz' });
  });

  it('cambia categoria, fecha y comentario', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    const n = await actualizarNota(db, id, YO, { categoria: 'otro', fecha: '2026-10-01', comentario: 'Otro asunto' });
    expect(n).toMatchObject({ categoria: 'otro', fecha: '2026-10-01', comentario: 'Otro asunto' });
  });
});

describe('eliminarNota', () => {
  it('borra la nota y su imagen por cascada', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', conImagen());
    expect(await eliminarNota(db, id, YO)).toBe(true);
    expect(await notasDeAutor(db, YO)).toEqual([]);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM portal.ausencias_nota_imagenes');
    expect(rows[0].n).toBe(0);
  });
});

describe('la ficha de la persona', () => {
  it('si se borra la ficha, la nota sobrevive con el nombre copiado', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    await db.query('DELETE FROM portal.empleados WHERE id = $1', [empleadoId]);
    expect(await notaDeAutor(db, id, YO)).toMatchObject({ empleadoId: null, empleadoNombre: 'Ana Ruiz' });
  });
});

describe('CHECK de la migracion 076', () => {
  const insertarCruda = (campos: { categoria?: string; comentario?: string; estado?: string; autor?: string }) =>
    db.query(
      `INSERT INTO portal.ausencias_notas (empleado_nombre, categoria, fecha, comentario, estado, autor_email)
       VALUES ('X', $1, '2026-11-12', $2, $3, $4) RETURNING id`,
      [campos.categoria ?? 'otro', campos.comentario ?? 'ok', campos.estado ?? 'abierta', campos.autor ?? YO],
    );

  it('rechaza un comentario en blanco', async () => {
    await expect(insertarCruda({ comentario: '   ' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza un comentario hecho solo de tabuladores y saltos de linea', async () => {
    // Por esto el CHECK es `comentario ~ '\S'` y no `btrim(...)`: btrim sin
    // segundo argumento solo quita espacios.
    await expect(insertarCruda({ comentario: '\t\n\n' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza una categoria desconocida', async () => {
    await expect(insertarCruda({ categoria: 'vacaciones' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza una nota resuelta sin resuelta_at', async () => {
    await expect(insertarCruda({ estado: 'resuelta' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza un autor con mayusculas', async () => {
    await expect(insertarCruda({ autor: 'Admin@Ambientalia.com.co' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza una imagen que no es JPEG, PNG ni WebP', async () => {
    const { rows } = await insertarCruda({});
    await expect(
      db.query(
        `INSERT INTO portal.ausencias_nota_imagenes (nota_id, nombre_archivo, mime, contenido) VALUES ($1, 'x.gif', 'image/gif', $2)`,
        [rows[0].id, JPEG],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('admite una sola imagen por nota', async () => {
    const { rows } = await insertarCruda({});
    const meter = () =>
      db.query(
        `INSERT INTO portal.ausencias_nota_imagenes (nota_id, nombre_archivo, mime, contenido) VALUES ($1, 'x.jpg', 'image/jpeg', $2)`,
        [rows[0].id, JPEG],
      );
    await meter();
    await expect(meter()).rejects.toMatchObject({ code: '23505' });
  });
});
