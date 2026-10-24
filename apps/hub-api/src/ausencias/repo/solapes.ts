import type { Pool } from '@algarpibe/zoho-sync';
import { esOtorgamiento, type Solicitud, type TipoSolicitud } from '../types.js';
import type { PoolClient } from './comun.js';

// ARQ-612 — la regla de no solaparse, sacada de repo.ts tal cual: qué ocupa
// agenda, con qué choca un rango y si un otorgamiento ya está reclamado. La
// usan el alta, la decisión de una modificación y la corrección de admin, todas
// dentro de su transacción y con su candado (DATA-336); esto solo pregunta.
// repo.ts lo reexporta: el resto del código lo sigue llamando como `repo.*`
// (lo vigila barril.test.ts).

/** Una ausencia viva que se cruza con un rango. Lo justo para redactar el aviso. */
export interface Solape {
  id: string;
  tipo: TipoSolicitud;
  estado: Solicitud['estado'];
  fechaInicio: string;
  fechaFin: string;
}

/**
 * Qué cuenta como ausencia VIVA, escrito una sola vez.
 *
 * Quedan dos exclusiones y ninguna es la incapacidad. La del ESTADO: una
 * rechazada no concedió ni un día, así que no ocupa nada. La del TIPO: un
 * otorgamiento no es una ausencia, y el porqué está en el cuerpo. La del estado
 * es la que se escapa con facilidad —se lee como una condición de tipo y no lo
 * es, y en el `WHERE` de `solapeDe` va suelta entre las otras—, y escaparse le
 * costó a la puerta del `PATCH` dejar INMODIFICABLE cualquier rechazada con una
 * ausencia viva encima, que es el caso corriente de a quien le rechazan unos
 * días y los vuelve a pedir.
 *
 * ⚠️ La incapacidad SÍ ocupa agenda desde el 2026-08-21, y antes NO. Estuvo
 * exenta a propósito —«una incapacidad no se pide, se informa después de haber
 * estado enfermo»—: se registraba encima de lo que fuera y tampoco frenaba a
 * nadie. Ese mismo día se probó la versión intermedia, dejarla pasar avisando
 * del choque, y se decidió lo contrario. El motivo del bloqueo no es la
 * enfermedad, es el REGISTRO: una baja encima de unas vacaciones aprobadas deja
 * los mismos días contados dos veces, y de ese recuento salen el saldo, la
 * nómina y el calendario. El aviso dejaba la contradicción escrita y confiaba en
 * que alguien la arreglara después; negar el alta obliga a arreglarla antes, que
 * es el único momento en que quien informa la baja tiene las dos solicitudes
 * delante.
 *
 * La exención se quitó SIMÉTRICA a propósito: ni la frenan las demás ni frena
 * ella a las demás. Bloquearla sólo cuando es la fila que se escribe, y seguir
 * ignorándola cuando es la que ya estaba debajo, sería una regla que contesta
 * distinto según cuál de las dos ausencias se registre primero.
 *
 * La llaman los tres sitios que comprueban un solape antes de dejar la fila
 * escrita —`exigirSinSolape` en el servicio (el alta y la propuesta),
 * `decidirModificacion` y `actualizarSolicitud` aquí—, y siempre sobre la fila
 * que van a dejar: la que no ocupa agenda no puede chocar con nadie, y
 * comprobarla igualmente niega correcciones legítimas.
 *
 * Quedan DOS reescrituras que el compilador no puede atar a esta, y no están en
 * la misma situación, por más que las tres tengan que decir lo mismo:
 *
 *  - El `WHERE` de `solapeDe` dice esto en SQL, y **lo vigila** el cuarto
 *    portón: ejecuta contra Postgres de verdad en `repo.solapes.db.test.ts`,
 *    con un test que fija que una incapacidad SÍ sale de esa consulta y dos para
 *    la mitad del estado (la rechazada y la anulada, que es una rechazada con
 *    marca).
 *  - El doble in-memory de `router.test.ts` **no vigila: replica**. Ese fichero
 *    hace `vi.mock('./repo.js')` y reimplementa esta función, así que el
 *    servicio bajo prueba nunca llega a ejecutar ESTA.
 *
 * De donde sale la consecuencia que hay que tener delante antes de tocar la
 * línea de abajo: **romper esta regla no pone rojo el portón rápido.**
 *
 * Que no lo vigile el portón rápido NO significa que no lo vigile nada: el cuarto
 * portón es un step BLOQUEANTE del CI (`ci.yml`, «Tests contra Postgres real»).
 * Lo que se puede romper en silencio es la máquina de quien edita, no la rama.
 *
 * Y de ahí lo que hoy NO está acreditado: las dos puertas que viven en el
 * servicio —el alta y la propuesta— se prueban de sobra, pero contra la copia
 * del doble. Nada comprueba que ejecuten la MISMA regla que las otras dos; el
 * CANDADO de la superficie de `router.test.ts` solo exige que esta función se
 * exporte, no que diga lo mismo.
 *
 * ⚠️ NO confundir con `estaEnElCalendario` (`types.ts`). Esta pregunta si la fila
 * RESERVA días; aquella, si la fila tiene evento en Google. Que desde el
 * 2026-08-21 las dos digan «sí» sobre una incapacidad no las ha unificado:
 * siguen discrepando en las dos direcciones —una `pendiente` ocupa agenda y no
 * está en Google, y un otorgamiento `aprobada` está en Google y no ocupa
 * agenda—, y contestar una con la otra es la forma exacta que tuvo el bug de la
 * cuarta puerta del solapamiento.
 */
export function ocupaAgenda(tipo: TipoSolicitud, estado: Solicitud['estado']): boolean {
  // El otorgamiento es la única exclusión por tipo que queda, y se sostiene por
  // una razón que a la incapacidad nunca le valió: no es una ausencia en
  // absoluto — su fecha es la del día que se TRABAJÓ de más.
  //
  // Sin este corte, la regla de solapes bloquearía justo el caso más típico:
  // pedir el compensatorio por un sábado trabajado DURANTE las propias
  // vacaciones chocaría contra esas mismas vacaciones.
  return !esOtorgamiento(tipo) && estado !== 'rechazada';
}

/**
 * La primera ausencia VIVA de esta persona que se cruza con el rango, o `null`.
 *
 * El predicado de fechas es el mismo que usa `ausenciasEntre` —solapa, no
 * contiene—, pero es el mismo predicado dentro de una pregunta distinta:
 * aquella une con `empleados` y filtra por `e.activo`, no filtra por `tipo`, y
 * su `soloEmpleadoId` admite `null` para no acotar. Esta no mira
 * `empleados.activo` porque la pregunta ya es sobre una persona concreta, no
 * sobre a quién pintar en un calendario.
 *
 * `LIMIT 1` porque el mensaje solo puede nombrar una colisión; buscarlas todas
 * sería trabajo que nadie lee.
 *
 * Las dos condiciones de «viva» de su `WHERE` —`estado <> 'rechazada'` y
 * `tipo <> 'otorgamiento'`— son `ocupaAgenda` escrito en SQL, y su porqué está
 * allí y no aquí. Quien tenga que hacerse la misma pregunta desde TypeScript
 * llama a aquella función; aquí no se puede.
 *
 * ⚠️ Las dos definiciones tienen que decir LO MISMO, y ninguna vigila a la otra:
 * el compilador no las relaciona, y un filtro que sobre o que falte de este lado
 * sólo se nota por las puertas que pasan por el SQL. De ahí que este `WHERE` ya
 * NO lleve `tipo <> 'incapacidad'`: lo llevó hasta el 2026-08-21, cuando una
 * incapacidad ni ocupaba ni la frenaba nadie, y se quitó A LA VEZ de aquí y de
 * `ocupaAgenda` —el porqué del cambio, entero allí—. Devolverlo a un solo sitio
 * deja la regla contestando distinto según por dónde se entre: quitarlo sólo de
 * la función deja el alta pasando y la consulta sin encontrar nada, y quitarlo
 * sólo del `WHERE` deja el alta comprobando una condición que la consulta ya no
 * puede satisfacer.
 *
 * ⚠️ El filtro de estado —`estado <> 'rechazada'`— es el mismo filtro que en
 * `ausenciasEntre`; lo que se invierte no es el filtro sino la
 * CONSECUENCIA de que falle en abierto: un estado nuevo que nadie añada a la
 * lista entra igual por los dos lados, pero aquí eso cuenta como ocupado y
 * bloquea de más —lo reporta un usuario el mismo día—, mientras que allí se
 * pintaría de más y eso no lo nota nadie.
 *
 * `excluirSolicitudId` es imprescindible al mover fechas: sin él, una solicitud
 * chocaría siempre contra ella misma. El alta pasa `null` porque todavía no hay
 * fila.
 *
 * Acepta `PoolClient` además de `Pool` para poder llamarse DENTRO de la
 * transacción que aplica un cambio de fechas: por esa misma conexión la
 * comprobación ve lo que la propia transacción ya escribió sin confirmar
 * —una consulta por el `Pool` no lo vería— y se deshace con el mismo
 * `ROLLBACK`. Lo que **no** da es un snapshot compartido: `BEGIN` pelado es
 * READ COMMITTED, y ahí cada sentencia toma el suyo. La ventana de carrera
 * tampoco la cierra esta función —el `SELECT` no lleva `FOR UPDATE`—: dos
 * llamadas simultáneas pasan las dos. La cierra quien la llama, con el candado
 * del empleado de DATA-336 tomado ANTES de llamarla y por la misma conexión: el
 * alta (`conCandadoDelEmpleado`), proponer y firmar un cambio de fechas
 * (`bloquearDuenoDe` en `crearModificacion` y `decidirModificacion`) y el
 * `PATCH` de admin (`actualizarSolicitud`). Las cuatro piden la MISMA llave, así
 * que también se esperan entre puertas distintas. Una llamada nueva que use esta
 * función para decidir una escritura sin ese candado vuelve a abrir la carrera;
 * lo vigila `cambios-concurrentes.db.test.ts`. Lo que se descartó es cerrarlo en la propia
 * tabla, con un índice único parcial como el que la 024 pone a las
 * propuestas: la restricción falla al
 * aplicarse si hay datos que ya la incumplen, y los hay: comprobado el
 * 2026-08-18 contra producción, un empleado tiene vacaciones aprobadas del 10
 * al 14 de agosto de 2026 y un permiso aprobado el 14. Y desde el 2026-08-21 hay
 * más, por construcción: toda incapacidad informada encima de otra ausencia
 * mientras la exención existía sigue en la tabla, y es justo lo que la regla
 * nueva prohíbe.
 */
export async function solapeDe(
  db: Pool | PoolClient,
  empleadoId: string,
  fechaInicio: string,
  fechaFin: string,
  excluirSolicitudId: string | null,
): Promise<Solape | null> {
  const { rows } = await db.query(
    `SELECT id, tipo, estado,
            fecha_inicio::text AS fecha_inicio,
            fecha_fin::text    AS fecha_fin
       FROM portal.solicitudes_ausencia
      WHERE empleado_id = $1
        AND estado <> 'rechazada'
        -- El otorgamiento no es una ausencia: su fecha es el dia trabajado. Sin
        -- esta linea, pedir el compensatorio por un sabado trabajado DURANTE las
        -- propias vacaciones chocaria contra esas mismas vacaciones.
        AND tipo   <> 'otorgamiento'
        AND ($4::uuid IS NULL OR id <> $4)
        AND fecha_inicio <= $3::date
        AND fecha_fin    >= $2::date
      ORDER BY fecha_inicio, id
      LIMIT 1`,
    [empleadoId, fechaInicio, fechaFin, excluirSolicitudId],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    tipo: TipoSolicitud;
    estado: Solicitud['estado'];
    fecha_inicio: string;
    fecha_fin: string;
  };
  return { id: r.id, tipo: r.tipo, estado: r.estado, fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin };
}

/**
 * Si esta persona ya tiene VIVO un otorgamiento por ese mismo día trabajado.
 *
 * Pregunta aparte, y no una condición más dentro de `solapeDe`, porque son dos
 * reglas que no se pueden fundir sin romper una de las dos. Un otorgamiento SÍ
 * puede caer encima de unas vacaciones —su fecha es el día que se TRABAJÓ, y
 * trabajar un sábado durante las propias vacaciones es el caso más típico que
 * hay—, y por eso está exento de `ocupaAgenda`. Pero esa exención dejaba abierto
 * reclamar DOS veces la misma jornada, que concede el doble de días por un solo
 * día de trabajo. De ahí una regla propia y estrecha: solo contra otro
 * otorgamiento, solo del mismo día.
 *
 * `estado <> 'rechazada'` por lo mismo que en `solapeDe`: a quien le nieguen la
 * concesión tiene que poder volver a pedirla. Y una anulación aprobada deja la
 * fila `rechazada`, así que también libera el día.
 *
 * Compara `fecha_inicio` a secas y no un rango porque un otorgamiento es SIEMPRE
 * de un solo día: lo garantiza `otorgamiento_un_solo_dia` en el servicio, que es
 * quien valida antes de llegar aquí.
 *
 * `excluirSolicitudId` existe por lo mismo que en `solapeDe`: al corregir una
 * fila, sin él chocaría contra ella misma.
 */
export async function existeOtorgamientoDelDia(
  db: Pool | PoolClient,
  empleadoId: string,
  fecha: string,
  excluirSolicitudId: string | null,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1
       FROM portal.solicitudes_ausencia
      WHERE empleado_id = $1
        AND tipo   = 'otorgamiento'
        AND estado <> 'rechazada'
        AND fecha_inicio = $2::date
        AND ($3::uuid IS NULL OR id <> $3)
      LIMIT 1`,
    [empleadoId, fecha, excluirSolicitudId],
  );
  return rows.length > 0;
}
