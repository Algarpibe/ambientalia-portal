// Setup de los tests: matchers de jest-dom, limpieza del DOM entre tests (RTL 16 no limpia
// sola sin globals) y el arreglo de localStorage.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { JSDOM } from 'jsdom';

// En Node 22+ el `localStorage` de Node tapa al de jsdom y vale `undefined` (la explicación
// entera está en apps/portal/src/vitest.setup.ts). Se trae uno de un JSDOM aparte; la URL es
// obligatoria, porque jsdom niega localStorage a los orígenes opacos.
if (typeof window !== 'undefined' && !globalThis.localStorage) {
  globalThis.localStorage = new JSDOM('', { url: 'http://localhost:3000' }).window.localStorage;
}

afterEach(() => {
  cleanup();
});
