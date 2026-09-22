import type { AnticipoAtencion, MotivoAtencion } from './api';
import { formatCOP } from './format';

// Helpers puros de la tabla de OV pendientes: aquí viven las decisiones que se pueden
// testear sin montar el componente.

/** Claves de las columnas de anticipo. Solo existen si el servidor manda los campos. */
export const COLUMNAS_ANTICIPO: readonly string[] = ['anticipoCobrado', 'anticipoSinAplicar'];

/**
 * Compara dos valores de celda para ordenar. Si alguno es número, la columna es numérica y lo
 * vacío (una OV sin anticipos) queda por debajo de cualquier importe, incluido el 0. Si no,
 * orden alfabético español.
 */
export function compararValores(av: unknown, bv: unknown): number {
  const an = typeof av === 'number' ? av : null;
  const bn = typeof bv === 'number' ? bv : null;
  if (an !== null || bn !== null) return (an ?? -1) - (bn ?? -1);
  return String(av ?? '').localeCompare(String(bv ?? ''), 'es');
}

/** ¿Trae la respuesta los campos de anticipo? El servidor solo los manda a Contabilidad. */
export function traeAnticipos(ordenes: readonly object[] | null): boolean {
  return !!ordenes?.some((o) => 'anticipoCobrado' in o);
}

/** Quita las columnas de anticipo cuando el usuario no las recibe. */
export function columnasDisponibles<K extends string>(orden: readonly K[], conAnticipos: boolean): K[] {
  return conAnticipos ? [...orden] : orden.filter((k) => !COLUMNAS_ANTICIPO.includes(k));
}

/** «—» si la OV no tiene anticipos (null); el importe si los tiene, aunque ya esté aplicado (0). */
export function celdaAnticipo(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : formatCOP(v);
}

const MOTIVOS: Record<Exclude<MotivoAtencion, 'sin_aplicar_ov_cerrada'>, string> = {
  sin_referencia: 'La descripción no nombra ninguna OV',
  varias_ov: 'Nombra varias OV: no se puede repartir el importe',
  ov_inexistente: 'La OV nombrada no existe en Zoho',
  moneda_distinta: 'El anticipo y la OV van en monedas distintas',
};

/** El motivo de atención en lenguaje llano. */
export function motivoLegible(a: Pick<AnticipoAtencion, 'motivo' | 'estadoOV'>): string {
  if (a.motivo === 'sin_aplicar_ov_cerrada') {
    return a.estadoOV === 'void'
      ? 'OV anulada con anticipo sin aplicar: ¿hay que devolverlo?'
      : 'OV ya facturada con anticipo sin aplicar: posible cobro doble';
  }
  return MOTIVOS[a.motivo];
}

const ESTADOS: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviado',
  viewed: 'Visto',
  unpaid: 'Sin pagar',
  partially_paid: 'Pago parcial',
  paid: 'Pagado',
  overdue: 'Vencido',
  void: 'Anulado',
};

/** Estado de un anticipo en español; los desconocidos pasan tal cual. */
export function estadoAnticipo(s: string | null): string {
  if (!s) return '—';
  return ESTADOS[s] ?? s;
}
