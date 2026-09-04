import type React from 'react';

/**
 * Tirador de ancho en el borde derecho de una cabecera: arrastrar redimensiona,
 * doble clic devuelve la columna a su ancho por defecto.
 *
 * Los eventos del arrastre se escuchan en `document` (y no en el propio tirador)
 * para que siga funcionando aunque el cursor se salga de la celda. Solo se avisa
 * del ancho definitivo al soltar: durante el arrastre se emite `onPreview` para
 * pintar en vivo, sin escribir en localStorage en cada píxel.
 */
interface Props {
  ancho: number;
  /**
   * Ancho mínimo. Deliberadamente pequeño: la columna puede quedar como una franja
   * estrecha —tapando su texto— pero nunca desaparecer, que es lo que se pide al
   * querer apartar una columna sin ocultarla del todo.
   */
  minimo?: number;
  /** Ancho en curso mientras se arrastra; null al terminar. */
  onPreview: (ancho: number | null) => void;
  onFin: (ancho: number) => void;
  onRestablecer: () => void;
}

export default function ResizeHandle({ ancho, minimo = 24, onPreview, onFin, onRestablecer }: Props) {
  const iniciar = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // no dispares la ordenación al agarrar el borde
    const xInicial = e.clientX;
    const calcular = (ev: MouseEvent) => Math.max(minimo, ancho + (ev.clientX - xInicial));

    const alMover = (ev: MouseEvent) => onPreview(calcular(ev));
    const alSoltar = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', alMover);
      document.removeEventListener('mouseup', alSoltar);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onPreview(null);
      onFin(calcular(ev));

      // Tras el mouseup el navegador dispara un `click` que burbujea hasta el <th> y
      // acababa ordenando la columna sin querer. Se traga ese único click en fase de
      // captura; el temporizador retira el oyente si por lo que sea no llega a haberlo
      // (el click se despacha antes que los timers, así que nunca se cuela otro).
      const tragarClick = (ev2: MouseEvent) => {
        ev2.stopPropagation();
        ev2.preventDefault();
      };
      document.addEventListener('click', tragarClick, true);
      setTimeout(() => document.removeEventListener('click', tragarClick, true), 0);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none'; // sin esto el arrastre selecciona texto
    document.addEventListener('mousemove', alMover);
    document.addEventListener('mouseup', alSoltar);
  };

  return (
    <span
      onMouseDown={iniciar}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRestablecer();
      }}
      onClick={(e) => e.stopPropagation()}
      title="Arrastra para cambiar el ancho · doble clic para restablecer"
      // Zona de agarre ancha (12px) y a caballo del borde: con 6px dentro de la celda
      // era muy fácil fallar y acabar ordenando. La barrita visible se pinta con un
      // pseudo-elemento fino, así el objetivo del ratón es grande pero se ve discreto.
      className="absolute -right-1.5 top-0 z-10 h-full w-3 cursor-col-resize before:absolute before:right-1.5 before:top-0 before:h-full before:w-0.5 before:bg-transparent hover:before:bg-blue-500 group-hover:before:bg-gray-300"
    />
  );
}
