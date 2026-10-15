// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, MDNS_SERVICES, SCENE_TRIGGERS, STORED } from '../src/constants.js';
import { ACTION_NAMES } from '../src/dirigera/gateway.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');

const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers].flatMap((item) => item.fields ?? []),
];

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/, 'scene triggers need Gladys 5.1');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-ikea:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    if (fields[key].default !== undefined || value !== '') {
      assert.deepEqual(fields[key].default, value, key);
    }
  }
  for (const key of Object.values(STORED)) {
    assert.equal(fields[key], undefined, `${key} is stored by the code, never shown`);
  }
  const intro = fields.intro;
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
  }
  for (const section of allFields.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.equal(section.placeholder, undefined, section.key);
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
    assert.ok((section.links ?? []).length <= 5);
  }
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: multi-language placeholder`);
  }
});

test('the mDNS services scanned are the ones declared', () => {
  assert.deepEqual(manifest.network_discovery, [
    { type: 'mdns', service: MDNS_SERVICES.DIRIGERA },
    { type: 'mdns', service: MDNS_SERVICES.TRADFRI },
  ]);
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  const pairDirigera = manifest.actions.find((a) => a.key === ACTIONS.PAIR_DIRIGERA);
  assert.ok(pairDirigera.timeout_seconds >= 100, 'the 90 s to press the hub button fit');
  const pairTradfri = manifest.actions.find((a) => a.key === ACTIONS.PAIR_TRADFRI);
  assert.deepEqual(
    pairTradfri.fields.map((f) => f.key),
    ['security_code'],
    'read by app.pairTradfri(fields)',
  );
  assert.match(app, /fields\?\.security_code/);
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

test('the trigger fields and variables are what the events carry', () => {
  const trigger = manifest.scene_triggers.find((t) => t.key === SCENE_TRIGGERS.REMOTE_BUTTON);
  assert.deepEqual(
    trigger.fields.map((f) => f.key),
    ['device', 'button', 'action'],
  );
  // The data object of publishSceneEvent in src/app.js.
  const sent = /publishSceneEvent\(SCENE_TRIGGERS\.REMOTE_BUTTON, \{([\s\S]*?)\}\)/.exec(app)[1];
  for (const key of [...trigger.fields, ...trigger.variables].map((f) => f.key)) {
    assert.match(sent, new RegExp(`\\b${key}\\b`), `${key} is never sent`);
  }
  const device = trigger.fields.find((f) => f.key === 'device');
  assert.equal(device.source, 'devices');
  assert.equal(device.options, undefined);
  const actions = trigger.fields.find((f) => f.key === 'action').options.map((o) => o.value);
  assert.deepEqual(actions.sort(), Object.values(ACTION_NAMES).sort());
});
