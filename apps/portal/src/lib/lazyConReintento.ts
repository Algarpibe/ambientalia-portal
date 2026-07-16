import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * Cada mini-app se carga con lazy(() => import(...)), en chunks con hash en el nombre.
 * Cada despliegue cambia esos hashes. Dos formas de que un import dinámico falle:
 *  - Un hipo de red justo mientras EasyPanel intercambia el contenedor (transitorio).
 *  - Un tab abierto desde ANTES de un deploy que pide un chunk viejo ya inexistente.
 *
 * Sin esto, cualquiera de los dos deja al usuario en una pantalla rota (y un Sentry).
 * Aquí: un reintento corto cubre el hipo; si sigue fallando, se recarga la página UNA
 * vez para traer el index.html nuevo con los hashes actuales. Un flag en sessionStorage
 * evita un bucle de recargas, y se limpia en cuanto un import vuelve a funcionar.
 */

const CLAVE_RECARGA = 'portal:chunk-recargado';

interface Opciones {
  esperar?: (ms: number) => Promise<void>;
  recargar?: () => void;
  almacen?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export function importarConReintento<T>(factory: () => Promise<T>, opts: Opciones = {}): Promise<T> {
  const esperar = opts.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const recargar = opts.recargar ?? (() => window.location.reload());
  const almacen = opts.almacen ?? window.sessionStorage;

  const exito = (mod: T): T => {
    // Import correcto: se resetea el flag para que un despliegue futuro pueda recargar.
    almacen.removeItem(CLAVE_RECARGA);
    return mod;
  };

  return factory().then(exito, async () => {
    // 1 reintento tras una pausa corta: cubre el hipo de red durante el swap.
    await esperar(500);
    try {
      return exito(await factory());
    } catch (err) {
      // Sigue fallando: el chunk probablemente ya no existe. Recargar trae el HTML
      // nuevo. El flag corta el bucle si el fallo persiste tras recargar.
      if (!almacen.getItem(CLAVE_RECARGA)) {
        almacen.setItem(CLAVE_RECARGA, '1');
        recargar();
        // La página se está recargando; se cuelga para no renderizar un error a medias.
        return new Promise<T>(() => {});
      }
      throw err;
    }
  });
}

/** lazy() con auto-reintento y recarga ante un import dinámico fallido. Misma firma que
 *  el lazy de React (ComponentType<any>) para aceptar exactamente lo mismo que él. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyConReintento<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() => importarConReintento(factory));
}
