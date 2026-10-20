// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import WidgetErrorBoundary from './WidgetErrorBoundary';

// FE-413 — un widget roto enseñaba «Error al renderizar: <mensaje crudo>» en la
// home del portal, a la vista de cualquiera que entre.

const sentry = vi.hoisted(() => ({ captureWidgetError: vi.fn() }));
vi.mock('../sentry', () => sentry);

function Revienta(): never {
  throw new Error('secret internal detail');
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  sentry.captureWidgetError.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WidgetErrorBoundary', () => {
  it('no enseña el mensaje crudo y el error sigue llegando a Sentry con su widget', () => {
    render(
      <WidgetErrorBoundary widgetId="w1" appId="ausencias" widgetName="Pendientes">
        <Revienta />
      </WidgetErrorBoundary>,
    );
    expect(screen.queryByText(/secret internal detail/)).toBeNull();
    expect(screen.getByText('Pendientes')).toBeTruthy();
    expect(screen.getByText(/No se pudo mostrar este widget/)).toBeTruthy();
    expect(sentry.captureWidgetError).toHaveBeenCalledWith(expect.any(Error), { widgetId: 'w1', appId: 'ausencias' });
  });
});
