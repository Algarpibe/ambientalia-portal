import { describe, it, expect } from 'vitest';
import { CAL_ROLES, resolveRole, can, assertCan, permissionsOf, type CalAction } from './roles.js';
import { CalError } from './types.js';

describe('resolveRole', () => {
  it('a user with the app but no role row is LECTOR', () => {
    expect(resolveRole(null)).toBe('LECTOR');
    expect(resolveRole(undefined)).toBe('LECTOR');
  });

  it('keeps a known stored role', () => {
    for (const r of CAL_ROLES) expect(resolveRole(r)).toBe(r);
  });

  it('an unknown stored value falls back to the least privileged role', () => {
    expect(resolveRole('ADMIN')).toBe('LECTOR');
  });
});

describe('permission matrix', () => {
  const writeActions: CalAction[] = [
    'equipment.write',
    'verification.write',
    'verification.calculate',
    'verification.newVersion',
  ];
  const directorOnly: CalAction[] = [
    'equipment.level',
    'verification.approve',
    'limits.write',
    'config.write',
    'level4.override',
  ];

  it('LECTOR is read-only', () => {
    expect(can('LECTOR', 'read')).toBe(true);
    for (const a of [...writeActions, ...directorOnly]) expect(can('LECTOR', a)).toBe(false);
  });

  it('TECNICO edits drafts and calculates but cannot approve or change limits', () => {
    for (const a of ['read' as CalAction, ...writeActions]) expect(can('TECNICO', a)).toBe(true);
    for (const a of directorOnly) expect(can('TECNICO', a)).toBe(false);
  });

  it('DIRECTOR_TECNICO can do everything', () => {
    for (const a of ['read' as CalAction, ...writeActions, ...directorOnly]) {
      expect(can('DIRECTOR_TECNICO', a)).toBe(true);
    }
  });

  it('permissionsOf lists the granted actions', () => {
    expect(permissionsOf('LECTOR')).toEqual(['read']);
    expect(permissionsOf('DIRECTOR_TECNICO')).toContain('verification.approve');
  });
});

describe('assertCan', () => {
  it('throws a 403 CalError with a Spanish message when not allowed', () => {
    try {
      assertCan('TECNICO', 'verification.approve');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CalError);
      expect((e as CalError).status).toBe(403);
      expect((e as CalError).code).toBe('forbidden_role');
      expect((e as CalError).messageEs).toMatch(/permiso/i);
    }
  });

  it('does nothing when allowed', () => {
    expect(() => assertCan('DIRECTOR_TECNICO', 'verification.approve')).not.toThrow();
  });
});
