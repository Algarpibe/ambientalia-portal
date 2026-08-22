import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { ausenciasEntre, empleadosActivos } from './repo.js';
import type { AusenciaRango } from './calendario.js';
import type { Solicitud, TipoSolicitud } from './types.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

const CORREO = 'ana.ruiz@ambientalia.com.co';
// Otro correo y no una variante del primero: `portal.empleados` lleva UNIQUE
// sobre el correo, asi que dos fichas con el mismo revientan en la siembra.
const OTRO_CORREO = 'luis.gomez@ambientalia.com.co';

// Los dos meses tal como se los pasa `rangoDelMes` al pedir el calendario.
const JULIO = { desde: '2026-07-01', hasta: '2026-07-31' };
const AGOSTO = { desde: '2026-08-01', hasta: '2026-08-31' };

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  // Con `?`: si `beforeAll` revienta, `db` se queda sin asignar y el TypeError
  // de este cierre taparia en el informe el error que de verdad importa.
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
});

/**
 * Una ausencia sembrada. `aprobada` por defecto porque a los casos de rango el
 * estado les da igual y es lo normal en el calendario; el caso que va DE los
 * estados los nombra todos.
 */
function sembrar(
  empleadoId: string,
  correo: string,
  fechaInicio: string,
  fechaFin: string,
  estado: Solicitud['estado'] = 'aprobada',
  tipo?: TipoSolicitud,
): Promise<Solicitud> {
  return sembrarSolicitud(db, {
    empleadoId,
    correo,
    estado,
    fechaInicio,
    fechaFin,
    segundoAprobadorCorreo: null,
    tipo,
  });
}

/**
 * Las ausencias por su rango, y ordenadas AQUI.
 *
 * El orden que devuelve el SQL no se compara a proposito: con cuatro filas
 * Postgres las sirve estables aunque no se lo pidas, asi que una asercion de
 * orden pasaria por suerte y no por el `ORDER BY` --seguiria verde despues de
 * quitarlo--. Ordenar en el test deja escrito que lo que se afirma es QUE filas
 * salen, no en que orden llegan.
 */
function rangos(a: AusenciaRango[]): string[] {
  return a.map((x) => `${x.fechaInicio}..${x.fechaFin}`).sort();
}

describe('ausenciasEntre: el solape contra Postgres real', () => {
  it('CANDADO: la ausencia que cruza el cambio de mes sale en LOS DOS meses', async () => {
    // La condicion es de SOLAPE, no de contencion. Con la natural
    // (`fecha_inicio >= desde AND fecha_fin <= hasta`) las tres primeras
    // desaparecerian de julio, y el mes diria que el dia 28 no falta nadie.
    // Los dos operadores son ademas inclusivos, y de ahi los dos bordes: la que
    // acaba justo el dia 1 y la que empieza justo el dia 31 tambien se pintan.
    const empleadoId = await sembrarEmpleado(db, CORREO);

    await sembrar(empleadoId, CORREO, '2026-07-28', '2026-08-03'); // cruza el cambio de mes
    await sembrar(empleadoId, CORREO, '2026-06-25', '2026-07-01'); // acaba el dia 1 del rango
    await sembrar(empleadoId, CORREO, '2026-07-31', '2026-08-04'); // empieza el ultimo dia
    await sembrar(empleadoId, CORREO, '2026-07-10', '2026-07-15'); // contenida entera
    // Y las dos que no tocan ni un dia de julio.
    await sembrar(empleadoId, CORREO, '2026-06-01', '2026-06-30');
    await sembrar(empleadoId, CORREO, '2026-08-10', '2026-08-20');

    expect(rangos(await ausenciasEntre(db, null, JULIO.desde, JULIO.hasta))).toEqual([
      '2026-06-25..2026-07-01',
      '2026-07-10..2026-07-15',
      '2026-07-28..2026-08-03',
      '2026-07-31..2026-08-04',
    ]);

    // Las mismas dos que cruzan, vistas desde el otro lado del cambio de mes:
    // una ausencia a caballo entre julio y agosto pertenece a los DOS meses, no
    // al de su fecha de inicio.
    expect(rangos(await ausenciasEntre(db, null, AGOSTO.desde, AGOSTO.hasta))).toEqual([
      '2026-07-28..2026-08-03',
      '2026-07-31..2026-08-04',
      '2026-08-10..2026-08-20',
    ]);
  });
});

describe('ausenciasEntre: que estados se pintan', () => {
  it('CANDADO: la incapacidad registrada sale; la rechazada y la anulada, no', async () => {
    // El filtro es `estado <> 'rechazada'`, NO una lista blanca: falla en
    // ABIERTO, asi que cualquier estado que no sea exactamente ese entra solo.
    // Eso sostiene una decision de diseno concreta: anular una solicitud no
    // estrena estado. Si existiera un `'anulada'`, este `<>` lo dejaria pasar y
    // el calendario seguiria pintando como ausencia vigente unos dias que ya
    // nadie disfruta, un fallo que no revienta nada y que solo se ve mirando la
    // rejilla. Por eso anular reutiliza `rechazada` y se distingue por
    // `anulada_at`: para caer del lado que este filtro descarta.
    const empleadoId = await sembrarEmpleado(db, CORREO);

    await sembrar(empleadoId, CORREO, '2026-07-06', '2026-07-07', 'aprobada');
    await sembrar(empleadoId, CORREO, '2026-07-08', '2026-07-09', 'pendiente');
    await sembrar(empleadoId, CORREO, '2026-07-10', '2026-07-11', 'pendiente_2');
    // Las incapacidades se INFORMAN, no se aprueban: `registrada` es su estado
    // terminal, y quien esta incapacitado esta fuera igual que quien esta de
    // vacaciones. Con tipo `incapacidad` porque esa pareja estado/tipo es la
    // unica que produccion sabe crear.
    await sembrar(empleadoId, CORREO, '2026-07-13', '2026-07-14', 'registrada', 'incapacidad');
    await sembrar(empleadoId, CORREO, '2026-07-16', '2026-07-17', 'rechazada');

    // Anulada COMO EN PRODUCCION: se queda `rechazada` y gana `anulada_at`. Se
    // deja asi con un UPDATE directo en vez de aprobando una propuesta de
    // anulacion porque ese camino ya lo prueba `repo.testigos.db.test.ts`
    // («anular deja rechazada + anulada_at»); lo que se examina aqui es como
    // reacciona el filtro a la fila que aquel deja.
    const anulada = await sembrar(empleadoId, CORREO, '2026-07-20', '2026-07-21', 'aprobada');
    await db.query(`UPDATE portal.solicitudes_ausencia SET estado = 'rechazada', anulada_at = NOW() WHERE id = $1`, [
      anulada.id,
    ]);

    const salen = await ausenciasEntre(db, null, JULIO.desde, JULIO.hasta);

    // Los cinco estados estan sembrados y las dos rechazadas se distinguen por
    // su fecha, asi que esta lista dice a la vez cuales entran y cuales no.
    expect(salen.map((x) => `${x.estado} ${x.fechaInicio}`).sort()).toEqual([
      'aprobada 2026-07-06',
      'pendiente 2026-07-08',
      'pendiente_2 2026-07-10',
      'registrada 2026-07-13',
    ]);

    // El tipo viaja con la ausencia: es lo que el calendario usa para pintar
    // una incapacidad distinta de unas vacaciones.
    expect(salen.find((x) => x.estado === 'registrada')?.tipo).toBe('incapacidad');
  });
});

describe('ausenciasEntre: las fichas dadas de baja', () => {
  it('CANDADO: un empleado desactivado no aporta ausencias, aunque las tenga en rango', async () => {
    // `e.activo` esta en las DOS consultas del calendario a proposito.
    // `empleadosActivos` ya deja fuera su FILA, pero sin este filtro sus marcas
    // seguirian llegando: ausencias de gente que ya no esta, colgando de un
    // empleado que la rejilla no tiene donde pintar.
    const activo = await sembrarEmpleado(db, CORREO);
    const deBaja = await sembrarEmpleado(db, OTRO_CORREO);

    await sembrar(activo, CORREO, '2026-07-06', '2026-07-10');
    await sembrar(deBaja, OTRO_CORREO, '2026-07-13', '2026-07-17');

    // La baja se da DESPUES de sembrar: lo que se prueba es que el filtro mira
    // la ficha en el momento de pintar, no que el alta rechace a quien no esta.
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [deBaja]);

    const salen = await ausenciasEntre(db, null, JULIO.desde, JULIO.hasta);
    expect(rangos(salen)).toEqual(['2026-07-06..2026-07-10']);
    expect(salen.map((x) => x.empleadoId)).toEqual([activo]);
  });
});

describe('el alcance del calendario: la plantilla, mi rama y yo', () => {
  // Los tres escalones que decide `alcanceDelCalendario()`, contra Postgres.
  //
  // ⚠️ Cada caso afirma las DOS consultas —`empleadosActivos`, que pone las
  // FILAS, y `ausenciasEntre`, que pone las MARCAS— porque comparten el
  // fragmento y tienen que decir exactamente lo mismo. Si divergieran no
  // fallaria nada: saldria una persona sin marcas, o marcas colgando de alguien
  // que no tiene fila y que por tanto no se pintan. Probar solo una dejaria esa
  // divergencia en verde, que es justo por lo que el fragmento se extrajo.

  /** Una jerarquia de tres niveles: JEFA → MANDO → BASE, y AJENA fuera. */
  const JEFA = 'jefa@ambientalia.com.co';
  const MANDO = 'mando@ambientalia.com.co';
  const BASE = 'base@ambientalia.com.co';
  const AJENA = 'ajena@ambientalia.com.co';

  async function sembrarJerarquia() {
    // La jefa cuelga de si misma: asi se declara la raiz del organigrama.
    const jefa = await sembrarEmpleado(db, JEFA, JEFA);
    const mando = await sembrarEmpleado(db, MANDO, JEFA);
    const base = await sembrarEmpleado(db, BASE, MANDO);
    const ajena = await sembrarEmpleado(db, AJENA, AJENA);

    await sembrar(jefa, JEFA, '2026-07-06', '2026-07-06');
    await sembrar(mando, MANDO, '2026-07-07', '2026-07-07');
    await sembrar(base, BASE, '2026-07-08', '2026-07-08');
    await sembrar(ajena, AJENA, '2026-07-09', '2026-07-09');
    return { jefa, mando, base, ajena };
  }

  /** Las dos consultas del calendario para un mismo alcance, ya normalizadas. */
  async function calendarioDe(soloDe: string | null) {
    const [filas, marcas] = await Promise.all([
      empleadosActivos(db, soloDe),
      ausenciasEntre(db, soloDe, JULIO.desde, JULIO.hasta),
    ]);
    return {
      filas: filas.map((f) => f.id).sort(),
      marcas: [...new Set(marcas.map((m) => m.empleadoId))].sort(),
    };
  }

  it('con null sale la plantilla entera: es lo que ve un admin', async () => {
    const { jefa, mando, base, ajena } = await sembrarJerarquia();
    const todo = [jefa, mando, base, ajena].sort();
    expect(await calendarioDe(null)).toEqual({ filas: todo, marcas: todo });
  });

  it('CANDADO: un jefe se ve a SI MISMO y a sus dos niveles, y a nadie mas', async () => {
    // Lo que esta funcion existe para dar: coordinar un equipo exige ver cuando
    // falta ese equipo. Dos niveles y no un subarbol entero porque es el alcance
    // de lo que ese jefe FIRMA — la misma regla que el registro de movimientos.
    const { jefa, mando, base, ajena } = await sembrarJerarquia();
    const suRama = [jefa, mando, base].sort();

    const visto = await calendarioDe(JEFA);
    expect(visto).toEqual({ filas: suRama, marcas: suRama });
    // Dicho por separado, porque es la mitad que importa: el mutante que
    // convierte esto en `WHERE TRUE` deja la primera asercion casi igual de
    // verde en una plantilla pequena, y esta no.
    expect(visto.filas).not.toContain(ajena);
    expect(visto.marcas).not.toContain(ajena);
  });

  it('CANDADO: el jefe intermedio ve su rama, NO la de su jefa', async () => {
    // El recorte mira hacia ABAJO. Si mirara hacia arriba, o si el fragmento
    // perdiera el `lower(e.aprobador_correo) = lower($1)`, un mando intermedio
    // se llevaria el calendario de toda la cadena por encima de el.
    const { mando, base, jefa, ajena } = await sembrarJerarquia();
    const suRama = [mando, base].sort();

    const visto = await calendarioDe(MANDO);
    expect(visto).toEqual({ filas: suRama, marcas: suRama });
    expect(visto.filas).not.toContain(jefa);
    expect(visto.filas).not.toContain(ajena);
  });

  it('CANDADO: quien no aprueba a nadie sigue viendo SOLO su propia fila', async () => {
    // El escalon de abajo, que es el que no cambio. El mutante que muere aqui es
    // el peor de todos: si el `OR lower(e.correo) = lower($1)` se escribiera mal
    // y acabara dejando pasar de mas, la rejilla volveria a ensenar a cualquiera
    // cuando falta cada companero — la decision de producto que se revirtio en
    // su dia a peticion expresa.
    const { base } = await sembrarJerarquia();
    expect(await calendarioDe(BASE)).toEqual({ filas: [base], marcas: [base] });
  });

  it('CANDADO: un correo que no es de nadie devuelve la rejilla VACIA, no la plantilla', async () => {
    // Quien no tiene ficha ni aprueba a nadie. Es la rama que antes cubria el
    // `ID_INEXISTENTE` del servicio y que ahora sostiene el propio SQL: `null`
    // sigue significando «sin acotar», asi que confundir «no encontrado» con
    // «sin filtro» aqui entregaria la compania entera.
    await sembrarJerarquia();
    expect(await calendarioDe('nadie@ambientalia.com.co')).toEqual({ filas: [], marcas: [] });
  });

  it('el correo se compara sin distinguir mayusculas, en las dos consultas', async () => {
    // El correo entra por el `sub` del JWT, que no garantiza la caja.
    const { jefa, mando, base } = await sembrarJerarquia();
    const suRama = [jefa, mando, base].sort();
    expect(await calendarioDe(JEFA.toUpperCase())).toEqual({ filas: suRama, marcas: suRama });
  });

  it('CANDADO: una ficha de la rama dada de baja desaparece de las DOS consultas', async () => {
    // `e.activo` vive en las dos, y el alcance no lo sustituye: sin el, un ex
    // empleado seguiria ocupando una fila del calendario de su antiguo jefe.
    const { jefa, mando, base } = await sembrarJerarquia();
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [base]);
    expect(await calendarioDe(JEFA)).toEqual({ filas: [jefa, mando].sort(), marcas: [jefa, mando].sort() });
  });
});
