import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as engine from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('public API', () => {
  it('exposes the engine and limits versions', () => {
    expect(engine.ENGINE_VERSION).toBe('1.0.0');
    expect(engine.LIMITS_VERSION).toBe('1.0.0');
    expect(typeof engine.evaluateVerification).toBe('function');
    expect(typeof engine.validateTraceability).toBe('function');
    expect(typeof engine.ozoneConcentrationPpm).toBe('function');
  });

  it('engine sources import nothing outside this folder', () => {
    const sources = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.includes('.test'));
    expect(sources.length).toBeGreaterThan(5);
    for (const f of sources) {
      const text = readFileSync(join(here, f), 'utf8');
      const specs = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specs) expect(s, `${f} imports ${s}`).toMatch(/^\.\/[\w.-]+\.js$/);
    }
  });
});
