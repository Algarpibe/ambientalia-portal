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
// Las pasadas nocturnas (lote 10): la última de cada tipo, tal como la sirven los dos GET de los planes.
export type { ConNocturna, PasadaNocturna, ResultadoPasada } from '../../hub-api/src/trazabilidad/pasadas-nocturnas';
// La pestaña «Trazabilidad F-ST-022»: la tabla de la hoja tal como la sirve GET /hoja (tipos; el cálculo es del servidor).
export type { ApunteRetiro, AvisoHoja, CalibracionHoja, EnHoja, FilaHoja, RespuestaEdicion, RespuestaHoja, RespuestaRetiro, ResumenHoja, Retiro, SituacionHoja } from '../../hub-api/src/trazabilidad/hoja';
export { AVISOS_HOJA } from '../../hub-api/src/trazabilidad/hoja';
// Marcas en seguimiento (lote 9f): las marcas con su vista previa, tal como las sirve GET /marcas, y la clave de una marca (la del servidor).
export type { CambioMarca, CambioVigencia, FirmaMarca, MarcaSeguimiento, RespuestaMarcas, ResumenMarca, VigenciaMarca } from '../../hub-api/src/trazabilidad/marcas';
// Y, desde el lote 11, qué vigencia se puede guardar (la misma comprobación que hace el servidor).
export { VIGENCIA_MAX_DIAS, VIGENCIA_MIN_DIAS, claveMarca, esVigenciaValida } from '../../hub-api/src/trazabilidad/marcas';
// Lote 12: «según contrato del cliente» y la frecuencia de preventivo de cada cliente (la misma regla y las mismas comprobaciones del servidor).
export type { CambioFrecuencia, FrecuenciaCliente, RespuestaContrato, ValorVigencia } from '../../hub-api/src/trazabilidad/marcas';
export { FRECUENCIA_MAX_MESES, FRECUENCIA_MIN_MESES, SEGUN_CONTRATO, diasDeMeses, esFrecuenciaValida, valorVigencia } from '../../hub-api/src/trazabilidad/marcas';
// Exportar la F-ST-022: sólo los tipos de «última exportación» (el libro lo genera el servidor; de aquí no se importa su código, que carga SheetJS).
export type { Exportacion, RespuestaExportaciones } from '../../hub-api/src/trazabilidad/exportacion';
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
