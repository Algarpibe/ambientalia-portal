import { CUALIDADES, EVENTO, MAX_CUALIDADES, MENSAJE_MAX, PREFERENCIAS } from './config.js';

// Reglas puras de la invitación: los cierres, la validación de lo que manda el
// portal y el top 3 de cualidades. Nada de BD ni de reloj: la hora llega como
// argumento.

export type CodigoError =
  | 'confirmaciones_cerradas'
  | 'votos_cerrados'
  | 'asiste_invalido'
  | 'preferencia_invalida'
  | 'mensaje_invalido'
  | 'cualidad_invalida'
  | 'demasiadas_cualidades'
  | 'voto_propio'
  | 'usuario_no_valido'
  | 'no_invitado'
  | 'exclusion_propia';

const CIERRES: ReadonlySet<CodigoError> = new Set<CodigoError>(['confirmaciones_cerradas', 'votos_cerrados']);

/** Error de negocio: el router lo traduce a 409 (cierres), 403 (no invitado) o 400 (lo demás), nunca a 401. */
export class CelebracionError extends Error {
  readonly status: 400 | 403 | 409;

  constructor(readonly code: CodigoError) {
    super(code);
    this.name = 'CelebracionError';
    this.status = CIERRES.has(code) ? 409 : code === 'no_invitado' ? 403 : 400;
  }
}

export interface DatosConfirmacion {
  asiste: boolean;
  preferencia: string | null;
  mensaje: string | null;
}

export interface CualidadVotada {
  cualidad: string;
  votos: number;
}

export function confirmacionesAbiertas(ahora: Date): boolean {
  return ahora.getTime() <= new Date(EVENTO.cierreConfirmaciones).getTime();
}

export function votosAbiertos(ahora: Date): boolean {
  return ahora.getTime() < new Date(EVENTO.inicio).getTime();
}

const CODIGOS_PREFERENCIA = new Set(PREFERENCIAS.map((p) => p.codigo));

/** Valida el cuerpo de PUT /celebracion/confirmacion. */
export function parseConfirmacion(body: unknown): DatosConfirmacion {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.asiste !== 'boolean') throw new CelebracionError('asiste_invalido');
  const preferencia = b.preferencia ?? null;
  if (b.asiste) {
    if (typeof preferencia !== 'string' || !CODIGOS_PREFERENCIA.has(preferencia)) {
      throw new CelebracionError('preferencia_invalida');
    }
    return { asiste: true, preferencia, mensaje: parseMensaje(b.mensaje) };
  }
  if (preferencia !== null) throw new CelebracionError('preferencia_invalida');
  return { asiste: false, preferencia: null, mensaje: parseMensaje(b.mensaje) };
}

/** Controles C0, DEL, C1 y los separadores de línea y de párrafo de Unicode. */
function tieneControl(texto: string): boolean {
  for (const caracter of texto) {
    const c = caracter.codePointAt(0) ?? 0;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

function parseMensaje(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new CelebracionError('mensaje_invalido');
  const limpio = valor.trim();
  if (limpio === '') return null;
  if (limpio.length > MENSAJE_MAX || tieneControl(limpio)) throw new CelebracionError('mensaje_invalido');
  return limpio;
}

const SET_CUALIDADES = new Set(CUALIDADES);

/** Valida el cuerpo de PUT /celebracion/votos/:userId: de 0 a 3 cualidades de la lista, sin repetir. */
export function parseCualidades(body: unknown): string[] {
  const lista = ((body ?? {}) as Record<string, unknown>).cualidades;
  if (!Array.isArray(lista)) throw new CelebracionError('cualidad_invalida');
  if (lista.length > MAX_CUALIDADES) throw new CelebracionError('demasiadas_cualidades');
  const vistas = new Set<string>();
  for (const c of lista) {
    if (typeof c !== 'string' || !SET_CUALIDADES.has(c) || vistas.has(c)) throw new CelebracionError('cualidad_invalida');
    vistas.add(c);
  }
  return [...vistas];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID.test(valor);
}

const ORDEN = new Map(CUALIDADES.map((c, i) => [c, i] as const));

/** Las 3 cualidades más votadas; empata el orden de la lista. Las que ya no están en la lista no salen. */
export function top3(conteos: readonly CualidadVotada[]): CualidadVotada[] {
  return conteos
    .filter((c) => c.votos > 0 && ORDEN.has(c.cualidad))
    .sort((a, b) => b.votos - a.votos || (ORDEN.get(a.cualidad) ?? 0) - (ORDEN.get(b.cualidad) ?? 0))
    .slice(0, MAX_CUALIDADES);
}
