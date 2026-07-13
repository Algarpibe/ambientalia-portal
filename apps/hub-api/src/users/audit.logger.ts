import type { AuditEntry, AuditOperation } from './users.types.js';

// Log de auditoría de las operaciones de gestión de usuarios (Requirement 5.5).
// Escribe una línea JSON estructurada a stdout; sin dependencias externas.
// Cada entrada contiene los 4 campos requeridos: timestamp (ISO 8601 UTC),
// adminEmail, targetEmail y operation (Property 14).

/** Datos de la operación; el `timestamp` lo genera el logger. */
export type AuditEventInput = Omit<AuditEntry, 'timestamp'>;

/**
 * Construye la entrada de auditoría completa, estampando el timestamp actual en
 * ISO 8601 UTC. Función pura respecto de sus argumentos (solo depende del reloj),
 * lo que la hace directamente verificable.
 */
export function buildAuditEntry(input: AuditEventInput): AuditEntry {
  return {
    timestamp: new Date().toISOString(), // ISO 8601 UTC (sufijo Z)
    adminEmail: input.adminEmail,
    targetEmail: input.targetEmail,
    operation: input.operation,
  };
}

export const AuditLogger = {
  /** Registra una operación de gestión de usuarios en el log del servidor. */
  log(input: AuditEventInput): void {
    const entry = buildAuditEntry(input);
    // Línea JSON estructurada; el campo `event` facilita el filtrado en logs.
    console.log(JSON.stringify({ event: 'user_management_audit', ...entry }));
  },
};

export type { AuditEntry, AuditOperation };
