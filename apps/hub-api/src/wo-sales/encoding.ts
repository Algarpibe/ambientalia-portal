import iconv from 'iconv-lite';

/**
 * El CSV de World Office NO es UTF-8: en la muestra, la ú de "Número" es el byte
 * 0xFA, propio de Windows-1252. Se usa iconv-lite y no Buffer.from(s,'latin1')
 * porque latin1 (ISO-8859-1) coincide con cp1252 solo en 0xC0-0xFF: sirve para
 * ñ y tildes, pero destroza –, … o €, que pueden aparecer en un nombre de producto.
 */
export function toWindows1252(texto: string): Buffer {
  return iconv.encode(texto, 'win1252');
}
