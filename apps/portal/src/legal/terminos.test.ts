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
// TERMS_EFFECTIVE_DATE y CORREO_CONTACTO tienen que estar siempre puestos: si
// alguno vuelve a ser un marcador, o deja de coincidir con el Anexo, los tests de
// marcadores, de la fecha y del correo se ponen en rojo.

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

  it('ningún texto lleva un hueco entre corchetes o llaves', () => {
    expect(
      publicados.filter((t) => /\[[^\]]*\]|\{[^}]*\}/.test(t.texto)),
      'queda un marcador sin rellenar en el texto publicado; hay que poner el valor real, no uno cualquiera',
    ).toEqual([]);
  });

  it('la fecha de vigencia está puesta y sale en la línea de versión y en el §2.8', () => {
    const MESES = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];
    expect(
      legal.TERMS_EFFECTIVE_DATE,
      'la fecha de vigencia debe ser una fecha real, la del despliegue de esa versión',
    ).toMatch(
      new RegExp(`^([1-9]|[12]\\d|3[01]) de (${MESES.join('|')}) de \\d{4}$`),
    );
    // Fecha de calendario real: «31 de febrero» no existe y no puede publicarse.
    const [dia, , mes, , anio] = legal.TERMS_EFFECTIVE_DATE.split(' ');
    const fecha = new Date(Date.UTC(Number(anio), MESES.indexOf(mes), Number(dia)));
    expect([fecha.getUTCDate(), MESES[fecha.getUTCMonth()], fecha.getUTCFullYear()]).toEqual([
      Number(dia),
      mes,
      Number(anio),
    ]);
    expect(legal.LINEA_VERSION).toContain(legal.TERMS_EFFECTIVE_DATE);
    expect(
      publicados.some((t) => t.texto.startsWith(`Esta política rige desde el ${legal.TERMS_EFFECTIVE_DATE}.`)),
    ).toBe(true);
  });

  it('el correo de contacto está puesto y es el del Anexo (§2.1)', () => {
    expect(CORREO_DEL_ANEXO).toContain('@');
    expect(
      legal.CORREO_CONTACTO,
      'CORREO_CONTACTO debe ser la dirección de la fila «Canal de contacto» del Anexo',
    ).toBe(CORREO_DEL_ANEXO);
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

  it('cada fila de cada tabla tiene tantas celdas como columnas', () => {
    // El test del texto entero aplana las tablas: con filas del mismo ancho, texto
    // aplanado igual implica tablas idénticas; sin esto, mover una celda al inicio
    // de la fila siguiente pasaría sin que nadie lo viera.
    const tablas = legal.SECCIONES.flatMap((s) => s.apartados.flatMap((a) => a.bloques)).filter(
      (b): b is legal.Tabla => b.tipo === 'tabla',
    );
    expect(tablas).toHaveLength(5);
    for (const t of tablas) {
      expect(t.filas.every((f) => f.length === t.columnas.length), t.columnas.join(' | ')).toBe(true);
    }
  });

  it('el texto entero coincide con el Anexo, en los dos sentidos y en el mismo orden', () => {
    // Complementa al test anterior, que solo mira pieza a pieza (una frase borrada,
    // un párrafo recortado o dos celdas intercambiadas pasarían). Aquí se compara
    // todo el texto, en el orden en que se pinta, contra el Anexo sin su sintaxis
    // Markdown.
    const crudo = readFileSync(SPEC, 'utf8').split('## Anexo')[1] ?? '';
    const [cuerpoCrudo, colaCrudo = ''] = crudo.split('**Casilla');
    const deMarkdown = cuerpoCrudo
      .split('\n')
      .slice(1) // el resto de la línea «## Anexo — …»
      .filter((l) => !l.startsWith('>')) // la nota que explica el hueco de la fecha
      .filter((l) => !/^\|[-:| ]+\|\s*$/.test(l)) // la fila separadora de las tablas
      .map((l) => {
        if (l.startsWith('|')) return l.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim()).join(' ');
        return l.replace(/^#+\s+/, '').replace(/^- /, '');
      })
      .join(' ')
      .replace(/\*\*/g, '');
    const delAnexo = normalizar(
      deMarkdown.split('{fecha de vigencia}').join(legal.TERMS_EFFECTIVE_DATE).split(CORREO_DEL_ANEXO).join(legal.CORREO_CONTACTO),
    );

    const bloques = (b: legal.Bloque): string[] =>
      b.tipo === 'parrafo'
        ? [b.destacado ?? '', b.texto]
        : b.tipo === 'lista'
          ? b.items
          : [...b.columnas, ...b.filas.flat()];
    const delCodigo = normalizar(
      [
        legal.TITULO_TERMINOS,
        legal.INTRODUCCION,
        legal.LINEA_VERSION,
        ...legal.SECCIONES.flatMap((s) => [
          s.titulo,
          ...s.apartados.flatMap((a) => [a.titulo ?? '', ...a.bloques.flatMap(bloques)]),
        ]),
      ].join(' '),
    );

    expect(delAnexo.length).toBeGreaterThan(3000);
    expect(delCodigo.trim()).toBe(delAnexo.trim());

    // La casilla va aparte: en el Anexo es el texto entre « y ».
    const casilla = /«([^»]*)»/.exec(normalizar(colaCrudo))?.[1];
    expect(casilla).toBeTruthy();
    expect(normalizar(legal.TEXTO_CASILLA)).toBe(casilla);
  });
});
