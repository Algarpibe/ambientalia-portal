import type { Pool } from '@algarpibe/zoho-sync';

// ARQ-612 — la lectura de un adjunto, sacada de repo.ts tal cual. Devuelve los
// correos de la solicitud junto al fichero porque quien llama decide con ellos
// si puede verlo (service.puedeVerAdjunto). repo.ts lo reexporta: el resto del
// código lo sigue llamando como `repo.*` (lo vigila barril.test.ts).

export interface AdjuntoCompleto {
  solicitudId: string;
  solicitanteEmail: string;
  aprobadorCorreo: string | null;
  segundoAprobadorCorreo: string | null;
  nombreArchivo: string;
  mime: string;
  contenido: Buffer;
}

export async function adjuntoPorId(db: Pool, id: string): Promise<AdjuntoCompleto | null> {
  const { rows } = await db.query(
    `SELECT a.solicitud_id, s.solicitante_email, s.aprobador_correo, s.segundo_aprobador_correo,
            a.nombre_archivo, a.mime, a.contenido
       FROM portal.solicitud_adjuntos a
       JOIN portal.solicitudes_ausencia s ON s.id = a.solicitud_id
      WHERE a.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const r = rows[0] as {
    solicitud_id: string;
    solicitante_email: string;
    aprobador_correo: string | null;
    segundo_aprobador_correo: string | null;
    nombre_archivo: string;
    mime: string;
    contenido: Buffer;
  };
  return {
    solicitudId: r.solicitud_id,
    solicitanteEmail: r.solicitante_email,
    aprobadorCorreo: r.aprobador_correo,
    segundoAprobadorCorreo: r.segundo_aprobador_correo,
    nombreArchivo: r.nombre_archivo,
    mime: r.mime,
    contenido: r.contenido,
  };
}
