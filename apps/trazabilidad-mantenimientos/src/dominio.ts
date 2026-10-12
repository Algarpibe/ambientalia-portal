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
// El maestro de equipos (Desk 2.0): el plan del cruce y el cruce informativo, tal como los sirve la API (tipos), y la
// regla con que el servidor decide si un nombre de cliente es el mismo escrito de otra forma (para agrupar el detalle).
export type { CambioMaestro, CruceHojaMarca, CruceMarca, EquipoRevisar, FilaHojaRevisar, RecuentosMaestro, RecuentosOtras, RespuestaCruceFst022, RespuestaPlanMaestro, SincronizacionMaestro } from '../../hub-api/src/trazabilidad/maestro';
export { mismoNombre } from '../../hub-api/src/trazabilidad/maestro';
// Las calibraciones desde Desk 2.0: el plan de la pasada y el historial de un equipo, tal como los sirve la API (tipos), y el orden de su detalle.
export type { CalibracionHistorial, DetalleCalibracion, EstadoFilaCalibracion, PasadaCalibraciones, RecuentosCalibraciones, RespuestaHistorialCalibraciones, RespuestaPlanCalibraciones, TipoDetalle } from '../../hub-api/src/trazabilidad/calibraciones';
export { TIPOS_DETALLE } from '../../hub-api/src/trazabilidad/calibraciones';
// La pestaña «Trazabilidad F-ST-022»: la tabla de la hoja tal como la sirve GET /hoja (tipos; el cálculo es del servidor).
export type { AvisoHoja, CalibracionHoja, EnHoja, FilaHoja, RespuestaHoja, ResumenHoja, SituacionHoja } from '../../hub-api/src/trazabilidad/hoja';
export { AVISOS_HOJA } from '../../hub-api/src/trazabilidad/hoja';
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
