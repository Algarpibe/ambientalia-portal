import type { Pool } from '@algarpibe/zoho-sync';
import type { DatosConfirmacion } from './dominio.js';
import type { CelebracionStore, Confirmacion, ConteoVotos, Miembro, VotoPropio } from './service.js';

// El tipo del cliente transaccional se deriva del Pool, como en
// users.repository.ts (los @types de 'pg' no están en este paquete).
type PoolClient = Awaited<ReturnType<Pool['connect']>>;

interface FilaConfirmacion {
  user_id: string;
  asiste: boolean;
  preferencia: string | null;
  mensaje: string | null;
  actualizado_en: Date | string;
}

function aConfirmacion(r: FilaConfirmacion): Confirmacion {
  return {
    userId: r.user_id,
    asiste: r.asiste,
    preferencia: r.preferencia,
    mensaje: r.mensaje,
    actualizadoEn: new Date(r.actualizado_en),
  };
}

const COLUMNAS_CONFIRMACION = 'user_id, asiste, preferencia, mensaje, actualizado_en';

/** SQL de la invitación. Parámetros posicionales siempre; la hora llega del servicio. */
export class CelebracionRepository implements CelebracionStore {
  constructor(private readonly pool: Pool) {}

  async listarEquipo(): Promise<Miembro[]> {
    const { rows } = await this.pool.query(
      `SELECT id, full_name, avatar FROM portal.users WHERE status = 'active' ORDER BY full_name, id`,
    );
    return (rows as { id: string; full_name: string; avatar: string | null }[]).map((r) => ({
      userId: r.id,
      nombre: r.full_name,
      avatar: r.avatar,
    }));
  }

  async esUsuarioActivo(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM portal.users WHERE id = $1 AND status = 'active'`, [userId]);
    return rows.length > 0;
  }

  async contarVotos(evento: string): Promise<ConteoVotos[]> {
    const { rows } = await this.pool.query(
      `SELECT v.votado_id, v.cualidad, count(*)::int AS votos
         FROM portal.celebracion_votos v
         JOIN portal.users u ON u.id = v.votante_id AND u.status = 'active'
        WHERE v.evento = $1
        GROUP BY v.votado_id, v.cualidad`,
      [evento],
    );
    return (rows as { votado_id: string; cualidad: string; votos: number }[]).map((r) => ({
      votadoId: r.votado_id,
      cualidad: r.cualidad,
      votos: r.votos,
    }));
  }

  async votosDe(evento: string, votanteId: string): Promise<VotoPropio[]> {
    const { rows } = await this.pool.query(
      `SELECT votado_id, cualidad FROM portal.celebracion_votos
        WHERE evento = $1 AND votante_id = $2
        ORDER BY votado_id, creado_en, cualidad`,
      [evento, votanteId],
    );
    return (rows as { votado_id: string; cualidad: string }[]).map((r) => ({ votadoId: r.votado_id, cualidad: r.cualidad }));
  }

  async confirmacionDe(evento: string, userId: string): Promise<Confirmacion | null> {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNAS_CONFIRMACION} FROM portal.celebracion_confirmaciones WHERE evento = $1 AND user_id = $2`,
      [evento, userId],
    );
    const fila = rows[0] as FilaConfirmacion | undefined;
    return fila ? aConfirmacion(fila) : null;
  }

  async listarConfirmaciones(evento: string): Promise<Confirmacion[]> {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNAS_CONFIRMACION} FROM portal.celebracion_confirmaciones WHERE evento = $1`,
      [evento],
    );
    return (rows as FilaConfirmacion[]).map(aConfirmacion);
  }

  async guardarConfirmacion(evento: string, userId: string, datos: DatosConfirmacion, ahora: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO portal.celebracion_confirmaciones (evento, user_id, asiste, preferencia, mensaje, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (evento, user_id) DO UPDATE
          SET asiste = EXCLUDED.asiste,
              preferencia = EXCLUDED.preferencia,
              mensaje = EXCLUDED.mensaje,
              actualizado_en = EXCLUDED.actualizado_en`,
      [evento, userId, datos.asiste, datos.preferencia, datos.mensaje, ahora],
    );
  }

  async reemplazarVotos(
    evento: string,
    votanteId: string,
    votadoId: string,
    cualidades: string[],
    ahora: Date,
  ): Promise<void> {
    await this.transaction(async (client) => {
      // Decisión D4: serializa los guardados de la misma persona. Dos a la vez
      // (doble clic) no pueden dejar más de 3 cualidades. Sin permisos especiales.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`celebracion:${evento}:${votanteId}`]);
      await client.query(
        `DELETE FROM portal.celebracion_votos WHERE evento = $1 AND votante_id = $2 AND votado_id = $3`,
        [evento, votanteId, votadoId],
      );
      if (cualidades.length > 0) {
        await client.query(
          `INSERT INTO portal.celebracion_votos (evento, votante_id, votado_id, cualidad, creado_en)
           SELECT $1::text, $2::uuid, $3::uuid, c, $5::timestamptz FROM unnest($4::text[]) AS c`,
          [evento, votanteId, votadoId, cualidades, ahora],
        );
      }
    });
  }

  /** BEGIN, el trabajo y COMMIT; un error hace ROLLBACK y se propaga. */
  private async transaction(fn: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
    } catch (err) {
      // Si el ROLLBACK también falla, no debe tapar el error original.
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
