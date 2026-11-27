/** Descarga una URL (data: o blob:) con un nombre de fichero. */
export function descargarUrl(nombre: string, url: string): void {
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
}

/** Descarga un texto como fichero (el .ics). */
export function descargarTexto(nombre: string, contenido: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  descargarUrl(nombre, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
