import { describe, expect, it } from 'vitest';
import type { Me } from '../types';
import { BUCKET, can, todayInColombia } from './domain';

describe('can', () => {
  const me = (permissions: Me['permissions']): Me => ({ userId: 'u', email: 'e', role: 'TECNICO', permissions, canManageRoles: false });
  it('reads the permissions sent by /roles/me', () => {
    expect(can(me(['read', 'verification.write']), 'verification.write')).toBe(true);
    expect(can(me(['read']), 'verification.approve')).toBe(false);
    expect(can(null, 'read')).toBe(false);
  });
});

describe('BUCKET', () => {
  it('30/15/0/vencido badges have Spanish labels and a tone', () => {
    expect(BUCKET.EXPIRED).toEqual({ label: 'Vencido', tone: 'red' });
    expect(BUCKET.DUE_TODAY.label).toBe('Vence hoy');
    expect(BUCKET.DUE_15.label).toBe('Vence en ≤ 15 días');
    expect(BUCKET.DUE_30.label).toBe('Vence en ≤ 30 días');
    expect(BUCKET.OK.tone).toBe('green');
    expect(BUCKET.NO_VALIDITY.tone).toBe('gray');
  });
});

describe('todayInColombia', () => {
  it('is the Bogotá calendar date (UTC−5) as YYYY-MM-DD', () => {
    expect(todayInColombia(new Date('2026-09-30T03:00:00Z'))).toBe('2026-09-29');
    expect(todayInColombia(new Date('2026-09-30T06:00:00Z'))).toBe('2026-09-30');
  });
});
