import { describe, it, expect } from 'vitest';
import { errorFromResponse } from './apiError';

describe('errorFromResponse', () => {
  it('usa el mensaje en español del servidor y conserva el campo', () => {
    const e = errorFromResponse(400, { error: 'invalid_input', message: 'Falta «cliente».', field: 'filas[0].cliente' });
    expect(e).toMatchObject({ status: 400, code: 'invalid_input', message: 'Falta «cliente».', field: 'filas[0].cliente' });
  });
  it('401 siempre pide volver a entrar; 403 sin mensaje habla de la app', () => {
    expect(errorFromResponse(401, { message: 'x' }).message).toMatch(/sesión ha caducado/);
    expect(errorFromResponse(403, { error: 'forbidden' }).message).toMatch(/no tienes esta aplicación/i);
  });
  it('un 500 sin cuerpo da un mensaje genérico', () => {
    expect(errorFromResponse(500, null).message).toMatch(/error 500/);
  });
});
