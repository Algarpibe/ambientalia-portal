// FE-419 — accesibilidad compartida por el portal y las sub-apps. Vive en un paquete y
// no en apps/portal porque las sub-apps no pueden importar del portal (cada una se
// construye también por separado) y el comportamiento tiene que ser el mismo en todas.
export { useDialogo, type OpcionesDialogo } from './useDialogo';
export { activable, ariaSort } from './activable';
