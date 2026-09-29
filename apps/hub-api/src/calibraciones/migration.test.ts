import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG, DEFAULT_LIMITS, LIMITS_VERSION } from './o3-engine/index.js';

// The default limit set and config are seeded by hardcoded SQL (migrations
// re-run on every boot, and the hub-api migration runner only executes .sql).
// This test is the guard that keeps the SQL copy equal to the engine defaults:
// changing DEFAULT_LIMITS without the migration (or vice versa) turns it red.

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'users', 'migrations', '040_calibraciones.sql'),
  'utf8',
);

function block(marker: string): string {
  const start = SQL.indexOf(`-- seed:${marker}:begin`);
  const end = SQL.indexOf(`-- seed:${marker}:end`);
  expect(start, `marker seed:${marker}:begin`).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('040_calibraciones.sql seeds', () => {
  it('seeds the engine default limit set under LIMITS_VERSION', () => {
    const b = block('limits');
    const m = /'(\{[\s\S]*?\})'::jsonb/.exec(b);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual(DEFAULT_LIMITS);
    expect(b).toContain(`'${LIMITS_VERSION}'`);
  });

  it('seeds the engine default config, key by key', () => {
    const b = block('config');
    const seeded: Record<string, unknown> = {};
    for (const m of b.matchAll(/\('(\w+)',\s*'([^']*)'::jsonb\)/g)) seeded[m[1]] = JSON.parse(m[2]);
    expect(seeded).toEqual(DEFAULT_CONFIG);
  });
});
