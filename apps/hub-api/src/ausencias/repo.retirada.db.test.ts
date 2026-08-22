import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { retirarSolicitud, solicitudPorId } from './repo.js';
import type { Solicitud } from './types.js';
import {
  poolDePrueba,
  limpiar,
  payloadStub,
  sembrarEmpleado,
  sembrarSolicitud,
  eventosDelOutbox,
} from '../test-db/harness.js';

// `retirarSolicitud` contra Postgres de verdad.
//
// ⚠️ Este fichero existe porque al falsar los candados se vio que NO habIa
// ninguno sobre el WHERE. El guard equivalente del servicio (`puedeRetirarla`)
// si estaba cubierto, pero contra el doble en memoria — y el que cierra la
// CARRERA es este, el del SQL. Quitarle el `AND primera_firma_at IS NULL`
// dejaba la bateria entera en verde mientras una retirada borraba la firma que
// el jefe inmediato acababa de dar.
//
// Son dos defensas del mismo par de condiciones y hacen falta las dos: el
// servicio decide el 409 con su mensaje leyendo la fila ANTES, y este WHERE es
// lo unico que vale si la fila se mueve entre esa lectura y la escritura.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const JEFE = 'jefe1@ambientalia.com.co';

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
  empleadoId = await sembrarEmpleado(db, CORREO, JEFE);
});

function sembrar(estado: Solicitud['estado']): Promise<Solicitud> {
  return sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo: null,
  });
}

describe('retirarSolicitud', () => {
  it('retira una pendiente sin firmar: queda anulada y avisa', async () => {
    const s = await sembrar('pendiente');
    const r = await retirarSolicitud(db, s.id, payloadStub);

    expect(r).toMatchObject({ estado: 'rechazada' });
    expect(r?.anuladaAt).not.toBeNull();
    expect(await eventosDelOutbox(db)).toEqual(['retirada']);
  });

  it('CANDADO: NO la retira si ya lleva la primera firma, aunque el estado diga `pendiente`', async () => {
    // El mutante que muere aqui es quitar `AND primera_firma_at IS NULL` del
    // WHERE, y hasta que se escribio este test NO MORIA EN NINGUN SITIO: el
    // candado del servicio corre contra el doble en memoria.
    //
    // La combinacion se da de verdad: un admin puede devolver una solicitud a
    // `pendiente` con el PATCH del registro sin limpiar esa marca, y entonces
    // «pendiente» convive con una firma YA DADA. Retirarla ahi le borraria al
    // jefe inmediato su visto bueno sin decirselo a nadie.
    const s = await sembrar('pendiente');
    await db.query(`UPDATE portal.solicitudes_ausencia SET primera_firma_at = now() WHERE id = $1`, [s.id]);

    expect(await retirarSolicitud(db, s.id, payloadStub)).toBeNull();

    const final = await solicitudPorId(db, s.id);
    expect(final?.estado).toBe('pendiente');
    expect(final?.anuladaAt).toBeNull();
    // Y no se ha encolado ningun aviso: nadie tiene que enterarse de algo que no
    // ha pasado.
    expect(await eventosDelOutbox(db)).toEqual([]);
  });

  it('CANDADO: tampoco una `pendiente_2` — ahi el jefe inmediato ya firmo', async () => {
    const s = await sembrar('pendiente_2');
    expect(await retirarSolicitud(db, s.id, payloadStub)).toBeNull();
    expect((await solicitudPorId(db, s.id))?.estado).toBe('pendiente_2');
  });

  it('CANDADO: ni una ya decidida, en ninguno de sus dos finales', async () => {
    // Retirar una aprobada devolveria los dias y la sacaria del calendario sin
    // que se entere quien la firmo. Para eso esta pedir la anulacion.
    for (const estado of ['aprobada', 'rechazada'] as const) {
      await limpiar(db);
      empleadoId = await sembrarEmpleado(db, CORREO, JEFE);
      const s = await sembrar(estado);
      expect(await retirarSolicitud(db, s.id, payloadStub)).toBeNull();
      expect((await solicitudPorId(db, s.id))?.estado).toBe(estado);
    }
  });

  it('CANDADO: no inventa un decisor', async () => {
    // No la decidio nadie. Es lo unico que distingue en el registro una retirada
    // de una anulacion que un jefe firmo, y por eso el UPDATE no toca
    // `decidida_at` ni `aprobador_user_id`.
    const s = await sembrar('pendiente');
    await retirarSolicitud(db, s.id, payloadStub);

    const { rows } = await db.query(
      `SELECT decidida_at, aprobador_user_id, primera_firma_at
         FROM portal.solicitudes_ausencia WHERE id = $1`,
      [s.id],
    );
    expect(rows[0]).toEqual({ decidida_at: null, aprobador_user_id: null, primera_firma_at: null });
  });

  it('un id inexistente devuelve null y no encola nada', async () => {
    expect(await retirarSolicitud(db, '00000000-0000-4000-8000-000000000000', payloadStub)).toBeNull();
    expect(await eventosDelOutbox(db)).toEqual([]);
  });

  it('CANDADO: el evento `retirada` cabe en el CHECK del outbox', async () => {
    // La mitad que se olvido en la 024 y que la 027 dejo documentada: si el CHECK
    // no admitiera el literal, este INSERT rebotaria DENTRO de la transaccion y
    // el ROLLBACK se llevaria tambien el UPDATE — el usuario veria un 500 y su
    // solicitud seguiria ahi. Se afirma que la fila QUEDO retirada, que es lo que
    // demuestra que la transaccion entera cuajo.
    const s = await sembrar('pendiente');
    await retirarSolicitud(db, s.id, payloadStub);
    expect((await solicitudPorId(db, s.id))?.estado).toBe('rechazada');
  });
});
