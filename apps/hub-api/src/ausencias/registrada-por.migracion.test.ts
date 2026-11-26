import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// La migración 080 sin base de datos: que está apuntada (y es la última), que
// solo añade la columna, nullable y con IF NOT EXISTS, y que no siembra ni toca
// permisos. Lo que hace contra Postgres lo vigila incapacidad-ajena.db.test.ts, y
// que portal_app la pueda escribir sin GRANT nuevo, db.roles.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL_080 = leer('../users/migrations/080_ausencias_registrada_por.sql');
// Sin comentarios: el texto explicativo nombra GRANT sin ser sentencia.
const SIN_COMENTARIOS = SQL_080.replace(/--.*$/gm, '');

describe('migración 080 (quién registró la incapacidad)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 079', () => {
    expect(leer('../db.ts')).toMatch(/'079_terms_acceptances\.sql',\s*'080_ausencias_registrada_por\.sql'[,\]]/);
  });

  it('añade la columna, nullable y con IF NOT EXISTS (se re-ejecuta en cada arranque)', () => {
    expect(SIN_COMENTARIOS).toMatch(
      /ALTER TABLE portal\.solicitudes_ausencia\s+ADD COLUMN IF NOT EXISTS registrada_por VARCHAR\(254\);/,
    );
    // NULL es el valor de toda la que registró la propia persona: ni NOT NULL
    // ni DEFAULT, o las filas que ya existen quedarían «registradas por» alguien.
    expect(SIN_COMENTARIOS).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it('no siembra, ni cambia, ni borra nada, y no toca permisos', () => {
    expect(SIN_COMENTARIOS).not.toMatch(/INSERT\s+INTO|UPDATE\s+portal|\b(DROP|TRUNCATE)\b|DELETE\s+FROM|\b(GRANT|REVOKE)\b/i);
  });
});
