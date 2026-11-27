import { COLORES } from './marca';

// El pase en PNG, dibujado en un lienzo. Sin QR (diseño): el de la invitación
// original era decorativo y parecía escaneable.

export interface DatosPase {
  titulo: string;
  nombre: string;
  fecha: string;
  hora: string;
  lugar: string;
  preferencia: string;
  mensaje: string | null;
}

export function lineasPase(d: DatosPase): string[] {
  return [`📅 ${d.fecha} · ${d.hora}`, `📍 ${d.lugar}`, `🍽️ Preferencia: ${d.preferencia}`];
}

export const MENSAJE_PASE_MAX = 90;

/** Recorta el mensaje para que quepa legible en el lienzo. */
export function mensajeParaPase(mensaje: string): string {
  return mensaje.length <= MENSAJE_PASE_MAX ? mensaje : `${mensaje.slice(0, MENSAJE_PASE_MAX - 1)}…`;
}

export function nombreFicheroPase(eventoId: string, nombre: string): string {
  const limpio = nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `Pase_${eventoId}_${limpio || 'invitado'}.png`;
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const imagen = new Image();
    imagen.onload = () => resolver(imagen);
    imagen.onerror = () => rechazar(new Error('no cargó el logo'));
    imagen.src = src;
  });
}

/** Dibuja el pase y devuelve su data URL en PNG. */
export async function dibujarPase(d: DatosPase, logoUrl: string): Promise<string> {
  const lienzo = document.createElement('canvas');
  lienzo.width = 800;
  lienzo.height = 440;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('sin contexto 2D');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 800, 440);
  const franja = ctx.createLinearGradient(0, 0, 800, 0);
  COLORES.forEach((color, i) => franja.addColorStop(i / (COLORES.length - 1), color));
  ctx.fillStyle = franja;
  ctx.fillRect(0, 0, 800, 16);

  try {
    const logo = await cargarImagen(logoUrl);
    const alto = 56;
    ctx.drawImage(logo, 44, 40, (logo.width / logo.height) * alto, alto);
  } catch {
    ctx.fillStyle = '#525252';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('Ambientalia', 44, 80);
  }

  ctx.fillStyle = '#C95B00';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(`PASE OFICIAL · ${d.titulo.toUpperCase()}`, 44, 128, 712);

  ctx.fillStyle = '#6B7280';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('INVITADO', 44, 175);
  ctx.fillStyle = '#1F2229';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(d.nombre, 44, 212, 712);

  ctx.fillStyle = '#3E4352';
  ctx.font = '20px sans-serif';
  lineasPase(d).forEach((linea, i) => ctx.fillText(linea, 44, 270 + i * 37, 712));

  if (d.mensaje) {
    ctx.fillStyle = '#4E5362';
    ctx.font = 'italic 18px sans-serif';
    ctx.fillText(`“${mensajeParaPase(d.mensaje)}”`, 44, 400, 712);
  }
  return lienzo.toDataURL('image/png');
}
