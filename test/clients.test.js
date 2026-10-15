// -----------------------------------------------------------------------------
// The two network clients, against a fake transport (DIRIGERA) and a fake
// node-coap-client (TRÅDFRI): what goes on the wire, how errors are read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IKEA_ROOT_CA } from '../src/dirigera/certificate.js';
import {
  createDirigeraClient,
  DirigeraError,
  errorKind,
  errorReason,
  tlsOptions,
} from '../src/dirigera/client.js';
import {
  cleanSecurityCode,
  createTradfriClient,
  errorKind as tradfriErrorKind,
  exchangeSecurityCode,
  newIdentity,
  payloadOf,
} from '../src/tradfri/client.js';

function fakeTransport(answers) {
  const requests = [];
  const sockets = [];
  return {
    requests,
    sockets,
    async request(options) {
      requests.push(options);
      const answer = answers.shift();
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    websocket(url, options) {
      sockets.push({ url, options });
      return { url };
    },
  };
}

test('DIRIGERA: requests carry the token, the IKEA root CA, and JSON bodies', async () => {
  const transport = fakeTransport([
    { status: 200, body: '[{"id":"a"}]' },
    { status: 202, body: '' },
  ]);
  const client = createDirigeraClient({ host: '192.168.1.20', token: 'secret', transport });
  assert.deepEqual(await client.devices(), [{ id: 'a' }]);
  await client.setAttributes('a b', { isOn: true });
  const [list, patch] = transport.requests;
  assert.equal(list.url, 'https://192.168.1.20:8443/v1/devices');
  assert.equal(list.method, 'GET');
  assert.equal(list.headers.authorization, 'Bearer secret');
  assert.deepEqual(list.tls.ca, [IKEA_ROOT_CA]);
  assert.equal(list.tls.checkServerIdentity(), undefined, 'the hub is reached by its IP');
  assert.equal(patch.url, 'https://192.168.1.20:8443/v1/devices/a%20b');
  assert.equal(patch.method, 'PATCH');
  assert.equal(patch.body, '[{"attributes":{"isOn":true}}]');
  assert.equal(patch.headers['content-type'], 'application/json');
  client.events();
  assert.equal(transport.sockets[0].url, 'wss://192.168.1.20:8443/v1');
  assert.equal(transport.sockets[0].options.headers.authorization, 'Bearer secret');
});

test('DIRIGERA: the PKCE pairing requests', async () => {
  const transport = fakeTransport([
    { status: 200, body: '{"code":"the-code"}' },
    { status: 200, body: '{"access_token":"the-token"}' },
  ]);
  const client = createDirigeraClient({ host: 'fd00::20', transport, verifyCertificate: false });
  assert.equal(await client.authorize('challenge'), 'the-code');
  assert.equal(
    await client.token({ code: 'the-code', verifier: 'v', name: 'Gladys Assistant' }),
    'the-token',
  );
  const [authorize, token] = transport.requests;
  assert.equal(
    authorize.url,
    'https://[fd00::20]:8443/v1/oauth/authorize?audience=homesmart.local&response_type=code&code_challenge=challenge&code_challenge_method=S256',
  );
  assert.equal(authorize.headers.authorization, undefined);
  assert.deepEqual(authorize.tls, { rejectUnauthorized: false });
  assert.equal(token.method, 'POST');
  assert.equal(token.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(
    token.body,
    'code=the-code&name=Gladys+Assistant&grant_type=authorization_code&code_verifier=v',
  );
});

test('DIRIGERA: errors say what to do, and never carry the token', async () => {
  const refused = fakeTransport([{ status: 401, body: 'nope' }]);
  const err = await createDirigeraClient({ host: 'h', token: 'secret', transport: refused })
    .devices()
    .catch((e) => e);
  assert.ok(err instanceof DirigeraError);
  assert.equal(errorKind(err), 'auth');
  assert.doesNotMatch(err.message, /secret/);

  const cert = Object.assign(new Error('self-signed certificate in certificate chain'), {
    code: 'SELF_SIGNED_CERT_IN_CHAIN',
  });
  const certErr = await createDirigeraClient({
    host: 'h',
    token: 't',
    transport: fakeTransport([cert]),
  })
    .devices()
    .catch((e) => e);
  assert.equal(errorKind(certErr), 'certificate');

  const down = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const downErr = await createDirigeraClient({
    host: 'h',
    token: 't',
    transport: fakeTransport([down]),
  })
    .devices()
    .catch((e) => e);
  assert.equal(errorKind(downErr), 'unreachable');
  assert.equal(errorReason(downErr), 'ECONNREFUSED');

  const garbage = fakeTransport([
    { status: 200, body: '<html>' },
    { status: 200, body: '{}' },
  ]);
  const client = createDirigeraClient({ host: 'h', token: 't', transport: garbage });
  await assert.rejects(client.devices(), /not JSON/);
  await assert.rejects(client.devices(), /not a list/);
  await assert.rejects(
    createDirigeraClient({
      host: 'h',
      transport: fakeTransport([{ status: 200, body: '{}' }]),
    }).authorize('c'),
    /no authorization code/,
  );
  assert.deepEqual(Object.keys(tlsOptions(true)), ['ca', 'checkServerIdentity']);
});

function fakeCoap({ connect = true, responses = {} } = {}) {
  const calls = [];
  return {
    calls,
    reset: (host) => calls.push(['reset', host]),
    setSecurityParams: (host, params) => calls.push(['psk', host, params]),
    setCompatOptions: (host, compat) => calls.push(['compat', host, compat]),
    tryToConnect: async (url) => {
      calls.push(['connect', url]);
      return connect;
    },
    request: async (url, method, payload) => {
      calls.push(['request', url, method, payload?.toString()]);
      return responses[`${method} ${url}`] ?? { code: '4.04' };
    },
    observe: async (url, method, callback) => {
      calls.push(['observe', url]);
      callback({ code: '2.05', payload: Buffer.from('{"9003":1}') });
    },
    stopObserving: (url) => calls.push(['stop', url]),
    ping: async (url) => {
      calls.push(['ping', url]);
      return true;
    },
  };
}

const json = (code, value) => ({ code, payload: Buffer.from(JSON.stringify(value)) });

test('TRÅDFRI: the security code is exchanged for an identity and its key', async () => {
  const coap = fakeCoap({
    responses: {
      'post coaps://192.168.1.21:5684/15011/9063': json('2.01', { 9091: 'psk', 9029: '1.21' }),
    },
  });
  const client = createTradfriClient({ host: '192.168.1.21', coap });
  const result = await exchangeSecurityCode(client, 'ABCDEFGH12345678', 'gladys_x');
  assert.deepEqual(result, { identity: 'gladys_x', psk: 'psk' });
  assert.deepEqual(
    coap.calls.find((c) => c[0] === 'psk'),
    ['psk', '192.168.1.21', { psk: { Client_identity: 'ABCDEFGH12345678' } }],
  );
  assert.deepEqual(coap.calls.find((c) => c[0] === 'compat')[2], {
    resetAntiReplayWindowBeforeServerHello: true,
  });
  assert.deepEqual(coap.calls.find((c) => c[0] === 'request').slice(2), [
    'post',
    '{"9090":"gladys_x"}',
  ]);
  assert.deepEqual(coap.calls.at(-1), ['reset', '192.168.1.21'], 'the pairing session is closed');
  assert.match(newIdentity(), /^gladys_[0-9a-f]{12}$/);
  assert.equal(cleanSecurityCode(' abcd efgh '), 'abcdefgh');
});

test('TRÅDFRI: requests, observations and errors', async () => {
  const coap = fakeCoap({
    responses: {
      'get coaps://gw:5684/15001': json('2.05', [65537]),
      'put coaps://gw:5684/15001/65537': { code: '2.04' },
    },
  });
  const client = createTradfriClient({ host: 'gw', coap });
  await client.connect('gladys_x', 'psk');
  assert.deepEqual(await client.get('15001'), [65537]);
  assert.equal(await client.put('15001/65537', { 3311: [{ 5850: 1 }] }), undefined);
  await assert.rejects(client.get('15004'), /4\.04/);
  const seen = [];
  await client.observe('15001/65537', (payload) => seen.push(payload));
  assert.deepEqual(seen, [{ 9003: 1 }]);
  assert.equal(await client.ping(), true);

  const refused = createTradfriClient({ host: 'gw', coap: fakeCoap({ connect: 'auth failed' }) });
  const err = await refused.connect('gladys_x', 'wrong').catch((e) => e);
  assert.equal(tradfriErrorKind(err), 'auth');
  const silent = createTradfriClient({ host: 'gw', coap: fakeCoap({ connect: 'timeout' }) });
  assert.equal(tradfriErrorKind(await silent.connect('i', 'k').catch((e) => e)), 'unreachable');
  assert.equal(payloadOf({ payload: Buffer.from('not json') }), undefined);
  assert.equal(payloadOf({}), undefined);
});
