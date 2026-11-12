import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anonimizar, buscarFugas, cls, crearAnonimizador, nrm } from './equipos-anonimizar.mjs';

// El anonimizador con datos INVENTADOS (aquí no hay ningún dato real): conserva las
// peculiaridades del OCR que prueban las reglas y no deja pasar los valores de entrada.
const aDigitos = (c) => c.replace(/S/g, '5').replace(/T/g, '7').replace(/B/g, '8');

describe('seriales', () => {
  it('O/0, I/1, S/5, T/7 y B/8 siguen siendo la misma clase, en la misma posición', () => {
    const a = crearAnonimizador();
    const canon = a.serial('KEWR0XF5');
    const ocr = a.serial('KEWROXFS');
    expect(cls(ocr)).toBe(cls(canon));
    expect(canon).not.toBe('KEWR0XF5');
    expect(/\d/.test(ocr)).toBe(false); // el serial sin dígitos sigue sin dígitos
    expect(/\d/.test(nrm(ocr))).toBe(true); // …y el OCR lo sigue leyendo con dígitos (O→0)
  });

  it('los ceros a la izquierda se conservan y no cuentan', () => {
    const a = crearAnonimizador();
    const largo = a.serial('0355590041');
    expect(largo.startsWith('0')).toBe(true);
    expect(cls(largo)).toBe(cls(a.serial('355590041')));
  });

  it('una clase que empieza por 0 sigue empezando por 0 (OCR con ceros a la izquierda)', () => {
    const a = crearAnonimizador();
    for (const real of ['0355590041', '0K7R2X9Q', '0ABCD1234']) {
      const s = a.clase(real);
      expect(s.startsWith('0')).toBe(true);
      expect(s).toHaveLength(real.length);
      expect(s).not.toBe(real);
    }
    expect(a.clase('0355590041')).toBe(a.clase('0355590041')); // determinista por valor
  });

  it('el prefijo GRIMM se conserva y el resto cambia', () => {
    const s = crearAnonimizador().serial('18A90417');
    expect(s).toMatch(/^18A\d{5}$/);
    expect(s).not.toBe('18A90417');
  });

  it('el serial deformado «NN#NNNNN» usa los dígitos del serial sintético que le toca', () => {
    const a = crearAnonimizador();
    const s = a.serial('18A90417');
    expect(a.texto('EDM180C · Grimm · 18#90417 · Equipo calibrado')).toBe('EDM180C · Grimm · 18#' + aDigitos(cls(s)).slice(-5) + ' · Equipo calibrado');
  });
});

describe('texto', () => {
  it('conserva el formato, las fechas y los números pequeños; cambia lo demás', () => {
    const a = crearAnonimizador();
    const t = a.texto('REMISIÓN DE SERVICIO TÉCNICO\nFecha: 2026-04-01\n1\nSeñores: Laboratorio Inventado Quimera\nTeléfono: 6015551234');
    expect(t).toMatch(/^REMISIÓN DE SERVICIO TÉCNICO\nFecha: 2026-04-01\n1\n/);
    expect(t).not.toMatch(/Quimera|Inventado|6015551234/);
    expect(t).toMatch(/Laboratorio/);
  });

  it('los tickets del rango 700–1499 siguen dentro del rango', () => {
    const a = crearAnonimizador();
    const k = Number(a.ticket('1033'));
    expect(k).toBeGreaterThanOrEqual(700);
    expect(k).toBeLessThan(1500);
    expect(k).not.toBe(1033);
  });
});

describe('anonimizar', () => {
  const reales = {
    roles: { remisiones: { inventada: 'remA' }, seriales: { S_UNO: '18A90417' }, tickets: { T_UNO: '1033' }, clientes: { C_UNO: 'QUIMERA' } },
    remisiones: { inventada: 'REMISIÓN DE SERVICIO TÉCNICO\n\\#S/N\n1033\nEDM180C\nGrimm\n18A90417\nQUIMERA S.A.S.' },
    escaneos: {
      _nota: 'nota inventada',
      ilegibles: [{ n: '260115 - QUIMERA.pdf', d: '2026-01-15', t: ['CANT1DAD'], it: { CANT1DAD: { e: 'EDM 180 · 18#90417', k: '' } } }],
      legibles: [{ n: '260116 - Quimera.pdf', d: '2026-01-16', t: [cls('18A90417')], it: { [cls('18A90417')]: { e: 'EDM180C', k: '1033' } } }],
      fechaErrada: { n: '270316 - QUIMERA.pdf', d: '2027-03-16', t: ['202603T6'], it: {} },
    },
  };

  it('es determinista y los roles salen en roles.json', () => {
    const a = anonimizar(reales);
    expect(anonimizar(reales)).toEqual(a);
    const roles = JSON.parse(a['roles.json']);
    expect(roles.clientes.C_UNO).toBe('ALFA');
    expect(JSON.parse(a['remisiones.json']).remA).toContain(roles.seriales.S_UNO);
    expect(JSON.parse(a['escaneos.json']).legibles[0].n).toBe('260116 - Alfa.pdf');
    expect(JSON.parse(a['escaneos.json']).legibles[0].it[cls(roles.seriales.S_UNO)].k).toBe(roles.tickets.T_UNO);
  });

  it('ningún valor sintético coincide con un serial o un ticket de tickets.json', () => {
    const antes = JSON.parse(anonimizar(reales)['roles.json']);
    const conTickets = { ...reales, tickets: [{ ticketNumber: antes.tickets.T_UNO, cf: { cf_serial: antes.seriales.S_UNO } }] };
    const despues = JSON.parse(anonimizar(conTickets)['roles.json']);
    expect(despues.tickets.T_UNO).not.toBe(antes.tickets.T_UNO);
    expect(cls(despues.seriales.S_UNO)).not.toBe(cls(antes.seriales.S_UNO));
  });

  it('la salida no contiene ningún valor de entrada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anon-'));
    try {
      for (const [n, t] of Object.entries(anonimizar(reales))) writeFileSync(join(dir, n), t);
      expect(buscarFugas(reales, [dir])).toEqual([]);
      writeFileSync(join(dir, 'fuga.txt'), 'el serial 18A90417 de QUIMERA');
      const fugas = buscarFugas(reales, [dir]);
      expect(fugas.length).toBeGreaterThan(0);
      // nunca devuelve el valor filtrado: solo el fichero y la posición y longitud de la coincidencia
      for (const f of fugas) {
        expect(f).not.toMatch(/18A90417|QUIMERA|1033/i);
        expect(f).toMatch(/fuga\.txt: coincidencia en la posición \d+ \(longitud \d+\)/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('una clave de remisiones sin rol es un error, no una fuga', () =>
    expect(() => anonimizar({ ...reales, remisiones: { ...reales.remisiones, otra: 'x' } })).toThrow(/sin rol/));
});

describe('buscarFugas: palabras comunes y números cortos', () => {
  // Todo INVENTADO. DESKTOP hace de palabra que el OCR leyó sola y en mayúsculas en una
  // remisión (escaneos.t la toma por serial sin dígitos); KEWROXFS, de serial real sin
  // dígitos; 706, de ticket real de tres cifras.
  const reales = {
    roles: { remisiones: { inventada: 'remA' }, seriales: { S_UNO: '18A90417', S_DOS: 'KEWROXFS' }, tickets: { T_UNO: '706' }, clientes: { C_UNO: 'QUIMERA' } },
    remisiones: {},
    escaneos: {
      ilegibles: [],
      legibles: [{ n: '260116 - x.pdf', d: '2026-01-16', t: [cls('DESKTOP'), cls('18A90417'), cls('KEWROXFS')], it: {} }],
      fechaErrada: { n: '270316 - y.pdf', d: '2027-03-16', t: [], it: {} },
    },
  };
  const fugasEn = (nombre, texto) => {
    const dir = mkdtempSync(join(tmpdir(), 'fugas-'));
    try {
      writeFileSync(join(dir, nombre), texto);
      return buscarFugas(reales, [dir]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('la palabra del escaneo dentro de un identificador no es una fuga', () => {
    expect(fugasEn('Sidebar.tsx', 'const [desktopOpen, setDesktopOpen] = useState(false);\nconst isDesktop = true;\nconst IS_DESKTOP = 1;\n')).toEqual([]);
  });

  it('ni suelta en prosa, en minúsculas o con mayúscula inicial', () => {
    expect(fugasEn('README.md', '## Desktop\n\nDiseño responsive para desktop y móvil.\n')).toEqual([]);
  });

  it('escrita como la lee el OCR (sola y en mayúsculas) sí lo es', () => {
    const fugas = fugasEn('nota.md', 'Remisión:\nDESKTOP\nEDM180C\n');
    expect(fugas).toHaveLength(1);
    expect(fugas[0]).toMatch(/nota\.md: coincidencia en la posición 10 \(longitud 7\)$/);
  });

  it('un serial sin dígitos sigue siendo estricto, aunque vaya pegado a otra palabra', () =>
    expect(fugasEn('x.ts', 'const kewroxfsOpen = 1;')).toHaveLength(1));

  it('el nombre del cliente y el serial siguen siendo estrictos (sueltos, pegados, en cualquier caja)', () => {
    for (const t of ['Laboratorio Quimera', 'QuimeraLab', 'el equipo SN18A90417', 'const s = "18a90417";'])
      expect(fugasEn('nota.md', t), t).toHaveLength(1);
  });

  it('un número de tres cifras igual a un ticket, sin contexto de ticket, no es una fuga', () => {
    // un recuento en prosa, una lista suelta, una versión, un decimal de un SVG, una fecha
    const t = 'Aguas 701 · Fuentes Fijas 706 · Marina 702\n| 6 | Por Facturar: 700, 706, 703 |\nversión 1.706.2, d="M14.706 8.2", 2026-706, 706px\n';
    expect(fugasEn('plan.md', t)).toEqual([]);
    expect(fugasEn('react.svg', '<path d="M5.045-14.706 8.298-22.6"/>')).toEqual([]);
  });

  it('con contexto de ticket sí lo es, y nunca se devuelve el número', () => {
    for (const t of ['ver #706', 'el ticket 706 del cliente', 'Ticket #706.', "ticketNumber: '706'", '"ticket": "706"', 'tiquete nº 706', 'Remisión\n706\nEDM180C']) {
      const fugas = fugasEn('nota.md', t);
      expect(fugas, t).toHaveLength(1);
      expect(fugas[0]).toMatch(/nota\.md: coincidencia de ticket en la posición \d+ \(longitud 3\)$/);
      expect(fugas[0].replace(/^.*nota\.md/, '')).not.toMatch(/706/);
    }
  });

  it('…pero no si es parte de un número más largo', () => {
    for (const t of ['#7061', 'ticket 1706', 'ticket 706.5', '#706a3f']) expect(fugasEn('nota.md', t), t).toEqual([]);
  });

  it('en un fichero de datos (.json) cuenta cualquier 706 suelto: así sale un ticket en las fixtures', () =>
    expect(fugasEn('roles.json', '{ "tickets": { "T_UNO": "706" } }\n')).toHaveLength(1));
});
