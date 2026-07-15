// Catálogo de equipos de calidad del aire acreditados, portado del prototipo.
// La clave es el código de designación (US EPA / UNE-EN) que aparece embebido en
// el texto libre del campo «método» del dataset.
export type Equipo = { brand: string; model: string; pollutant: string };
export type EquipoIdentificado = Equipo & { code: string };

export const EQUIPMENT_MAP: Record<string, Equipo> = {
  'EQPM-0798-122': { brand: 'Met One Instruments, Inc.', model: 'BAM 1020', pollutant: 'Partículas' },
  'EQPM-0308-170': { brand: 'Teledyne API', model: '602 BetaPlus', pollutant: 'Partículas' },
  'EQSA-0495-100': { brand: 'Teledyne API', model: '100 Series', pollutant: 'SO₂' },
  'EQSA-0507-166': { brand: 'SIR S.A.', model: 'S-5001', pollutant: 'SO₂' },
  'RFNA-1194-099': { brand: 'Teledyne API', model: '200E / T200 / N200 Series', pollutant: 'NOx' },
  'RFNA-0804-152': { brand: 'SIR S.A.', model: 'S-5012', pollutant: 'NOx' },
  'RFCA-0708-172': { brand: 'SIR S.A.', model: 'S-5006', pollutant: 'CO' },
  'RFCA-1093-093': { brand: 'Teledyne API', model: '300 Series', pollutant: 'CO' },
  'EQOA-0992-087': { brand: 'Teledyne API', model: '400 Series', pollutant: 'O₃' },
  'EQOA-0207-164': { brand: 'SIR S.A.', model: 'S-5014', pollutant: 'O₃' },
  'EQSA-0506-159': { brand: 'Horiba', model: 'APSA-370', pollutant: 'SO₂' },
  'EQOA-0506-160': { brand: 'Horiba', model: 'APOA-370', pollutant: 'O₃' },
  'RFCA-0506-158': { brand: 'Horiba', model: 'APMA-370', pollutant: 'CO' },
  'RFNA-0506-157': { brand: 'Horiba', model: 'APNA-370', pollutant: 'NOx' },
  'RFNA-1289-074': { brand: 'Thermo Environmental', model: '42i / 42iQ Series', pollutant: 'NOx' },
  'EQSA-0990-077': { brand: 'Advanced Pollution Instrumentation', model: '100', pollutant: 'SO₂' },
  'RFSA-1219-255': { brand: 'Focused Photonics Inc.', model: 'AQMS-500', pollutant: 'SO₂' },
  'EQOA-0719-253': { brand: 'Focused Photonics Inc.', model: 'AQMS-300 / 300M', pollutant: 'O₃' },
  'RFCA-0419-252': { brand: 'Focused Photonics Inc.', model: 'AQMS-400 / 400M', pollutant: 'CO' },
  'RFNA-0819-254': { brand: 'Focused Photonics Inc.', model: 'AQMS-600', pollutant: 'NOx' },
  'EQNA-0217-243': { brand: '2B Technologies', model: '405 nm', pollutant: 'NO₂' },
  'EQNA-0512-200': { brand: 'Teledyne API', model: '200EUP / T200UP', pollutant: 'NO₂' },
  'EQNA-1016-241': { brand: 'Teledyne API', model: 'T200P', pollutant: 'NO₂' },
  'EQNA-0514-212': { brand: 'Teledyne API', model: 'T500U', pollutant: 'NO₂' },
  'EQNA-0320-256': { brand: 'Teledyne API', model: 'N500', pollutant: 'NO₂' },
  'EQSA-0486-060': { brand: 'Thermo Scientific', model: '43i / 43iQ Series', pollutant: 'SO₂' },
  'EQOA-0880-047': { brand: 'Thermo Scientific', model: '49i / 49iQ Series', pollutant: 'O₃' },
  'RFCA-0981-054': { brand: 'Thermo Scientific', model: '48i / 48iQ Series', pollutant: 'CO' },
  'RFNA-0809-186': { brand: 'Ecotech / Acoem', model: 'Serinus 40 / 44', pollutant: 'NOx' },
  'EQSA-0809-188': { brand: 'Ecotech / Acoem', model: 'Serinus 50', pollutant: 'SO₂' },
  'EQOA-0809-187': { brand: 'Ecotech / Acoem', model: 'Serinus 10', pollutant: 'O₃' },
  'RFCA-0509-174': { brand: 'Ecotech / Acoem', model: 'Serinus 30', pollutant: 'CO' },
  'EQNA-0217-242': { brand: 'Ecotech / Acoem', model: 'Serinus 60', pollutant: 'NO₂' },
  'UNE-EN 16450': { brand: 'Grimm', model: 'EDM180', pollutant: 'Partículas' },
  'UNE EN 16450': { brand: 'Grimm', model: 'EDM180', pollutant: 'Partículas' },
  'EQPM-0121-258': { brand: 'Focused Photonics Inc.', model: 'BPM-200 PM10 Monitor', pollutant: 'Partículas' },
  'RFSA-0616-237': { brand: 'Thermo Scientific', model: '43i-TLE SO2 Analyzer', pollutant: 'SO₂' },
  'RFSA-1120-257': { brand: 'KENTEK Inc.', model: 'MEZUS 110 SO2 Analyzer', pollutant: 'SO₂' },
  'EQPM-0923-262': { brand: 'Vasthi Instruments', model: 'PM Monitor', pollutant: 'Partículas' },
  'EQOA-0219-251': { brand: 'KENTEK Inc.', model: 'MEZUS 410 O3 Analyzer', pollutant: 'O₃' },
  'RFNA-1221-259': { brand: 'KENTEK Inc.', model: 'MEZUS 210 NO₂ Analyzer', pollutant: 'NO₂' },
  'RFCA-0317-244': { brand: 'KENTEK Inc.', model: 'MEZUS 310 CO Analyzer', pollutant: 'CO' },
  'EQOA-0415-222': { brand: 'Sabio', model: '6030 Ozone Analyzer', pollutant: 'O₃' },
  'RFCA-0817-248': { brand: 'Sabio', model: '6050 CO Analyzer', pollutant: 'CO' },
  'EQPM-1013-209': { brand: 'Met One Instruments, Inc.', model: 'BAM-1022', pollutant: 'Partículas' },
  'EQPM-0715-266': { brand: 'Met One Instruments, Inc.', model: 'BAM-1022', pollutant: 'Partículas' },
};

export function extractEquipment(metodo: string): EquipoIdentificado | null {
  if (!metodo) return null;
  // De más largo a más corto: evita que un código que es prefijo de otro gane el match.
  const codes = Object.keys(EQUIPMENT_MAP).sort((a, b) => b.length - a.length);
  for (const code of codes) {
    if (metodo.includes(code)) return { code, ...EQUIPMENT_MAP[code] };
  }
  return null;
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'es');

export function listBrands(): string[] {
  return [...new Set(Object.values(EQUIPMENT_MAP).map((equipo) => equipo.brand))].sort(compare);
}

export function listModels(brand: string): string[] {
  const modelos = Object.values(EQUIPMENT_MAP)
    .filter((equipo) => equipo.brand === brand)
    .map((equipo) => equipo.model);
  return [...new Set(modelos)].sort(compare);
}
