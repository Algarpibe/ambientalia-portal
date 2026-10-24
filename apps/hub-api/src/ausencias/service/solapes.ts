import { AusenciaError } from '../errores.js';
import * as repo from '../repo.js';
import type { EstadoSolicitud, TipoSolicitud } from '../types.js';

// ARQ-612 — la regla del solapamiento vista desde el servicio, sacada de
// service.ts tal cual: qué se le cuenta al cliente del choque y la puerta
// `exigirSinSolape`, que comparten el alta y proponer un cambio de fechas.
// Las dos se exportan porque esos casos de uso viven en otros trozos. La regla
// en sí —qué ocupa agenda y qué choca— está en repo/solapes.ts. service.ts lo
// reexporta (lo vigila barril.test.ts).

/**
 * Lo que el cliente necesita saber del choque, y nada más.
 *
 * Campo a campo, y sin el `id`: es a la vez lo que hace que esto compile
 * —`Solape` es una interface, sin index signature implícita, así que
 * `AusenciaError` no la admite tal cual— y lo que evita mandar al cliente un
 * uuid que no necesita.
 *
 * Tiene nombre y no `Record<string, unknown>` a secas porque el `detalle` de un
 * `AusenciaError` no lo tiene: sin este alias, quien redacta el 409 en el
 * navegador se lo inventa campo a campo y nada compara las dos listas.
 *
 * ⚠️ `type` y NO `interface`, y la diferencia es de compilación: TypeScript le
 * da index signature implícita a un alias de tipo, pero no a una interface. En
 * cuanto esto sea una `interface` deja de ser asignable al
 * `Record<string, unknown>` del `detalle` de `AusenciaError` y `errorDeSolape`
 * no compila — que es exactamente lo que le pasa a `repo.Solape`, y por lo que
 * existe la función de abajo.
 */
export type SolapeDetalle = {
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  fechaInicio: string;
  fechaFin: string;
};

/**
 * El choque recortado a eso. Privada a propósito: quien lo necesita desde fuera
 * necesita en realidad el error entero, y para eso está `errorDeSolape`.
 */
function detalleDelSolape(choque: repo.Solape): SolapeDetalle {
  return {
    tipo: choque.tipo,
    estado: choque.estado,
    fechaInicio: choque.fechaInicio,
    fechaFin: choque.fechaFin,
  };
}

/**
 * El 409 del solapamiento entero, escrito una sola vez.
 *
 * El `detalle` no era lo único que había que atar: `code`, `status` y `field` son
 * igual de contrato, y estaban tecleados a mano en los tres sitios que responden
 * este error —`exigirSinSolape` para el alta y la propuesta, la traducción de
 * `decidirModificacion` más abajo, y el `catch` del `PATCH` en `router.ts`—. Con
 * la tripleta suelta bastaba con que uno dijera `fechaFin`, o un `code` con otra
 * letra, para que la interfaz tuviera que aprender dos formas de contar lo mismo,
 * y ningún test lo habría visto: cada puerta afirma la SUYA.
 *
 * Lo vigilan los cuatro tests de `router.test.ts` que afirman
 * `error: 'rango_solapado'` desde HTTP, uno por puerta; tres comparan además las
 * claves exactas del `detalle`, que es donde vive la promesa de no filtrar el
 * `id` del choque.
 */
export function errorDeSolape(choque: repo.Solape): AusenciaError {
  return new AusenciaError('rango_solapado', 409, 'fechaInicio', detalleDelSolape(choque));
}

/**
 * Corta si esta persona ya tiene una ausencia viva en esas fechas.
 *
 * Aquí se decide qué es un solapamiento para las DOS puertas que pasan por el
 * servicio: esta alta y proponer un cambio de fechas.
 *
 * ⚠️ Las otras dos no pasan por aquí, y no es descuido. Firmar el cambio vive
 * dentro de la transacción de `repo.decidirModificacion`, con un `PoolClient` y
 * sin poder lanzar `AusenciaError`. Y el `PATCH` de admin no tiene función de
 * servicio —el router llama a `repo.actualizarSolicitud` derecho— y su
 * comprobación va también dentro de esa transacción, para no mirar por una
 * conexión y escribir por otra. Las dos llaman a `repo.solapeDe` por su cuenta,
 * pero la REGLA de qué ocupa agenda ya no se repite en ninguna: las cuatro
 * puertas llaman a `repo.ocupaAgenda`. Se comparte porque copiarla salió mal —el
 * `PATCH` nació copiando media, el tipo sin el estado— y porque los candados no
 * lo habrían visto: cada puerta prueba la suya, así que cambiar la regla en un
 * solo sitio deja verdes los tests de las otras.
 *
 * ⚠️ `db` tiene que ser el `tx` de una transacción que ya tiene el candado del
 * empleado (DATA-336): por el pool, la comprobación puede mirar mientras otra
 * petición de la misma persona ya miró y está a punto de escribir. El alta la
 * llama dentro de `repo.conCandadoDelEmpleado`; la propuesta, dentro de
 * `repo.crearModificacion`.
 */
export async function exigirSinSolape(
  db: repo.Consultable,
  empleadoId: string,
  tipo: TipoSolicitud,
  estado: EstadoSolicitud,
  fechaInicio: string,
  fechaFin: string,
  excluirSolicitudId: string | null,
): Promise<void> {
  // La fila que va a quedar escrita solo puede chocar con alguien si ella misma
  // OCUPA agenda; si no, comprobarla solo sirve para negar lo que nadie tenía por
  // qué negar. El porqué de cada mitad, en `repo.ocupaAgenda`.
  //
  // Por estas dos puertas hoy no pasa ninguna fila que no ocupe por su estado: el
  // alta nace `pendiente` o `registrada` —nunca `rechazada`— y
  // `estadoAdmiteModificacion` deja fuera a las rechazadas mucho antes de llegar a
  // la propuesta. Se pasa el estado igual, porque preguntar por la fila ENTERA es
  // lo que impide que esta puerta diverja de las otras tres — que es exactamente
  // lo que pasó cuando el `PATCH` copió media regla.
  if (!repo.ocupaAgenda(tipo, estado)) return;

  const choque = await repo.solapeDe(db, empleadoId, fechaInicio, fechaFin, excluirSolicitudId);
  if (!choque) return;
  throw errorDeSolape(choque);
}
