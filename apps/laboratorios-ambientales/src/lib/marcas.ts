// La regla de marcas que comparten la «Base instalada de aire» y el «Análisis de
// Marcas». Vive aquí, sin importar equipment.ts ni baseInstalada.ts, para que
// ambos puedan usarla sin un ciclo de importaciones.

// En EQUIPMENT_MAP, « / » significa dos cosas: fabricantes distintos de una misma
// designación («Tisch Environmental / New Star Environmental»), que son dos
// opciones; o una misma empresa con nombre viejo y nuevo («Environnement S.A. /
// ENVEA»), que es una sola. Como el texto no distingue una cosa de la otra, esta
// lista dice qué nombres son la misma empresa: un grupo es una empresa con varios
// nombres, y su opción muestra la `etiqueta` (no los nombres unidos, salvo que
// la etiqueta los una a propósito).
type GrupoDeEmpresa = { readonly etiqueta: string; readonly nombres: readonly string[] };

const GRUPOS_DE_EMPRESA: readonly GrupoDeEmpresa[] = [
  { etiqueta: 'Environnement S.A. / ENVEA', nombres: ['Environnement S.A.', 'ENVEA'] },
  { etiqueta: 'BGI Inc. / Mesa Laboratories Inc.', nombres: ['BGI Inc.', 'Mesa Laboratories Inc.'] },
  { etiqueta: 'Ecotech / Acoem', nombres: ['Ecotech', 'Acoem'] },
  {
    etiqueta: 'Graseby Andersen / Sierra-Andersen / General Metal Works',
    nombres: ['Graseby Andersen', 'Sierra-Andersen', 'General Metal Works'],
  },
  // Una sola marca para el usuario: Thermo Scientific absorbió a las demás.
  {
    etiqueta: 'Thermo Scientific',
    nombres: ['Thermo Scientific', 'Thermo Environmental', 'Thermo Andersen', 'Rupprecht & Patashnick'],
  },
  // Advanced Pollution Instrumentation es el nombre antiguo de Teledyne API;
  // Teledyne Monitor Labs es otra empresa y queda aparte.
  { etiqueta: 'Teledyne API', nombres: ['Teledyne API', 'Advanced Pollution Instrumentation'] },
];

const ETIQUETA_DE_FABRICANTE: ReadonlyMap<string, string> = new Map(
  GRUPOS_DE_EMPRESA.flatMap((grupo) => grupo.nombres.map((nombre) => [nombre, grupo.etiqueta] as const)),
);

// Las marcas de un texto de marca: cada fabricante, y las empresas con varios
// nombres (GRUPOS_DE_EMPRESA) juntas, sin repetir.
export function marcasDe(marca: string): string[] {
  const partes = marca
    .split(' / ')
    .map((parte) => parte.trim())
    .filter(Boolean);
  return [...new Set(partes.map((parte) => ETIQUETA_DE_FABRICANTE.get(parte) ?? parte))];
}
