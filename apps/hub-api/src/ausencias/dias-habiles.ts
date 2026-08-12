import { festivosColombia, diaDeSemana, sumarDias } from './festivos.js';

/** Tope de un rango de ausencia. Nadie pide 3 años; un rango así es un error de
 *  tecleo (o un intento de hacer trabajar al servidor de más). */
export const MAX_DIAS_RANGO = 366;

/**
 * Fecha de calendario real, no solo con forma de fecha. El chequeo de forma por
 * sí solo deja pasar «2026-13-45» y «2026-02-30», que llegarían al `::date` del
 * SQL y devolverían un 500 por lo que en realidad es un error del que llama.
 * (Mismo criterio que `esFechaValida` en wo-sales/router.ts.)
 */
export function esFechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Días hábiles entre dos fechas, **ambas incluidas**: descarta sábados,
 * domingos y festivos de Colombia.
 *
 * Es el puerto del nodo «Contar días Laborables» del flujo de n8n, con dos
 * arreglos: los festivos se calculan (no estaban escritos a mano, ver
 * festivos.ts) y toda la aritmética es en UTC sobre cadenas, así que el
 * resultado no depende de la zona horaria del proceso.
 */
export function contarDiasHabiles(desde: string, hasta: string): number {
  if (!esFechaValida(desde)) throw new Error(`fecha inválida: ${desde}`);
  if (!esFechaValida(hasta)) throw new Error(`fecha inválida: ${hasta}`);
  if (desde > hasta) throw new Error('rango invertido: la fecha final es anterior a la inicial');

  const diasNaturales = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000 + 1;
  if (diasNaturales > MAX_DIAS_RANGO) throw new Error(`rango demasiado largo: ${diasNaturales} días`);

  // Un rango puede cruzar el cambio de año, así que se acumulan los festivos de
  // todos los años que toca.
  const festivos = new Set<string>();
  for (let anio = Number(desde.slice(0, 4)); anio <= Number(hasta.slice(0, 4)); anio++) {
    for (const f of festivosColombia(anio)) festivos.add(f);
  }

  let habiles = 0;
  for (let fecha = desde; fecha <= hasta; fecha = sumarDias(fecha, 1)) {
    const dia = diaDeSemana(fecha);
    if (dia !== 0 && dia !== 6 && !festivos.has(fecha)) habiles++;
  }
  return habiles;
}
