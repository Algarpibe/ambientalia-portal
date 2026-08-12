// Festivos de Colombia, CALCULADOS.
//
// El flujo de n8n que esta app sustituye llevaba la lista escrita a mano dentro
// del nodo «Contar días Laborables», y terminaba en 2026-12-25: a partir de
// enero de 2027 habría empezado a contar los festivos como días laborables, sin
// avisar. Aquí se derivan de la ley, así que no caducan.
//
// Fuente: Ley 51 de 1983 («Ley Emiliani»), que traslada al lunes siguiente todos
// los festivos salvo los seis de fecha fija y el Jueves y Viernes Santo.

/** Fecha ISO (YYYY-MM-DD) a partir de sus componentes. */
function iso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Aritmética de fechas en UTC puro. Todo lo que se toca aquí son cadenas
 * `YYYY-MM-DD` y milisegundos UTC, nunca la zona horaria del proceso: el
 * servidor corre en UTC y Colombia es UTC−5, así que `new Date(str)` +
 * `toISOString()` (lo que hacía n8n) puede desplazar un día.
 */
export function sumarDias(fecha: string, dias: number): string {
  const ms = Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Día de la semana en UTC: 0 = domingo … 6 = sábado. */
export function diaDeSemana(fecha: string): number {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

/** Traslada la fecha al lunes siguiente, salvo que ya sea lunes (Ley Emiliani). */
function alLunes(fecha: string): string {
  const d = diaDeSemana(fecha);
  return d === 1 ? fecha : sumarDias(fecha, (8 - d) % 7);
}

/**
 * Domingo de Resurrección del año dado (algoritmo de Butcher / Meeus para el
 * calendario gregoriano). Es la raíz de los cinco festivos móviles.
 */
export function pascua(anio: number): string {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const total = h + l - 7 * m + 114;
  return iso(anio, Math.floor(total / 31), (total % 31) + 1);
}

/** Los seis de fecha fija: no se trasladan nunca, caigan en el día que caigan. */
const FIJOS: ReadonlyArray<[number, number]> = [
  [1, 1],   // Año Nuevo
  [5, 1],   // Día del Trabajo
  [7, 20],  // Grito de Independencia
  [8, 7],   // Batalla de Boyacá
  [12, 8],  // Inmaculada Concepción
  [12, 25], // Navidad
];

/** Los siete que la Ley Emiliani traslada al lunes siguiente. */
const EMILIANI: ReadonlyArray<[number, number]> = [
  [1, 6],   // Reyes Magos
  [3, 19],  // San José
  [6, 29],  // San Pedro y San Pablo
  [8, 15],  // Asunción de la Virgen
  [10, 12], // Día de la Raza
  [11, 1],  // Todos los Santos
  [11, 11], // Independencia de Cartagena
];

const cache = new Map<number, ReadonlySet<string>>();

/**
 * Los festivos del año como Set de fechas ISO.
 *
 * Normalmente son 18, pero **puede haber menos**: en 2025 San Pedro y San Pablo
 * (29-jun, domingo) se traslada al lunes 30-jun, que ya es el Sagrado Corazón,
 * y quedan 17 fechas distintas. Por eso devuelve un Set y no una lista.
 */
export function festivosColombia(anio: number): Set<string> {
  let f = cache.get(anio);
  if (!f) {
    const dias = new Set<string>();
    for (const [mes, dia] of FIJOS) dias.add(iso(anio, mes, dia));
    for (const [mes, dia] of EMILIANI) dias.add(alLunes(iso(anio, mes, dia)));

    const domingoDePascua = pascua(anio);
    dias.add(sumarDias(domingoDePascua, -3)); // Jueves Santo — no se traslada
    dias.add(sumarDias(domingoDePascua, -2)); // Viernes Santo — no se traslada
    // Los tres siguientes ya incorporan el traslado a lunes en el desplazamiento:
    // Ascensión (+39 → +43), Corpus Christi (+60 → +64), Sagrado Corazón (+68 → +71).
    dias.add(sumarDias(domingoDePascua, 43));
    dias.add(sumarDias(domingoDePascua, 64));
    dias.add(sumarDias(domingoDePascua, 71));

    f = dias;
    cache.set(anio, f);
  }
  // Copia defensiva: el Set cacheado no debe poder mutarse desde fuera.
  return new Set(f);
}
