// Configuración del almuerzo de fin de año 2026 (diseño:
// docs/superpowers/specs/2026-11-26-invitacion-fin-de-ano-design.md). Es la ÚNICA
// copia: el portal la recibe por GET /api/celebracion y el servicio la usa para
// hacer cumplir los cierres. Para otro evento se cambia este archivo y su `id`.

export const EVENTO = {
  id: 'fin-de-ano-2026',
  titulo: 'Almuerzo de fin de año 2026',
  inicio: '2026-12-18T12:30:00-05:00',
  fin: '2026-12-18T16:00:00-05:00',
  lugar: 'Restaurante Anfitriona',
  direccion: 'Cl. 83 Bis #24-09, Bogotá D.C.',
  vestimenta: 'Smart casual',
  /** Último instante en que se puede confirmar o cambiar la respuesta. */
  cierreConfirmaciones: '2026-12-04T23:59:59-05:00',
} as const;

/** Lista fija de cualidades que se pueden votar. Su orden desempata el top 3. */
export const CUALIDADES: readonly string[] = [
  'Liderazgo',
  'Empatía',
  'Compromiso',
  'Creatividad',
  'Trabajo en equipo',
  'Proactividad',
  'Alegría contagiosa',
  'Organización',
  'Precisión técnica',
  'Confiabilidad',
  'Generosidad',
  'Perseverancia',
  'Actitud resolutiva',
  'Atención al detalle',
  'Compañerismo',
  'Calidez humana',
  'Visión estratégica',
  'Espíritu positivo',
];

export interface Preferencia {
  codigo: string;
  texto: string;
}

export const PREFERENCIAS: readonly Preferencia[] = [
  { codigo: 'general', texto: 'Menú general (sin restricciones)' },
  { codigo: 'vegetariano', texto: 'Opción vegetariana' },
  { codigo: 'sin_gluten', texto: 'Sin gluten' },
  { codigo: 'sin_mariscos', texto: 'Sin mariscos ni pescados' },
];

/** Cualidades que cada persona puede votar a cada compañero. */
export const MAX_CUALIDADES = 3;

/** Largo máximo del mensaje de la confirmación (la BD tiene el mismo CHECK). */
export const MENSAJE_MAX = 200;
