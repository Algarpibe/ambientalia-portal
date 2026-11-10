import { describe, expect, it } from 'vitest';
import { HORA_POR_DEFECTO, leerConfig, MAX_HORAS_SYNC_POR_DEFECTO, RESERVA_POR_DEFECTO } from './config.js';

// Configuración desde el entorno. Drive ya no se configura aquí: lo lee n8n y manda la copia.
// Todo ficticio.
describe('leerConfig', () => {
  it('ya no lee Drive: ni cuenta de servicio ni carpetas', () => {
    const c = leerConfig({ EQUIPOS_GOOGLE_CUENTA_SERVICIO: '{"client_email":"x"}', EQUIPOS_DRIVE_ENTRADAS: 'carpetaEntradas01' });
    expect(Object.keys(c).sort()).toEqual(['alerta', 'horaDiaria', 'maxHorasSync', 'reserva', 'tokenSync']);
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

  it('el token de la alerta se recorta', () => {
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'https://n8n.example/webhook/x', EQUIPOS_ALERTA_TOKEN: '  t0k\n' }).alerta?.token).toBe('t0k');
  });
});

describe('leerConfig: la copia de Drive que manda n8n', () => {
  it('la frescura máxima es de 6 h salvo un entero de 1 a 168', () => {
    expect(MAX_HORAS_SYNC_POR_DEFECTO).toBe(6);
    expect(leerConfig({}).maxHorasSync).toBe(MAX_HORAS_SYNC_POR_DEFECTO);
    expect(leerConfig({ EQUIPOS_SYNC_MAX_HORAS: '12' }).maxHorasSync).toBe(12);
    expect(leerConfig({ EQUIPOS_SYNC_MAX_HORAS: ' 168 ' }).maxHorasSync).toBe(168);
    for (const v of ['0', '169', '1.5', '-3', 'seis', '']) expect(leerConfig({ EQUIPOS_SYNC_MAX_HORAS: v }).maxHorasSync, v).toBe(MAX_HORAS_SYNC_POR_DEFECTO);
  });

  it('del token solo se sabe si está y vale como cabecera; su valor no sale', () => {
    expect(leerConfig({}).tokenSync).toBe(false);
    expect(leerConfig({ EQUIPOS_SYNC_TOKEN: 'con espacio' }).tokenSync).toBe(false);
    const c = leerConfig({ EQUIPOS_SYNC_TOKEN: 'token-ficticio-123' });
    expect(c.tokenSync).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/token-ficticio-123/);
  });
});
