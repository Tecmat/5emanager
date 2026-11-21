import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import type { StoredPasskey } from './accounts.js';

export interface RpConfig {
  rpName: string;
  rpID: string;
  origin: string;
}

/**
 * RP (Relying Party) derivato dall'header Host della richiesta WS, con override da env:
 *   DND5E_RP_ID     es. dnd.example.com        (solo dominio, senza schema/porta)
 *   DND5E_RP_ORIGIN es. https://dnd.example.com (origin esatto della pagina web servita)
 *   DND5E_RP_NAME   nome mostrato nel prompt della passkey
 * In locale (localhost/127.x) l'origin di default resta http, altrove https (tipicamente dietro
 * nginx in reverse proxy: vedi docs/DOCKER.md). Le passkey funzionano solo in secure context:
 * su LAN in chiaro (http://ip) il browser blocca WebAuthn.
 */
export function rpConfigFromHost(hostHeader: string | undefined): RpConfig {
  const host = String(hostHeader ?? '').split(',')[0].trim() || 'localhost';
  const rpID = (process.env.DND5E_RP_ID ?? '').trim() || host.split(':')[0] || 'localhost';
  let origin = (process.env.DND5E_RP_ORIGIN ?? '').trim();
  if (!origin) {
    const local = /^(localhost|127\.|\[?::1\]?)(\:|$)/.test(host);
    const h = local ? host : host.replace(/:443$/, '').replace(/:80$/, '');
    origin = `${local ? 'http' : 'https'}://${h}`;
  }
  return { rpName: (process.env.DND5E_RP_NAME ?? '').trim() || '5e Manager', rpID, origin };
}

const b64 = (u8: Uint8Array): string => Buffer.from(u8).toString('base64');

/** options per navigator.credentials.create(): user.id = username (server self-hosted privato) */
export async function registrationOptionsFor(
  username: string,
  existing: StoredPasskey[],
  rp: RpConfig,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: username,
    userID: new TextEncoder().encode(username),
    userDisplayName: username,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports as never })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred', requireResidentKey: false },
  });
}

/** verifica la risposta di registrazione e restituisce la credenziale da salvare (id base64url + publicKey base64) */
export async function verifyRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  rp: RpConfig,
  name: string,
): Promise<StoredPasskey> {
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: false,
  });
  if (!v.verified || !v.registrationInfo) {
    throw new Error('Registrazione passkey non verificata (challenge o origin non corrispondono)');
  }
  const info = v.registrationInfo;
  return {
    id: info.credential.id,
    publicKeyB64: b64(info.credential.publicKey),
    counter: info.credential.counter,
    transports: (response.response.transports ?? info.credential.transports) as string[] | undefined,
    name,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    createdAt: new Date().toISOString(),
  };
}

/** options per navigator.credentials.get(): allowCredentials vuota = passkey discoverable (senza username) */
export async function authenticationOptionsFor(
  rp: RpConfig,
  allowCredentials: StoredPasskey[] | undefined,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: allowCredentials?.map((p) => ({ id: p.id, transports: p.transports as never })),
    userVerification: 'preferred',
    timeout: 120000,
  });
}

export function toWebAuthnCredential(p: StoredPasskey): WebAuthnCredential {
  return {
    id: p.id,
    publicKey: new Uint8Array(Buffer.from(p.publicKeyB64, 'base64')),
    counter: p.counter,
    transports: p.transports as never,
  };
}

/** verifica l'asserzione di login e restituisce il nuovo counter (anti-replay) */
export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  rp: RpConfig,
  credential: WebAuthnCredential,
): Promise<number> {
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential,
    requireUserVerification: false,
  });
  if (!v.verified) throw new Error('Asserzione passkey non verificata');
  return v.authenticationInfo.newCounter;
}
