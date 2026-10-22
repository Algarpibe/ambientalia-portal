import type { KeyboardEvent } from 'react';

// FE-419 — props para que un elemento que solo respondía al clic (típicamente una
// `<tr onClick>` que abre el detalle de una factura u OV) se pueda usar con teclado:
// entra en el orden de tabulación y Enter o Espacio hacen lo mismo que el clic, que
// sigue igual. El nombre accesible («Abrir el detalle de…») lo pone quien lo usa, igual
// que el `role` cuando el elemento no es una fila (p. ej. role="button" en un <div>).
//
// Solo se activa si la tecla se pulsó sobre el propio elemento: si viene de un control
// de dentro (el input editable de cartera de una fila), Enter o Espacio son de ese
// control y no deben abrir el detalle. Espacio cancela su acción por defecto para que
// la página no se desplace al activar.
export function activable(onActivar: () => void) {
  return {
    tabIndex: 0,
    onClick: () => onActivar(),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onActivar();
    },
  };
}

// FE-419 — valor de `aria-sort` para la cabecera de una columna ordenable. Solo la
// columna por la que se ordena lo declara; en las demás se omite (equivale a «none»),
// que es lo que recomienda WAI-ARIA para no anunciar un estado en cada cabecera.
export function ariaSort(activa: boolean, ascendente: boolean): 'ascending' | 'descending' | undefined {
  if (!activa) return undefined;
  return ascendente ? 'ascending' : 'descending';
}
