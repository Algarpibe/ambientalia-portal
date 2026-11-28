// La regla de marcas que comparten la «Base instalada de aire» y el «Análisis de
// Marcas». Vive aquí, sin importar equipment.ts ni baseInstalada.ts, para que
// ambos puedan usarla sin un ciclo de importaciones.

// En EQUIPMENT_MAP, « / » significa dos cosas: fabricantes distintos de una misma
// designación («Tisch Environmental / New Star Environmental»), que son dos
// opciones; o una misma empresa con nombre viejo y nuevo («Environnement S.A. /
// ENVEA»), que es una sola. Como el texto no distingue una cosa de la otra, esta
// lista dice qué fabricantes son la misma empresa. La opción de un grupo es sus
// nombres unidos con « / », en este orden.
export const GRUPOS_DE_EMPRESA: string[][] = [
  ['Environnement S.A.', 'ENVEA'],
  ['BGI Inc.', 'Mesa Laboratories Inc.'],
  ['Ecotech', 'Acoem'],
  ['Graseby Andersen', 'Sierra-Andersen', 'General Metal Works'],
];

const ETIQUETA_DE_FABRICANTE = new Map<string, string>(
  GRUPOS_DE_EMPRESA.flatMap((grupo) => grupo.map((fabricante) => [fabricante, grupo.join(' / ')] as const)),
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
