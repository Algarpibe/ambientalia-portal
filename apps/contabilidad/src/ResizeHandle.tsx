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
  minimo?: number;
  /** Ancho en curso mientras se arrastra; null al terminar. */
  onPreview: (ancho: number | null) => void;
  onFin: (ancho: number) => void;
  onRestablecer: () => void;
}

export default function ResizeHandle({ ancho, minimo = 48, onPreview, onFin, onRestablecer }: Props) {
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
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-blue-400/60 group-hover:bg-gray-300"
    />
  );
}
