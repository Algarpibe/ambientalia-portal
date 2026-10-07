/**
 * Punto único de entrada al dominio puro de hub-api (la misma regla que aplica
 * el servidor). Toda la UI lo importa desde aquí.
 */
export * from '../../hub-api/src/trazabilidad/dominio';
// Roles y permisos de la app: la misma matriz que comprueba el servidor.
export * from '../../hub-api/src/trazabilidad/roles';
// La agenda del taller tal como la sirve GET /agenda (sólo tipos: el cálculo es del servidor).
export type { AgendaTaller, DetalleTicket, EtapaProyectada, ItemReparto, PuestoAgenda, RespuestaAgenda, TicketEncadenado, TicketEnFila } from '../../hub-api/src/trazabilidad/agenda';
export type { EstadoFuente, NombreFuente } from '../../hub-api/src/trazabilidad/fuente';
export type {
  ConfiguracionAgenda,
  DuracionAgendaConfig,
  EquipoVista,
  EstadoDesk,
  EtapaAgendaConfig,
  FilaImportada,
  MiRol,
  OrigenCliente,
  PartePlazo,
  PlazoServicio,
  ResumenImportacion,
  Seguimiento,
  SeguimientoGuardado,
  ServicioVista,
  TicketDesk,
  TipoManual,
  TipoServicioOpcion,
  UsuarioRol,
} from '../../hub-api/src/trazabilidad/types';
