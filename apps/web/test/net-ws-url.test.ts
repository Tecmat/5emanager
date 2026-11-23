import { describe, expect, it } from 'vitest';
import { isLocalhostHost, wsUrlFromLocation, toWsUrl, httpUrlFromWs } from '../src/net.js';

describe('wsUrlFromLocation (deploy HTTPS dietro nginx)', () => {
  it('usa wss:// quando la pagina e\' servita in https', () => {
    expect(wsUrlFromLocation({ protocol: 'https:', host: 'dnd.example.com' })).toBe('wss://dnd.example.com');
    expect(wsUrlFromLocation({ protocol: 'https:', host: 'dnd.example.com:8443' })).toBe('wss://dnd.example.com:8443');
  });
  it('usa ws:// in http (LAN / docker diretto)', () => {
    expect(wsUrlFromLocation({ protocol: 'http:', host: '192.168.1.10:3001' })).toBe('ws://192.168.1.10:3001');
  });
  it('isLocalhostHost riconosce localhost/127/::1, con e senza porta', () => {
    expect(isLocalhostHost('localhost')).toBe(true);
    expect(isLocalhostHost('localhost:3001')).toBe(true);
    expect(isLocalhostHost('tauri.localhost')).toBe(true);
    expect(isLocalhostHost('127.0.0.1')).toBe(true);
    expect(isLocalhostHost('127.0.0.1:3001')).toBe(true);
    expect(isLocalhostHost('[::1]:3001')).toBe(true);
    expect(isLocalhostHost('dnd.example.com')).toBe(false);
    expect(isLocalhostHost('dnd.example.com:443')).toBe(false);
  });
});

describe('toWsUrl / httpUrlFromWs (setup e scelta server: https -> wss)', () => {
  it('converte http/https in ws/wss e lascia ws/wss invariati', () => {
    expect(toWsUrl('https://dnd.example.com')).toBe('wss://dnd.example.com');
    expect(toWsUrl('http://192.168.1.10:3001')).toBe('ws://192.168.1.10:3001');
    expect(toWsUrl('wss://dnd.example.com')).toBe('wss://dnd.example.com');
    expect(toWsUrl('ws://10.0.0.5:3001')).toBe('ws://10.0.0.5:3001');
    expect(toWsUrl('192.168.1.10:3001')).toBe('ws://192.168.1.10:3001');
    expect(toWsUrl('  https://dnd.example.com/path  ')).toBe('wss://dnd.example.com/path');
    expect(toWsUrl('')).toBe('');
  });
  it('httpUrlFromWs torna indietro per aprire /admin', () => {
    expect(httpUrlFromWs('wss://dnd.example.com')).toBe('https://dnd.example.com');
    expect(httpUrlFromWs('ws://192.168.1.10:3001')).toBe('http://192.168.1.10:3001');
    expect(httpUrlFromWs('https://dnd.example.com')).toBe('https://dnd.example.com');
  });
});
