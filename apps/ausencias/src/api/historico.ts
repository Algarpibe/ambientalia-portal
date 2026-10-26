import { post } from './http';

// ARQ-612 — dar de alta a los empleados desde el portal e importar el histórico
// de la hoja, sacado de api.ts tal cual. api.ts lo reexporta (lo vigila
// barril.test.ts).

/** Da de alta a todos los usuarios del portal que ya tienen la app asignada. */
export const sincronizarEmpleados = () =>
  post<{ creados: number; vinculados: number }>('/api/ausencias/empleados/sincronizar', {});

/** Una fila del Excel histórico, tal como la lee el navegador. */
export interface FilaHistorico {
  nombre: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number | string;
  comentarios?: string | null;
  adjunto?: string | null;
  observaciones?: string | null;
}

export interface ResumenImportacion {
  total: number;
  resueltas: number;
  importadas: number;
  yaExistian: number;
  sinResolver: string[];
  ambiguos: { nombre: string; candidatos: string[] }[];
}

/** Con `dryRun` no escribe nada: solo devuelve el recuento para previsualizar. */
export const importarHistorico = (solicitudes: FilaHistorico[], dryRun: boolean) =>
  post<ResumenImportacion>('/api/ausencias/historico/import', { solicitudes, dryRun });
