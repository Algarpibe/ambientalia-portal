import type { FilterState, Laboratorio } from '../types';
import { EMPTY_FILTERS } from '../types';

// La cascada del prototipo vanilla: matriz -> componente -> actividad ->
// variable -> metodo. Cada filtro solo ofrece lo que existe dentro de lo ya
// elegido aguas ARRIBA; nunca se acota por sí mismo (si no, al elegir un valor
// el desplegable quedaría con esa única opción) ni por los de abajo.
export type CascadeField = 'componente' | 'actividad' | 'variable' | 'metodo';

// Los filtros que pueden invalidar a los de aguas abajo al cambiar. 'metodo' es
// el último de la cascada: no tiene nada debajo, así que no entra aquí.
export type ChangedField = 'matriz' | 'componente' | 'actividad' | 'variable';

const CASCADE: readonly ChangedField[] = ['matriz', 'componente', 'actividad', 'variable'];

const compare = (a: string, b: string): number => a.localeCompare(b, 'es');

// Clave de agrupación de 'variable'. El dataset trae 994 grafías crudas que son
// 888 variables reales: 98 grupos difieren solo en mayúsculas ('Plomo'/'plomo')
// y 3 solo en espacios internos ('Coliformes Termotolerantes  (fecales)'). Van
// juntos aquí, y no en mapRecord, porque el title-case de normalize.ts rompería
// la nomenclatura técnica (pH -> Ph, DQO -> Dqo, n-Decano -> N-Decano).
// El colapso de \s+ replica el que normalize.ts ya hace por el mismo motivo.
// applyFilters y optionsFor DEBEN usar esta misma clave: si difirieran, elegir
// la opción canónica dejaría fuera los registros de las demás grafías.
const variableKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

export function applyFilters(data: Laboratorio[], filters: FilterState): Laboratorio[] {
  const busqueda = filters.busqueda.trim().toLowerCase();
  const variables = filters.variables.map(variableKey);

  return data.filter((registro) => {
    if (busqueda) {
      const enNombre = registro.nombreLaboratorio.toLowerCase().includes(busqueda);
      const enVariable = registro.variable.toLowerCase().includes(busqueda);
      if (!enNombre && !enVariable) return false;
    }
    if (filters.estado && registro.estado !== filters.estado) return false;
    // Estos campos ya los canoniza normalize.ts al mapear: igualdad exacta basta.
    if (filters.matriz && registro.matriz !== filters.matriz) return false;
    if (filters.componente && registro.componente !== filters.componente) return false;
    if (filters.actividad && registro.actividad !== filters.actividad) return false;
    if (variables.length > 0 && !variables.includes(variableKey(registro.variable))) return false;
    if (filters.metodo && registro.metodo !== filters.metodo) return false;
    return true;
  });
}

// El recorte con el que se calculan las opciones de `field`: solo lo que tiene
// aguas arriba, más `estado`. `estado` no está en la cascada pero sí acota (un
// componente que solo existe en registros suspendidos no debe ofrecerse si se
// filtra por Activa). `busqueda` NO acota: es un texto libre y volatilizaría los
// desplegables mientras se teclea.
function scopeFor(field: CascadeField, filters: FilterState): FilterState {
  return {
    ...EMPTY_FILTERS,
    estado: filters.estado,
    matriz: filters.matriz,
    componente: field === 'componente' ? '' : filters.componente,
    actividad: field === 'componente' || field === 'actividad' ? '' : filters.actividad,
    // 'metodo' es el único aguas abajo del multiselect de variables.
    variables: field === 'metodo' ? filters.variables : [],
  };
}

export function optionsFor(data: Laboratorio[], field: CascadeField, filters: FilterState): string[] {
  const valores = applyFilters(data, scopeFor(field, filters))
    .map((registro) => registro[field].trim())
    .filter((valor) => valor !== '');

  if (field === 'variable') return canonicalVariables(valores);
  return [...new Set(valores)].sort(compare);
}

// Un grupo por variableKey, y de cada grupo se ofrece la grafía más frecuente
// tal cual viene (así 'pH' sigue siendo 'pH'). Desempate por localeCompare para
// que el resultado no dependa del orden de llegada de los registros.
function canonicalVariables(valores: string[]): string[] {
  const grupos = new Map<string, Map<string, number>>();
  for (const valor of valores) {
    const clave = variableKey(valor);
    let grafias = grupos.get(clave);
    if (!grafias) {
      grafias = new Map<string, number>();
      grupos.set(clave, grafias);
    }
    grafias.set(valor, (grafias.get(valor) ?? 0) + 1);
  }

  const canonicas: string[] = [];
  for (const grafias of grupos.values()) {
    let mejor = '';
    let mejorFrecuencia = -1;
    for (const [grafia, frecuencia] of grafias) {
      if (frecuencia > mejorFrecuencia || (frecuencia === mejorFrecuencia && compare(grafia, mejor) < 0)) {
        mejor = grafia;
        mejorFrecuencia = frecuencia;
      }
    }
    canonicas.push(mejor);
  }
  return canonicas.sort(compare);
}

// Al cambiar un filtro hay que limpiar los de aguas abajo: su valor pudo dejar
// de existir dentro del nuevo recorte. `busqueda` y `estado` quedan fuera de la
// cascada y nunca se tocan.
export function clearDownstream(filters: FilterState, changed: ChangedField): FilterState {
  const posicion = CASCADE.indexOf(changed);
  return {
    ...filters,
    componente: posicion < CASCADE.indexOf('componente') ? '' : filters.componente,
    actividad: posicion < CASCADE.indexOf('actividad') ? '' : filters.actividad,
    variables: posicion < CASCADE.indexOf('variable') ? [] : filters.variables,
    // 'metodo' cierra la cascada: cualquier cambio aguas arriba lo invalida.
    metodo: '',
  };
}
