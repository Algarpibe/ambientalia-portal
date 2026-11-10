import { describe, expect, it } from 'vitest';
import { inspect } from 'node:util';
import { HORA_POR_DEFECTO, leerConfig, RESERVA_POR_DEFECTO } from './config.js';

// Configuración desde el entorno: qué deja el módulo «sin configurar» y qué se apaga.
// Todo ficticio: ni la clave ni las carpetas son reales.
const SA = JSON.stringify({ client_email: 'sa@ficticio.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n' });
const DRIVE = {
  EQUIPOS_GOOGLE_CUENTA_SERVICIO: SA,
  EQUIPOS_DRIVE_ENTRADAS: 'carpetaEntradas01',
  EQUIPOS_DRIVE_SALIDAS_N8N: 'carpetaSalidasN8n1',
  EQUIPOS_DRIVE_SALIDAS_ESCANEADAS: 'carpetaEscaneos01',
  EQUIPOS_DRIVE_TEMPORAL: 'carpetaTemporal01',
};

describe('leerConfig', () => {
  it('con todo lo de Drive queda configurado, con las carpetas en su sitio', () => {
    const c = leerConfig(DRIVE);
    expect(c.faltaDrive).toEqual([]);
    expect(c.drive?.carpetas).toEqual({ entradas: 'carpetaEntradas01', salidasGeneradas: 'carpetaSalidasN8n1', salidasEscaneadas: 'carpetaEscaneos01' });
    expect(c.drive?.carpetaTemporalOcr).toBe('carpetaTemporal01');
    expect(c.drive?.cuentaServicio.client_email).toBe('sa@ficticio.iam.gserviceaccount.com');
  });

  it('sin la cuenta de servicio, o con un JSON que no vale, queda sin configurar y nombra la variable (sin su valor)', () => {
    expect(leerConfig({ ...DRIVE, EQUIPOS_GOOGLE_CUENTA_SERVICIO: undefined })).toMatchObject({ drive: null, faltaDrive: ['EQUIPOS_GOOGLE_CUENTA_SERVICIO'] });
    const mal = leerConfig({ ...DRIVE, EQUIPOS_GOOGLE_CUENTA_SERVICIO: '{"client_email":"x"' });
    expect(mal.drive).toBeNull();
    expect(JSON.stringify(mal)).not.toMatch(/client_email/);
  });

  it('una carpeta que falta o con caracteres raros deja el módulo sin configurar', () => {
    expect(leerConfig({ ...DRIVE, EQUIPOS_DRIVE_TEMPORAL: '' }).faltaDrive).toEqual(['EQUIPOS_DRIVE_TEMPORAL']);
    expect(leerConfig({ ...DRIVE, EQUIPOS_DRIVE_ENTRADAS: "abc' or name contains '" }).faltaDrive).toEqual(['EQUIPOS_DRIVE_ENTRADAS']);
  });

  it('la hora diaria es 06:30 salvo una HH:MM válida', () => {
    expect(leerConfig({}).horaDiaria).toBe(HORA_POR_DEFECTO);
    expect(leerConfig({ EQUIPOS_HORA_DIARIA: '07:15' }).horaDiaria).toBe('07:15');
    expect(leerConfig({ EQUIPOS_HORA_DIARIA: '25:00' }).horaDiaria).toBe(HORA_POR_DEFECTO);
  });

  it('la alerta necesita URL https (o un servicio interno) y token; si no, queda apagada', () => {
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'https://n8n.example/webhook/x', EQUIPOS_ALERTA_TOKEN: 't0k' }).alerta).toEqual({ url: 'https://n8n.example/webhook/x', token: 't0k' });
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'http://n8n:5678/webhook/x', EQUIPOS_ALERTA_TOKEN: 't0k' }).alerta).not.toBeNull();
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'http://n8n.example/webhook/x', EQUIPOS_ALERTA_TOKEN: 't0k' }).alerta).toBeNull();
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'https://n8n.example/webhook/x' }).alerta).toBeNull();
  });

  it('la reserva es comercial@ salvo otra dirección del dominio', () => {
    expect(leerConfig({}).reserva).toBe(RESERVA_POR_DEFECTO);
    expect(leerConfig({ EQUIPOS_ALERTA_RESERVA: 'Taller@Ambientalia.com.co' }).reserva).toBe('taller@ambientalia.com.co');
    expect(leerConfig({ EQUIPOS_ALERTA_RESERVA: 'alguien@gmail.com' }).reserva).toBe(RESERVA_POR_DEFECTO);
  });
});

describe('leerConfig: endurecimiento', () => {
  it('la clave privada no sale ni por JSON.stringify ni por util.inspect, pero se sigue pudiendo leer', () => {
    const c = leerConfig(DRIVE);
    expect(c.drive?.cuentaServicio.private_key).toContain('PRIVATE KEY');
    expect(JSON.stringify(c)).not.toMatch(/PRIVATE KEY|AAA/);
    expect(inspect(c, { depth: 10 })).not.toMatch(/PRIVATE KEY|AAA/);
  });

  it('una clave con los saltos de línea escapados dos veces se normaliza', () => {
    const doble = JSON.stringify({ client_email: 'sa@ficticio.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\\nAAA\\n-----END PRIVATE KEY-----\\n' });
    expect(leerConfig({ ...DRIVE, EQUIPOS_GOOGLE_CUENTA_SERVICIO: doble }).drive?.cuentaServicio.private_key).toBe('-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n');
  });

  it('el token de la alerta se recorta', () => {
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'https://n8n.example/webhook/x', EQUIPOS_ALERTA_TOKEN: '  t0k\n' }).alerta?.token).toBe('t0k');
  });
});
