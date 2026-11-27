/** Descarga una URL (data: o blob:) con un nombre de fichero. */
export function descargarUrl(nombre: string, url: string): void {
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
}
