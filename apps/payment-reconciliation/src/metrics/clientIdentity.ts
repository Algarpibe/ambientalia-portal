/** A client as the KPIs group it: spelling variants share the key; `name` is for display. */
export interface ClientIdentity {
  key: string;
  name: string;
}

// ReconciledRow has no customer id, so clients are identified by a normalized
// name: trimmed, inner whitespace collapsed, case-insensitive.
export function clientIdentity(raw: string | null | undefined): ClientIdentity {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ') || 'Sin cliente';
  return { key: name.toLocaleUpperCase('es'), name };
}
