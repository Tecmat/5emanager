import { describe, expect, it } from 'vitest';
import { isLocalhostHost, wsUrlFromLocation } from '../src/net.js';

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
