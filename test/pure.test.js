// -----------------------------------------------------------------------------
// The small pure modules: configuration, colours, mDNS results, PKCE.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hsvToRgb, kelvinToMired, miredToKelvin, rgbToHsv } from '../src/color.js';
import { normalizeConfig, parseHost, urlHost } from '../src/config.js';
import { STORED } from '../src/constants.js';
import { challengeOf, createVerifier } from '../src/dirigera/auth.js';
import { bestAddress, classifyServices } from '../src/mdns.js';
import * as M from './fixtures/mdns.js';

test('parseHost keeps the host of what the user typed or pasted', () => {
  assert.deepEqual(parseHost('192.168.1.20'), { host: '192.168.1.20' });
  assert.deepEqual(parseHost(' https://192.168.1.20:8443/v1 '), { host: '192.168.1.20' });
  assert.deepEqual(parseHost('Hub.lan'), { host: 'hub.lan' });
  assert.deepEqual(parseHost('[fd00::20]:8443'), { host: 'fd00::20' });
  assert.deepEqual(parseHost('fd00::20'), { host: 'fd00::20' });
  assert.deepEqual(parseHost(''), { host: '' });
  assert.deepEqual(parseHost(undefined), { host: '' });
  assert.deepEqual(parseHost('not a host'), { error: 'invalid' });
  assert.equal(urlHost('fd00::20'), '[fd00::20]');
  assert.equal(urlHost('192.168.1.20'), '192.168.1.20');
});

test('normalizeConfig: a typed address wins over the one stored at the pairing', () => {
  const stored = {
    [STORED.DIRIGERA_TOKEN]: 'token',
    [STORED.DIRIGERA_ADDRESS]: '192.168.1.20',
    [STORED.TRADFRI_IDENTITY]: 'gladys_1',
    [STORED.TRADFRI_PSK]: 'key',
    [STORED.TRADFRI_ADDRESS]: '192.168.1.21',
  };
  const auto = normalizeConfig(stored);
  assert.deepEqual(auto.dirigera, {
    host: '192.168.1.20',
    typed: false,
    hostError: undefined,
    token: 'token',
    verifyCertificate: true,
  });
  assert.deepEqual(auto.tradfri, {
    host: '192.168.1.21',
    typed: false,
    hostError: undefined,
    identity: 'gladys_1',
    psk: 'key',
  });
  const typed = normalizeConfig({
    ...stored,
    dirigera_host: '10.0.0.2',
    verify_certificate: false,
  });
  assert.equal(typed.dirigera.host, '10.0.0.2');
  assert.equal(typed.dirigera.typed, true);
  assert.equal(typed.dirigera.verifyCertificate, false);
  assert.equal(normalizeConfig({ tradfri_host: 'a b' }).tradfri.hostError, 'invalid');
  assert.equal(normalizeConfig(null).dirigera.token, '');
});

test('colours: RGB <-> HSV, kelvin <-> mireds', () => {
  assert.equal(hsvToRgb(0, 1), 0xff0000);
  assert.equal(hsvToRgb(240, 1), 0x0000ff);
  assert.equal(hsvToRgb(60, 0), 0xffffff);
  assert.equal(hsvToRgb(-120, 1), 0x0000ff);
  for (const rgb of [0xff0000, 0x00ff00, 0x0000ff, 0xffaa00, 0x7f00ff]) {
    const { h, s } = rgbToHsv(rgb);
    assert.equal(hsvToRgb(h, s), rgb, rgb.toString(16));
  }
  assert.deepEqual(rgbToHsv(0), { h: 0, s: 0, v: 0 });
  assert.equal(kelvinToMired(4000), 250);
  assert.equal(miredToKelvin(454), 2203);
});

test('mDNS: the DIRIGERA hubs and TRÅDFRI gateways among the results', () => {
  const found = classifyServices(M.ALL);
  assert.deepEqual(found.dirigera, [
    { name: 'gw2-0123456789ab', address: '192.168.1.20', txt: { uuid: 'hub-0001', api: '1' } },
  ]);
  assert.deepEqual(found.tradfri, [
    { name: 'gw-b072bf257a41', address: '192.168.1.21', txt: { version: '1.21.31' } },
  ]);
  assert.deepEqual(classifyServices([{ ...M.DIRIGERA, addresses: [] }, null, 'x']), {
    dirigera: [],
    tradfri: [],
  });
  assert.equal(bestAddress(['fe80::1', 'fd00::5']), 'fd00::5');
  assert.equal(bestAddress(['::1']), undefined);
});

test('PKCE: the challenge is the base64url SHA-256 of the verifier', () => {
  const verifier = createVerifier((n) => Buffer.alloc(n, 1));
  assert.equal(verifier.length, 128);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  // RFC 7636, appendix B.
  assert.equal(
    challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});
