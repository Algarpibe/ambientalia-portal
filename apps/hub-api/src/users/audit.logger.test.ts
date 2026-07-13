import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { buildAuditEntry, AuditLogger } from './audit.logger.js';
import type { AuditOperation } from './users.types.js';

// Property test del log de auditoría (task 6.2).

const operationArb = fc.constantFrom<AuditOperation>(
  'register_user',
  'approve_user',
  'deactivate_user',
  'reactivate_user',
  'delete_user',
  'change_role',
  'update_apps',
);
const emailArb = fc.string({ minLength: 1, maxLength: 60 });
const inputArb = fc.record({ adminEmail: emailArb, targetEmail: emailArb, operation: operationArb });

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('AuditLogger — property test', () => {
  // Feature: user-management, Property 14: Audit log siempre registra los 4 campos requeridos
  // Validates: Requirements 5.5
  it('6.2 — cada entrada contiene timestamp ISO 8601 UTC, adminEmail, targetEmail y operation', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const entry = buildAuditEntry(input);

        // Los 4 campos presentes y con el valor esperado.
        expect(ISO_8601_UTC.test(entry.timestamp)).toBe(true);
        expect(entry.adminEmail).toBe(input.adminEmail);
        expect(entry.targetEmail).toBe(input.targetEmail);
        expect(entry.operation).toBe(input.operation);
        expect(entry.operation.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('6.2 — AuditLogger.log emite una línea JSON con los 4 campos', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          AuditLogger.log(input);
          expect(spy).toHaveBeenCalledTimes(1);
          const logged = JSON.parse(spy.mock.calls[0][0] as string);
          expect(ISO_8601_UTC.test(logged.timestamp)).toBe(true);
          expect(logged.adminEmail).toBe(input.adminEmail);
          expect(logged.targetEmail).toBe(input.targetEmail);
          expect(logged.operation).toBe(input.operation);
        } finally {
          spy.mockRestore();
        }
      }),
      { numRuns: 100 },
    );
  });
});
