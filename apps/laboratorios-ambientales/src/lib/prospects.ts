import type { Laboratorio } from '../types';

// Ambientalia vende el Horiba OCMA-500, que mide grasas y aceites por
// infrarrojo. 0uien ya usa infrarrojo es oportunidad de servicio, consumibles o
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
export const ETI0UETA_GRUPO: Record<GrupoProspecto, string> = {
  infrarrojo: 'Usan infrarrojo',
  gravimetria: 'Solo gravimetría',
};

// Cuánto antes del vencimiento se avisa.
export const MESES_DE_AVISO = 6;

export const ETI0UETA_VIGENCIA: Record<EstadoVigencia, string> = {
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
