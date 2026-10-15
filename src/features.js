// -----------------------------------------------------------------------------
// The building blocks shared by the DIRIGERA and TRÅDFRI models (pure).
//
// A model turns the devices of one gateway into:
// - `devices`: the Gladys devices offered in Discovery;
// - `routes`: gateway device id -> the features its values feed, each with
//   `keys` (the attributes it depends on) and `read(source)`;
// - `writers`: feature external id -> `{ sourceId, write(value, source) }`,
//   the command sent to the gateway;
// - `owners`: gateway device id -> Gladys device external id (reachability);
// - `throttled` (measurements, spaced) and `events` (buttons, never deduped).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

export const compact = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));

/** A finite number, else undefined. */
export const num = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** A boolean as 0/1, else undefined. */
export const bit = (value) => (typeof value === 'boolean' ? Number(value) : undefined);

export const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Gladys device params: strings only, bounded. */
export function params(entries) {
  return Object.entries(entries)
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([name, value]) => ({ name, value: value.trim().slice(0, 100) }));
}

/** The Gladys feature of a spec. */
export function gladysFeature(spec, externalId) {
  return compact({
    name: spec.name,
    external_id: externalId,
    category: spec.category,
    type: spec.type,
    unit: spec.unit,
    min: spec.min ?? 0,
    max: spec.max ?? 1,
    read_only: !spec.write,
    has_feedback: Boolean(spec.read),
    keep_history: spec.keepHistory ?? true,
  });
}

export function emptyModel() {
  return {
    devices: [],
    routes: new Map(),
    writers: new Map(),
    owners: new Map(),
    throttled: new Set(),
    events: new Set(),
  };
}

/**
 * Adds one Gladys device to a model.
 * @param {object} model the model being built
 * @param {object} ids gladys.externalIds() of the device
 * @param {object} device `{ name, params }`
 * @param {object[]} parts `{ sourceId, specs }`: the gateway devices it groups
 */
export function addDevice(model, ids, device, parts) {
  const features = [];
  const seen = new Set();
  for (const { sourceId, specs } of parts) {
    model.owners.set(sourceId, ids.device);
    for (const spec of specs) {
      const featureId = ids.feature(spec.key);
      // Grouped gateway devices may share a feature (the battery): the first wins.
      if (seen.has(featureId)) {
        continue;
      }
      seen.add(featureId);
      features.push(gladysFeature(spec, featureId));
      if (spec.read) {
        const list = model.routes.get(sourceId) ?? [];
        list.push({ featureId, keys: spec.keys, read: spec.read });
        model.routes.set(sourceId, list);
      }
      if (spec.write) {
        model.writers.set(featureId, { sourceId, write: spec.write });
      }
      if (spec.kind === 'measure') {
        model.throttled.add(featureId);
      }
      if (spec.kind === 'event') {
        model.events.add(featureId);
      }
    }
  }
  if (features.length > 0) {
    model.devices.push({
      name: device.name.slice(0, 100),
      external_id: ids.device,
      features,
      params: device.params ?? [],
      should_poll: false,
    });
  }
}

/** The battery level, shared by every battery device of both gateways. */
export const batterySpec = (keys, read) => ({
  key: 'battery',
  name: 'Battery',
  category: C.BATTERY,
  type: T.BATTERY.INTEGER,
  unit: U.PERCENT,
  min: 0,
  max: 100,
  kind: 'measure',
  keys,
  read,
});
