// Catálogo de equipos de calidad del aire acreditados, portado del prototipo.
// La clave es el código de designación (US EPA / UNE-EN) que aparece embebido en
// el texto libre del campo «método» del dataset.
//
// Fuente de los códigos EPA: la «List of Designated Reference and Equivalent
// Methods» de la EPA, emitida el 28 de julio de 2026:
// https://www.epa.gov/system/files/documents/2026-07/amtic-list-july-2026_508-compliant.pdf
// Marca, modelo y contaminante salen del texto de cada designación. Si un código
// cubre varios fabricantes o modelos, van unidos con « / » («Ecotech / Acoem»),
// también cuando una empresa cambió de nombre («Environnement S.A. / ENVEA»).
// PM10, PM2.5 y PM10-2.5 son «Partículas», como en el catálogo original.
// El 2026-11-27 se corrigieron nueve entradas del prototipo que no cuadraban con
// la lista: marca o modelo de otro código, un modelo genérico («PM Monitor») o
// sin el -380 de Horiba.
// Horiba APDA-371, Spirant BAM1000/BAM1100 (Ecotech/Acoem) y Sibata GBAM son el
// Met One BAM con otro nombre: marcas blancas, como las que la tabla deja fuera
// a propósito. En Colombia son Met One, así que no van en la marca.
export type Equipo = { brand: string; model: string; pollutant: string };
export type EquipoIdentificado = Equipo & { code: string };

export const EQUIPMENT_MAP: Record<string, Equipo> = {
  'EQPM-0798-122': { brand: 'Met One Instruments, Inc.', model: 'BAM 1020 / BAM 1020-1', pollutant: 'Partículas' },
  'EQPM-0308-170': { brand: 'Met One Instruments, Inc.', model: 'BAM-1020', pollutant: 'Partículas' },
  'EQSA-0495-100': { brand: 'Teledyne API', model: '100 Series', pollutant: 'SO₂' },
  'EQSA-0507-166': { brand: 'SIR S.A.', model: 'S-5001', pollutant: 'SO₂' },
  'RFNA-1194-099': { brand: 'Teledyne API', model: '200E / T200 / N200 Series', pollutant: 'NOx' },
  'RFNA-0804-152': { brand: 'SIR S.A.', model: 'S-5012', pollutant: 'NOx' },
  'RFCA-0708-172': { brand: 'SIR S.A.', model: 'S-5006', pollutant: 'CO' },
  'RFCA-1093-093': { brand: 'Teledyne API', model: '300 Series', pollutant: 'CO' },
  'EQOA-0992-087': { brand: 'Teledyne API', model: '400 Series', pollutant: 'O₃' },
  'EQOA-0207-164': { brand: 'SIR S.A.', model: 'S-5014', pollutant: 'O₃' },
  'EQSA-0506-159': { brand: 'Horiba', model: 'APSA-370 / 380', pollutant: 'SO₂' },
  'EQOA-0506-160': { brand: 'Horiba', model: 'APOA-370 / 380', pollutant: 'O₃' },
  'RFCA-0506-158': { brand: 'Horiba', model: 'APMA-370 / 380', pollutant: 'CO' },
  'RFNA-0506-157': { brand: 'Horiba', model: 'APNA-370 / 380', pollutant: 'NOx' },
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
  'RFSA-0616-237': { brand: 'Sutron / Sabio', model: '6020 SO2 Analyzer', pollutant: 'SO₂' },
  'RFSA-1120-257': { brand: 'KENTEK Inc.', model: 'MEZUS 110 SO2 Analyzer', pollutant: 'SO₂' },
  'EQPM-0923-262': { brand: 'Vasthi Instruments', model: 'Vair-9009', pollutant: 'Partículas' },
  'EQOA-0219-251': { brand: 'KENTEK Inc.', model: 'MEZUS 410 O3 Analyzer', pollutant: 'O₃' },
  'RFNA-1221-259': { brand: 'KENTEK Inc.', model: 'MEZUS 210 NO₂ Analyzer', pollutant: 'NO₂' },
  'RFCA-0317-244': { brand: 'KENTEK Inc.', model: 'MEZUS 310 CO Analyzer', pollutant: 'CO' },
  'EQOA-0415-222': { brand: 'Sabio', model: '6030 Ozone Analyzer', pollutant: 'O₃' },
  'RFCA-0817-248': { brand: 'Sabio', model: '6050 CO Analyzer', pollutant: 'CO' },
  'EQPM-1013-209': { brand: 'Met One Instruments, Inc.', model: 'BAM-1022', pollutant: 'Partículas' },
  'EQPM-0715-266': { brand: 'Met One Instruments, Inc.', model: 'BAM-1020', pollutant: 'Partículas' },
  // Añadidos el 2026-11-27: los 36 códigos que cita el dataset de aire y faltaban.
  'EQOA-0193-091': {
    brand: 'Teledyne Monitor Labs / Casella / Ecotech / Acoem / Aeris / Wedding & Associates',
    model: 'ML9810 / CM2010 / EC9810 / AE2010 / AE9810 (los cinco también en -11 y -12) / ML9810B / CM2010B / EC9810B / 1010',
    pollutant: 'O₃',
  },
  'EQOA-0206-148': { brand: 'Environnement S.A. / ENVEA', model: 'O3 42M', pollutant: 'O₃' },
  'EQOA-0410-190': { brand: '2B Technologies', model: '202 / 205', pollutant: 'O₃' },
  'EQOA-0515-225': { brand: 'Environnement S.A. / ENVEA', model: 'O3 42e', pollutant: 'O₃' },
  'EQPM-0311-195': { brand: 'Grimm', model: 'EDM180', pollutant: 'Partículas' },
  'EQPM-0325-269': { brand: 'Focused Photonics Inc.', model: 'BPM-200 PM2.5 Monitor', pollutant: 'Partículas' },
  'EQPM-0404-151': { brand: 'Environnement S.A. / ENVEA', model: 'MP101M', pollutant: 'Partículas' },
  'EQPM-0516-238': { brand: 'Teledyne API', model: 'T640 (640X)', pollutant: 'Partículas' },
  'EQPM-0516-239': { brand: 'Teledyne API', model: 'T640 (640X)', pollutant: 'Partículas' },
  'EQPM-0609-183': { brand: 'Thermo Scientific', model: '5014i / 5014iQ / 5028i / FH62C14-DHS', pollutant: 'Partículas' },
  'EQPM-1013-211': { brand: 'Environnement S.A. / ENVEA', model: 'MP101M', pollutant: 'Partículas' },
  'EQPM-1102-150': {
    brand: 'Thermo Andersen / Thermo Scientific',
    model: 'FH 62 C14 / 5014i / 5014iQ / 5028i',
    pollutant: 'Partículas',
  },
  'EQPS-0311-197': { brand: 'Thermo Scientific', model: 'Partisol 2000-D / 2000i-D', pollutant: 'Partículas' },
  'EQPS-0509-177': { brand: 'Thermo Scientific', model: 'Partisol 2000-D / 2000i-D', pollutant: 'Partículas' },
  'EQSA-0193-092': {
    brand: 'Teledyne Monitor Labs / Casella / Ecotech / Acoem / Aeris / Wedding & Associates',
    model: 'ML9850 / CM2050 / EC9850 / EC9850T / AE9850 / AE2050 / ML9850B / CM2050B / EC9850B / 1040',
    pollutant: 'SO₂',
  },
  'EQSA-0802-149': { brand: 'Environnement S.A. / ENVEA', model: 'AF22M / AF22e', pollutant: 'SO₂' },
  'RFCA-0206-147': { brand: 'Environnement S.A. / ENVEA', model: 'CO12M', pollutant: 'CO' },
  'RFCA-0915-228': { brand: 'Environnement S.A. / ENVEA', model: 'CO12e', pollutant: 'CO' },
  'RFNA-0118-249': { brand: 'Environnement S.A. / ENVEA', model: 'AC32e / AC32e*', pollutant: 'NOx' },
  'RFNA-0202-146': { brand: 'Environnement S.A. / ENVEA', model: 'AC32M', pollutant: 'NOx' },
  'RFNA-0418-250': { brand: 'Sabio', model: '6040 NOx Analyzer', pollutant: 'NOx' },
  'RFPS-0202-141': {
    brand: 'Tisch Environmental / New Star Environmental',
    model: 'TE-6070 / NS-6070',
    pollutant: 'Partículas',
  },
  'RFPS-0216-231': {
    brand: 'Met One Instruments, Inc.',
    model: 'E-FRM-PM10 / E-FRM-DC-PM10',
    pollutant: 'Partículas',
  },
  'RFPS-0315-221': {
    brand: 'Met One Instruments, Inc.',
    model: 'E-FRM-PM2.5 / E-FRM-DC-PM2.5',
    pollutant: 'Partículas',
  },
  'RFPS-0498-116': { brand: 'BGI Inc. / Mesa Laboratories Inc.', model: 'PQ200 / PQ200A', pollutant: 'Partículas' },
  'RFPS-0498-117': {
    brand: 'Thermo Scientific / Rupprecht & Patashnick',
    model: 'Partisol 2000-FRM / 2000i PM2.5',
    pollutant: 'Partículas',
  },
  'RFPS-0498-118': {
    brand: 'Thermo Scientific / Rupprecht & Patashnick',
    model: 'Partisol-Plus 2025 / 2025i PM2.5',
    pollutant: 'Partículas',
  },
  'RFPS-0694-098': { brand: 'Thermo Scientific / Rupprecht & Patashnick', model: 'Partisol 2000', pollutant: 'Partículas' },
  'RFPS-0714-216': { brand: 'Tisch Environmental', model: 'TE-Wilbur10', pollutant: 'Partículas' },
  'RFPS-1014-219': { brand: 'Tisch Environmental', model: 'TE-Wilbur2.5', pollutant: 'Partículas' },
  'RFPS-1087-062': { brand: 'Wedding & Associates / Thermo Environmental', model: '600', pollutant: 'Partículas' },
  'RFPS-1287-063': {
    brand: 'Graseby Andersen / Sierra-Andersen / General Metal Works',
    model: '1200',
    pollutant: 'Partículas',
  },
  'RFPS-1298-124': { brand: 'BGI Inc. / Mesa Laboratories Inc.', model: 'PQ100', pollutant: 'Partículas' },
  'RFPS-1298-125': { brand: 'BGI Inc. / Mesa Laboratories Inc.', model: 'PQ200', pollutant: 'Partículas' },
  'RFPS-1298-126': {
    brand: 'Thermo Scientific / Rupprecht & Patashnick',
    model: 'Partisol 2000-FRM / 2000i PM10',
    pollutant: 'Partículas',
  },
  'RFPS-1298-127': {
    brand: 'Thermo Scientific / Rupprecht & Patashnick',
    model: 'Partisol-Plus 2025 / 2025i PM10',
    pollutant: 'Partículas',
  },
};

// De más largo a más corto: evita que un código que es prefijo de otro gane el
// match. Se ordena una sola vez: extractEquipment corre por cada registro.
const CODES_BY_LENGTH = Object.keys(EQUIPMENT_MAP).sort((a, b) => b.length - a.length);

export function extractEquipment(metodo: string): EquipoIdentificado | null {
  if (!metodo) return null;
  for (const code of CODES_BY_LENGTH) {
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
