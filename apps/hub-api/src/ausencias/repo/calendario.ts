import type { Pool } from '@algarpibe/zoho-sync';
import type { AusenciaRango } from '../calendario.js';
import type { Solicitud, TipoSolicitud } from '../types.js';
import { ramaDeDosNiveles } from './comun.js';

// ARQ-612 — las dos consultas del calendario (sus filas y sus marcas) y el
// alcance que comparten, sacados de repo.ts tal cual. El alcance envuelve
// `ramaDeDosNiveles` de comun.ts en vez de copiarlo (lo vigila comun.test.ts).
// No confundir con ../calendario.ts, que convierte estas filas en la rejilla.
// repo.ts lo reexporta: el resto del código lo sigue llamando como `repo.*`
// (lo vigila barril.test.ts).

/** Un empleado activo, reducido a lo que la rejilla necesita para su fila. */
export interface EmpleadoActivo {
  id: string;
  nombreCompleto: string;
}

interface FilaEmpleadoActivoDb {
  id: string;
  nombre_completo: string;
}

function aEmpleadoActivo(r: FilaEmpleadoActivoDb): EmpleadoActivo {
  return { id: r.id, nombreCompleto: r.nombre_completo };
}

/**
 * Los empleados activos, para que el calendario tenga una fila por persona.
 *
 * No se reutiliza `listarEmpleados`: esa NO filtra por `activo`, así que
 * arrastraría las fichas dadas de baja —justo lo que se hace con quien deja de
 * ser empleado directo— y saldrían como filas vacías para siempre.
 */
/**
 * Los empleados activos. `soloEmpleadoId` acota a uno: es lo que ve quien no es
 * admin en el calendario. Sin valor por defecto a propósito —igual que en
 * `empleadosConSaldo`—, para que acotar o no acotar sea siempre una decisión
 * escrita en el llamante y no un olvido que enseñe la plantilla entera.
 */
/**
 * A quién alcanza el calendario de quien pregunta: SU propia fila y la de su
 * rama de dos niveles. Con el parámetro a NULL no acota nada, que es lo que
 * necesitan un administrador y quien tenga `ve_toda_la_empresa`.
 *
 * Envuelve `ramaDeDosNiveles()` en vez de reescribirla: la definición de «mi
 * rama» tiene que seguir siendo la MISMA que la del registro de movimientos y
 * la de los saldos, y una copia divergente no lanza — solo enseña las ausencias
 * de gente que no es de quien mira. Lo único que añade es el «y yo», que el
 * recorte por rama no incluye: `aprobador_correo` de uno apunta a su jefe, no a
 * uno mismo, así que sin este OR un jefe vería el calendario de su equipo y no
 * el suyo.
 *
 * ⚠️ Lo usan DOS consultas —las filas y las marcas— y tienen que decir
 * exactamente lo mismo. Si discreparan no fallaría nada: saldría una persona sin
 * marcas, o marcas de alguien que no tiene fila y que por tanto no se pintan.
 * Por eso está aquí y no copiado en cada una.
 *
 * Hereda de `ramaDeDosNiveles` las dos condiciones de uso: `$1` es SIEMPRE el
 * primer parámetro de la consulta que lo incrusta, y la tabla `portal.empleados`
 * va aliasada como `e`.
 */
export function alcanceDelCalendario(): string {
  return `(${ramaDeDosNiveles()} OR lower(e.correo) = lower($1))`;
}

export async function empleadosActivos(db: Pool, soloDe: string | null): Promise<EmpleadoActivo[]> {
  const { rows } = await db.query(
    // Aliasada como `e` porque lo exige el fragmento que se incrusta debajo.
    `SELECT e.id, e.nombre_completo FROM portal.empleados e
      WHERE e.activo AND ${alcanceDelCalendario()}
      ORDER BY e.nombre_completo`,
    [soloDe],
  );
  return (rows as FilaEmpleadoActivoDb[]).map(aEmpleadoActivo);
}

interface FilaAusenciaRangoDb {
  empleado_id: string;
  tipo: TipoSolicitud;
  estado: Solicitud['estado'];
  fecha_inicio: string;
  fecha_fin: string;
}

function aAusenciaRango(r: FilaAusenciaRangoDb): AusenciaRango {
  return {
    empleadoId: r.empleado_id,
    tipo: r.tipo,
    estado: r.estado,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
  };
}

/**
 * Las ausencias que SOLAPAN con el rango, no las contenidas en él.
 *
 * La condición natural (`fecha_inicio >= desde AND fecha_fin <= hasta`) perdería
 * exactamente las que cruzan el cambio de mes, que son las que más importa ver:
 * un mes que no las enseña miente sobre quién está fuera el día 1.
 */
export async function ausenciasEntre(
  db: Pool,
  soloDe: string | null,
  desde: string,
  hasta: string,
): Promise<AusenciaRango[]> {
  const { rows } = await db.query(
    `SELECT s.empleado_id, s.tipo, s.estado,
            s.fecha_inicio::text AS fecha_inicio,
            s.fecha_fin::text    AS fecha_fin
       FROM portal.solicitudes_ausencia s
       JOIN portal.empleados e ON e.id = s.empleado_id
      WHERE e.activo
        AND s.estado <> 'rechazada'
        -- Un otorgamiento no es una ausencia: su fecha es el dia que se trabajo
        -- de mas, y pintarlo aqui diria que esa persona NO estuvo justo el dia
        -- que si estuvo. El filtro va en el SQL y no en el frontend porque el
        -- calendario del portal no filtra nada por su cuenta: pinta lo que le
        -- llega, ya expandido por dia.
        AND s.tipo <> 'otorgamiento'
        -- El MISMO alcance que empleadosActivos, y por eso compartido: si los
        -- dos discreparan saldrian marcas de gente sin fila (invisibles) o
        -- filas sin marcas, y ninguna de las dos cosas falla.
        --
        -- Sin comillas invertidas en este comentario a proposito: vive DENTRO
        -- del template literal de la consulta y una sin escapar lo cierra a
        -- mitad de frase. Ya paso una vez, en la consulta de movimientos.
        AND ${alcanceDelCalendario()}
        AND s.fecha_inicio <= $3::date
        AND s.fecha_fin    >= $2::date
      -- Determinismo del pintado, no estética: dos ausencias solapadas del
      -- mismo empleado producen dos marcas para el mismo (empleadoId, fecha), y
      -- el frontend arma un Map con esa clave, así que gana la última. Sin este
      -- ORDER BY, cuál de las dos "gana" podría cambiar entre peticiones.
      ORDER BY s.fecha_inicio, s.id`,
    // `soloDe` como PRIMER parámetro, siempre: es la regla que imponen
    // `ramaDeDosNiveles` y el fragmento que lo envuelve. Las fechas se corrieron
    // a $2 y $3 por eso, no por gusto.
    [soloDe, desde, hasta],
  );
  return (rows as FilaAusenciaRangoDb[]).map(aAusenciaRango);
}
