import type { Laboratorio } from '../types';
import type { EquipoIdentificado } from './equipment';
import { extractEquipment } from './equipment';

export type EquipoDeLab = EquipoIdentificado & { metodo: string };

export type LabConEquipos = {
  nombreLaboratorio: string;
  ciudad: string;
  contacto: string;
  correo: string;
  telefono: string;
  equipos: EquipoDeLab[];
};

// El ámbito del Análisis de Marcas es fijo: solo en las acreditaciones activas de
// calidad del aire el campo 'metodo' cita códigos de designación de equipo.
// 'Calidad del Aire' es el literal canónico que produce normalizeComponente: el
// dataset trae 'Calidad del Aire' (1302) y 'Calidad de aire' (15), y ahí se
// unifican. Cualquier otra grafía aquí dejaría la vista casi vacía.
const esCalidadDelAire = (registro: Laboratorio): boolean =>
  registro.estado === 'Activa' && registro.matriz === 'Aire' && registro.componente === 'Calidad del Aire';

export function groupLabsByEquipment(data: Laboratorio[], brand: string, model: string): LabConEquipos[] {
  const labs = new Map<string, LabConEquipos>();
  // Un mismo equipo aparece en varias filas, una por variable acreditada: el
  // método ya visto dentro de un laboratorio no se vuelve a añadir.
  const metodosVistos = new Map<string, Set<string>>();

  for (const registro of data) {
    if (!esCalidadDelAire(registro)) continue;
    if (!registro.nombreLaboratorio) continue;

    const equipo = extractEquipment(registro.metodo);
    if (!equipo) continue;
    // brand/model vacíos = sin filtrar.
    if (brand && equipo.brand !== brand) continue;
    if (model && equipo.model !== model) continue;

    const clave = registro.nombreLaboratorio;
    let lab = labs.get(clave);
    if (!lab) {
      lab = {
        nombreLaboratorio: registro.nombreLaboratorio,
        ciudad: registro.ciudad,
        contacto: registro.contacto,
        correo: registro.correo,
        telefono: registro.telefono,
        equipos: [],
      };
      labs.set(clave, lab);
      metodosVistos.set(clave, new Set<string>());
    }

    const vistos = metodosVistos.get(clave)!;
    if (vistos.has(registro.metodo)) continue;
    vistos.add(registro.metodo);
    lab.equipos.push({ ...equipo, metodo: registro.metodo });
  }

  // Los laboratorios que se quedan sin equipos tras filtrar ni siquiera llegan a
  // crearse: el filtro va antes del alta. Solo queda ordenar.
  return [...labs.values()].sort((a, b) => a.nombreLaboratorio.localeCompare(b.nombreLaboratorio, 'es'));
}
