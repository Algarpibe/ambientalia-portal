import { describe, it, expect } from 'vitest';
import { festivosColombia, pascua } from './festivos.js';

// Los festivos oficiales de Colombia, verificados contra el calendario laboral.
// OJO con 2025: San Pedro y San Pablo (29-jun, domingo) se traslada al lunes
// 30-jun, que es el mismo día que el Sagrado Corazón → ese año hay 17 fechas
// distintas, no 18. Por eso la función devuelve un Set y no un array.
const FESTIVOS_2025 = [
  '2025-01-01', // Año Nuevo
  '2025-01-06', // Reyes (ya cae en lunes)
  '2025-03-24', // San José (19-mar mié → lunes 24)
  '2025-04-17', // Jueves Santo
  '2025-04-18', // Viernes Santo
  '2025-05-01', // Día del Trabajo
  '2025-06-02', // Ascensión
  '2025-06-23', // Corpus Christi
  '2025-06-30', // Sagrado Corazón + San Pedro y San Pablo (colisión)
  '2025-07-20', // Independencia
  '2025-08-07', // Batalla de Boyacá
  '2025-08-18', // Asunción (15-ago vie → lunes 18)
  '2025-10-13', // Día de la Raza (12-oct dom → lunes 13)
  '2025-11-03', // Todos los Santos (1-nov sáb → lunes 3)
  '2025-11-17', // Independencia de Cartagena (11-nov mar → lunes 17)
  '2025-12-08', // Inmaculada Concepción
  '2025-12-25', // Navidad
];

const FESTIVOS_2026 = [
  '2026-01-01',
  '2026-01-12', // Reyes (6-ene mar → lunes 12)
  '2026-03-23', // San José (19-mar jue → lunes 23)
  '2026-04-02', // Jueves Santo
  '2026-04-03', // Viernes Santo
  '2026-05-01',
  '2026-05-18', // Ascensión
  '2026-06-08', // Corpus Christi
  '2026-06-15', // Sagrado Corazón
  '2026-06-29', // San Pedro y San Pablo (ya cae en lunes)
  '2026-07-20',
  '2026-08-07',
  '2026-08-17', // Asunción (15-ago sáb → lunes 17)
  '2026-10-12', // Día de la Raza (ya cae en lunes)
  '2026-11-02', // Todos los Santos (1-nov dom → lunes 2)
  '2026-11-16', // Independencia de Cartagena (11-nov mié → lunes 16)
  '2026-12-08',
  '2026-12-25',
];

const FESTIVOS_2027 = [
  '2027-01-01',
  '2027-01-11', // Reyes (6-ene mié → lunes 11)
  '2027-03-22', // San José (19-mar vie → lunes 22)
  '2027-03-25', // Jueves Santo
  '2027-03-26', // Viernes Santo
  '2027-05-01',
  '2027-05-10', // Ascensión
  '2027-05-31', // Corpus Christi
  '2027-06-07', // Sagrado Corazón
  '2027-07-05', // San Pedro y San Pablo (29-jun mar → lunes 5-jul)
  '2027-07-20',
  '2027-08-07',
  '2027-08-16', // Asunción (15-ago dom → lunes 16)
  '2027-10-18', // Día de la Raza (12-oct mar → lunes 18)
  '2027-11-01', // Todos los Santos (ya cae en lunes)
  '2027-11-15', // Independencia de Cartagena (11-nov jue → lunes 15)
  '2027-12-08',
  '2027-12-25',
];

describe('pascua', () => {
  it('calcula el Domingo de Resurrección', () => {
    expect(pascua(2025)).toBe('2025-04-20');
    expect(pascua(2026)).toBe('2026-04-05');
    expect(pascua(2027)).toBe('2027-03-28');
    // Año bisiesto: el desplazamiento de días tiene que cruzar el 29 de febrero
    // sin descuadrarse.
    expect(pascua(2028)).toBe('2028-04-16');
  });
});

describe('festivosColombia', () => {
  it('devuelve el calendario de 2025 (17 fechas: dos festivos colisionan)', () => {
    expect([...festivosColombia(2025)].sort()).toEqual(FESTIVOS_2025);
  });

  it('devuelve el calendario de 2026', () => {
    expect([...festivosColombia(2026)].sort()).toEqual(FESTIVOS_2026);
  });

  it('devuelve el calendario de 2027 — el año en que la lista de n8n se quedaba vacía', () => {
    expect([...festivosColombia(2027)].sort()).toEqual(FESTIVOS_2027);
  });

  it('coincide con la lista hardcodeada del flujo de n8n para 2026', () => {
    // Oráculo: la lista del nodo «Contar días Laborables», filtrada a 2026.
    // Se le quitan 2026-03-29 (Domingo de Ramos) y 2026-04-05 (Domingo de
    // Resurrección), que estaban de más — no son festivos oficiales, y como
    // caen en domingo nunca cambiaron el resultado del conteo.
    const listaN8n = [
      '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
      '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
      '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
      '2026-11-16', '2026-12-08', '2026-12-25',
    ];
    expect([...festivosColombia(2026)].sort()).toEqual(listaN8n);
  });

  it('todos los festivos trasladables caen en lunes', () => {
    const trasladables = new Set(['01-06', '03-19', '06-29', '08-15', '10-12', '11-01', '11-11']);
    for (const anio of [2025, 2026, 2027, 2028, 2029, 2030]) {
      for (const iso of festivosColombia(anio)) {
        const d = new Date(`${iso}T00:00:00Z`);
        // No podemos saber de qué festivo viene cada fecha, así que la
        // comprobación es la inversa: ninguna fecha «móvil por Emiliani» puede
        // quedarse en su día original si ese día no era lunes.
        if (trasladables.has(iso.slice(5)) && d.getUTCDay() !== 1) {
          throw new Error(`${iso} es un festivo Emiliani que no se trasladó a lunes`);
        }
      }
    }
  });

  it('no depende del huso horario del proceso', () => {
    // Regresión: el código original de n8n usaba new Date(str) + toISOString(),
    // que en un servidor en UTC (el caso de hub-api) desplaza un día.
    const tzOriginal = process.env.TZ;
    try {
      process.env.TZ = 'America/Bogota';
      const bogota = [...festivosColombia(2026)].sort();
      process.env.TZ = 'UTC';
      const utc = [...festivosColombia(2026)].sort();
      expect(bogota).toEqual(utc);
    } finally {
      process.env.TZ = tzOriginal;
    }
  });

  it('cachea por año sin devolver el mismo Set mutable', () => {
    const a = festivosColombia(2026);
    a.delete('2026-01-01');
    expect(festivosColombia(2026).has('2026-01-01')).toBe(true);
  });
});
