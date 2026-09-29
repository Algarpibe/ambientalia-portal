import { describe, expect, it } from 'vitest';
import { ApiError, errorFromResponse, traceabilityDetailOf } from './apiError';

describe('errorFromResponse', () => {
  it('uses the Spanish message, code, field and detail sent by hub-api', () => {
    const e = errorFromResponse(409, { error: 'internal_code_taken', message: 'Ya existe un equipo.', field: 'internalCode' });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe('Ya existe un equipo.');
    expect(e.code).toBe('internal_code_taken');
    expect(e.field).toBe('internalCode');
    expect(e.status).toBe(409);
  });
  it('401 is always the expired-session message', () => {
    expect(errorFromResponse(401, { error: 'x' }).message).toMatch(/sesión/);
  });
  it('403 without a message means the app is not assigned; with one (role) keeps it', () => {
    expect(errorFromResponse(403, null).message).toMatch(/asignada/);
    expect(errorFromResponse(403, { error: 'forbidden_role', message: 'Su rol no tiene permiso.' }).message).toBe(
      'Su rol no tiene permiso.',
    );
  });
  it('other failures without a message get a generic text with the status', () => {
    const e = errorFromResponse(500, { error: 'internal error' });
    expect(e.message).toMatch(/500/);
    expect(e.code).toBe('internal error');
  });
});

describe('traceabilityDetailOf', () => {
  it('extracts blocking issues and warnings from a 422 traceability_blocked', () => {
    const issue = { code: 'REFERENCE_EXPIRED', messageEs: 'Venció', reference: 'TAD' };
    const e = errorFromResponse(422, {
      error: 'traceability_blocked',
      message: 'No cumple',
      detail: { issues: [issue], warnings: [] },
    });
    expect(traceabilityDetailOf(e)).toEqual({ issues: [issue], warnings: [] });
  });
  it('null for anything else', () => {
    expect(traceabilityDetailOf(new Error('x'))).toBeNull();
    expect(traceabilityDetailOf(errorFromResponse(422, { error: 'invalid_structure', message: 'x' }))).toBeNull();
  });
});
