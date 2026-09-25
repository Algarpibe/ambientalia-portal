/**
 * Frecuencia de envío del correo de WO-sales, por destinatario. La configura un
 * administrador. Lógica pura (sin BD) para poder probar las franjas sin reloj real.
 *
 * Semántica: para diario / semanal / fin de mes, cada destinatario tiene "franjas"
 * (su hora de envío). En cada franja nueva se le envía el archivo SI hubo cambios; si
 * no los hubo, la franja se cierra igual, así un cambio que llega después de la hora
 * espera a la franja siguiente en vez de salir en ese momento. `ultimoCorte` es la
 * última franja ya procesada; solo avanza al confirmar un envío (o al cerrar una franja
 * sin cambios), de modo que un envío fallido se reintenta en el siguiente ciclo de n8n.
 */
export type Frecuencia = 'inmediato' | 'diario' | 'semanal' | 'fin_de_mes' | 'nunca';

export const FRECUENCIAS: readonly Frecuencia[] = ['inmediato', 'diario', 'semanal', 'fin_de_mes', 'nunca'];

export interface PreferenciaEnvio {
  frecuencia: Frecuencia;
  /** Hora del día (0–23, hora de Colombia). Obligatoria en diario, semanal y fin_de_mes. */
  hora: number | null;
  /** Día ISO de la semana (1 = lunes … 7 = domingo). Solo en semanal. */
  diaSemana: number | null;
}

export const PREFERENCIA_POR_DEFECTO: PreferenciaEnvio = { frecuencia: 'inmediato', hora: null, diaSemana: null };

/** Colombia es UTC-5 todo el año (sin horario de verano). */
const OFFSET_MS = 5 * 3_600_000;

/** Instante UTC de una hora local de Colombia. Date.UTC normaliza días fuera de rango. */
function desdeLocal(anio: number, mes: number, dia: number, hora: number): Date {
  return new Date(Date.UTC(anio, mes, dia, hora) + OFFSET_MS);
}

/** Última franja de envío <= ahora, o null si la frecuencia no tiene franjas. */
export function ultimaFranja(pref: PreferenciaEnvio, ahora: Date): Date | null {
  if (pref.hora === null) return null;
  const local = new Date(ahora.getTime() - OFFSET_MS);
  const a = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const h = pref.hora;

  switch (pref.frecuencia) {
    case 'diario': {
      const hoy = desdeLocal(a, m, d, h);
      return hoy <= ahora ? hoy : desdeLocal(a, m, d - 1, h);
    }
    case 'semanal': {
      if (pref.diaSemana === null) return null;
      const iso = local.getUTCDay() || 7;
      const atras = (iso - pref.diaSemana + 7) % 7;
      const franja = desdeLocal(a, m, d - atras, h);
      return franja <= ahora ? franja : desdeLocal(a, m, d - atras - 7, h);
    }
    case 'fin_de_mes': {
      // Día 0 del mes siguiente = último día de este mes.
      const esteMes = desdeLocal(a, m + 1, 0, h);
      return esteMes <= ahora ? esteMes : desdeLocal(a, m, 0, h);
    }
    default:
      return null;
  }
}

export interface EstadoDestinatario {
  /** Hash del último archivo que recibió (null = nunca recibió). */
  hashRecibido: string | null;
  preferencia: PreferenciaEnvio;
  /** Última franja ya procesada (null = ninguna). */
  ultimoCorte: Date | null;
}

/**
 * ¿Se le envía ahora? `franja` es la franja a sellar como procesada: al confirmar el
 * envío si `enviar`, o de inmediato si no hubo cambios. null = no hay franja que sellar.
 */
export function decidirEnvioDestinatario(
  e: EstadoDestinatario,
  token: string,
  ahora: Date
): { enviar: boolean; franja: Date | null } {
  const hayCambios = e.hashRecibido !== token;
  if (e.preferencia.frecuencia === 'nunca') return { enviar: false, franja: null };
  if (e.preferencia.frecuencia === 'inmediato') return { enviar: hayCambios, franja: null };

  const franja = ultimaFranja(e.preferencia, ahora);
  if (!franja) return { enviar: false, franja: null };
  if (e.ultimoCorte && e.ultimoCorte >= franja) return { enviar: false, franja: null };
  return { enviar: hayCambios, franja };
}

type Validacion = { ok: true; preferencia: PreferenciaEnvio } | { ok: false; error: string };

const esEnteroEntre = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Valida el cuerpo que manda el panel de administración. */
export function validarPreferencia(body: unknown): Validacion {
  const b = (body ?? {}) as { frecuencia?: unknown; hora?: unknown; diaSemana?: unknown };
  if (!FRECUENCIAS.includes(b.frecuencia as Frecuencia)) return { ok: false, error: 'frecuencia_invalida' };
  const frecuencia = b.frecuencia as Frecuencia;

  if (frecuencia === 'inmediato' || frecuencia === 'nunca') {
    return { ok: true, preferencia: { frecuencia, hora: null, diaSemana: null } };
  }
  if (!esEnteroEntre(b.hora, 0, 23)) return { ok: false, error: 'hora_invalida' };
  if (frecuencia === 'semanal') {
    if (!esEnteroEntre(b.diaSemana, 1, 7)) return { ok: false, error: 'dia_semana_invalido' };
    return { ok: true, preferencia: { frecuencia, hora: b.hora, diaSemana: b.diaSemana } };
  }
  return { ok: true, preferencia: { frecuencia, hora: b.hora, diaSemana: null } };
}
