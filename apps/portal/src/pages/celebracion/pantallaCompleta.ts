// Pantalla completa del sistema para la presentación de cualidades. El navegador solo la concede dentro de un
// gesto del usuario (el clic de «Presentar cualidades»). El iPhone no trae la API: entonces no se hace nada y
// basta la capa fija de la presentación.

/** Si el navegador trae la API; el iPhone no. */
export function admitePantallaCompleta(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function';
}

/** Pide la pantalla completa de toda la página; sin la API, o si el navegador la niega, no pasa nada. */
export function entrarPantallaCompleta(): void {
  const raiz = document.documentElement;
  if (typeof raiz.requestFullscreen !== 'function') return;
  // Promise.resolve: algún navegador antiguo devuelve undefined en vez de una promesa.
  Promise.resolve(raiz.requestFullscreen()).catch(() => {
    // Denegada: la presentación sigue en su capa.
  });
}

/** Sale de la pantalla completa solo si la página está en ella. */
export function salirPantallaCompleta(): void {
  if (!document.fullscreenElement || typeof document.exitFullscreen !== 'function') return;
  Promise.resolve(document.exitFullscreen()).catch(() => {
    // Ya había salido, por ejemplo con Esc: nada que hacer.
  });
}
