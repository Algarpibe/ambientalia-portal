import type { Pool } from '@algarpibe/zoho-sync';

// Pagos de clientes agrupados por semana del mes, para la pestaña «Pagos recibidos» de
// Contabilidad. Toda la lógica de semanas vive aquí, en funciones puras: SQL solo trae
// las filas.

export interface SemanaDelMes {
  anio: number;
  mes: number;    // 1-12
  semana: number; // 1-6
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Día de la semana del día 1 del mes, 0=lunes … 6=domingo. En UTC a propósito: el
// servidor corre en UTC y las fechas llegan como 'AAAA-MM-DD' sin hora, así que no hay
// zona horaria que pueda mover el día.
function diaIsoDelDia1(anio: number, mes: number): number {
  return (new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay() + 6) % 7;
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

const dos = (n: number) => String(n).padStart(2, '0');

/**
 * Semana del mes de una fecha 'AAAA-MM-DD'. Regla aprobada el 2026-10-01: la semana empieza
 * en lunes; la semana 1 va del día 1 al primer domingo aunque quede corta, y un mes de 30
 * días que empieza en domingo (o de 31 que empieza en sábado o domingo) llega a semana 6.
 */
export function semanaDelMes(fecha: string): SemanaDelMes {
  const [anio, mes, dia] = fecha.slice(0, 10).split('-').map(Number);
  return { anio, mes, semana: Math.floor((dia - 1 + diaIsoDelDia1(anio, mes)) / 7) + 1 };
}

/** Primer y último día de una semana del mes, y su etiqueta legible («1-6 sep 2026»). */
export function rangoDeSemana(anio: number, mes: number, semana: number): { desde: string; hasta: string; etiqueta: string } {
  const iso = diaIsoDelDia1(anio, mes);
  const diaDesde = Math.max(1, 7 * (semana - 1) - iso + 1);
  const diaHasta = Math.min(7 * semana - iso, diasDelMes(anio, mes));
  const dias = diaDesde === diaHasta ? `${diaDesde}` : `${diaDesde}-${diaHasta}`;
  return {
    desde: `${anio}-${dos(mes)}-${dos(diaDesde)}`,
    hasta: `${anio}-${dos(mes)}-${dos(diaHasta)}`,
    etiqueta: `${dias} ${MESES[mes - 1]} ${anio}`,
  };
}
