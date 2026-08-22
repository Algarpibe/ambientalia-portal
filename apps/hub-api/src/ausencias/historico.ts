import { esFechaValida } from './dias-habiles.js';
import { AusenciaError } from './service.js';
import {
  ESTADOS,
  ESTADOS_MODIFICACION,
  ETIQUETA_TIPO,
  TIPOS,
  type ClaseModificacion,
  type Empleado,
  type EstadoModificacion,
  type EstadoSolicitud,
  type TipoSolicitud,
} from './types.js';

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

/** Días máximos que admite una corrección. Mismo tope que el rango de fechas. */
const MAX_DIAS = 366;

/**
 * Valida la corrección de una solicitud desde el registro general.
 *
 * Se exigen todos los campos editables, no un parche parcial: el formulario los
 * manda siempre completos, y aceptar campos sueltos abriría la puerta a
 * peticiones a medias difíciles de razonar (¿qué significa cambiar la fecha de
 * fin sin la de inicio?).
 *
 * Los días llegan a mano y NO se recalculan aquí: el histórico está lleno de
 * valores que no coinciden con el conteo de días hábiles —un 6,5, rangos donde
 * la hoja anotó menos días de los naturales— y recalcularlos al guardar
 * destruiría precisamente lo que se está corrigiendo.
 */
export function validarEdicionSolicitud(body: unknown): {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  estado: EstadoSolicitud;
  comentarios: string | null;
  observaciones: string | null;
} {
  const b = (body ?? {}) as Record<string, unknown>;

  const empleadoId = String(b.empleadoId ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(empleadoId)) throw new AusenciaError('empleado_invalido', 400, 'empleadoId');

  const tipo = b.tipo as TipoSolicitud;
  if (!(TIPOS as readonly string[]).includes(tipo)) throw new AusenciaError('tipo_invalido', 400, 'tipo');

  // La lista sale de `types.ts` y no se reescribe aquí: duplicarla dejó fuera el
  // estado intermedio de la cascada, y un admin no habría podido corregir a mano
  // una solicitud atascada en él.
  const estado = b.estado as EstadoSolicitud;
  if (!(ESTADOS as readonly string[]).includes(estado)) throw new AusenciaError('estado_invalido', 400, 'estado');

  const fechaInicio = String(b.fechaInicio ?? '');
  const fechaFin = String(b.fechaFin ?? '');
  if (!esFechaValida(fechaInicio)) throw new AusenciaError('fecha_invalida', 400, 'fechaInicio');
  if (!esFechaValida(fechaFin)) throw new AusenciaError('fecha_invalida', 400, 'fechaFin');
  if (fechaInicio > fechaFin) throw new AusenciaError('rango_invertido', 400, 'fechaFin');

  const dias = Number(b.dias);
  if (!Number.isFinite(dias) || dias < 0 || dias > MAX_DIAS) throw new AusenciaError('dias_invalidos', 400, 'dias');

  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  return {
    empleadoId,
    tipo,
    fechaInicio,
    fechaFin,
    // Un decimal, como la columna. Evita que un 5.33 tecleado se guarde y luego
    // Postgres lo redondee por detrás sin que nadie lo vea.
    dias: Math.round(dias * 10) / 10,
    estado,
    comentarios: texto(b.comentarios),
    observaciones: texto(b.observaciones),
  };
}

/** Tope del motivo de una modificación. El mismo `MAX_MOTIVO_MODIFICACION` que
 *  aplica al pedirla: corregirla a mano no puede colar un texto que el camino
 *  normal habría rechazado. */
const MAX_MOTIVO_CORRECCION = 2000;

/**
 * Valida la corrección a mano de una fila del registro de movimientos.
 *
 * `clase` NO viene del cuerpo sino de la fila que ya está en la base, y por eso
 * es un parámetro: es lo que decide qué campos son obligatorios y cuáles tienen
 * que ir a NULL. Dejar que la mandara el cliente permitiría pedir una corrección
 * «de clase fechas» sobre una anulación y estrellarse contra el CHECK
 * `modificaciones_campos_por_clase` con un 500 en vez de un 400.
 *
 * En una ANULACIÓN los tres campos de fechas se fuerzan a `null` sin mirar lo
 * que llegue. No es indulgencia con un cuerpo mal formado: el CHECK de la 024 no
 * admite otra cosa, así que lo único que puede hacer aquí un valor es reventar
 * la escritura, y rechazarlo con un 400 obligaría al cliente a saber una regla
 * de la base de datos para poder editar un motivo.
 */
export function validarCorreccionModificacion(
  body: unknown,
  clase: ClaseModificacion,
): {
  fechaInicioNueva: string | null;
  fechaFinNueva: string | null;
  diasHabilesNuevos: number | null;
  motivo: string | null;
  estado: EstadoModificacion;
} {
  const b = (body ?? {}) as Record<string, unknown>;

  // La lista sale de `types.ts` y no se reescribe aquí, por lo mismo que en
  // `validarEdicionSolicitud`: una copia dejó fuera en su día un estado legítimo
  // y nadie pudo corregir a mano las filas atascadas en él.
  const estado = b.estado as EstadoModificacion;
  if (!(ESTADOS_MODIFICACION as readonly string[]).includes(estado)) {
    throw new AusenciaError('estado_invalido', 400, 'estado');
  }

  const motivoBruto = typeof b.motivo === 'string' ? b.motivo.trim() : '';
  if (motivoBruto.length > MAX_MOTIVO_CORRECCION) {
    throw new AusenciaError('motivo_demasiado_largo', 400, 'motivo');
  }
  const motivo = motivoBruto || null;

  if (clase === 'anulacion') {
    return { fechaInicioNueva: null, fechaFinNueva: null, diasHabilesNuevos: null, motivo, estado };
  }

  const fechaInicioNueva = String(b.fechaInicioNueva ?? '');
  const fechaFinNueva = String(b.fechaFinNueva ?? '');
  if (!esFechaValida(fechaInicioNueva)) throw new AusenciaError('fecha_invalida', 400, 'fechaInicioNueva');
  if (!esFechaValida(fechaFinNueva)) throw new AusenciaError('fecha_invalida', 400, 'fechaFinNueva');
  // El mismo orden que exige el CHECK `modificaciones_rango_valido`. Sin esto la
  // base lo rechazaría igual, pero con un 500 en vez de un 400 con su campo.
  if (fechaInicioNueva > fechaFinNueva) throw new AusenciaError('rango_invertido', 400, 'fechaFinNueva');

  const dias = Number(b.diasHabilesNuevos);
  if (!Number.isFinite(dias) || dias < 0 || dias > MAX_DIAS) {
    throw new AusenciaError('dias_invalidos', 400, 'diasHabilesNuevos');
  }

  return {
    fechaInicioNueva,
    fechaFinNueva,
    // Un decimal, como la columna NUMERIC(4,1), y por el mismo motivo que en
    // `validarEdicionSolicitud`: sin redondear aquí, Postgres lo haría por
    // detrás y el valor guardado no sería el que se tecleó.
    diasHabilesNuevos: Math.round(dias * 10) / 10,
    motivo,
    estado,
  };
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
