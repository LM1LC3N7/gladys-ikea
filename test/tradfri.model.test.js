import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { COVER_STATE, FAN_MODE } from '../src/constants.js';
import { aliveOf, buildTradfriModel, fanSpeedOut } from '../src/tradfri/model.js';
import * as F from './fixtures/tradfri.js';

const gladys = createFakeGladys();
const model = buildTradfriModel(gladys, F.ALL);
const id = (instance) => gladys.externalIds('tradfri', String(instance)).device;
const device = (instance) => model.devices.find((d) => d.external_id === id(instance));
const keys = (instance) => device(instance).features.map((f) => f.external_id.split(':').at(-1));
const read = (accessory, key, patch) => {
  const route = model.routes
    .get(String(accessory[9003]))
    .find((r) => r.featureId === `${id(accessory[9003])}:${key}`);
  return route.read(patch ? patch(structuredClone(accessory)) : accessory);
};
const write = (instance, key, value) => model.writers.get(`${id(instance)}:${key}`).write(value);

test('every accessory but the repeater becomes a Gladys device', () => {
  assert.equal(model.devices.length, 7);
  assert.ok(!model.devices.some((d) => d.name === 'Répéteur'));
  assert.deepEqual(device(65537).params, [
    { name: 'MODEL', value: 'TRADFRI bulb E27 WS opal 980lm' },
    { name: 'MANUFACTURER', value: 'IKEA of Sweden' },
    { name: 'FIRMWARE', value: '2.3.087' },
  ]);
});

test('white spectrum bulb: dimmer 0-254 as a percentage, mireds as is', () => {
  assert.deepEqual(keys(65537), ['on', 'brightness', 'color_temperature']);
  assert.equal(read(F.WS_BULB, 'brightness'), 100);
  assert.equal(read(F.WS_BULB, 'color_temperature'), 370);
  assert.deepEqual(write(65537, 'brightness', 50), { 3311: [{ 5850: 1, 5851: 127 }] });
  assert.deepEqual(write(65537, 'brightness', 0), { 3311: [{ 5850: 0 }] });
  assert.deepEqual(write(65537, 'color_temperature', 600), { 3311: [{ 5711: 454 }] });
  assert.deepEqual(write(65537, 'on', 0), { 3311: [{ 5850: 0 }] });
});

test('colour bulb: hue and saturation 0-65279 <-> RGB', () => {
  assert.deepEqual(keys(65538), ['on', 'brightness', 'color']);
  assert.equal(read(F.CWS_BULB, 'on'), 0);
  const blue = write(65538, 'color', 0x0000ff)[3311][0];
  assert.equal(blue[5707], Math.round((240 / 360) * 65279));
  assert.equal(blue[5708], 65279);
  const red = (a) => {
    a[3311][0][5707] = 0;
    return a;
  };
  assert.equal(read(F.CWS_BULB, 'color', red), 0xff0000);
});

test('plug, blind, purifier', () => {
  assert.deepEqual(keys(65539), ['on']);
  assert.deepEqual(write(65539, 'on', 1), { 3312: [{ 5850: 1 }] });

  assert.deepEqual(keys(65540), ['position', 'state', 'battery']);
  assert.equal(read(F.BLIND, 'position'), 75, '25 % closed is 75 % open');
  assert.equal(read(F.BLIND, 'state'), COVER_STATE.STOP);
  assert.equal(read(F.BLIND, 'battery'), 77);
  assert.deepEqual(write(65540, 'position', 100), { 15015: [{ 5536: 0 }] });
  assert.deepEqual(write(65540, 'state', COVER_STATE.CLOSE), { 15015: [{ 5536: 100 }] });
  assert.deepEqual(write(65540, 'state', COVER_STATE.STOP), { 15015: [{ 5523: 0 }] });

  assert.deepEqual(keys(65541), ['mode', 'speed', 'pm25', 'child_lock', 'filter']);
  assert.equal(read(F.PURIFIER, 'mode'), FAN_MODE.AUTO);
  assert.equal(read(F.PURIFIER, 'speed'), 20);
  assert.equal(read(F.PURIFIER, 'pm25'), 5);
  assert.equal(read(F.PURIFIER, 'filter'), 75);
  const unknown = (a) => {
    a[15025][0][5907] = 65535;
    return a;
  };
  assert.equal(read(F.PURIFIER, 'pm25', unknown), undefined, '65535: no measurement yet');
  assert.deepEqual(write(65541, 'mode', FAN_MODE.MEDIUM), { 15025: [{ 5900: 30 }] });
  assert.deepEqual(write(65541, 'speed', 47), { 15025: [{ 5908: 25 }] });
  assert.equal(fanSpeedOut(3), 10);
  assert.equal(fanSpeedOut(0), 0);
  assert.equal(fanSpeedOut(80), 50);
});

test('remotes and motion sensors: the battery only', () => {
  assert.deepEqual(keys(65542), ['battery']);
  assert.deepEqual(keys(65543), ['battery']);
  assert.equal(read(F.MOTION, 'battery'), 90);
});

test('reachability', () => {
  assert.equal(aliveOf(F.PLUG), 1);
  assert.equal(aliveOf({ ...F.PLUG, 9019: 0 }), 0);
  assert.equal(aliveOf({}), undefined);
});
