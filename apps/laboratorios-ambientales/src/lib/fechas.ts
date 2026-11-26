const dos = (n: number): string => String(n).padStart(2, '0');

// Fecha de hoy (AAAA-MM-DD) en la zona horaria del navegador. No sirve
// `toISOString()`: da la fecha UTC, y en Colombia (UTC−5) desde las 7 p. m. ya
// marca el día siguiente. Es el mismo patrón que `hoyLocal` de contabilidad
// (apps/contabilidad/src/cartera.ts), repetido aquí porque las apps no se
// importan entre sí.
export function hoyLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// Suma meses de calendario a una fecha AAAA-MM-DD. Si el día no existe en el mes
// de llegada, se queda en el último: el 31 de agosto + 6 meses es el 28 de
// febrero (el 29 en bisiesto), y no el 3 de marzo, que es lo que daría Date al
// desbordarse.
export function sumarMeses(fecha: string, meses: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const indice = anio * 12 + (mes - 1) + meses;
  const anioFinal = Math.floor(indice / 12);
  const mesFinal = indice - anioFinal * 12; // 0 = enero
  // El día 0 del mes siguiente es el último de este. En UTC, para que la zona
  // horaria no mueva el día.
  const ultimoDia = new Date(Date.UTC(anioFinal, mesFinal + 1, 0)).getUTCDate();
  return `${anioFinal}-${dos(mesFinal + 1)}-${dos(Math.min(dia, ultimoDia))}`;
}
