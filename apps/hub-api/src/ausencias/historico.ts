import { esFechaValida } from './dias-habiles.js';
import { AusenciaError } from './service.js';
import { ETIQUETA_TIPO, TIPOS, type Empleado, type TipoSolicitud } from './types.js';

// Importación del histórico que hasta ahora solo vivía en las cuatro pestañas de
// la hoja `consulta_vacaciones`.
//
// El problema de fondo es que la hoja no guarda el correo de nadie: solo el
// nombre, escrito a mano y distinto cada vez. La misma persona aparece como
// «Nelson Julián Maya González», «Julián Maya González» y «Julián Maya». Así que
// hay que casar por nombre, y hacerlo de forma que el caso dudoso se vea en la
// previsualización en vez de resolverse a la brava.

/** Tope defensivo. El histórico real son 53 filas; esto es para el día que no. */
const MAX_FILAS = 5000;

// `normalize('NFD')` separa la tilde de su letra y el bloque U+0300–U+036F son
// esas marcas sueltas. La clase se construye desde los códigos en vez de
// escribirla como literal: en el fuente serían caracteres invisibles.
const DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/**
 * Un nombre convertido en palabras comparables: sin tildes, en mayúsculas y sin
 * puntuación.
 *
 * La ñ acaba convertida en `N`, y eso es exactamente lo que se busca: quien
 * escribió «Penalosa» sin la tilde tiene que casar con «Peñalosa». La función
 * entera existe para ser insensible justo a estas diferencias.
 */
export function normalizarNombre(nombre: string): string[] {
  return String(nombre ?? '')
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export interface Resolucion {
  empleado?: Empleado;
  /** Más de un candidato: se enseña en la previsualización, no se elige. */
  ambiguo?: Empleado[];
}

/**
 * Busca a quién pertenece un nombre del histórico.
 *
 * La regla es **subconjunto de palabras en cualquiera de los dos sentidos**:
 * vale que a la hoja le falte un apellido y vale que le sobre un nombre de pila
 * que el maestro no tiene. Se exigen al menos dos palabras en común para no
 * resolver por un apellido suelto, que es demasiado poco para decidir.
 */
export function resolverEmpleado(nombre: string, empleados: Empleado[]): Resolucion {
  const buscado = new Set(normalizarNombre(nombre));
  if (buscado.size < 2) return {};

  const candidatos = empleados.filter((e) => {
    const suyo = new Set(normalizarNombre(e.nombreCompleto));
    if (suyo.size < 2) return false;
    const cabeEnElSuyo = [...buscado].every((p) => suyo.has(p));
    const cabeElSuyo = [...suyo].every((p) => buscado.has(p));
    return cabeEnElSuyo || cabeElSuyo;
  });

  if (candidatos.length === 1) return { empleado: candidatos[0] };
  if (candidatos.length > 1) return { ambiguo: candidatos };
  return {};
}

/** Una fila del histórico ya validada, lista para insertar. */
export interface FilaHistorico {
  nombre: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  comentarios: string | null;
  observaciones: string | null;
}

/** «Vacaciones» → `vacaciones`. La hoja usa las etiquetas, no los identificadores. */
const TIPO_DE_ETIQUETA = new Map<string, TipoSolicitud>(
  TIPOS.map((t) => [ETIQUETA_TIPO[t].toUpperCase(), t]),
);

/**
 * El nombre del PDF que la hoja guardaba como el JSON crudo de n8n:
 * `[{"filename":"x.pdf","mimetype":…,"size":…}]`. Si no parsea, se devuelve el
 * texto tal cual — un nombre raro sigue diciendo más que nada.
 */
function nombreDelAdjunto(valor: string): string {
  try {
    const parsed = JSON.parse(valor) as { filename?: string }[];
    const nombres = (Array.isArray(parsed) ? parsed : [])
      .map((a) => a?.filename)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (nombres.length) return nombres.join(', ');
  } catch {
    // No era JSON. Cae al texto literal.
  }
  return valor;
}

/**
 * Los días tal como los escribió alguien en la hoja. Además del número hay un
 * `"1*"`: el asterisco remite a una nota al margen, así que el número entra como
 * número y la marca se conserva en las observaciones para no perder el matiz.
 */
function leerDias(valor: unknown, campo: string): { dias: number; marca: string | null } {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0) {
    return { dias: valor, marca: null };
  }
  if (typeof valor === 'string') {
    const limpio = valor.trim();
    const n = Number.parseFloat(limpio.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) {
      const marca = /[^\d.,\s]/.test(limpio) ? `Anotado en la hoja como «${limpio}»` : null;
      return { dias: n, marca };
    }
  }
  throw new AusenciaError('dias_invalidos', 400, campo);
}

/** Junta los pedazos de observación, sin dejar separadores sueltos. */
function unirObservaciones(...partes: (string | null | undefined)[]): string | null {
  const limpias = partes.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  return limpias.length ? limpias.join(' · ') : null;
}

/**
 * Valida y normaliza lo que manda el navegador tras leer el Excel. Mismo
 * criterio que `validarFilasEmpleados`: el índice de la fila viaja en `field`
 * para que un error en la 37 se pueda encontrar en la hoja.
 */
export function validarFilasHistorico(body: unknown): FilaHistorico[] {
  const filas = (body as { solicitudes?: unknown })?.solicitudes;
  if (!Array.isArray(filas) || filas.length === 0) {
    throw new AusenciaError('solicitudes_requeridas', 400, 'solicitudes');
  }
  if (filas.length > MAX_FILAS) throw new AusenciaError('demasiadas_filas', 400, 'solicitudes');

  return filas.map((f, i) => {
    const r = (f ?? {}) as Record<string, unknown>;
    const campo = (c: string) => `solicitudes[${i}].${c}`;

    const nombre = String(r.nombre ?? '').trim();
    if (!nombre) throw new AusenciaError('nombre_requerido', 400, campo('nombre'));

    const tipo = TIPO_DE_ETIQUETA.get(String(r.tipo ?? '').trim().toUpperCase());
    if (!tipo) throw new AusenciaError('tipo_invalido', 400, campo('tipo'));

    const fechaInicio = String(r.fechaInicio ?? '');
    const fechaFin = String(r.fechaFin ?? '');
    if (!esFechaValida(fechaInicio)) throw new AusenciaError('fecha_invalida', 400, campo('fechaInicio'));
    if (!esFechaValida(fechaFin)) throw new AusenciaError('fecha_invalida', 400, campo('fechaFin'));
    if (fechaInicio > fechaFin) throw new AusenciaError('rango_invertido', 400, campo('fechaFin'));

    const { dias, marca } = leerDias(r.dias, campo('dias'));

    const adjunto = typeof r.adjunto === 'string' && r.adjunto.trim() ? nombreDelAdjunto(r.adjunto.trim()) : null;

    return {
      nombre,
      tipo,
      fechaInicio,
      fechaFin,
      dias,
      comentarios: typeof r.comentarios === 'string' && r.comentarios.trim() ? r.comentarios.trim() : null,
      observaciones: unirObservaciones(
        typeof r.observaciones === 'string' ? r.observaciones : null,
        marca,
        adjunto ? `Adjunto en Drive: ${adjunto}` : null,
      ),
    };
  });
}
