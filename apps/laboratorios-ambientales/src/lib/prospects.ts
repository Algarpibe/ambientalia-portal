import type { Laboratorio } from '../types';
import { sumarMeses } from './fechas';

// Ambientalia vende el Horiba OCMA-500, que mide grasas y aceites por
// infrarrojo. Quien ya usa infrarrojo es oportunidad de servicio, consumibles o
// reposición; quien solo usa gravimetría, de vender el equipo.
export type GrupoProspecto = 'infrarrojo' | 'gravimetria';

export type EstadoVigencia = 'sin-fecha' | 'vencida' | 'pronto' | 'vigente';

// Un laboratorio, no una acreditación: junta todas sus filas activas de grasas y
// aceites (una por matriz y método).
export type Prospecto = {
  codigo: string;
  nombre: string;
  nit: string;
  ciudad: string;
  departamento: string;
  contacto: string;
  telefono: string;
  correo: string;
  matrices: string[];
  metodos: string[];
  grupo: GrupoProspecto;
  // AAAA-MM-DD, o null si ninguna de sus acreditaciones trae una fecha válida.
  vigenciaMasProxima: string | null;
};

export type FiltrosProspectos = {
  grupo: GrupoProspecto;
  // '' = todos los departamentos.
  departamento: string;
  busqueda: string;
};

// El orden de las pestañas: la primera es la que se abre por defecto.
export const GRUPOS: readonly GrupoProspecto[] = ['infrarrojo', 'gravimetria'];

// «Solo gravimetría» y no «Sin infrarrojo»: hoy los 64 laboratorios de este
// grupo son gravimétricos. Si alguno usara otra técnica sin infrarrojo, caería
// aquí y la columna de métodos lo dejaría a la vista.
export const ETIQUETA_GRUPO: Record<GrupoProspecto, string> = {
  infrarrojo: 'Usan infrarrojo',
  gravimetria: 'Solo gravimetría',
};

// Cuánto antes del vencimiento se avisa.
export const MESES_DE_AVISO = 6;

export const ETIQUETA_VIGENCIA: Record<EstadoVigencia, string> = {
  'sin-fecha': 'Sin fecha',
  vencida: 'Vencida',
  pronto: `Vence en menos de ${MESES_DE_AVISO} meses`,
  vigente: 'Vigente',
};

// Minúsculas, sin tildes y con los espacios colapsados: el dataset es de captura
// manual y la misma palabra llega con varias grafías.
function clave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// La variable llega como «Aceites y Grasas», «Grasas y Aceites», «Aceites y
// grasas» o «Grasas y aceites»: basta con que estén las dos palabras, en
// cualquier orden. Vale para cualquier matriz (agua, suelo, sedimento, lodo).
export function esGrasasYAceites(registro: Pick<Laboratorio, 'estado' | 'variable'>): boolean {
  if (registro.estado !== 'Activa') return false;
  const variable = clave(registro.variable);
  return variable.includes('grasa') && variable.includes('aceite');
}

// «---» y «No Aplica» son los rellenos del dataset cuando la técnica no se informó.
const TECNICA_SIN_DATO = new Set(['', '---', 'no aplica']);

// Los métodos por infrarrojo: SM 5520 C, NTC 3362 C (con o sin «Método» o
// «Métodos» delante de la C) y ASTM D7066. El \b impide que la C case con el
// principio de otra palabra.
const METODO_INFRARROJO = /5520 c\b|ntc 3362 (?:metodos? )?c\b|d7066/;

export function esInfrarrojo(registro: Pick<Laboratorio, 'tecnica' | 'metodo'>): boolean {
  const tecnica = clave(registro.tecnica);
  // La técnica manda cuando dice algo; el método solo se mira si no informa nada.
  if (!TECNICA_SIN_DATO.has(tecnica)) return tecnica.includes('fotometr') || tecnica.includes('infrarroj');
  return METODO_INFRARROJO.test(clave(registro.metodo));
}

// `hasta` llega como «2027-04-21T00:00:00.000» o como «---».
const FECHA_ISO = /^(\d{4}-\d{2}-\d{2})/;

function fechaDeHasta(hasta: string): string | null {
  const encontrada = FECHA_ISO.exec(hasta.trim());
  return encontrada ? encontrada[1] : null;
}

const compararTexto = (a: string, b: string): number => a.localeCompare(b, 'es');

function distintos(valores: string[]): string[] {
  return [...new Set(valores.map((valor) => valor.trim()).filter(Boolean))].sort(compararTexto);
}

function aProspecto(filas: Laboratorio[]): Prospecto {
  // El primer valor no vacío en el orden del dataset: el contacto o el teléfono
  // faltan a menudo en una fila y están en otra del mismo laboratorio.
  const primero = (campo: keyof Laboratorio): string => {
    for (const fila of filas) {
      const valor = fila[campo].trim();
      if (valor) return valor;
    }
    return '';
  };
  // AAAA-MM-DD se ordena bien como texto: tras el sort, la primera es la más temprana.
  const fechas = filas
    .map((fila) => fechaDeHasta(fila.hasta))
    .filter((fecha): fecha is string => fecha !== null)
    .sort();

  return {
    codigo: primero('codigo'),
    nombre: primero('nombreLaboratorio'),
    nit: primero('nit'),
    ciudad: primero('ciudad'),
    departamento: primero('departamento'),
    contacto: primero('contacto'),
    telefono: primero('telefono'),
    correo: primero('correo'),
    matrices: distintos(filas.map((fila) => fila.matriz)),
    metodos: distintos(filas.map((fila) => fila.metodo)),
    grupo: filas.some(esInfrarrojo) ? 'infrarrojo' : 'gravimetria',
    vigenciaMasProxima: fechas[0] ?? null,
  };
}

// Por código de laboratorio y no por NIT: una misma empresa tiene varias sedes
// acreditadas, cada una con su código. Sin código, por nombre. Los prefijos
// impiden que un nombre choque con un código. El Map conserva el orden del dataset.
export function groupProspects(data: Laboratorio[]): Prospecto[] {
  const porLaboratorio = new Map<string, Laboratorio[]>();
  for (const registro of data) {
    if (!esGrasasYAceites(registro)) continue;
    const codigo = registro.codigo.trim();
    const id = codigo ? `codigo:${codigo}` : `nombre:${registro.nombreLaboratorio.trim()}`;
    const filas = porLaboratorio.get(id);
    if (filas) filas.push(registro);
    else porLaboratorio.set(id, [registro]);
  }
  return [...porLaboratorio.values()].map(aProspecto);
}

// `hoy` llega como argumento para que el resultado no dependa del reloj. El
// límite es hoy + 6 meses de calendario, ajustado al último día del mes
// (sumarMeses), y queda fuera: esa fecha ya es «vigente».
export function estadoVigencia(fecha: string | null, hoy: string): EstadoVigencia {
  if (fecha === null) return 'sin-fecha';
  if (fecha < hoy) return 'vencida';
  if (fecha < sumarMeses(hoy, MESES_DE_AVISO)) return 'pronto';
  return 'vigente';
}
