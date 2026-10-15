// -----------------------------------------------------------------------------
// TRÅDFRI gateway accessories (CoAP, IPSO JSON) -> Gladys devices (pure).
//
// The resource keys and value ranges follow node-tradfri-client (AlCalzone,
// MIT) and the Home Assistant `tradfri` integration (Apache-2.0):
// - 15001/<id>: one accessory; `5750` its type, `3` its device info, `9019`
//   whether the gateway reaches it, and one list per kind (3311 lights, 3312
//   plugs, 15015 blinds, 15025 air purifiers) whose first entry is the state.
// - dimmer 0-254, hue and saturation 0-65279, colour temperature in mireds,
//   blind position 0 = open (Gladys: 100 = open), fan speed 0 or 10-50.
// - Remotes and motion sensors only report their battery: the gateway never
//   forwards their presses or detections.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { clamp, hsvToRgb, rgbToHsv, RGB_MAX } from '../color.js';
import { COVER_STATE, FAN_MODE, LIMITS } from '../constants.js';
import { addDevice, batterySpec, emptyModel, num, params } from '../features.js';

export const DEVICE_TYPE = 'tradfri';

export const ACCESSORY = {
  REMOTE: 0,
  SLAVE_REMOTE: 1,
  LIGHT: 2,
  PLUG: 3,
  MOTION_SENSOR: 4,
  REPEATER: 6,
  BLIND: 7,
  SOUND_REMOTE: 8,
  AIR_PURIFIER: 10,
};

/** IPSO resource keys. */
export const K = {
  NAME: '9001',
  ID: '9003',
  ALIVE: '9019',
  TYPE: '5750',
  INFO: '3',
  LIGHT: '3311',
  PLUG: '3312',
  BLIND: '15015',
  PURIFIER: '15025',
  ON: '5850',
  DIMMER: '5851',
  HUE: '5707',
  SATURATION: '5708',
  MIREDS: '5711',
  POSITION: '5536',
  TRIGGER: '5523',
  FAN_MODE: '5900',
  FAN_SPEED: '5908',
  AIR_QUALITY: '5907',
  LOCKED: '5905',
  FILTER_LIFETIME: '5904',
  FILTER_REMAINING: '5910',
};
const INFO = { MANUFACTURER: '0', MODEL: '1', FIRMWARE: '3', BATTERY: '9' };

export const COLOR_MAX = 65279;
export const DIMMER_MAX = 254;
/** The white spectrum range of the TRÅDFRI bulbs (mireds). */
export const MIREDS = { min: 250, max: 454 };
/** The air quality the purifier reports while it has no measurement. */
const NO_MEASUREMENT = 65535;

/** The first state entry of a kind ({ "3311": [ { … } ] } -> { … }). */
const entry = (accessory, kind) => {
  const list = accessory?.[kind];
  return Array.isArray(list) && list[0] && typeof list[0] === 'object' ? list[0] : undefined;
};
const field = (kind, key) => (accessory) => entry(accessory, kind)?.[key];
const on = (value) =>
  value === 1 || value === true ? 1 : value === 0 || value === false ? 0 : undefined;

function lightSpecs(accessory, kind, category, binaryType) {
  const state = entry(accessory, kind);
  const specs = [
    {
      key: 'on',
      name: 'On/Off',
      category,
      type: binaryType,
      min: 0,
      max: 1,
      kind: 'state',
      read: (a) => on(field(kind, K.ON)(a)),
      write: (value) => ({ [kind]: [{ [K.ON]: value >= 1 ? 1 : 0 }] }),
    },
  ];
  if (kind !== K.LIGHT) {
    return specs;
  }
  if (num(state?.[K.DIMMER]) !== undefined) {
    specs.push({
      key: 'brightness',
      name: 'Brightness',
      category: C.LIGHT,
      type: T.LIGHT.BRIGHTNESS,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      kind: 'state',
      read: (a) => {
        const dimmer = num(field(K.LIGHT, K.DIMMER)(a));
        return dimmer === undefined
          ? undefined
          : Math.round((clamp(dimmer, 0, DIMMER_MAX) / DIMMER_MAX) * 100);
      },
      write: (value) =>
        value <= 0
          ? { [K.LIGHT]: [{ [K.ON]: 0 }] }
          : {
              [K.LIGHT]: [
                { [K.ON]: 1, [K.DIMMER]: Math.round((clamp(value, 1, 100) / 100) * DIMMER_MAX) },
              ],
            },
    });
  }
  if (num(state?.[K.HUE]) !== undefined) {
    // Colour bulbs (CWS) are driven by hue and saturation, white spectrum ones by mireds.
    specs.push({
      key: 'color',
      name: 'Color',
      category: C.LIGHT,
      type: T.LIGHT.COLOR,
      min: 0,
      max: RGB_MAX,
      kind: 'state',
      read: (a) => {
        const hue = num(field(K.LIGHT, K.HUE)(a));
        const saturation = num(field(K.LIGHT, K.SATURATION)(a));
        return hue === undefined || saturation === undefined
          ? undefined
          : hsvToRgb((hue / COLOR_MAX) * 360, saturation / COLOR_MAX, 1);
      },
      write: (value) => {
        const { h, s } = rgbToHsv(value);
        return {
          [K.LIGHT]: [
            {
              [K.HUE]: Math.round((h / 360) * COLOR_MAX),
              [K.SATURATION]: Math.round(s * COLOR_MAX),
            },
          ],
        };
      },
    });
  } else if (num(state?.[K.MIREDS]) !== undefined) {
    specs.push({
      key: 'color_temperature',
      name: 'Color temperature',
      category: C.LIGHT,
      type: T.LIGHT.TEMPERATURE,
      min: MIREDS.min,
      max: MIREDS.max,
      kind: 'state',
      read: (a) => num(field(K.LIGHT, K.MIREDS)(a)),
      write: (value) => ({
        [K.LIGHT]: [{ [K.MIREDS]: clamp(Math.round(value), MIREDS.min, MIREDS.max) }],
      }),
    });
  }
  return specs;
}

const battery = () =>
  batterySpec([], (a) => {
    const level = num(a?.[K.INFO]?.[INFO.BATTERY]);
    return level === undefined ? undefined : clamp(level, 0, 100);
  });

function blindSpecs() {
  const position = (a) => num(field(K.BLIND, K.POSITION)(a));
  return [
    {
      key: 'position',
      name: 'Position',
      category: C.SHUTTER,
      type: T.SHUTTER.POSITION,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      kind: 'state',
      read: (a) =>
        position(a) === undefined ? undefined : 100 - clamp(Math.round(position(a)), 0, 100),
      write: (value) => ({ [K.BLIND]: [{ [K.POSITION]: 100 - clamp(Math.round(value), 0, 100) }] }),
    },
    {
      key: 'state',
      name: 'Open/Close',
      category: C.SHUTTER,
      type: T.SHUTTER.STATE,
      min: COVER_STATE.CLOSE,
      max: COVER_STATE.OPEN,
      kind: 'state',
      keepHistory: false,
      read: (a) => {
        const p = position(a);
        if (p === undefined) {
          return undefined;
        }
        return p <= 0 ? COVER_STATE.OPEN : p >= 100 ? COVER_STATE.CLOSE : COVER_STATE.STOP;
      },
      write: (value) => {
        if (value === COVER_STATE.OPEN) {
          return { [K.BLIND]: [{ [K.POSITION]: 0 }] };
        }
        if (value === COVER_STATE.CLOSE) {
          return { [K.BLIND]: [{ [K.POSITION]: 100 }] };
        }
        return { [K.BLIND]: [{ [K.TRIGGER]: 0 }] };
      },
    },
    battery(),
  ];
}

/** 5900: 0 off, 1 auto, 10-50 a manual level. */
const FAN_MODES_OUT = {
  [FAN_MODE.OFF]: 0,
  [FAN_MODE.AUTO]: 1,
  [FAN_MODE.LOW]: 10,
  [FAN_MODE.MEDIUM]: 30,
  [FAN_MODE.HIGH]: 50,
};

/** Fan speed for the gateway: 0, or 10 to 50 by steps of 5. */
export const fanSpeedOut = (speed) => (speed <= 0 ? 0 : clamp(Math.round(speed / 5) * 5, 10, 50));

function purifierSpecs(accessory) {
  const state = entry(accessory, K.PURIFIER);
  const value = (key) => (a) => num(field(K.PURIFIER, key)(a));
  const specs = [
    {
      key: 'mode',
      name: 'Mode',
      category: C.FAN,
      type: T.FAN.MODE,
      min: FAN_MODE.OFF,
      max: FAN_MODE.AUTO,
      kind: 'state',
      keepHistory: false,
      read: (a) => {
        const mode = value(K.FAN_MODE)(a);
        if (mode === undefined) {
          return undefined;
        }
        if (mode === 0) {
          return FAN_MODE.OFF;
        }
        if (mode === 1) {
          return FAN_MODE.AUTO;
        }
        return mode <= 20 ? FAN_MODE.LOW : mode <= 30 ? FAN_MODE.MEDIUM : FAN_MODE.HIGH;
      },
      write: (mode) => {
        if (!(mode in FAN_MODES_OUT)) {
          throw new Error(`unknown fan mode ${mode}`);
        }
        return { [K.PURIFIER]: [{ [K.FAN_MODE]: FAN_MODES_OUT[mode] }] };
      },
    },
    {
      key: 'speed',
      name: 'Speed',
      category: C.FAN,
      type: T.FAN.PERCENT,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      kind: 'state',
      read: (a) => {
        const speed = value(K.FAN_SPEED)(a);
        return speed === undefined ? undefined : clamp(speed * 2, 0, 100);
      },
      write: (percent) => ({ [K.PURIFIER]: [{ [K.FAN_SPEED]: fanSpeedOut(percent / 2) }] }),
    },
    {
      key: 'pm25',
      name: 'PM2.5',
      category: C.PM25_SENSOR,
      type: T.SENSOR.DECIMAL,
      unit: U.MICROGRAM_PER_CUBIC_METER,
      min: 0,
      max: 1000,
      kind: 'measure',
      read: (a) => {
        const quality = value(K.AIR_QUALITY)(a);
        return quality === undefined || quality === NO_MEASUREMENT ? undefined : quality;
      },
    },
    {
      key: 'child_lock',
      name: 'Child lock',
      category: C.CHILD_LOCK,
      type: T.CHILD_LOCK.BINARY,
      min: 0,
      max: 1,
      kind: 'state',
      keepHistory: false,
      read: (a) => on(field(K.PURIFIER, K.LOCKED)(a)),
      write: (locked) => ({ [K.PURIFIER]: [{ [K.LOCKED]: locked >= 1 ? 1 : 0 }] }),
    },
  ];
  if (num(state?.[K.FILTER_LIFETIME]) > 0) {
    specs.push({
      key: 'filter',
      name: 'Filter life remaining',
      category: C.HEPA_FILTER_MONITORING,
      type: T.FILTER_MONITORING.FILTER_LIFE_REMAINING,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      kind: 'measure',
      read: (a) => {
        const lifetime = value(K.FILTER_LIFETIME)(a);
        const remaining = value(K.FILTER_REMAINING)(a);
        return lifetime > 0 && remaining !== undefined
          ? clamp(Math.round((remaining / lifetime) * 100), 0, 100)
          : undefined;
      },
    });
  }
  return specs;
}

/** The specs of one accessory; [] for the repeaters and unknown types. */
export function specsOf(accessory) {
  switch (accessory?.[K.TYPE]) {
    case ACCESSORY.LIGHT:
      return entry(accessory, K.LIGHT)
        ? lightSpecs(accessory, K.LIGHT, C.LIGHT, T.LIGHT.BINARY)
        : [];
    case ACCESSORY.PLUG:
      return entry(accessory, K.PLUG)
        ? lightSpecs(accessory, K.PLUG, C.SWITCH, T.SWITCH.BINARY)
        : [];
    case ACCESSORY.BLIND:
      return entry(accessory, K.BLIND) ? blindSpecs() : [];
    case ACCESSORY.AIR_PURIFIER:
      return entry(accessory, K.PURIFIER) ? purifierSpecs(accessory) : [];
    case ACCESSORY.REMOTE:
    case ACCESSORY.SLAVE_REMOTE:
    case ACCESSORY.SOUND_REMOTE:
    case ACCESSORY.MOTION_SENSOR:
      return num(accessory?.[K.INFO]?.[INFO.BATTERY]) !== undefined ? [battery()] : [];
    default:
      return [];
  }
}

/** Whether the gateway currently reaches the accessory (undefined when it does not say). */
export const aliveOf = (accessory) => on(accessory?.[K.ALIVE]);

/**
 * @param {object} gladys the SDK client (for the external ids)
 * @param {object[]} accessories the 15001/<id> resources
 */
export function buildTradfriModel(gladys, accessories) {
  const model = emptyModel();
  const list = (Array.isArray(accessories) ? accessories : [])
    .filter((a) => Number.isInteger(a?.[K.ID]))
    .sort((a, b) => a[K.ID] - b[K.ID])
    .slice(0, LIMITS.devices);
  for (const accessory of list) {
    const id = String(accessory[K.ID]);
    const info = accessory[K.INFO] ?? {};
    const name =
      (typeof accessory[K.NAME] === 'string' && accessory[K.NAME].trim()) ||
      (typeof info[INFO.MODEL] === 'string' && info[INFO.MODEL].trim()) ||
      `TRÅDFRI ${id}`;
    addDevice(
      model,
      gladys.externalIds(DEVICE_TYPE, id),
      {
        name,
        params: params({
          MODEL: info[INFO.MODEL],
          MANUFACTURER: info[INFO.MANUFACTURER],
          FIRMWARE: info[INFO.FIRMWARE],
        }),
      },
      [{ sourceId: id, specs: specsOf(accessory) }],
    );
  }
  model.devices.sort((a, b) => a.name.localeCompare(b.name));
  return model;
}
