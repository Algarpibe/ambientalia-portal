// Base instalada de aire: un equipo por código de laboratorio + número de serie,
// sacado del dataset 2waz-acaa. Ver
// docs/superpowers/specs/2026-11-27-base-instalada-aire-design.md.
import type { Laboratorio } from '../types';
import type { CruceZoho, EstadoCliente } from './clientes';
import { filtrarPorCliente } from './clientes';
import { extractEquipment } from './equipment';
import { fechaDeHasta } from './fechas';
import { marcasDe } from './marcas';
import { clave, distintos, nitCoincide } from './prospects';

// Los rellenos que el dataset escribe cuando no hay dato.
const RELLENOS = new Set(['no aplica', 'n/a', 'na']);

/**
 * ¿Es un valor vacío? Tras recortarlo: en blanco, solo guiones, o «No aplica»,
 * «N/A» o «NA» sin distinguir mayúsculas. Lo usan mapRecord (para no guardar
 * estacion ni serie vacías) y la agrupación de equipos.
 */
export function esValorVacio(texto: string): boolean {
  const limpio = texto.trim().toLowerCase().replace(/\s+/g, ' ');
  return limpio === '' || /^[-–—]+$/.test(limpio) || RELLENOS.has(limpio);
}

// Separadores de series: coma, punto y coma y salto de línea; y también un
// guion, raya o «/» con un espacio al menos en un lado.
const SEPARADOR_DE_SERIES = /[,;\r\n]|\s[-–—/]|[-–—/]\s/;

/**
 * Las series de un campo de equipo: una fila puede listar varias (una red con
 * 30 muestreadores). Se parte por comas, puntos y comas y saltos de línea, y por
 * un guion, raya (–, —) o «/» con espacio en al menos un lado («1001 - 1002»,
 * «2001 -2002»). Un guion o «/» pegado por los dos lados es parte de la serie
 * («XY-12345-678/2»); tampoco se parte por los espacios solos. Los trozos se
 * recortan y los vacíos (según esValorVacio) se descartan.
 */
export function separarSeries(campo: string): string[] {
  return campo
    .split(SEPARADOR_DE_SERIES)
    .map((trozo) => trozo.trim())
    .filter((trozo) => !esValorVacio(trozo));
}

// Los dos componentes del aire que traen equipos con número de serie: los
// literales que da normalizeComponente para cualquier grafía del dataset.
const COMPONENTES_CON_EQUIPOS = new Set(['Calidad del Aire', 'Olores Ofensivos']);

export const SIN_ESTACION = 'Sin estación';
export const SIN_IDENTIFICAR = 'Sin identificar';

export type MarcaModelo = { marca: string; modelo: string };

// Un equipo: la pareja código de laboratorio + serie, con todas sus filas.
export type EquipoInstalado = {
  // La clave del agrupado (laboratorio + serie en mayúsculas): única por equipo
  // y estable. Sirve de key en la tabla; `codigo` puede salir vacío aunque el
  // dato crudo no lo fuera.
  id: string;
  codigo: string;
  laboratorio: string;
  nit: string;
  ciudad: string;
  departamento: string;
  contacto: string;
  telefono: string;
  correo: string;
  // Tal como aparece la primera vez.
  serie: string;
  // Distintas y ordenadas; vacía = «Sin estación».
  estaciones: string[];
  // Los pares distintos que reconoce extractEquipment, ordenados; vacía = «Sin identificar».
  marcasYModelos: MarcaModelo[];
  // Los códigos EPA distintos que citan sus métodos, reconocidos o no, ordenados.
  codigosEpa: string[];
  // Distintas y ordenadas.
  variables: string[];
  // AAAA-MM-DD, o null si ninguna fila trae una fecha válida.
  vigenciaMasProxima: string | null;
};

export function esRegistroDeEquipoAire(
  registro: Pick<Laboratorio, 'estado' | 'matriz' | 'componente' | 'serie'>,
): boolean {
  return (
    registro.estado === 'Activa' &&
    registro.matriz === 'Aire' &&
    COMPONENTES_CON_EQUIPOS.has(registro.componente) &&
    separarSeries(registro.serie ?? '').length > 0
  );
}

// Un código de designación EPA: casi siempre «RFPS-0202-141», a veces con
// espacios en vez de guiones («EQPM 0311-195», «RFPS- 0202-141»). Sin \b al
// final a propósito: el dataset escribe una vez «RFNA-1289-0704», que así cuenta
// como RFNA-1289-070, un código que no está en la lista de la EPA.
const CODIGO_EPA = /\b(RF|EQ)([A-Z]{2})[\s-]*(\d{4})[\s-]*(\d{3})/g;

// El método con sus códigos EPA escritos con guiones: extractEquipment busca el
// código como subcadena y, si no, no reconocería «EQPM 0311-195».
export function normalizarCodigosEpa(metodo: string): string {
  return metodo.replace(CODIGO_EPA, '$1$2-$3-$4');
}

// Los códigos EPA que cita un método, con guiones y sin repetir.
export function codigosEpa(metodo: string): string[] {
  return [...new Set(normalizarCodigosEpa(metodo).match(CODIGO_EPA) ?? [])];
}

const compararTexto = (a: string, b: string): number => a.localeCompare(b, 'es');

// Sin código de laboratorio, por nombre, como en Prospectos. Los prefijos
// impiden que un nombre choque con un código.
function idLaboratorio(codigo: string, nombre: string): string {
  return codigo ? `codigo:${codigo}` : `nombre:${nombre}`;
}

// Los datos de la ficha que salen de la primera fila con valor.
type CampoDeFicha = 'codigo' | 'nombreLaboratorio' | 'nit' | 'ciudad' | 'departamento' | 'contacto' | 'telefono' | 'correo';

function aEquipo(id: string, filas: Laboratorio[], serie: string): EquipoInstalado {
  // El primer valor no vacío en el orden del dataset, como en Prospectos, pero
  // con esValorVacio: un «No aplica» en una fila no tapa el dato de otra.
  const primero = (campo: CampoDeFicha): string => {
    for (const fila of filas) {
      const valor = fila[campo].trim();
      if (!esValorVacio(valor)) return valor;
    }
    return '';
  };

  const pares = new Map<string, MarcaModelo>();
  const codigos = new Set<string>();
  for (const fila of filas) {
    const identificado = extractEquipment(normalizarCodigosEpa(fila.metodo));
    if (identificado) {
      pares.set(`${identificado.brand}\n${identificado.model}`, {
        marca: identificado.brand,
        modelo: identificado.model,
      });
    }
    for (const codigo of codigosEpa(fila.metodo)) codigos.add(codigo);
  }

  // AAAA-MM-DD se ordena bien como texto: tras el sort, la primera es la más temprana.
  const fechas = filas
    .map((fila) => fechaDeHasta(fila.hasta))
    .filter((fecha): fecha is string => fecha !== null)
    .sort();

  return {
    id,
    codigo: primero('codigo'),
    laboratorio: primero('nombreLaboratorio'),
    nit: primero('nit'),
    ciudad: primero('ciudad'),
    departamento: primero('departamento'),
    contacto: primero('contacto'),
    telefono: primero('telefono'),
    correo: primero('correo'),
    serie,
    estaciones: distintos(filas.map((fila) => fila.estacion ?? '')),
    marcasYModelos: [...pares.values()].sort(
      (a, b) => compararTexto(a.marca, b.marca) || compararTexto(a.modelo, b.modelo),
    ),
    codigosEpa: [...codigos].sort(),
    variables: distintos(filas.map((fila) => fila.variable)),
    vigenciaMasProxima: fechas[0] ?? null,
  };
}

/**
 * Un equipo por pareja código de laboratorio + serie (la serie, en mayúsculas
 * para comparar). Solo entran los registros de esRegistroDeEquipoAire. El Map
 * conserva el orden del dataset: el de la pantalla lo pone ordenarEquipos.
 */
export function agruparEquipos(data: Laboratorio[]): EquipoInstalado[] {
  const grupos = new Map<string, { filas: Laboratorio[]; serie: string }>();
  for (const registro of data) {
    if (!esRegistroDeEquipoAire(registro)) continue;
    const laboratorio = idLaboratorio(registro.codigo.trim(), registro.nombreLaboratorio.trim());
    for (const serie of separarSeries(registro.serie ?? '')) {
      // Un salto de línea nunca va dentro de una serie: separarSeries parte por él.
      const id = `${laboratorio}\n${serie.toUpperCase()}`;
      const grupo = grupos.get(id);
      if (grupo) grupo.filas.push(registro);
      else grupos.set(id, { filas: [registro], serie });
    }
  }
  return [...grupos].map(([id, { filas, serie }]) => aEquipo(id, filas, serie));
}

// «Sin estación» va al final de su laboratorio.
function compararEstacion(a: EquipoInstalado, b: EquipoInstalado): number {
  const sinA = a.estaciones.length === 0;
  const sinB = b.estaciones.length === 0;
  if (sinA || sinB) return Number(sinA) - Number(sinB);
  return compararTexto(a.estaciones[0], b.estaciones[0]);
}

/** Por departamento, ciudad, laboratorio, código, estación y serie. Devuelve una lista nueva. */
export function ordenarEquipos(equipos: EquipoInstalado[]): EquipoInstalado[] {
  return [...equipos].sort(
    (a, b) =>
      compararTexto(a.departamento, b.departamento) ||
      compararTexto(a.ciudad, b.ciudad) ||
      compararTexto(a.laboratorio, b.laboratorio) ||
      compararTexto(a.codigo, b.codigo) ||
      compararEstacion(a, b) ||
      compararTexto(a.serie, b.serie),
  );
}

export type FiltrosEquipos = {
  busqueda: string;
  // '' = todos los departamentos.
  departamento: string;
  // '' = todas las ciudades.
  ciudad: string;
  // '' = todas; SIN_IDENTIFICAR = los que no tienen marca.
  marca: string;
  // '' = todos.
  cliente: EstadoCliente | '';
};

export const FILTROS_VACIOS: FiltrosEquipos = { busqueda: '', departamento: '', ciudad: '', marca: '', cliente: '' };

export type OpcionesDeFiltro = { departamentos: string[]; ciudades: string[]; marcas: string[] };

function tieneMarca(equipo: EquipoInstalado, marca: string): boolean {
  if (marca === SIN_IDENTIFICAR) return equipo.marcasYModelos.length === 0;
  return equipo.marcasYModelos.some((par) => marcasDe(par.marca).includes(marca));
}

// `busqueda` ya pasó por clave: la misma normalización que en Prospectos.
function coincideBusqueda(equipo: EquipoInstalado, busqueda: string): boolean {
  return (
    clave(equipo.laboratorio).includes(busqueda) ||
    nitCoincide(equipo.nit, busqueda) ||
    equipo.estaciones.some((estacion) => clave(estacion).includes(busqueda)) ||
    clave(equipo.serie).includes(busqueda)
  );
}

/**
 * Los filtros se suman y se conserva el orden recibido. Sin cruce (consultando
 * o con error), el de cliente no cuenta. `hoy` va en AAAA-MM-DD: lo necesita
 * estadoCliente para saber si un cliente es activo.
 */
export function filtrarEquipos(
  equipos: EquipoInstalado[],
  filtros: FiltrosEquipos,
  cruce: CruceZoho | null,
  hoy: string,
): EquipoInstalado[] {
  const busqueda = clave(filtros.busqueda);
  const filtrados = equipos.filter((equipo) => {
    if (filtros.departamento && equipo.departamento !== filtros.departamento) return false;
    if (filtros.ciudad && equipo.ciudad !== filtros.ciudad) return false;
    if (filtros.marca && !tieneMarca(equipo, filtros.marca)) return false;
    return busqueda === '' || coincideBusqueda(equipo, busqueda);
  });
  return filtrarPorCliente(filtrados, filtros.cliente, cruce, hoy);
}

/**
 * Las opciones de los desplegables, de todos los equipos y no de los filtrados:
 * así lo elegido no desaparece de su lista. Las ciudades, solo las del
 * departamento elegido. Las marcas, cada fabricante por separado (marcasDe), y
 * «Sin identificar» al final si hay algún equipo así.
 */
export function opcionesDeFiltro(equipos: EquipoInstalado[], departamento: string): OpcionesDeFiltro {
  const delDepartamento = departamento ? equipos.filter((equipo) => equipo.departamento === departamento) : equipos;
  const marcas = distintos(equipos.flatMap((equipo) => equipo.marcasYModelos.flatMap((par) => marcasDe(par.marca))));
  const haySinIdentificar = equipos.some((equipo) => equipo.marcasYModelos.length === 0);
  return {
    departamentos: distintos(equipos.map((equipo) => equipo.departamento)),
    ciudades: distintos(delDepartamento.map((equipo) => equipo.ciudad)),
    marcas: haySinIdentificar ? [...marcas, SIN_IDENTIFICAR] : marcas,
  };
}

/** «N equipos de M laboratorios», con los laboratorios contados por código. */
export function textoRecuento(equipos: EquipoInstalado[]): string {
  const laboratorios = new Set(equipos.map((equipo) => idLaboratorio(equipo.codigo, equipo.laboratorio))).size;
  const cifra = (n: number): string => n.toLocaleString('es-CO');
  const equiposTexto = `${cifra(equipos.length)} ${equipos.length === 1 ? 'equipo' : 'equipos'}`;
  const laboratoriosTexto = `${cifra(laboratorios)} ${laboratorios === 1 ? 'laboratorio' : 'laboratorios'}`;
  return `${equiposTexto} de ${laboratoriosTexto}`;
}
