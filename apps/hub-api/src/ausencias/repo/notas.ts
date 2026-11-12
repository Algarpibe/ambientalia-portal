import type { Pool } from '@algarpibe/zoho-sync';
import { withTransaction, type Consultable, type PoolClient } from './comun.js';
import type { CambioNota, CategoriaNota, EstadoNota, ImagenNuevaDeNota, MimeImagenNota, Nota, NuevaNota } from '../types.js';

// Las notas personales del administrador (migración 076). repo.ts lo reexporta:
// el resto del código lo llama como `repo.*` (lo vigila barril.test.ts).
//
// ⚠️ TODA consulta de este fichero filtra por `autor_email`. Cada nota es de
// quien la escribe; quitar ese filtro de una sola consulta le abriría las notas
// de un administrador a otro. Lo vigila repo.notas.db.test.ts, consulta a
// consulta.

/** La imagen entera, bytes incluidos: solo para la ruta que la sirve. */
export interface ImagenCompletaDeNota {
  nombreArchivo: string;
  mime: MimeImagenNota;
  contenido: Buffer;
}

interface FilaNotaDb {
  id: string;
  empleado_id: string | null;
  empleado_nombre: string;
  categoria: CategoriaNota;
  fecha: string;
  comentario: string;
  estado: EstadoNota;
  resuelta_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  imagen_id: string | null;
  imagen_nombre: string | null;
  imagen_mime: MimeImagenNota | null;
  imagen_bytes: number | null;
}

// `to_char` en la fecha para no depender del parser de DATE del pool, y
// `octet_length` para enseñar el tamaño sin traer los bytes.
const SELECT_NOTA = `
  SELECT n.id, n.empleado_id, n.empleado_nombre, n.categoria,
         to_char(n.fecha, 'YYYY-MM-DD') AS fecha, n.comentario, n.estado,
         n.resuelta_at, n.created_at, n.updated_at,
         i.id AS imagen_id, i.nombre_archivo AS imagen_nombre, i.mime AS imagen_mime,
         octet_length(i.contenido) AS imagen_bytes
    FROM portal.ausencias_notas n
    LEFT JOIN portal.ausencias_nota_imagenes i ON i.nota_id = n.id`;

const iso = (v: Date | string): string => new Date(v).toISOString();

function aNota(f: FilaNotaDb): Nota {
  return {
    id: f.id,
    empleadoId: f.empleado_id,
    empleadoNombre: f.empleado_nombre,
    categoria: f.categoria,
    fecha: f.fecha,
    comentario: f.comentario,
    estado: f.estado,
    resueltaAt: f.resuelta_at === null ? null : iso(f.resuelta_at),
    createdAt: iso(f.created_at),
    updatedAt: iso(f.updated_at),
    imagen:
      f.imagen_id === null
        ? null
        : {
            id: f.imagen_id,
            nombreArchivo: f.imagen_nombre as string,
            mime: f.imagen_mime as MimeImagenNota,
            bytes: Number(f.imagen_bytes),
          },
  };
}

/** Todas las notas del autor, de la más reciente a la más antigua. */
export async function notasDeAutor(db: Pool, autorEmail: string): Promise<Nota[]> {
  const { rows } = await db.query(
    `${SELECT_NOTA} WHERE n.autor_email = $1 ORDER BY n.fecha DESC, n.created_at DESC`,
    [autorEmail],
  );
  return (rows as FilaNotaDb[]).map(aNota);
}

/** Una nota, solo si es de ese autor. `null` tanto si no existe como si es ajena. */
export async function notaDeAutor(db: Consultable, id: string, autorEmail: string): Promise<Nota | null> {
  const { rows } = await db.query(`${SELECT_NOTA} WHERE n.id = $1 AND n.autor_email = $2`, [id, autorEmail]);
  return rows.length ? aNota(rows[0] as FilaNotaDb) : null;
}

/** Inserta o sustituye la imagen de una nota. UNIQUE (nota_id) hace de una a lo sumo. */
async function guardarImagen(client: PoolClient, notaId: string, img: ImagenNuevaDeNota): Promise<void> {
  await client.query(
    `INSERT INTO portal.ausencias_nota_imagenes (nota_id, nombre_archivo, mime, contenido)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (nota_id) DO UPDATE
       SET nombre_archivo = EXCLUDED.nombre_archivo, mime = EXCLUDED.mime,
           contenido = EXCLUDED.contenido, created_at = NOW()`,
    [notaId, img.nombreArchivo, img.mime, img.contenido],
  );
}

/**
 * Crea la nota y, si la trae, su imagen, en una transacción: una nota que se
 * guardara sin la foto que se adjuntó sería una nota distinta de la pedida.
 */
export async function insertarNota(
  db: Pool,
  autorEmail: string,
  empleadoNombre: string,
  datos: NuevaNota,
): Promise<Nota> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO portal.ausencias_notas (empleado_id, empleado_nombre, categoria, fecha, comentario, autor_email)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [datos.empleadoId, empleadoNombre, datos.categoria, datos.fecha, datos.comentario, autorEmail],
    );
    const id = (rows[0] as { id: string }).id;
    if (datos.imagen) await guardarImagen(client, id, datos.imagen);
    return (await notaDeAutor(client, id, autorEmail)) as Nota;
  });
}

/**
 * Aplica el cambio a la nota del autor. `null` si no existe o es ajena, y en ese
 * caso no se toca nada: el UPDATE va primero y la imagen solo se toca si alcanzó
 * una fila.
 *
 * `empleadoNombre` acompaña a `cambio.empleadoId`: la copia del nombre la decide
 * el servicio, que es quien lee la ficha.
 */
export async function actualizarNota(
  db: Pool,
  id: string,
  autorEmail: string,
  cambio: CambioNota,
  empleadoNombre?: string,
): Promise<Nota | null> {
  return withTransaction(db, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    const poner = (columna: string, valor: unknown) => {
      valores.push(valor);
      sets.push(`${columna} = $${valores.length}`);
    };
    if (cambio.empleadoId !== undefined) {
      poner('empleado_id', cambio.empleadoId);
      poner('empleado_nombre', empleadoNombre);
    }
    if (cambio.categoria !== undefined) poner('categoria', cambio.categoria);
    if (cambio.fecha !== undefined) poner('fecha', cambio.fecha);
    if (cambio.comentario !== undefined) poner('comentario', cambio.comentario);
    if (cambio.estado !== undefined) {
      poner('estado', cambio.estado);
      // COALESCE: volver a marcar como resuelta una nota que ya lo estaba no
      // reescribe cuándo se resolvió.
      sets.push(cambio.estado === 'resuelta' ? 'resuelta_at = COALESCE(resuelta_at, NOW())' : 'resuelta_at = NULL');
    }
    sets.push('updated_at = NOW()');
    valores.push(id, autorEmail);
    const { rowCount } = await client.query(
      `UPDATE portal.ausencias_notas SET ${sets.join(', ')}
        WHERE id = $${valores.length - 1} AND autor_email = $${valores.length}`,
      valores,
    );
    if (!rowCount) return null;
    if (cambio.imagen === null) {
      await client.query('DELETE FROM portal.ausencias_nota_imagenes WHERE nota_id = $1', [id]);
    } else if (cambio.imagen !== undefined) {
      await guardarImagen(client, id, cambio.imagen);
    }
    return notaDeAutor(client, id, autorEmail);
  });
}

/** Borra la nota del autor; su imagen cae por el ON DELETE CASCADE. */
export async function eliminarNota(db: Pool, id: string, autorEmail: string): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM portal.ausencias_notas WHERE id = $1 AND autor_email = $2', [
    id,
    autorEmail,
  ]);
  return (rowCount ?? 0) > 0;
}

/** La imagen de una nota del autor, con sus bytes. `null` si no hay o es ajena. */
export async function imagenDeNota(db: Pool, notaId: string, autorEmail: string): Promise<ImagenCompletaDeNota | null> {
  const { rows } = await db.query(
    `SELECT i.nombre_archivo, i.mime, i.contenido
       FROM portal.ausencias_nota_imagenes i
       JOIN portal.ausencias_notas n ON n.id = i.nota_id
      WHERE n.id = $1 AND n.autor_email = $2`,
    [notaId, autorEmail],
  );
  if (!rows.length) return null;
  const f = rows[0] as { nombre_archivo: string; mime: MimeImagenNota; contenido: Buffer };
  return { nombreArchivo: f.nombre_archivo, mime: f.mime, contenido: f.contenido };
}
