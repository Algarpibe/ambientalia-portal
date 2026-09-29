/**
 * Calibraciones roles and permissions.
 *
 * Roles live in portal.cal_user_roles; a user who has the app but no row is
 * LECTOR (DECISIONS D-016). Portal admins manage the role table but are NOT
 * directors: approving a calibration is a technical competence (ISO/IEC 17025
 * §6.2), not an administrative one.
 */

import { CalError } from './types.js';

export type CalRole = 'TECNICO' | 'DIRECTOR_TECNICO' | 'LECTOR';

export const CAL_ROLES: readonly CalRole[] = ['TECNICO', 'DIRECTOR_TECNICO', 'LECTOR'];

export type CalAction =
  | 'read'
  | 'equipment.write'
  /** Setting an equipment traceability level by hand. */
  | 'equipment.level'
  | 'verification.write'
  | 'verification.calculate'
  | 'verification.newVersion'
  | 'verification.approve'
  | 'limits.write'
  | 'config.write'
  | 'level4.override';

const TECNICO_ACTIONS: readonly CalAction[] = [
  'read',
  'equipment.write',
  'verification.write',
  'verification.calculate',
  'verification.newVersion',
];

const PERMISSIONS: Record<CalRole, readonly CalAction[]> = {
  LECTOR: ['read'],
  TECNICO: TECNICO_ACTIONS,
  DIRECTOR_TECNICO: [
    ...TECNICO_ACTIONS,
    'equipment.level',
    'verification.approve',
    'limits.write',
    'config.write',
    'level4.override',
  ],
};

/** Stored value → role. Missing or unknown values fall back to the least privileged role. */
export function resolveRole(stored: string | null | undefined): CalRole {
  return (CAL_ROLES as readonly string[]).includes(stored ?? '') ? (stored as CalRole) : 'LECTOR';
}

export function can(role: CalRole, action: CalAction): boolean {
  return PERMISSIONS[role].includes(action);
}

export function permissionsOf(role: CalRole): CalAction[] {
  return [...PERMISSIONS[role]];
}

export function assertCan(role: CalRole, action: CalAction): void {
  if (!can(role, action)) {
    throw new CalError('forbidden_role', 403, 'Su rol en Calibraciones no tiene permiso para esta acción.', undefined, {
      role,
      action,
    });
  }
}
