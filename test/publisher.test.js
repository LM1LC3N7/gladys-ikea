import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { StatePublisher } from '../src/publisher.js';

const feature = (n) => `ext:test-integration:dirigera:d${n}:on`;

function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_760_000_000_000 });
  const gladys = createFakeGladys();
  const publisher = new StatePublisher({
    gladys,
    logger: createLogger({ level: 'silent' }),
    now: () => Date.now(),
  });
  return { gladys, publisher };
}

test('at most 250 states a minute, the rest waits', async (t) => {
  const { gladys, publisher } = setup(t);
  for (let i = 0; i < 300; i += 1) {
    publisher.push(feature(i), { state: 1 });
  }
  assert.equal(await publisher.flush(), 250);
  assert.equal(await publisher.flush(), 0);
  t.mock.timers.tick(60_000);
  assert.equal(await publisher.flush(), 50);
  assert.equal(gladys.fake.states.length, 300);
});

test('measurements are spaced, the last value is kept', async (t) => {
  const { gladys, publisher } = setup(t);
  const power = 'ext:test-integration:dirigera:plug:power';
  publisher.configure({ throttled: new Set([power]) });
  publisher.push(power, { state: 10 });
  await publisher.flush();
  publisher.push(power, { state: 11 });
  publisher.push(power, { state: 12 });
  await publisher.flush();
  assert.equal(gladys.fake.lastState(power), 10);
  t.mock.timers.tick(10_000);
  await publisher.flush();
  assert.equal(gladys.fake.lastState(power), 12);
});

test('a repeated button press is sent again', async (t) => {
  const { gladys, publisher } = setup(t);
  const button = 'ext:test-integration:dirigera:remote:button_1';
  const switchFeature = feature(1);
  publisher.configure({ events: new Set([button]) });
  for (let round = 0; round < 2; round += 1) {
    publisher.push(button, { state: 1 });
    publisher.push(switchFeature, { state: 1 });
    await publisher.flush();
  }
  const sent = (id) => gladys.fake.states.filter((s) => s.device_feature_external_id === id);
  assert.equal(sent(button).length, 2);
  assert.equal(sent(switchFeature).length, 1, 'an unchanged state is not');
});

test('a refused batch is kept for the next round, a deleted device forgotten', async (t) => {
  const { gladys, publisher } = setup(t);
  let fail = true;
  const original = gladys.publishChangedStates.bind(gladys);
  t.mock.method(gladys, 'publishChangedStates', async (...args) => {
    if (fail) {
      throw new Error('429');
    }
    return original(...args);
  });
  publisher.push(feature(1), { state: 1 });
  await assert.rejects(publisher.flush(), /429/);
  fail = false;
  assert.equal(await publisher.flush(), 1);
  publisher.push(feature(2), { state: 1 });
  publisher.forget('ext:test-integration:dirigera:d2');
  assert.equal(await publisher.flush(), 0);
});
