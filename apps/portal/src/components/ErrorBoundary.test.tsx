// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// FE-413 — la pantalla de error del portal pintaba `error.message` tal cual: en
// inglés, con detalles internos, y sin decir qué hacer.

const sentry = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock('../sentry', () => sentry);

function Revienta({ error }: { error: Error }): never {
  throw error;
}

function pintar(error: Error) {
  return render(
    <ErrorBoundary>
      <Revienta error={error} />
    </ErrorBoundary>,
  );
}

beforeEach(() => {
  // React vuelve a lanzar a consola lo que captura un boundary; aquí es ruido.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  sentry.captureError.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary del portal', () => {
  it('no enseña el mensaje crudo del error, sino un texto genérico en español', () => {
    pintar(new Error('secret internal detail'));
    expect(screen.queryByText(/secret internal detail/)).toBeNull();
    expect(screen.getByText(/Algo falló al mostrar esta aplicación/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('el error real sigue llegando a Sentry', () => {
    const error = new Error('secret internal detail');
    pintar(error);
    expect(sentry.captureError).toHaveBeenCalledWith(error);
  });

  it.each([
    ['Chrome', new TypeError('Failed to fetch dynamically imported module: https://portal.test/assets/App-abc123.js')],
    ['Firefox', new TypeError('error loading dynamically imported module: https://portal.test/assets/App-abc123.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['webpack', Object.assign(new Error('Loading chunk 7 failed.'), { name: 'ChunkLoadError' })],
  ])('un chunk que no se pudo descargar (%s) pide recargar la página', (_navegador, error) => {
    pintar(error);
    expect(screen.queryByText(/dynamically imported|module script|Loading chunk/)).toBeNull();
    expect(screen.getByText(/versión nueva del portal/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recargar la página' })).toBeTruthy();
  });
});
