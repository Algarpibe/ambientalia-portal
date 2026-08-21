import { describe, it, expect } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { crearModificacion, decidirModificacion, porFechaDeCierre } from './repo.js';
import type { Movimiento, PayloadEvento } from './types.js';

// Los tests del repo que NO necesitan Postgres.
//
// El resto de `repo.ts` es SQL y se prueba por otros dos caminos: el doble
// in-memory de `router.test.ts`, que lo sustituye entero, y
// `repo.testigos.db.test.ts`, que ejecuta las consultas de verdad contra un
// Postgres en Docker (`npm run test:db`, el cuarto portón). Ahí se fue lo que
// aquí era «la forma del SQL»: asertar sobre el TEXTO de una consulta protege el
// texto, no lo que hace.
//
// Aquí quedan las tres cosas que ninguno de esos dos caminos da. Una, cómo se
// traduce un error del DRIVER: el doble nunca lanza —comprueba en JS antes de
// escribir— y Postgres real no lo provoca sin ensuciar el esquema, porque hoy no
// hay ningún otro constraint que emita un `23505` dentro de este `try`. Otra,
// QUÉ sentencias llegaron a mandarse, que no se lee en las filas resultantes:
// que el `UPDATE` de la solicitud ni se intentó, que no se escribió en el
// outbox, que hubo `ROLLBACK` y no `COMMIT`.
//
// Y la tercera, las funciones PURAS que `repo.ts` exporta solo para poder
// probarlas sueltas: hoy `porFechaDeCierre`, el orden del registro de
// movimientos. Esa no es que Postgres no la dé — es que la da MAL: ninguna de
// las dos consultas del registro lleva `ORDER BY`, así que contra Postgres el
// orden en que llegan las filas empatadas lo elige el plan de ejecución, y para
// un dataset de test puede coincidir con el esperado por casualidad. Aquí no
// hay casualidad posible.
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

// ── El orden del registro de movimientos ───────────────────────────────────
//
// `porFechaDeCierre` se exporta solo para esto, y este bloque existe por una
// mutación que NO mordió: sustituyendo su desempate por `return 0`, los doce
// tests de `repo.movimientos.db.test.ts` seguían en verde. No porque el
// desempate no importe, sino porque allí no se puede observar: las filas
// empatadas vienen de una consulta SIN `ORDER BY` y Postgres las devolvía en el
// orden esperado por casualidad.
//
// La clave de que aquí sí muerda está en el orden de ENTRADA de cada caso, que
// es siempre el contrario del de salida. `Array.prototype.sort` es estable
// desde ES2019, así que un comparador que devuelve `0` deja la lista tal como
// entró: si la entrada ya viniera ordenada, un comparador roto pasaría igual.

/** Un movimiento con lo mínimo para ordenar; el resto es relleno inerte. */
function movimiento(id: string, decididaAt: string | null, createdAt: string): Movimiento {
  return {
    clase: 'solicitud',
    estado: 'aprobada',
    id,
    solicitudId: id,
    empleadoNombre: 'Ana Ruiz',
    empleadoCargo: 'Analista',
    solicitanteEmail: 'ana@ambientalia.com.co',
    tipo: 'vacaciones',
    fechaInicio: '2026-05-04',
    fechaFin: '2026-05-08',
    diasHabiles: 5,
    decididaAt,
    decididaPor: null,
    createdAt,
    motivo: null,
  };
}

/** El formato EXACTO que devuelve `::text` sobre un `timestamptz`. */
function marca(dia: string, hora: string): string {
  return `2026-0${dia} ${hora}+00`;
}

const ordenados = (ms: Movimiento[]): string[] => [...ms].sort(porFechaDeCierre).map((m) => m.id);

describe('porFechaDeCierre: el orden del registro', () => {
  it('lo último decidido va arriba', () => {
    const entrada = [
      movimiento('vieja', marca('1-10', '09:00:00'), marca('1-01', '09:00:00')),
      movimiento('nueva', marca('3-10', '09:00:00'), marca('1-01', '09:00:00')),
    ];
    expect(ordenados(entrada)).toEqual(['nueva', 'vieja']);
  });

  it('a igualdad de decididaAt, desempata por createdAt DESC', () => {
    // Entran de la más VIEJA a la más nueva, justo al revés de lo que se espera.
    const cierre = marca('3-10', '09:00:00');
    const entrada = [
      movimiento('creada-1', cierre, marca('1-01', '09:00:00')),
      movimiento('creada-2', cierre, marca('2-01', '09:00:00')),
      movimiento('creada-3', cierre, marca('3-01', '09:00:00')),
    ];
    expect(ordenados(entrada)).toEqual(['creada-3', 'creada-2', 'creada-1']);
  });

  // El caso que de verdad se da en producción, y el que la mutación dejaba
  // pasar: el registro trae las que siguen en trámite y las que llegaron a
  // estado terminal sin `decidida_at`, y TODAS ellas empatan a `null`. Sin
  // desempate, ese grupo —que en una empresa es la mayoría de la pantalla—
  // saldría en un orden arbitrario.
  it('las que no tienen decididaAt también desempatan por createdAt DESC', () => {
    const entrada = [
      movimiento('sin-cierre-1', null, marca('1-01', '09:00:00')),
      movimiento('sin-cierre-2', null, marca('2-01', '09:00:00')),
      movimiento('sin-cierre-3', null, marca('3-01', '09:00:00')),
    ];
    expect(ordenados(entrada)).toEqual(['sin-cierre-3', 'sin-cierre-2', 'sin-cierre-1']);
  });

  it('NULLS LAST: una sin decidir va detrás de una decidida, aunque sea más nueva', () => {
    // La sin cerrar entra PRIMERA y es la más recién creada de las dos: los dos
    // sesgos que la empujarían arriba si el `NULLS LAST` no estuviera.
    const entrada = [
      movimiento('sin-cierre', null, marca('3-01', '09:00:00')),
      movimiento('decidida', marca('2-10', '09:00:00'), marca('1-01', '09:00:00')),
    ];
    expect(ordenados(entrada)).toEqual(['decidida', 'sin-cierre']);
  });

  it('la lista mezclada: cierre DESC, luego las sin cerrar, y createdAt DESC dentro de cada grupo', () => {
    // La lista entra EXACTAMENTE al revés del orden esperado.
    const entrada = [
      movimiento('sin-cierre-vieja', null, marca('1-01', '09:00:00')),
      movimiento('sin-cierre-nueva', null, marca('3-01', '09:00:00')),
      movimiento('cerrada-empate-vieja', marca('2-10', '09:00:00'), marca('1-05', '09:00:00')),
      movimiento('cerrada-empate-nueva', marca('2-10', '09:00:00'), marca('2-05', '09:00:00')),
      movimiento('cerrada-ultima', marca('3-10', '09:00:00'), marca('1-01', '09:00:00')),
    ];
    expect(ordenados(entrada)).toEqual([
      'cerrada-ultima',
      'cerrada-empate-nueva',
      'cerrada-empate-vieja',
      'sin-cierre-nueva',
      'sin-cierre-vieja',
    ]);
  });

  // Un comparador que no es antisimétrico ordena distinto según cómo entre la
  // lista, y eso no da un rojo: da una pantalla que cambia de orden sin motivo.
  it('el resultado no depende del orden de entrada', () => {
    const ms = [
      movimiento('a', marca('3-10', '09:00:00'), marca('1-01', '09:00:00')),
      movimiento('b', marca('2-10', '09:00:00'), marca('2-01', '09:00:00')),
      movimiento('c', null, marca('3-01', '09:00:00')),
      movimiento('d', null, marca('1-01', '09:00:00')),
    ];
    const esperado = ['a', 'b', 'c', 'd'];
    expect(ordenados(ms)).toEqual(esperado);
    expect(ordenados([...ms].reverse())).toEqual(esperado);
    expect(ordenados([ms[2]!, ms[0]!, ms[3]!, ms[1]!])).toEqual(esperado);
  });
});
