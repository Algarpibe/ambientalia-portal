import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as legal from './terminos';

// CANDADO: el texto que se publica en /terminos no puede llevar huecos «[…]» de
// borrador («[plazo por definir]», «[fecha de aprobación]»…), y cada pieza tiene
// que estar TAL CUAL en el Anexo del spec, que es el texto aprobado. Recorre TODO
// lo que exporta terminos.ts —también la fecha de vigencia y el correo de
// contacto—, así que una pieza nueva queda vigilada sin tocar este test.
//
// Mientras TERMS_EFFECTIVE_DATE y CORREO_CONTACTO sean huecos, los tests del
// hueco, de la fecha y del correo están en ROJO a propósito: se rellenan en el
// último commit antes de fusionar (spec §8).

interface Texto {
  ruta: string;
  texto: string;
}

function textos(valor: unknown, ruta: string, salida: Texto[] = []): Texto[] {
  if (typeof valor === 'string') {
    salida.push({ ruta, texto: valor });
  } else if (Array.isArray(valor)) {
    valor.forEach((v, i) => textos(v, `${ruta}[${i}]`, salida));
  } else if (valor !== null && typeof valor === 'object') {
    for (const [clave, v] of Object.entries(valor)) {
      // `tipo` es la etiqueta interna del bloque («parrafo», «tabla»…): no se publica.
      if (clave !== 'tipo') textos(v, `${ruta}.${clave}`, salida);
    }
  }
  return salida;
}

const publicados = textos({ ...legal }, 'terminos');

const SPEC = fileURLToPath(
  new URL('../../../../docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md', import.meta.url),
);
const normalizar = (t: string) => t.replace(/\s+/g, ' ');
const ANEXO = normalizar(readFileSync(SPEC, 'utf8').split('## Anexo')[1] ?? '');
// La dirección de contacto se lee del propio Anexo (fila «Canal de contacto» del
// §2.1): así este test no la lleva escrita. La única copia en código es la de
// CORREO_CONTACTO en terminos.ts.
const CORREO_DEL_ANEXO = /\| Canal de contacto \| (\S+) \|/.exec(ANEXO)?.[1] ?? '';

describe('CANDADO: el texto publicado en /terminos', () => {
  it('el recorrido encuentra el texto (si no, el candado no vigilaría nada)', () => {
    expect(publicados.length).toBeGreaterThan(50);
    expect(publicados.some((t) => t.texto.includes('Ley 1581 de 2012'))).toBe(true);
  });

  it('ningún texto lleva un hueco entre corchetes', () => {
    expect(publicados.filter((t) => /\[[^\]]*\]/.test(t.texto))).toEqual([]);
  });

  it('la fecha de vigencia está puesta y sale en la línea de versión y en el §2.8', () => {
    expect(legal.TERMS_EFFECTIVE_DATE).toMatch(
      /^\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de \d{4}$/,
    );
    expect(legal.LINEA_VERSION).toContain(legal.TERMS_EFFECTIVE_DATE);
    expect(
      publicados.some((t) => t.texto.startsWith(`Esta política rige desde el ${legal.TERMS_EFFECTIVE_DATE}.`)),
    ).toBe(true);
  });

  it('el correo de contacto está puesto y es el del Anexo (§2.1)', () => {
    expect(CORREO_DEL_ANEXO).toContain('@');
    expect(legal.CORREO_CONTACTO).toBe(CORREO_DEL_ANEXO);
  });

  it('cada texto publicado está tal cual en el Anexo del spec (sin erratas ni texto inventado)', () => {
    expect(ANEXO.length).toBeGreaterThan(1000);
    // En el Anexo la fecha es el hueco «{fecha de vigencia}» y el correo, el real:
    // se comparan así para que este test no dependa de que ya estén rellenados.
    const comoEnElAnexo = (t: string) =>
      normalizar(
        t
          .split(legal.TERMS_EFFECTIVE_DATE)
          .join('{fecha de vigencia}')
          .split(legal.CORREO_CONTACTO)
          .join(CORREO_DEL_ANEXO),
      );
    expect(publicados.filter((t) => !ANEXO.includes(comoEnElAnexo(t.texto))).map((t) => t.ruta)).toEqual([]);
  });
});
