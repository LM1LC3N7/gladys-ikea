// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, plus the keys the
// integration stores itself after a pairing (STORED), normalized.
// -----------------------------------------------------------------------------

import { STORED } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  dirigera_host: '',
  verify_certificate: true,
  tradfri_host: '',
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * The address typed by the user: an IP address or a host name. A pasted URL
 * ("https://192.168.1.20:8443/") is reduced to its host.
 * @returns {{ host: string } | { error: 'invalid' }} `host` is '' when empty.
 */
export function parseHost(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return { host: '' };
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  const bracketed = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/i.exec(text);
  if (bracketed) {
    return { host: bracketed[1].toLowerCase() };
  }
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) {
    return { host: text.toLowerCase() };
  }
  const host = text.replace(/:\d{1,5}$/, '');
  if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label))) {
    return { error: 'invalid' };
  }
  return { host: host.toLowerCase() };
}

/** A host as it goes in a URL: an IPv6 address between brackets. */
export const urlHost = (host) => (host.includes(':') ? `[${host}]` : host);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The configuration of each gateway. `host` is the address to use (typed, or
 * found at the last pairing or mDNS scan), `typed` says whether the user chose
 * it (then it is never replaced by a discovered one).
 */
export function normalizeConfig(raw = {}) {
  const c = {
    ...DEFAULTS,
    ...Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => v != null)),
  };
  const dirigeraHost = parseHost(c.dirigera_host);
  const tradfriHost = parseHost(c.tradfri_host);
  const dirigeraStored = parseHost(c[STORED.DIRIGERA_ADDRESS]).host ?? '';
  const tradfriStored = parseHost(c[STORED.TRADFRI_ADDRESS]).host ?? '';
  return {
    dirigera: {
      host: dirigeraHost.host || dirigeraStored,
      typed: Boolean(dirigeraHost.host),
      hostError: dirigeraHost.error,
      token: text(c[STORED.DIRIGERA_TOKEN]),
      verifyCertificate: c.verify_certificate !== false,
    },
    tradfri: {
      host: tradfriHost.host || tradfriStored,
      typed: Boolean(tradfriHost.host),
      hostError: tradfriHost.error,
      identity: text(c[STORED.TRADFRI_IDENTITY]),
      psk: text(c[STORED.TRADFRI_PSK]),
    },
  };
}
