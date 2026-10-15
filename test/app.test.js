// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, a fake DIRIGERA hub and a fake TRÅDFRI gateway. Timers are mocked:
// the state flush, reconnections and pairing polls run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { IkeaApp } from '../src/app.js';
import { ACTIONS, COVER_STATE, SCENE_TRIGGERS, TIMINGS } from '../src/constants.js';
import { DirigeraError } from '../src/dirigera/client.js';
import { registerHandlers } from '../src/handlers.js';
import { TradfriError } from '../src/tradfri/client.js';
import * as D from './fixtures/dirigera.js';
import * as M from './fixtures/mdns.js';
import * as F from './fixtures/tradfri.js';
import { fakeDirigera, fakeTradfri, settle } from './helpers/fakes.js';

const DIRIGERA_PAIRED = { dirigera_token: 'token', dirigera_address: '192.168.1.20' };
const TRADFRI_PAIRED = {
  tradfri_identity: 'gladys_0123456789ab',
  tradfri_psk: 'stored-psk',
  tradfri_address: '192.168.1.21',
};

async function setup(t, { config = {}, mdns = M.ALL } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const gladys = createFakeGladys({ config, scanResults: { mdns } });
  const hub = fakeDirigera();
  const gateway = fakeTradfri();
  const app = new IkeaApp({
    gladys,
    logger: createLogger({ level: 'silent' }),
    dirigeraClient: hub.createClient,
    tradfriClient: gateway.createClient,
    now: () => Date.now(),
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { gladys, app, hub, gateway, tick };
}

const named = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);
const featureOf = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
const statesOf = (gladys, featureId) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === featureId);

test('nothing paired: the status says how to pair, nothing connects', async (t) => {
  const { gladys, hub, gateway } = await setup(t);
  assert.equal(hub.clients.length, 0);
  assert.equal(gateway.clients.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /No gateway paired yet/);
  assert.match(gladys.fake.connectionStatus.message.fr, /Aucune passerelle appairée/);
});

test('DIRIGERA: the devices are discovered, the states flow once a device is created', async (t) => {
  const { gladys, hub, tick } = await setup(t, { config: DIRIGERA_PAIRED });
  assert.deepEqual(hub.clients[0], {
    host: '192.168.1.20',
    token: 'token',
    verifyCertificate: true,
  });
  assert.equal(gladys.fake.discoveredDevices.length, 13);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'DIRIGERA "Maison" connected (192.168.1.20): 13 devices.',
  );

  const plug = named(gladys, 'Prise lave-linge');
  const on = featureOf(plug, 'on').external_id;
  const power = featureOf(plug, 'power').external_id;
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0, 'nothing is sent for a device not created');

  await gladys.fake.deviceCreated(plug);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(on), 1, 'the values read before the creation are sent');
  assert.equal(gladys.fake.lastState(power), 1834.5);

  hub.socket().open();
  hub.socket().deliver(D.stateChanged('outlet-energy', { isOn: false, currentActivePower: 0 }));
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(on), 0, 'a switch is never delayed');
  assert.equal(gladys.fake.lastState(power), 1834.5, 'a measurement waits for its interval');
  await tick(TIMINGS.measureInterval);
  assert.equal(gladys.fake.lastState(power), 0);
});

test('DIRIGERA: commands become PATCH requests, one per attribute group', async (t) => {
  const { gladys, hub } = await setup(t, { config: DIRIGERA_PAIRED });
  const light = named(gladys, 'Plafonnier');
  await gladys.fake.deviceCreated(light);
  const ack = await gladys.fake.setValue(light, featureOf(light, 'brightness'), 40);
  assert.equal(ack.success, true);
  assert.deepEqual(hub.patches, [
    { id: 'light-white', attributes: { isOn: true } },
    { id: 'light-white', attributes: { lightLevel: 40 } },
  ]);
  const blinds = named(gladys, 'Store chambre');
  await gladys.fake.setValue(blinds, featureOf(blinds, 'state'), COVER_STATE.STOP);
  assert.deepEqual(hub.patches.at(-1), { id: 'blinds-1', attributes: { blindsState: 'stopped' } });

  const sensor = named(gladys, 'Qualité air');
  const refused = await gladys.fake.setValue(sensor, featureOf(sensor, 'temperature'), 1);
  assert.equal(refused.success, false, 'a sensor cannot be controlled');

  hub.socket().drop();
  await settle();
  const offline = await gladys.fake.setValue(light, featureOf(light, 'on'), 1);
  assert.equal(offline.success, false);
  assert.match(offline.error, /not connected/);
});

test('DIRIGERA: remote presses fire the scene trigger and the button feature', async (t) => {
  const { gladys, hub, tick } = await setup(t, { config: DIRIGERA_PAIRED });
  const remote = named(gladys, 'Raccourcis');
  await gladys.fake.deviceCreated(remote);
  const button2 = featureOf(remote, 'button_2').external_id;

  hub.socket().deliver(D.remotePress('somrig-1_2', 'doublePress'));
  await tick(TIMINGS.flushInterval);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: SCENE_TRIGGERS.REMOTE_BUTTON,
    data: { device: remote.external_id, button: '2', action: 'double_press' },
  });
  assert.equal(gladys.fake.lastState(button2), 2, 'BUTTON_STATUS.DOUBLE_CLICK');

  hub.socket().deliver(D.remotePress('somrig-1_2', 'doublePress'));
  await tick(TIMINGS.flushInterval);
  assert.equal(statesOf(gladys, button2).length, 2, 'the same press twice is two presses');
  assert.equal(gladys.fake.sceneEvents.length, 2);

  // A remote whose model sends no press, if it does anyway: the trigger still fires.
  hub.socket().deliver(D.remotePress('styrbar-1', 'longPress'));
  await settle();
  assert.deepEqual(gladys.fake.sceneEvents.at(-1).data, {
    device: named(gladys, 'Télécommande salon').external_id,
    button: '1',
    action: 'long_press',
  });
  hub.socket().deliver(D.remotePress('unknown', 'singlePress'));
  hub.socket().deliver(D.remotePress('somrig-1_1', 'tripleTap'));
  await settle();
  assert.equal(gladys.fake.sceneEvents.length, 3);
});

test('DIRIGERA: reachability drives the transport badge', async (t) => {
  const { gladys, hub } = await setup(t, { config: DIRIGERA_PAIRED });
  const door = named(gladys, 'Porte entrée');
  await gladys.fake.deviceCreated(door);
  const badge = (transport) => ({ device_external_id: door.external_id, transport });
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.LOCAL));
  hub.socket().deliver(D.stateChanged('door-1', {}, { isReachable: false }));
  await settle();
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.UNREACHABLE));
  hub.socket().deliver(D.stateChanged('door-1', {}, { isReachable: true }));
  await settle();
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.LOCAL));
  const count = gladys.fake.transports.length;
  hub.socket().deliver(D.stateChanged('door-1', { batteryPercentage: 93 }, { isReachable: true }));
  await settle();
  assert.equal(gladys.fake.transports.length, count, 'an unchanged badge is not sent again');
  hub.socket().drop();
  await settle();
  assert.deepEqual(gladys.fake.transports.at(-1), badge(DEVICE_TRANSPORTS.UNREACHABLE));
});

test('DIRIGERA: a dropped websocket reconnects and reloads the devices', async (t) => {
  const { gladys, hub, tick } = await setup(t, { config: DIRIGERA_PAIRED });
  hub.socket().open();
  hub.devices.push({
    ...D.TRETAKT,
    id: 'outlet-new',
    attributes: { ...D.TRETAKT.attributes, customName: 'Nouvelle prise' },
  });
  hub.socket().drop();
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /unreachable \(websocket closed\), retrying/,
  );
  await tick(TIMINGS.reconnectMin);
  assert.equal(hub.sockets.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(named(gladys, 'Nouvelle prise'), 'what changed meanwhile is read');
});

test('DIRIGERA: pings keep the websocket alive, a silent hub is reconnected', async (t) => {
  const { hub, tick } = await setup(t, { config: DIRIGERA_PAIRED });
  const socket = hub.socket();
  socket.open();
  socket.answersPings = true;
  await tick(TIMINGS.wsPing);
  assert.equal(socket.pings, 1, 'a protocol ping');
  assert.equal(socket.sent[0].type, 'ping', 'and a ping event');
  assert.equal(socket.sent[0].specversion, '1.1.0');
  // The mock clock jumps to the end of a tick before the timers run: tick per ping.
  for (let i = 0; i < 5; i += 1) {
    await tick(TIMINGS.wsPing);
  }
  assert.equal(socket.terminated, false, 'a quiet hub that answers the pings is kept');
  socket.answersPings = false;
  for (let i = 0; i < 4; i += 1) {
    await tick(TIMINGS.wsPing);
  }
  assert.equal(socket.terminated, true, 'nothing heard for 95 s');
  await tick(TIMINGS.reconnectMin);
  assert.equal(hub.sockets.length, 2);
});

test('DIRIGERA: devices added, renamed and removed update Discovery', async (t) => {
  const { gladys, hub, tick } = await setup(t, { config: DIRIGERA_PAIRED });
  hub.socket().deliver(D.deviceRemoved('light-dim'));
  hub.socket().deliver(D.stateChanged('light-white', { customName: 'Plafonnier cuisine' }));
  await tick(TIMINGS.rebuildDebounce);
  assert.equal(gladys.fake.discoveredDevices.length, 12);
  assert.ok(named(gladys, 'Plafonnier cuisine'));
  hub.socket().deliver(D.deviceAdded({ ...D.DIMMABLE_LIGHT, id: 'light-dim-2' }));
  await tick(TIMINGS.rebuildDebounce);
  assert.equal(gladys.fake.discoveredDevices.length, 13);
  // A state change of a device the list does not have: the list is read again.
  const listed = hub.listed;
  hub.devices.push({
    ...D.PARASOLL,
    id: 'door-2',
    attributes: { ...D.PARASOLL.attributes, customName: 'Fenêtre' },
  });
  hub.socket().deliver(D.stateChanged('door-2', { isOpen: true }));
  await tick(TIMINGS.rebuildDebounce);
  assert.equal(hub.listed, listed + 1);
  assert.ok(named(gladys, 'Fenêtre'));
});

test('DIRIGERA: a refused token asks for a new pairing, without retrying', async (t) => {
  const { gladys, hub, tick } = await setup(t, { config: {} });
  hub.devicesError = new DirigeraError('GET /devices: HTTP 401', { status: 401 });
  await gladys.fake.configUpdated(DIRIGERA_PAIRED);
  await settle();
  assert.match(gladys.fake.connectionStatus.message.en, /refused the access\. Pair it again/);
  await tick(TIMINGS.reconnectMax);
  assert.equal(hub.clients.length, 1);
});

test('DIRIGERA: a certificate not issued by IKEA is reported', async (t) => {
  const { gladys, hub } = await setup(t, { config: {} });
  hub.devicesError = new DirigeraError('GET /devices: SELF_SIGNED_CERT_IN_CHAIN', {
    code: 'SELF_SIGNED_CERT_IN_CHAIN',
  });
  await gladys.fake.configUpdated(DIRIGERA_PAIRED);
  await settle();
  assert.match(gladys.fake.connectionStatus.message.en, /was not issued by IKEA/);
});

test('DIRIGERA: a hub that changed address is found again with mDNS', async (t) => {
  const { gladys, hub, tick } = await setup(t, { config: {} });
  hub.unreachable.add('192.168.1.99');
  await gladys.fake.configUpdated({ ...DIRIGERA_PAIRED, dirigera_address: '192.168.1.99' });
  await settle();
  assert.match(gladys.fake.connectionStatus.message.en, /192\.168\.1\.99 unreachable/);
  await tick(TIMINGS.reconnectMin);
  await tick(TIMINGS.reconnectMin * 2);
  assert.equal(gladys.fake.scans.length, 0, 'the last known address is tried first');
  await tick(TIMINGS.reconnectMin * 4);
  assert.equal(gladys.fake.scans.length, 1);
  assert.equal(hub.clients.at(-1).host, '192.168.1.20');
  assert.equal(gladys.fake.config.dirigera_address, '192.168.1.20', 'kept for the next start');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('pairing the DIRIGERA hub: found with mDNS, approved with its button', async (t) => {
  const { gladys, hub, tick } = await setup(t);
  hub.refuseToken = 2;
  const pending = gladys.fake.action(ACTIONS.PAIR_DIRIGERA);
  await settle();
  await tick(TIMINGS.pairingPoll);
  await tick(TIMINGS.pairingPoll);
  const ack = await pending;
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'DIRIGERA hub paired (192.168.1.20). Its devices are in the Discovery tab.',
  );
  assert.deepEqual(gladys.fake.scans, [{ type: 'mdns', timeout_seconds: TIMINGS.mdnsSeconds }]);
  assert.match(hub.challenges[0], /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hub.tokenRequests.length, 3);
  assert.equal(hub.tokenRequests[0].code, 'auth-code');
  assert.equal(hub.tokenRequests[0].name, 'Gladys Assistant');
  assert.equal(gladys.fake.config.dirigera_token, 'new-token');
  assert.equal(gladys.fake.config.dirigera_address, '192.168.1.20');
  await settle();
  assert.equal(hub.clients.at(-1).token, 'new-token');
  assert.equal(gladys.fake.discoveredDevices.length, 13);
});

test('pairing the DIRIGERA hub: the button not pressed in time', async (t) => {
  const { gladys, hub, tick } = await setup(t, { config: { dirigera_host: '10.0.0.5' } });
  hub.refuseToken = Infinity;
  const pending = gladys.fake.action(ACTIONS.PAIR_DIRIGERA);
  for (let i = 0; i < 50; i += 1) {
    await tick(TIMINGS.pairingPoll);
  }
  const ack = await pending;
  assert.match(ack.data.message.en, /was not pressed within 90 seconds/);
  assert.equal(hub.clients[0].host, '10.0.0.5', 'a typed address is used as is');
  assert.equal(gladys.fake.scans.length, 0);
  assert.equal(gladys.fake.config.dirigera_token, undefined);
});

test('pairing the DIRIGERA hub: nothing on the network', async (t) => {
  const { gladys } = await setup(t, { mdns: [] });
  const ack = await gladys.fake.action(ACTIONS.PAIR_DIRIGERA);
  assert.match(ack.data.message.en, /No DIRIGERA hub found/);
});

test('pairing the TRÅDFRI gateway with its security code', async (t) => {
  const { gladys, gateway } = await setup(t);
  const missing = await gladys.fake.action(ACTIONS.PAIR_TRADFRI, { security_code: '  ' });
  assert.match(missing.data.message.en, /Type the security code/);

  const ack = await gladys.fake.action(ACTIONS.PAIR_TRADFRI, {
    security_code: 'abcd efgh ijkl mnop',
  });
  assert.equal(
    ack.data.message.en,
    'TRÅDFRI gateway paired (192.168.1.21). Its devices are in the Discovery tab.',
  );
  assert.deepEqual(gateway.connects[0], {
    host: '192.168.1.21',
    identity: 'Client_identity',
    psk: 'abcdefghijklmnop',
  });
  const identity = gateway.posts[0].json[9090];
  assert.match(identity, /^gladys_[0-9a-f]{12}$/);
  assert.equal(gateway.posts[0].path, '15011/9063');
  assert.equal(gladys.fake.config.tradfri_identity, identity);
  assert.equal(gladys.fake.config.tradfri_psk, 'gateway-psk');
  assert.equal(gladys.fake.config.security_code, undefined, 'the code itself is not kept');
  await settle();
  assert.deepEqual(gateway.connects.at(-1), {
    host: '192.168.1.21',
    identity,
    psk: 'gateway-psk',
  });
  assert.equal(gladys.fake.discoveredDevices.length, 7);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /TRÅDFRI connected \(192\.168\.1\.21\): 7 devices/,
  );

  gateway.refuse();
  const wrong = await gladys.fake.action(ACTIONS.PAIR_TRADFRI, { security_code: 'wrong' });
  assert.match(wrong.data.message.en, /refused the security code/);
  gateway.connectError = new TradfriError('the gateway did not answer', { code: 'timeout' });
  const silent = await gladys.fake.action(ACTIONS.PAIR_TRADFRI, { security_code: 'wrong' });
  assert.match(silent.data.message.en, /did not complete the pairing.*security code/);
});

test('TRÅDFRI: observed changes, commands and reachability', async (t) => {
  const { gladys, gateway, tick } = await setup(t, { config: TRADFRI_PAIRED });
  assert.deepEqual(gateway.connects[0], {
    host: '192.168.1.21',
    identity: 'gladys_0123456789ab',
    psk: 'stored-psk',
  });
  assert.ok(gateway.observers.has('15001'));
  assert.ok(gateway.observers.has('15001/65539'));
  const plug = named(gladys, 'Prise bureau');
  const on = featureOf(plug, 'on').external_id;
  await gladys.fake.deviceCreated(plug);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(on), 1);

  const off = structuredClone(F.PLUG);
  off[3312][0][5850] = 0;
  gateway.notify('15001/65539', off);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(on), 0);

  const ack = await gladys.fake.setValue(plug, featureOf(plug, 'on'), 1);
  assert.equal(ack.success, true);
  assert.deepEqual(gateway.puts.at(-1), { path: '15001/65539', json: { 3312: [{ 5850: 1 }] } });

  gateway.notify('15001/65539', { ...off, 9019: 0 });
  await settle();
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: plug.external_id,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });
});

test('TRÅDFRI: the accessory list is followed', async (t) => {
  const { gladys, gateway, tick } = await setup(t, { config: TRADFRI_PAIRED });
  assert.equal(gladys.fake.discoveredDevices.length, 7);
  gateway.notify('15001', [65537, 65538, 65540, 65541, 65542, 65543, 65544]);
  await tick(TIMINGS.rebuildDebounce);
  assert.equal(gladys.fake.discoveredDevices.length, 6);
  assert.ok(!gateway.observers.has('15001/65539'));
  gateway.resources.set('15001/65545', {
    ...structuredClone(F.PLUG),
    9003: 65545,
    9001: 'Prise neuve',
  });
  gateway.notify('15001', [65537, 65538, 65540, 65541, 65542, 65543, 65544, 65545]);
  await settle(); // the new accessory is read first
  await tick(TIMINGS.rebuildDebounce);
  assert.ok(named(gladys, 'Prise neuve'));
  assert.ok(gateway.observers.has('15001/65545'));
});

test('TRÅDFRI: missed pings reopen the session', async (t) => {
  const { gladys, gateway, tick } = await setup(t, { config: TRADFRI_PAIRED });
  gateway.alive = false;
  await tick(TIMINGS.tradfriPing);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'one missed ping is tolerated');
  await tick(TIMINGS.tradfriPing);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.ok(gateway.clients[0].closed);
  gateway.alive = true;
  await tick(TIMINGS.reconnectMin);
  assert.equal(gateway.connects.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('TRÅDFRI: a refused key asks for a new pairing', async (t) => {
  const { gladys, gateway } = await setup(t);
  gateway.refuse();
  await gladys.fake.configUpdated(TRADFRI_PAIRED);
  await settle();
  assert.match(gladys.fake.connectionStatus.message.en, /refused the key/);
});

test('both gateways: one status, a new configuration restarts only what changed', async (t) => {
  const { gladys, hub, gateway } = await setup(t, {
    config: { ...DIRIGERA_PAIRED, ...TRADFRI_PAIRED },
  });
  assert.equal(gladys.fake.discoveredDevices.length, 20);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'DIRIGERA "Maison" connected (192.168.1.20): 13 devices. TRÅDFRI connected (192.168.1.21): 7 devices.',
  );
  await gladys.fake.configUpdated({
    ...DIRIGERA_PAIRED,
    ...TRADFRI_PAIRED,
    verify_certificate: false,
  });
  await settle();
  assert.equal(hub.clients.length, 2);
  assert.equal(hub.clients[1].verifyCertificate, false);
  assert.equal(gateway.clients.length, 1, 'the TRÅDFRI session is kept');

  const listed = hub.listed;
  await gladys.fake.scanRequest();
  assert.equal(hub.listed, listed + 1, 'a Discovery scan reads the hub again');
});

test('"Find the gateways" lists what answers on the network', async (t) => {
  const { gladys } = await setup(t);
  const ack = await gladys.fake.action(ACTIONS.FIND);
  assert.equal(
    ack.data.message.en,
    'Found on the network: DIRIGERA gw2-0123456789ab (192.168.1.20); TRÅDFRI gw-b072bf257a41 (192.168.1.21).',
  );
  gladys.fake.scanResults.mdns = [M.OTHER_COAP];
  const none = await gladys.fake.action(ACTIONS.FIND);
  assert.match(none.data.message.en, /No IKEA gateway answered/);
});

test('an invalid address is reported, nothing connects', async (t) => {
  const { gladys, hub } = await setup(t, {
    config: { ...DIRIGERA_PAIRED, dirigera_host: 'not an address' },
  });
  assert.equal(hub.clients.length, 0);
  assert.match(gladys.fake.connectionStatus.message.en, /the address typed is not valid/);
  const ack = await gladys.fake.action(ACTIONS.PAIR_DIRIGERA);
  assert.match(ack.data.message.en, /not valid/);
});
