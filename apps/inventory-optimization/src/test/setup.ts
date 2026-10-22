// Setup de tests de UI: matchers de jest-dom para vitest + limpieza del DOM
// entre tests (RTL 16 no auto-limpia sin globals) + el arreglo de localStorage.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { JSDOM } from 'jsdom';

// En Node 22+ el `localStorage` de Node tapa al de jsdom y vale `undefined` (la explicación
// entera está en apps/portal/src/vitest.setup.ts). Aquí muerde en cuanto se monta la tabla de
// resultados: lee el orden y el ancho de las columnas de localStorage al inicializar su estado.
// Se trae uno de un JSDOM aparte; la URL es obligatoria, porque jsdom niega localStorage a los
// orígenes opacos. Bajo Node 20 (el de CI) el global ya existe y esto no hace nada.
if (typeof window !== 'undefined' && !globalThis.localStorage) {
  globalThis.localStorage = new JSDOM('', { url: 'http://localhost:3000' }).window.localStorage;
}

afterEach(() => {
  cleanup();
});
