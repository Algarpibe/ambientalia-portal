/**
 * Punto único de entrada al dominio puro de hub-api (la misma regla que aplica
 * el servidor). Toda la UI lo importa desde aquí.
 */
export * from '../../hub-api/src/trazabilidad/dominio';
export type {
  EquipoVista,
  FilaImportada,
  PartePlazo,
  PlazoServicio,
  ResumenImportacion,
  Seguimiento,
  SeguimientoGuardado,
  ServicioVista,
  TicketDesk,
  TipoManual,
  TipoServicioOpcion,
} from '../../hub-api/src/trazabilidad/types';
