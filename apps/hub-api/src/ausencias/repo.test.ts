import { describe, it, expect } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { crearModificacion, decidirModificacion } from './repo.js';
import type { PayloadEvento } from './types.js';

// Los únicos tests del repo que no necesitan Postgres.
//
// El resto del fichero es SQL y se prueba a través del doble in-memory de
// `router.test.ts`, que lo sustituye entero. Aquí quedan las dos cosas que ese
// doble NO puede cubrir por construcción: cómo se traduce un error del DRIVER
// (que el doble nunca lanza, porque comprueba en JS antes de escribir) y la
// forma del SQL que el doble reemplaza.
//
// `crearModificacion` solo usa `db.connect()`, así que un Pool falso de quince
// líneas basta.

/** Una fila del satélite, con los alias `mod_*` que devuelve el SQL real. */
const FILA_MODIFICACION = {
  mod_id: 'm1',
  mod_solicitud_id: 's1',
  mod_clase: 'fechas',
  mod_estado_previo: 'aprobada',
  mod_fecha_inicio_previa: '2026-07-06',
  mod_fecha_fin_previa: '2026-07-10',
  mod_dias_habiles_previos: 5,
  mod_fecha_inicio_nueva: '2026-07-13',
  mod_fecha_fin_nueva: '2026-07-17',
  mod_dias_habiles_nuevos: 5,
  mod_motivo: 'Cita medica',
  mod_estado: 'pendiente',
  mod_aprobador_correo: 'comercial@ambientalia.com.co',
  mod_solicitante_email: 'ana.ruiz@ambientalia.com.co',
  mod_decidida_at: null,
  mod_motivo_rechazo: null,
  mod_created_at: '2026-06-20T10:00:00Z',
};

/** Lo mínimo de una solicitud para que `aSolicitud` no se quede a medias. */
const FILA_SOLICITUD = {
  id: 's1',
  tipo: 'vacaciones',
  empleado_id: 'e1',
  empleado_nombre: 'Ana Ruiz',
  empleado_cargo: 'Analista',
  solicitante_email: 'ana.ruiz@ambientalia.com.co',
  fecha_inicio: '2026-07-06',
  fecha_fin: '2026-07-10',
  dias_habiles: 5,
  estado: 'aprobada',
  origen: 'portal',
  created_at: '2026-06-01T10:00:00Z',
  ...FILA_MODIFICACION,
};

const DATOS = {
  solicitudId: 's1',
  clase: 'fechas' as const,
  estadoEsperado: 'aprobada' as const,
  fechaInicioNueva: '2026-07-13',
  fechaFinNueva: '2026-07-17',
  diasHabilesNuevos: 5,
  motivo: 'Cita medica',
  aprobadorCorreo: 'comercial@ambientalia.com.co',
};

/** El payload no se ejercita aquí: lo cubre entero notificaciones.test.ts. */
const payloadStub = () => ({ correo: { para: '', asunto: '', cuerpo: '' } }) as unknown as PayloadEvento;

/**
 * Un Pool que registra el SQL que se le manda y, opcionalmente, revienta en el
 * INSERT del satélite con el error que daría Postgres.
 */
function poolFalso(fallo?: { code: string; constraint?: string }) {
  const sqls: string[] = [];
  const client = {
    query: async (sql: string) => {
      sqls.push(sql);
      if (sql.includes('INSERT INTO portal.solicitud_modificaciones')) {
        if (fallo) throw Object.assign(new Error('duplicate key value'), fallo);
        return { rows: [{ id: 'm1' }] };
      }
      if (sql.includes('FROM portal.solicitud_modificaciones m')) return { rows: [FILA_MODIFICACION] };
      if (sql.includes('FROM portal.solicitudes_ausencia s')) return { rows: [FILA_SOLICITUD] };
      return { rows: [] };
    },
    release: () => {},
  };
  return { db: { connect: async () => client } as unknown as Pool, sqls };
}

describe('crearModificacion contra un driver falso', () => {
  it('un 23505 del índice único parcial es «ya hay una propuesta viva», no un 500', async () => {
    // La carrera que la BASE corta y el servicio no: dos peticiones simultáneas
    // pasan las dos cualquier comprobación previa en JS antes de que ninguna
    // escriba. Este camino NO lo cubre el doble de router.test.ts —comprueba en
    // memoria y devuelve `duplicada` sin lanzar—, así que sin este test el
    // `catch` entero está sin ejercitar.
    const { db, sqls } = poolFalso({ code: '23505', constraint: 'ux_modificaciones_una_pendiente' });
    await expect(crearModificacion(db, DATOS, payloadStub)).resolves.toEqual({ ok: false, razon: 'duplicada' });
    // Y la transacción se deshace: no puede quedar a medias.
    expect(sqls).toContain('ROLLBACK');
  });

  it('CANDADO: un 23505 de OTRO constraint se propaga, no se disfraza de duplicada', async () => {
    // Dentro del mismo `try` se escribe en `ausencias_outbox`, que no es
    // nuestra: añadirle un UNIQUE por idempotencia es lo más natural que puede
    // pasar en la Fase 3. El día que ocurra, un fallo real tiene que salir como
    // 500 y no como un «ya tienes una propuesta pendiente» que nadie entiende
    // y que además afirmaría que no se escribió nada.
    const { db } = poolFalso({ code: '23505', constraint: 'ux_outbox_idempotencia' });
    await expect(crearModificacion(db, DATOS, payloadStub)).rejects.toThrow('duplicate key value');
  });

  it('un error que no es 23505 se propaga tal cual', async () => {
    const { db } = poolFalso({ code: '40001' });
    await expect(crearModificacion(db, DATOS, payloadStub)).rejects.toThrow('duplicate key value');
  });
});

// ── La decisión ────────────────────────────────────────────────────────────

/**
 * Un Pool para la decisión, con las dos escrituras programables por separado.
 *
 * Que cada UPDATE pueda devolver CERO filas es todo el asunto: es la única forma
 * de ejecutar de verdad —sin Postgres— los dos caminos de fallo de
 * `decidirModificacion`, y en particular el que deshace la transacción entera.
 */
function poolDecision(over: { propuesta?: unknown[]; solicitud?: unknown[] } = {}) {
  const sqls: string[] = [];
  const client = {
    query: async (sql: string) => {
      sqls.push(sql);
      if (sql.includes('UPDATE portal.solicitud_modificaciones')) return { rows: over.propuesta ?? [FILA_MODIFICACION] };
      if (sql.includes('UPDATE portal.solicitudes_ausencia')) return { rows: over.solicitud ?? [{ id: 's1' }] };
      if (sql.includes('FROM portal.solicitudes_ausencia s')) return { rows: [FILA_SOLICITUD] };
      return { rows: [] };
    },
    release: () => {},
  };
  return { db: { connect: async () => client } as unknown as Pool, sqls };
}

const hizo = (sqls: string[], trozo: string) => sqls.some((s) => s.includes(trozo));

describe('decidirModificacion contra un driver falso', () => {
  it('CANDADO: si el UPDATE de la solicitud no encuentra fila, ROLLBACK y NADA en el outbox', async () => {
    // Lo más importante de la fase, y aquí sí se ejecuta el código de verdad: el
    // paso 1 YA ha escrito cuando el paso 2 falla. Si esto no lanzara, la
    // propuesta quedaría «aprobada» sobre una solicitud con las fechas viejas y
    // —peor— el correo saldría anunciando un cambio que no ha ocurrido.
    const { db, sqls } = poolDecision({ solicitud: [] });
    await expect(decidirModificacion(db, 'm1', true, null, null, payloadStub)).resolves.toEqual({
      ok: false,
      razon: 'solicitud_cambio_de_estado',
    });
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(hizo(sqls, 'INSERT INTO portal.ausencias_outbox')).toBe(false);
  });

  it('cero filas en la propuesta es «ya decidida», y ni se mira la solicitud', async () => {
    const { db, sqls } = poolDecision({ propuesta: [] });
    await expect(decidirModificacion(db, 'm1', true, null, null, payloadStub)).resolves.toEqual({
      ok: false,
      razon: 'ya_decidida',
    });
    expect(hizo(sqls, 'UPDATE portal.solicitudes_ausencia')).toBe(false);
    expect(hizo(sqls, 'INSERT INTO portal.ausencias_outbox')).toBe(false);
  });

  it('rechazar NO toca la solicitud, pero sí encola su aviso', async () => {
    const { db, sqls } = poolDecision();
    const r = await decidirModificacion(db, 'm1', false, 'Ya esta cubierto el turno', null, payloadStub);
    expect(r.ok).toBe(true);
    expect(hizo(sqls, 'UPDATE portal.solicitudes_ausencia')).toBe(false);
    expect(hizo(sqls, 'INSERT INTO portal.ausencias_outbox')).toBe(true);
    expect(sqls).toContain('COMMIT');
  });
});
