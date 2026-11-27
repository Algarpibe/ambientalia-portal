// Lo que devuelve hub-api (apps/hub-api/src/celebracion/service.ts). Las fechas
// llegan como texto ISO.

/** Largo máximo del mensaje (hub-api y la BD aplican el mismo). */
export const MENSAJE_MAX = 200;

export interface Preferencia {
  codigo: string;
  texto: string;
}

export interface Evento {
  id: string;
  titulo: string;
  inicio: string;
  fin: string;
  lugar: string;
  direccion: string;
  vestimenta: string;
  cierreConfirmaciones: string;
  confirmacionesAbiertas: boolean;
  votosAbiertos: boolean;
  cualidades: string[];
  preferencias: Preferencia[];
  maxCualidades: number;
}

export interface CualidadVotada {
  cualidad: string;
  votos: number;
}

export interface Miembro {
  userId: string;
  nombre: string;
  avatar: string | null;
  cualidades: CualidadVotada[];
}

export interface Respuesta {
  asiste: boolean;
  preferencia: string | null;
  mensaje: string | null;
  actualizadoEn: string;
}

export interface Vista {
  evento: Evento;
  yo: string;
  esAdmin: boolean;
  equipo: Miembro[];
  miRespuesta: Respuesta | null;
  misVotos: Record<string, string[]>;
}

export interface MiEstado {
  respondido: boolean;
  confirmacionesAbiertas: boolean;
}

export interface DatosConfirmacion {
  asiste: boolean;
  preferencia: string | null;
  mensaje: string | null;
}

export type EstadoRespuesta = 'va' | 'no_va' | 'sin_responder';

export interface FilaResumen {
  userId: string;
  nombre: string;
  estado: EstadoRespuesta;
  preferencia: string | null;
  mensaje: string | null;
  actualizadoEn: string | null;
}

export interface Resumen {
  totales: { van: number; noVan: number; sinResponder: number };
  porPreferencia: (Preferencia & { total: number })[];
  filas: FilaResumen[];
}
