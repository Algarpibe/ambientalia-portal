// Setup de tests de UI: matchers de jest-dom para vitest + limpieza del DOM
// entre tests (RTL 16 no auto-limpia sin globals).
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
