import { describe, it, expect } from 'vitest';
import * as api from '../api';
import * as adjuntos from './adjuntos';
import * as calendario from './calendario';
import * as historico from './historico';
import * as http from './http';
import * as kpis from './kpis';
import * as modificaciones from './modificaciones';
import * as notas from './notas';
import * as organigrama from './organigrama';
import * as registro from './registro';
import * as retiro from './retiro';
import * as saldos from './saldos';
import * as solicitudes from './solicitudes';

// ARQ-612 — api.ts se parte en trozos dentro de api/, con el mismo patrón que
// repo.ts y service.ts en hub-api: sigue siendo la ÚNICA puerta y reexporta
// todo lo de los trozos. Dos cosas lo sostienen, y las dos fallan en silencio
// si se rompen:
//
//  1. Que api.ts exporte las MISMAS funciones que el trozo. Los componentes
//     las importan de './api'.
//  2. Que nadie más importe de api/. Cuatro tests de componentes (App,
//     BandejaAprobacion, PanelOrganigrama, TablaSolicitudes) sustituyen './api'
//     por un doble parcial con vi.mock; un componente que importara un trozo
//     directamente se saltaría el doble y su test acabaría en un fetch de
//     verdad. El compilador no lo ve.
//
// Y al revés, INTERNOS: http.ts —los verbos y la lectura de los errores— es
// infraestructura que ningún componente debe llamar. Si se colara por un
// `export *`, los endpoints tipados dejarían de ser la única vía al servidor.
//
// tipos.ts no está en TROZOS porque solo tiene tipos, que no existen en tiempo
// de ejecución: si api.ts dejara de reexportarlos, lo diría el typecheck en
// cada componente que los importa.
//
// Cada PR que saque un trozo nuevo lo añade a TROZOS.

const TROZOS: Record<string, Record<string, unknown>> = {
  adjuntos,
  calendario,
  historico,
  kpis,
  modificaciones,
  notas,
  organigrama,
  registro,
  retiro,
  saldos,
  solicitudes,
};

const INTERNOS: Record<string, Record<string, unknown>> = { http };

// Los fuentes de src/, como texto. Con import.meta.glob y no con node:fs: el
// tsconfig de la app solo carga los tipos de vite/client, y los tests también
// pasan por él.
const FUENTES = import.meta.glob<string>('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

// Este fichero vive en src/api/; las claves del glob son relativas a él.
const AQUI = new URL('file:///src/api/');
const API_TS = '/src/api.ts';
const API_DIR = '/src/api/';

describe('api.ts como barril de api/ (ARQ-612)', () => {
  for (const [nombre, trozo] of Object.entries(TROZOS)) {
    it(`reexporta todas las funciones de api/${nombre}.ts, y son las mismas`, () => {
      const funciones = Object.keys(trozo).filter((k) => typeof trozo[k] === 'function');
      expect(funciones.length).toBeGreaterThan(0);
      for (const f of funciones) expect((api as Record<string, unknown>)[f], f).toBe(trozo[f]);
    });
  }

  for (const [nombre, interno] of Object.entries(INTERNOS)) {
    it(`NO reexporta las funciones de api/${nombre}.ts, que son internas`, () => {
      const funciones = Object.keys(interno).filter((k) => typeof interno[k] === 'function');
      expect(funciones.length).toBeGreaterThan(0);
      for (const f of funciones) expect((api as Record<string, unknown>)[f], f).toBeUndefined();
    });
  }

  it('solo api.ts importa de api/: el resto pasa por api.ts', () => {
    // Que el glob haya leído de verdad la app; si no, la guarda pasaría vacía.
    expect(Object.keys(FUENTES).length).toBeGreaterThan(20);

    // Por la ruta RESUELTA y no por el texto del import: desde una subcarpeta
    // el mismo trozo se escribe '../api/x', y una expresión sobre './api/' no
    // lo vería. Los imports del front van sin extensión: './api' resuelve a
    // /src/api y no entra en /src/api/.
    const infractores = Object.entries(FUENTES)
      .map(([clave, texto]) => ({ fichero: new URL(clave, AQUI).pathname, texto }))
      .filter(({ fichero }) => fichero !== API_TS && !fichero.startsWith(API_DIR))
      .filter(({ fichero, texto }) =>
        [...texto.matchAll(/from '(\.[^']+)'/g)].some((m) =>
          new URL(m[1], new URL(fichero, 'file:///')).pathname.startsWith(API_DIR),
        ),
      )
      .map(({ fichero }) => fichero);
    expect(infractores).toEqual([]);
  });
});
