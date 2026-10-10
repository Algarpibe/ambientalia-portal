/**
 * Punto único de entrada al dominio puro de hub-api (la misma regla que aplica
 * el servidor). Toda la UI lo importa desde aquí.
 */
export * from '../../hub-api/src/trazabilidad/dominio';
// Roles y permisos de la app: la misma matriz que comprueba el servidor.
export * from '../../hub-api/src/trazabilidad/roles';
// La congelación de la F-ST-022: la forma de lo guardado, que la app sólo lee.
export * from '../../hub-api/src/trazabilidad/fst022';
// La agenda del taller tal como la sirve GET /agenda (sólo tipos: el cálculo es del servidor).
export type { AgendaTaller, DetalleTicket, EtapaProyectada, ItemReparto, PuestoAgenda, RespuestaAgenda, TicketEncadenado, TicketEnFila } from '../../hub-api/src/trazabilidad/agenda';
export type { EstadoFuente, NombreFuente } from '../../hub-api/src/trazabilidad/fuente';
// El maestro de equipos (Desk 2.0): el plan del cruce y el cruce informativo, tal como los sirve la API (sólo tipos).
export type { CambioMaestro, CruceMarca, RecuentosMaestro, RespuestaCruceFst022, RespuestaPlanMaestro, SincronizacionMaestro } from '../../hub-api/src/trazabilidad/maestro';
export type {
  ConfiguracionAgenda,
  CongelacionFst022,
  DuracionAgendaConfig,
  EquipoVista,
  EstadoDesk,
  EtapaAgendaConfig,
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
