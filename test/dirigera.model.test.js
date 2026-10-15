import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { COVER_STATE, FAN_MODE, OPENING_SENSOR_STATE } from '../src/constants.js';
import { buildDirigeraModel, pressCapable, splitId } from '../src/dirigera/model.js';
import * as F from './fixtures/dirigera.js';

const gladys = createFakeGladys();
const model = buildDirigeraModel(gladys, F.ALL);
const id = (hubId) => gladys.externalIds('dirigera', hubId).device;
const device = (hubId) => model.devices.find((d) => d.external_id === id(hubId));
const keys = (hubId) => device(hubId).features.map((f) => f.external_id.split(':').at(-1));
const feature = (hubId, key) =>
  device(hubId).features.find((f) => f.external_id === `${id(hubId)}:${key}`);
const read = (hubId, key, attributes) => {
  const route = model.routes.get(hubId).find((r) => r.featureId === `${id(hubId)}:${key}`);
  return route.read({ ...F.ALL.find((d) => d.id === hubId).attributes, ...attributes });
};
const write = (hubId, key, value, attributes = {}) =>
  model.writers.get(`${id(hubId)}:${key}`).write(value, attributes);

test('splitId groups the hub devices of one physical device', () => {
  assert.deepEqual(splitId('somrig-1_2'), { base: 'somrig-1', index: 2 });
  assert.deepEqual(splitId('6a3c-11ee'), { base: '6a3c-11ee', index: 1 });
});

test('every usable hub device becomes one Gladys device', () => {
  const names = model.devices.map((d) => d.name);
  assert.equal(model.devices.length, 13, names.join(', '));
  assert.ok(!names.includes('Maison'), 'the hub itself is not a device');
  assert.ok(!names.includes('Répéteur') && !names.includes('Enceinte'));
  assert.ok(names.includes('TRETAKT Smart plug'), 'a device without a name takes its model');
  for (const d of model.devices) {
    assert.match(d.external_id, /^ext:test-integration:dirigera:/);
    assert.equal(d.should_poll, false);
  }
  assert.deepEqual(device('light-color').params, [
    { name: 'MODEL', value: 'TRADFRI bulb E27 CWS 806lm' },
    { name: 'PRODUCT_CODE', value: 'LED1924G9' },
    { name: 'FIRMWARE', value: '1.0.021' },
    { name: 'IKEA_ROOM', value: 'Salon' },
  ]);
});

test('lights: on/off, brightness, colour temperature in mireds, colour as an RGB integer', () => {
  assert.deepEqual(keys('light-color'), ['on', 'brightness', 'color_temperature', 'color']);
  assert.deepEqual(keys('light-white'), ['on', 'brightness', 'color_temperature']);
  assert.deepEqual(keys('light-dim'), ['on', 'brightness']);
  const temperature = feature('light-color', 'color_temperature');
  assert.equal(temperature.min, 250, '4000 K');
  assert.equal(temperature.max, 454, '2202 K');
  assert.equal(read('light-color', 'color_temperature', { colorTemperature: 2700 }), 370);
  assert.deepEqual(write('light-color', 'color_temperature', 370), [{ colorTemperature: 2703 }]);
  assert.deepEqual(write('light-color', 'color_temperature', 100), [{ colorTemperature: 4000 }]);
  assert.equal(read('light-color', 'color', {}), 0x00ff00, 'hue 120, saturation 1');
  assert.deepEqual(write('light-color', 'color', 0xff0000), [{ colorHue: 0, colorSaturation: 1 }]);
  assert.equal(feature('light-color', 'color').max, 0xffffff);
  assert.equal(read('light-color', 'on', { isOn: false }), 0);
  assert.deepEqual(write('light-color', 'on', 1), [{ isOn: true }]);
});

test('brightness 0 turns the light off, a brightness turns an off light on first', () => {
  assert.deepEqual(write('light-white', 'brightness', 0), [{ isOn: false }]);
  assert.deepEqual(write('light-white', 'brightness', 42.4, { isOn: false }), [
    { isOn: true },
    { lightLevel: 42 },
  ]);
  assert.deepEqual(write('light-white', 'brightness', 100, { isOn: true }), [{ lightLevel: 100 }]);
});

test('outlets: switch, and the meters of the INSPELNING', () => {
  assert.deepEqual(keys('outlet-energy'), [
    'on',
    'power',
    'voltage',
    'current',
    'energy',
    'child_lock',
  ]);
  assert.deepEqual(keys('outlet-plain'), ['on']);
  assert.equal(read('outlet-energy', 'power', {}), 1834.5);
  assert.equal(feature('outlet-energy', 'energy').unit, 'kilowatt-hour');
  assert.ok(model.throttled.has(`${id('outlet-energy')}:power`), 'measurements are spaced');
  assert.ok(!model.throttled.has(`${id('outlet-energy')}:on`));
  assert.deepEqual(write('outlet-energy', 'child_lock', 1), [{ childLock: true }]);
});

test('blinds: the position is the opening, the state follows the motor', () => {
  assert.deepEqual(keys('blinds-1'), ['position', 'state', 'battery']);
  assert.equal(read('blinds-1', 'position', { blindsCurrentLevel: 30 }), 70);
  assert.deepEqual(write('blinds-1', 'position', 100), [{ blindsTargetLevel: 0 }]);
  assert.deepEqual(write('blinds-1', 'state', COVER_STATE.OPEN), [{ blindsTargetLevel: 0 }]);
  assert.deepEqual(write('blinds-1', 'state', COVER_STATE.CLOSE), [{ blindsTargetLevel: 100 }]);
  assert.deepEqual(write('blinds-1', 'state', COVER_STATE.STOP), [{ blindsState: 'stopped' }]);
  assert.equal(read('blinds-1', 'state', { blindsState: 'up' }), COVER_STATE.OPEN);
  assert.equal(read('blinds-1', 'state', { blindsState: 'down' }), COVER_STATE.CLOSE);
  assert.equal(read('blinds-1', 'state', { blindsState: 'stopped' }), COVER_STATE.STOP);
  assert.equal(
    read('blinds-1', 'state', { blindsState: 'stopped', blindsCurrentLevel: 100 }),
    COVER_STATE.CLOSE,
  );
  assert.equal(read('blinds-1', 'battery', {}), 87);
});

test('STARKVIND: mode, speed, PM2.5, filter, child lock', () => {
  assert.deepEqual(keys('purifier-1'), ['mode', 'speed', 'pm25', 'filter', 'child_lock']);
  assert.equal(read('purifier-1', 'mode', {}), FAN_MODE.AUTO);
  assert.deepEqual(write('purifier-1', 'mode', FAN_MODE.HIGH), [{ fanMode: 'high' }]);
  assert.throws(() => write('purifier-1', 'mode', 9), /unknown fan mode/);
  assert.equal(read('purifier-1', 'speed', { motorState: 25 }), 50);
  assert.deepEqual(write('purifier-1', 'speed', 100), [{ motorState: 50 }]);
  assert.equal(read('purifier-1', 'filter', {}), 75);
  assert.equal(feature('purifier-1', 'filter').category, 'hepa-filter-monitoring');
});

test('sensors: VINDSTYRKA, PARASOLL, BADRING', () => {
  assert.deepEqual(keys('env-1'), ['temperature', 'humidity', 'pm25', 'voc']);
  assert.equal(feature('env-1', 'voc').type, 'integer');
  assert.equal(feature('env-1', 'temperature').read_only, true);
  assert.equal(read('door-1', 'opening', { isOpen: true }), OPENING_SENSOR_STATE.OPEN);
  assert.equal(read('door-1', 'opening', { isOpen: false }), OPENING_SENSOR_STATE.CLOSE);
  assert.equal(read('leak-1', 'leak', { waterLeakDetected: true }), 1);
});

test('the motion and light sensors of a VALLHORN make one device', () => {
  assert.deepEqual(keys('vallhorn-1'), ['motion', 'battery', 'illuminance']);
  assert.equal(model.owners.get('vallhorn-1_1'), id('vallhorn-1'));
  assert.equal(model.owners.get('vallhorn-1_3'), id('vallhorn-1'));
  assert.equal(model.routes.get('vallhorn-1_3').length, 1, 'the battery is read once');
});

test('remotes: one button feature per button, the battery', () => {
  assert.deepEqual(keys('somrig-1'), ['button_1', 'battery', 'button_2']);
  assert.equal(feature('somrig-1', 'button_2').name, 'Button 2');
  assert.equal(feature('somrig-1', 'button_1').category, 'button');
  assert.ok(model.events.has(`${id('somrig-1')}:button_1`));
  assert.deepEqual(model.buttons.get('somrig-1_2'), {
    deviceId: id('somrig-1'),
    featureId: `${id('somrig-1')}:button_2`,
    button: 2,
  });
  assert.deepEqual(keys('styrbar-1'), ['battery'], 'a remote bound to lights sends no press');
  assert.equal(pressCapable(F.STYRBAR), false);
  assert.equal(pressCapable(F.SOMRIG_1), true);
});

test('a feature the hub does not accept is read only', () => {
  const readOnly = buildDirigeraModel(gladys, [
    { ...F.DIMMABLE_LIGHT, capabilities: { canSend: [], canReceive: ['customName'] } },
  ]);
  const features = readOnly.devices[0].features;
  assert.ok(features.every((f) => f.read_only));
  assert.equal(readOnly.writers.size, 0);
});

test('garbage is skipped', () => {
  const empty = buildDirigeraModel(gladys, [null, {}, { id: 'x' }, { id: 1, attributes: {} }]);
  assert.equal(empty.devices.length, 0);
  assert.equal(buildDirigeraModel(gladys, 'nope').devices.length, 0);
});
