// -----------------------------------------------------------------------------
// The DIRIGERA local API: HTTPS on port 8443 and a websocket for the events.
// The only network access to the hub; `transport` is injected by the tests.
//
// The hub certificate is issued for the hub id, not for its IP address: the
// chain is verified against the IKEA root CA, the host name is not. The user
// can turn the verification off (a hub whose certificate changed).
// -----------------------------------------------------------------------------

import https from 'node:https';
import WebSocket from 'ws';
import { urlHost } from '../config.js';
import { LIMITS, PORTS, TIMINGS } from '../constants.js';
import { IKEA_ROOT_CA } from './certificate.js';

export class DirigeraError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DirigeraError';
    this.status = status;
    this.code = code;
  }
}

const CERTIFICATE_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
]);
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'timeout',
]);

/** 'auth' | 'certificate' | 'unreachable' | 'error': what the status tells the user. */
export function errorKind(err) {
  if (err?.status === 401 || err?.status === 403) {
    return 'auth';
  }
  if (CERTIFICATE_CODES.has(err?.code)) {
    return 'certificate';
  }
  return UNREACHABLE_CODES.has(err?.code) ? 'unreachable' : 'error';
}

/** A short reason for the logs and the status: never a header, never the token. */
export function errorReason(err) {
  if (err?.status) {
    return `HTTP ${err.status}`;
  }
  return String(err?.code ?? err?.message ?? err).slice(0, 120);
}

export function tlsOptions(verifyCertificate) {
  return verifyCertificate
    ? { ca: [IKEA_ROOT_CA], checkServerIdentity: () => undefined }
    : { rejectUnauthorized: false };
}

/** One HTTPS request; the body is read up to LIMITS.responseBytes. */
export function httpsRequest({ url, method, headers, body, tls, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, ...tls, timeout: timeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > LIMITS.responseBytes) {
          req.destroy(Object.assign(new Error('response too large'), { code: 'too-large' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
      );
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })));
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

export const defaultTransport = {
  request: httpsRequest,
  websocket: (url, { headers, tls }) =>
    new WebSocket(url, {
      headers,
      ...tls,
      handshakeTimeout: TIMINGS.requestTimeout,
      maxPayload: LIMITS.messageBytes,
    }),
};

/**
 * @param {object} options
 * @param {string} options.host IP address or host name of the hub
 * @param {string} [options.token] the access token (not needed to pair)
 * @param {boolean} [options.verifyCertificate]
 * @param {object} [options.transport] `{ request, websocket }`
 */
export function createDirigeraClient({
  host,
  token,
  verifyCertificate = true,
  transport = defaultTransport,
  timeoutMs = TIMINGS.requestTimeout,
}) {
  const origin = `${urlHost(host)}:${PORTS.DIRIGERA}`;
  const tls = tlsOptions(verifyCertificate);

  async function call(method, path, { json, form, auth = true } = {}) {
    const headers = { accept: 'application/json' };
    if (auth) {
      headers.authorization = `Bearer ${token}`;
    }
    let body;
    if (json !== undefined) {
      body = JSON.stringify(json);
      headers['content-type'] = 'application/json';
    } else if (form !== undefined) {
      body = new URLSearchParams(form).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    if (body !== undefined) {
      headers['content-length'] = Buffer.byteLength(body);
    }
    let res;
    try {
      res = await transport.request({
        url: `https://${origin}/v1${path}`,
        method,
        headers,
        body,
        tls,
        timeoutMs,
      });
    } catch (err) {
      throw new DirigeraError(`${method} ${path.split('?')[0]}: ${errorReason(err)}`, {
        code: err?.code,
        cause: err,
      });
    }
    if (res.status < 200 || res.status >= 300) {
      throw new DirigeraError(`${method} ${path.split('?')[0]}: HTTP ${res.status}`, {
        status: res.status,
      });
    }
    if (!res.body) {
      return undefined;
    }
    try {
      return JSON.parse(res.body);
    } catch {
      throw new DirigeraError(`${method} ${path.split('?')[0]}: not JSON`, { code: 'not-json' });
    }
  }

  return {
    host,
    async authorize(challenge) {
      const query = new URLSearchParams({
        audience: 'homesmart.local',
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      const answer = await call('GET', `/oauth/authorize?${query}`, { auth: false });
      if (typeof answer?.code !== 'string' || answer.code === '') {
        throw new DirigeraError('the hub sent no authorization code', { code: 'no-code' });
      }
      return answer.code;
    },
    async token({ code, verifier, name }) {
      const answer = await call('POST', '/oauth/token', {
        auth: false,
        form: { code, name, grant_type: 'authorization_code', code_verifier: verifier },
      });
      if (typeof answer?.access_token !== 'string' || answer.access_token === '') {
        throw new DirigeraError('the hub sent no access token', { code: 'no-token' });
      }
      return answer.access_token;
    },
    async devices() {
      const list = await call('GET', '/devices');
      if (!Array.isArray(list)) {
        throw new DirigeraError('GET /devices: not a list', { code: 'not-list' });
      }
      return list;
    },
    setAttributes(id, attributes) {
      return call('PATCH', `/devices/${encodeURIComponent(id)}`, { json: [{ attributes }] });
    },
    /** Opens the event websocket (a `ws` WebSocket, or the tests' fake). */
    events() {
      return transport.websocket(`wss://${origin}/v1`, {
        headers: { authorization: `Bearer ${token}` },
        tls,
      });
    },
  };
}
