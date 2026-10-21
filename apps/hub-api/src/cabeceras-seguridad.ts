import type { Express } from 'express';

/**
 * SEC-235 — cabeceras de seguridad para TODAS las respuestas de hub-api. Hasta
 * ahora no ponía ninguna. La que de verdad importa es `nosniff` en las descargas
 * (el PDF de una incapacidad, el CSV y el XLS de WO-sales, las hojas de
 * trazabilidad): sin ella, un navegador puede «adivinar» que un fichero es HTML y
 * ejecutarlo. Lo mitigaban `Content-Disposition: attachment` y el mime forzado;
 * esto lo cierra también para las rutas que nadie ha escrito todavía.
 *
 * A mano y no con `helmet`, a propósito:
 *  - el Dockerfile de hub-api instala con `npm install` sin lockfile, así que una
 *    dependencia nueva se resolvería al vuelo en cada build (DEP-*, supply chain);
 *  - lo que trae helmet por defecto pensado para páginas HTML —CSP,
 *    `Cross-Origin-Resource-Policy`, `Cross-Origin-Embedder-Policy`— no aporta en
 *    una API de JSON y ficheros, y alguna (la CSP) puede romper el visor de PDF del
 *    navegador si alguien abre una descarga en una pestaña.
 * HSTS tampoco va aquí: lo pone el proxy de EasyPanel, que es quien termina TLS.
 *
 * Tiene que montarse ANTES que cualquier router: lo que responda un router
 * montado antes saldría sin estas cabeceras. Lo vigila cabeceras-seguridad.test.ts.
 */
export function cabecerasDeSeguridad(app: Express): void {
  // No anunciar «Express» en cada respuesta: no protege de nada por sí solo, pero
  // es información gratis para quien busca versiones vulnerables.
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Nada de hub-api tiene sentido dentro de un iframe.
    res.setHeader('X-Frame-Options', 'DENY');
    // Las URLs de la API llevan el cliente en la query (PRIV-815): que no viajen
    // en el Referer si una respuesta llega a cargar algo de fuera.
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
}
