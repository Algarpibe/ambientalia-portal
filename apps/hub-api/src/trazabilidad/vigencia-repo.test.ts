import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { leerVigencias } from './vigencia-repo.js';

// La vigencia por marca (lote 11): la 063, su lectura y el CANDADO de quién la escribe.
const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('063_trazabilidad_vigencia_marcas.sql', () => {
  const sinComentarios = fuente('../users/migrations/063_trazabilidad_vigencia_marcas.sql').replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo crea sus dos tablas con IF NOT EXISTS: SIN SEMILLA (sin fila manda el código: al desplegar GRIMM sigue con 365 y las demás quedan sin vencimiento), sin clave foránea y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias.map((s) => /^CREATE (?:SCHEMA|TABLE) IF NOT EXISTS (portal(?:\.\w+)?)/.exec(s)?.[1])).toEqual(['portal', 'portal.tmc_marcas_vigencia', 'portal.tmc_marcas_vigencia_cambios']);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b|\bdesk\.|tmc_equipos|en_seguimiento/i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|destinatari|email|correo/i);
  });

  it('la vigencia por marca: null (sin vencimiento) o de 30 a 1095 días, con motivo y firma; GRIMM EDM 180 no puede tener fila', () => {
    expect(sinComentarios).toMatch(/clave\s+VARCHAR\(60\)\s+PRIMARY KEY/);
    expect(sinComentarios).toMatch(/dias\s+INTEGER\s+NULL CHECK \(dias IS NULL OR dias BETWEEN 30 AND 1095\)/);
    expect(sinComentarios).toMatch(/CONSTRAINT tmc_marcas_vigencia_no_edm180 CHECK \(clave <> 'grimm edm 180'\)/);
    expect(sinComentarios.match(/motivo\s+TEXT\s+NOT NULL CHECK \(btrim\(motivo\) <> ''\)/g)).toHaveLength(2);
  });

  it('el historial: un apunte por cambio con el valor anterior y el nuevo (los dos pueden ser «sin vencimiento»), quién y cuándo', () => {
    expect(sinComentarios).toMatch(/antes\s+INTEGER\s+NULL/);
    expect(sinComentarios).toMatch(/despues\s+INTEGER\s+NULL/);
    expect(sinComentarios.match(/por\s+VARCHAR\(254\)\s+NOT NULL/g)).toHaveLength(2);
    expect(sinComentarios).not.toMatch(/cliente|\bserial\b/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 062 (la 064, del lote 12, va detrás)', () => {
    expect(fuente('../db.ts')).toMatch(/'062_trazabilidad_pasadas_nocturnas\.sql',\s*'063_trazabilidad_vigencia_marcas\.sql',/);
  });
});

describe('leerVigencias', () => {
  it('lee las dos tablas de la regla en UNA consulta: marca → días, null (sin vencimiento) o «según contrato»; cliente → meses o null', async () => {
    const sqls: string[] = [];
    const filas = [
      { de: 'marca', clave: 'horiba', valor: null, contrato: true },
      { de: 'marca', clave: 'kunak', valor: 730, contrato: false },
      { de: 'marca', clave: 'tca', valor: null, contrato: false },
      { de: 'cliente', clave: 'cliente ficticio a', valor: 6, contrato: false },
      { de: 'cliente', clave: 'cliente ficticio b', valor: null, contrato: false },
    ];
    const db = { query: async (sql: string) => (sqls.push(sql), { rows: filas }) } as unknown as Pool;
    const { vigencias, contratos } = await leerVigencias(db);
    expect([...vigencias]).toEqual([['horiba', 'contrato'], ['kunak', 730], ['tca', null]]);
    expect([...contratos]).toEqual([['cliente ficticio a', 6], ['cliente ficticio b', null]]);
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toMatch(/^SELECT 'marca' AS de, clave, dias AS valor, contrato FROM portal\.tmc_marcas_vigencia\s+UNION ALL\s+SELECT 'cliente', clave, meses, FALSE FROM portal\.tmc_contratos$/);
  });
});

// CANDADO del lote 11. Cambiar la vigencia de una marca mueve a sus equipos dentro o fuera de Avisos, así que sólo un fichero escribe
// sus dos tablas (marcas-repo.ts, con la firma, el motivo y el permiso de su interruptor) y nada de esto envía ni avisa a nadie.
describe('CANDADO: quién escribe la vigencia de una marca', () => {
  const ficheros = ['./repo.ts', './hoja-repo.ts', './calibraciones-repo.ts', './exportacion-repo.ts', './maestro-repo.ts', './edicion-repo.ts', './retiros-repo.ts', './pasadas-nocturnas-repo.ts', './vigencia-repo.ts', './marcas-repo.ts', './contratos-repo.ts'];
  it('sólo marcas-repo.ts inserta en tmc_marcas_vigencia y tmc_marcas_vigencia_cambios; nadie las cambia ni las borra', () => {
    const escriben = ficheros.filter((f) => /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+portal\.tmc_marcas_vigencia/.test(fuente(f)));
    expect(escriben).toEqual(['./marcas-repo.ts']);
    for (const f of ficheros) expect(fuente(f), f).not.toMatch(/(UPDATE|DELETE\s+FROM|TRUNCATE)\s+portal\.tmc_marcas_vigencia/);
  });

  it('nada de la vigencia avisa a nadie ni programa nada', () => {
    for (const f of ['./marcas.ts', './vigencia-repo.ts']) expect(fuente(f), f).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
  });
});
