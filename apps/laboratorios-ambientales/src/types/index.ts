import type { EstadoAcreditacion } from '../lib/normalize';

// Un registro = un parámetro acreditado de un laboratorio (no un laboratorio).
// Los nombres de campo derivan del dataset 2waz-acaa de datos.gov.co.
export type Laboratorio = {
  codigo: string;
  estado: EstadoAcreditacion;
  matriz: string;
  componente: string;
  actividad: string;
  grupo: string;
  variable: string;
  tecnica: string;
  metodo: string;
  rango: string;
  nombreLaboratorio: string;
  nit: string;
  contacto: string;
  ciudad: string;
  departamento: string;
  direccion: string;
  telefono: string;
  correo: string;
  actoAdministrativo: string;
  desde: string;
  hasta: string;
};

export type FilterState = {
  busqueda: string;
  estado: string;
  matriz: string;
  componente: string;
  actividad: string;
  variables: string[];
  metodo: string;
};

export const EMPTY_FILTERS: FilterState = {
  busqueda: '',
  estado: '',
  matriz: '',
  componente: '',
  actividad: '',
  variables: [],
  metodo: '',
};
