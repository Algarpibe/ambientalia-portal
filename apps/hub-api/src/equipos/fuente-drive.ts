/** Google Drive para «Equipos en taller» (se completa en la Tarea 7). */
export interface CuentaServicioGoogle {
  client_email: string;
  private_key: string;
}
export interface CarpetasDrive {
  entradas: string;
  salidasGeneradas: string;
  salidasEscaneadas: string;
}
export interface ConfigDrive {
  cuentaServicio: CuentaServicioGoogle;
  carpetas: CarpetasDrive;
  /** Carpeta donde se crea (y se borra enseguida) la copia temporal del OCR. */
  carpetaTemporalOcr: string;
}
