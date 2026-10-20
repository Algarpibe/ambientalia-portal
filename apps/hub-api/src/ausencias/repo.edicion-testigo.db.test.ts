import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { actualizarSolicitud, solicitudPorId, SolicitudCambiada, type EdicionSolicitud } from './repo.js';
import { construirPayloadCorreccion } from './notificaciones.js';
import type { Solicitud } from './types.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// DATA-337 — el PATCH del registro general sobreescribe la fila entera, `estado`
// incluido, con lo que el admin tenía en el formulario. El formulario se carga
// minutos antes de guardar: si entre medias el jefe aprobaba, guardar devolvía
// la solicitud a `pendiente` —con el correo «aprobada» ya encolado o enviado—.
// El testigo es el estado que el admin VIO: si la fila ya no está en él, no se
// escribe nada.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const ADMIN = 'comercial@ambientalia.com.co';

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
});

async function pendiente(): Promise<Solicitud> {
  const empleadoId = await sembrarEmpleado(db, CORREO);
  return sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado: 'pendiente',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo: null,
  });
}

/** Lo que el admin manda: la fila como la vio, con algún cambio encima. */
function edicionDe(s: Solicitud, over: Partial<EdicionSolicitud> = {}): EdicionSolicitud {
  return {
    empleadoId: s.empleadoId,
    tipo: s.tipo,
    fechaInicio: s.fechaInicio,
    fechaFin: s.fechaFin,
    dias: s.diasHabiles,
    estado: s.estado,
    estadoLeido: s.estado,
    comentarios: s.comentarios,
    observaciones: s.observaciones,
    ...over,
  };
}

/** El jefe aprueba por su lado: una escritura directa, sin pasar por el admin. */
const aprobarPorDetras = (id: string) =>
  db.query(`UPDATE portal.solicitudes_ausencia SET estado = 'aprobada' WHERE id = $1`, [id]);

describe('el PATCH de admin lleva testigo del estado que vio', () => {
  it('si la fila sigue como la vio, corrige', async () => {
    const s = await pendiente();
    const r = await actualizarSolicitud(db, s.id, edicionDe(s, { comentarios: 'errata' }), ADMIN, construirPayloadCorreccion);
    expect(r?.comentarios).toBe('errata');
  });

  it('si la aprobaron después de abrir el formulario: lanza y NO revierte la aprobación', async () => {
    const s = await pendiente();
    const formulario = edicionDe(s, { comentarios: 'errata' });
    await aprobarPorDetras(s.id);

    await expect(actualizarSolicitud(db, s.id, formulario, ADMIN, construirPayloadCorreccion)).rejects.toBeInstanceOf(
      SolicitudCambiada,
    );
    const ahora = await solicitudPorId(db, s.id);
    expect(ahora?.estado).toBe('aprobada');
    expect(ahora?.comentarios).not.toBe('errata');
  });

  it('CANDADO: también si la aprobación se confirma EN MEDIO del PATCH', async () => {
    // La ventana de milisegundos entre leer la fila y escribirla: el jefe tiene
    // la fila cogida cuando el admin guarda. Sin el testigo en el WHERE del
    // UPDATE, la lectura previa ve `pendiente`, el UPDATE espera y, al soltarse,
    // escribe encima de la aprobación.
    const s = await pendiente();
    const jefe = await db.connect();
    try {
      await jefe.query('BEGIN');
      await jefe.query(`UPDATE portal.solicitudes_ausencia SET estado = 'aprobada' WHERE id = $1`, [s.id]);

      const guardar = actualizarSolicitud(db, s.id, edicionDe(s, { comentarios: 'errata' }), ADMIN, construirPayloadCorreccion);
      // Que el PATCH no quede como promesa rechazada sin manejar mientras espera.
      guardar.catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      await jefe.query('COMMIT');

      await expect(guardar).rejects.toBeInstanceOf(SolicitudCambiada);
    } finally {
      jefe.release();
    }
    expect((await solicitudPorId(db, s.id))?.estado).toBe('aprobada');
  });

  it('una solicitud que no existe sigue siendo null (404), no un conflicto', async () => {
    const s = await pendiente();
    // Fechas libres: con las de `s` saldría el solape, que va antes que el 404
    // a propósito (lo fija repo.solapes.db.test.ts).
    const r = await actualizarSolicitud(
      db,
      '00000000-0000-4000-8000-000000000000',
      edicionDe(s, { fechaInicio: '2026-09-07', fechaFin: '2026-09-07' }),
      ADMIN,
      construirPayloadCorreccion,
    );
    expect(r).toBeNull();
  });
});
