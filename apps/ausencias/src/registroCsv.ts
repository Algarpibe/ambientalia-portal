import { escaparCeldaCsv } from '@suite/format';
import type { Movimiento } from './api';
import { chipDeSolicitud, ETIQUETA_TIPO } from './dominio';

// Las líneas del CSV del Registro General, fuera del componente para poder
// probarlas sin navegador (SEC-231). Quien descarga el fichero sigue siendo
// `exportarCsv`, en RegistroGeneral.tsx.

/** Mismo estrechamiento que en RegistroGeneral.tsx, y por las mismas razones (ver allí). */
type MovimientoDeSolicitud = Extract<Movimiento, { clase: 'solicitud' }>;

/**
 * El CSV que sustituye al Excel de nómina: la cabecera y una línea por fila.
 *
 * ⚠️ Solo entran SOLICITUDES DE AUSENCIA, y el tipo del parámetro es lo que lo
 * sostiene. La regla ya existía para los otorgamientos, y las modificaciones caen
 * bajo exactamente la misma: la columna «Días» significa días fuera en todas las
 * columnas que tiene el fichero, y **no hay ninguna que diga el signo ni que diga
 * que una fila es una anulación**. Una anulación ahí dentro se leería como unos
 * días de ausencia MÁS cuando es justo lo contrario, y un cambio de fechas
 * contaría los mismos días dos veces. Es un error que se descubre en un recibo.
 *
 * Todo eso se sigue viendo en la tabla, que sí marca la clase con un chip y los
 * otorgamientos con un `+`. Quien necesite el detalle lo tiene ahí.
 *
 * Cada celda pasa por `escaparCeldaCsv`: «Comentarios» y «Observaciones» son
 * texto libre que escribe cualquier empleado, y sin neutralizar un `=HYPERLINK(…)`
 * se abría como fórmula en el Excel de quien exporta (SEC-231). Los días van como
 * número, así que no se tocan.
 */
export function lineasDelCsv(filas: MovimientoDeSolicitud[]): string[] {
  const cab = ['Nombre y Apellidos', 'Tipo', 'Fecha Inicio', 'Fecha Fin', 'Días', 'Estado', 'Comentarios', 'Observaciones'];
  return [
    cab.join(';'),
    ...filas.map((s) =>
      [
        s.empleadoNombre,
        ETIQUETA_TIPO[s.tipo],
        s.fechaInicio,
        s.fechaFin,
        s.diasHabiles,
        // `chipDeSolicitud` y NO `chipDe(s.estado)`: una anulada saldría rotulada
        // «Rechazada» —quien lo lea entenderá que el jefe le negó unos días que en
        // realidad devolvió la propia persona—. Se exporta la MISMA etiqueta que
        // se ve en pantalla, que es lo que permite cotejar fichero y tabla.
        //
        // Es además la SEGUNDA cerradura del candado de arriba, y sale gratis:
        // `anuladaAt` vive solo en la rama `solicitud` de la unión, así que esta
        // línea tampoco compilaría si alguien ensanchara el parámetro a
        // `Movimiento[]` para «exportarlo todo».
        chipDeSolicitud(s).label,
        s.motivo ?? '',
        // Última columna, en la misma posición que tenía antes de que el
        // registro pasara a ser de movimientos: `observaciones` vive solo en
        // la rama `solicitud` de la unión, así que esta línea es la TERCERA
        // cerradura del candado de más arriba y sale gratis por la misma
        // razón que `anuladaAt`.
        s.observaciones ?? '',
      ]
        .map((celda) => escaparCeldaCsv(celda))
        .join(';'),
    ),
  ];
}
