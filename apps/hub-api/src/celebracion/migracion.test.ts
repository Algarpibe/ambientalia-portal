import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
// Sin comentarios: lo que se comprueba es el SQL que se ejecuta.
const sql = () => leer('../users/migrations/081_celebracion.sql').replace(/--.*$/gm, '');

describe('migración 081 (invitación de fin de año)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 080', () => {
    expect(leer('../db.ts')).toMatch(/'080_ausencias_registrada_por\.sql',\s*'081_celebracion\.sql'[,\]]/);
  });

  it('es idempotente y no toca datos: solo CREATE ... IF NOT EXISTS', () => {
    const texto = sql();
    expect(texto).toMatch(/CREATE TABLE IF NOT EXISTS portal\.celebracion_confirmaciones/);
    expect(texto).toMatch(/CREATE TABLE IF NOT EXISTS portal\.celebracion_votos/);
    expect(texto).toMatch(/CREATE INDEX IF NOT EXISTS idx_celebracion_votos_votado/);
    expect(texto).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+portal\.|\bDELETE\s+FROM\b/i);
  });

  it('la BD impide votarse a uno mismo y que quien no va tenga preferencia', () => {
    const texto = sql();
    expect(texto).toMatch(/CONSTRAINT celebracion_votos_no_propio CHECK \(votante_id <> votado_id\)/);
    expect(texto).toMatch(/CHECK \(asiste OR preferencia IS NULL\)/);
  });

  it('el rol de las peticiones no borra confirmaciones ni edita votos (DATA-332)', () => {
    const texto = sql();
    expect(texto).toMatch(/REVOKE DELETE, TRUNCATE ON portal\.celebracion_confirmaciones FROM portal_app/);
    expect(texto).toMatch(/REVOKE UPDATE, TRUNCATE ON portal\.celebracion_votos FROM portal_app/);
  });
});

const sql082 = () => leer('../users/migrations/082_celebracion_excluidos.sql').replace(/--.*$/gm, '');

describe('migración 082 (personas quitadas de la invitación)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 081', () => {
    expect(leer('../db.ts')).toMatch(/'081_celebracion\.sql',\s*'082_celebracion_excluidos\.sql'[,\]]/);
  });

  it('es idempotente y no toca datos: solo CREATE TABLE IF NOT EXISTS', () => {
    const texto = sql082();
    expect(texto).toMatch(/CREATE TABLE IF NOT EXISTS portal\.celebracion_excluidos/);
    expect(texto).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+portal\.|\bDELETE\s+FROM\b/i);
  });

  it('el rol de las peticiones no edita exclusiones (DATA-332)', () => {
    expect(sql082()).toMatch(/REVOKE UPDATE, TRUNCATE ON portal\.celebracion_excluidos FROM portal_app/);
  });
});

const sql083 = () => leer('../users/migrations/083_celebracion_fotos.sql').replace(/--.*$/gm, '');

describe('migración 083 (foto graciosa del almuerzo)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 082, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'082_celebracion_excluidos\.sql',\s*'083_celebracion_fotos\.sql'\];/);
  });

  it('es idempotente y no toca datos: solo CREATE TABLE IF NOT EXISTS', () => {
    const texto = sql083();
    expect(texto).toMatch(/CREATE TABLE IF NOT EXISTS portal\.celebracion_fotos/);
    expect(texto).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+portal\.|\bDELETE\s+FROM\b/i);
  });

  it('el rol de las peticiones no borra fotos (DATA-332)', () => {
    expect(sql083()).toMatch(/REVOKE DELETE, TRUNCATE ON portal\.celebracion_fotos FROM portal_app/);
  });
});
