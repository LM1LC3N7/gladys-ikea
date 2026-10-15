// -----------------------------------------------------------------------------
// The TRÅDFRI gateway: CoAP over DTLS (PSK) on UDP 5684, through
// node-coap-client (AlCalzone, MIT). The only network access to the gateway;
// `coap` is injected by the tests.
//
// Pairing: a DTLS session with the identity "Client_identity" and the security
// code printed under the gateway as key, then POST 15011/9063 {"9090": <new
// identity>} -> {"9091": <its key>}. The security code is never stored: the
// identity and its key are.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { CoapClient } from 'node-coap-client';
import { urlHost } from '../config.js';
import { LIMITS, PORTS, TIMINGS } from '../constants.js';

export class TradfriError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = 'TradfriError';
    this.code = code;
  }
}

/** 'auth' | 'unreachable' | 'error': what the status tells the user. */
export const errorKind = (err) =>
  err?.code === 'auth' ? 'auth' : err?.code === 'timeout' ? 'unreachable' : 'error';

export const errorReason = (err) => String(err?.message ?? err).slice(0, 120);

export const newIdentity = (random = randomBytes) => `gladys_${random(6).toString('hex')}`;

/** The security code as printed: 16 letters and digits, spaces tolerated. */
export const cleanSecurityCode = (raw) => String(raw ?? '').replace(/\s+/g, '');

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TradfriError(`${what}: timeout`, { code: 'timeout' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The JSON payload of a CoAP response, or undefined. */
export function payloadOf(response) {
  const payload = response?.payload;
  if (!payload || payload.length === 0 || payload.length > LIMITS.messageBytes) {
    return undefined;
  }
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    return undefined;
  }
}

const succeeded = (response) => String(response?.code ?? '').startsWith('2.');

/**
 * @param {object} options
 * @param {string} options.host IP address or host name of the gateway
 * @param {object} [options.coap] the node-coap-client CoapClient (static API)
 */
export function createTradfriClient({
  host,
  coap = CoapClient,
  timeoutMs = TIMINGS.requestTimeout,
}) {
  const base = `coaps://${urlHost(host)}:${PORTS.TRADFRI}`;
  const url = (path) => `${base}/${path}`;

  async function request(method, path, json) {
    const body = json === undefined ? undefined : Buffer.from(JSON.stringify(json));
    let response;
    try {
      // Retransmissions can last a minute: a request never blocks longer than this.
      response = await withTimeout(coap.request(url(path), method, body), timeoutMs * 3, path);
    } catch (err) {
      throw err instanceof TradfriError ? err : new TradfriError(`${path}: ${errorReason(err)}`);
    }
    if (!succeeded(response)) {
      throw new TradfriError(`${method.toUpperCase()} ${path}: ${response?.code}`, {
        code: String(response?.code) === '4.01' ? 'auth' : undefined,
      });
    }
    return payloadOf(response);
  }

  return {
    host,
    /** Opens the DTLS session; throws a TradfriError ('auth', 'timeout'). */
    async connect(identity, psk) {
      coap.reset(host);
      coap.setSecurityParams(host, { psk: { [identity]: psk } });
      // Needed by the gateway firmwares 1.15 and later (as node-tradfri-client does).
      coap.setCompatOptions(host, { resetAntiReplayWindowBeforeServerHello: true });
      const result = await withTimeout(coap.tryToConnect(base), timeoutMs * 2, 'DTLS handshake');
      if (result === true) {
        return;
      }
      if (result === 'auth failed') {
        throw new TradfriError('the gateway refused the key', { code: 'auth' });
      }
      if (result === 'timeout') {
        throw new TradfriError('the gateway did not answer', { code: 'timeout' });
      }
      throw new TradfriError(errorReason(result));
    },
    get: (path) => request('get', path),
    put: (path, json) => request('put', path, json),
    post: (path, json) => request('post', path, json),
    /** Calls `callback(json)` on every notification of the resource. */
    observe(path, callback) {
      return withTimeout(
        coap.observe(url(path), 'get', (response) => callback(payloadOf(response))),
        timeoutMs * 3,
        `observe ${path}`,
      );
    },
    stopObserving: (path) => coap.stopObserving(url(path)),
    ping: () => coap.ping(base, timeoutMs),
    close: () => coap.reset(host),
  };
}

/** Exchanges the security code for a new identity and its key. */
export async function exchangeSecurityCode(client, securityCode, identity = newIdentity()) {
  await client.connect('Client_identity', securityCode);
  try {
    const answer = await client.post('15011/9063', { 9090: identity });
    const psk = answer?.['9091'];
    if (typeof psk !== 'string' || psk === '') {
      throw new TradfriError('the gateway sent no key', { code: 'no-key' });
    }
    return { identity, psk };
  } finally {
    client.close();
  }
}
