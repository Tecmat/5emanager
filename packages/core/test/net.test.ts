import { describe, expect, it } from 'vitest';
import { hostsInSubnet, intToIpv4, ipv4ToInt } from '../src/index.js';

describe('net utils (scansione LAN)', () => {
  it('ipv4ToInt / intToIpv4 round-trip e non validi', () => {
    expect(ipv4ToInt('192.168.1.10')).toBe(0xc0a8010a);
    expect(intToIpv4(0xc0a8010a)).toBe('192.168.1.10');
    expect(ipv4ToInt('999.1.1.1')).toBe(-1);
    expect(ipv4ToInt('abc')).toBe(-1);
  });
  it('hostsInSubnet /24 esclude rete e broadcast', () => {
    const hosts = hostsInSubnet('192.168.1.42', 24);
    expect(hosts.length).toBe(254);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts.at(-1)).toBe('192.168.1.254');
    expect(hosts).not.toContain('192.168.1.0');
    expect(hosts).not.toContain('192.168.1.255');
  });
  it('hostsInSubnet /30 e /16', () => {
    expect(hostsInSubnet('10.0.5.8', 30)).toEqual(['10.0.5.9', '10.0.5.10']);
    expect(hostsInSubnet('10.0.5.9', 16).length).toBe(65534);
    expect(hostsInSubnet('bad', 24)).toEqual([]);
  });
});
