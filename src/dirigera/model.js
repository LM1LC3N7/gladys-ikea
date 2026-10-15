// -----------------------------------------------------------------------------
// DIRIGERA devices (GET /v1/devices) -> Gladys devices (pure).
//
// The attribute names and value ranges follow the hub's local API, as
// documented by the `dirigera` npm library (lpgera, MIT) and the Home
// Assistant `dirigera_platform` integration (sanjoyg, MIT).
//
// - One physical device may be several hub devices sharing an id, suffixed
//   `_1`, `_2`… (the buttons of a SOMRIG or STYRBAR remote, the motion and
//   light sensors of a VALLHORN): they make one Gladys device.
// - Writers return a LIST of attribute objects: the hub refuses some
//   combinations in one request, each object is sent as its own PATCH.
// - Blinds: the hub's level is 0 = open, 100 = closed; Gladys' position is
//   the opening (100 = open).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { clamp, hsvToRgb, kelvinToMired, miredToKelvin, rgbToHsv, RGB_MAX } from '../color.js';
import {
  BUTTON_STATUS,
  COVER_STATE,
  FAN_MODE,
  LIMITS,
  OPENING_SENSOR_STATE,
} from '../constants.js';
import { addDevice, batterySpec, bit, emptyModel, num, params, round } from '../features.js';

export const DEVICE_TYPE = 'dirigera';

/** remotePressEvent click patterns -> Gladys BUTTON_STATUS. */
export const CLICK_PATTERNS = {
  singlePress: BUTTON_STATUS.CLICK,
  doublePress: BUTTON_STATUS.DOUBLE_CLICK,
  longPress: BUTTON_STATUS.LONG_CLICK,
};

/** Kelvin range of a white spectrum bulb that does not say it. */
const DEFAULT_KELVIN = { min: 2202, max: 4000 };

const FAN_MODES = {
  off: FAN_MODE.OFF,
  low: FAN_MODE.LOW,
  medium: FAN_MODE.MEDIUM,
  high: FAN_MODE.HIGH,
  auto: FAN_MODE.AUTO,
};
const FAN_MODE_NAMES = Object.fromEntries(Object.entries(FAN_MODES).map(([k, v]) => [v, k]));

/** "6c1c…_2" -> { base: "6c1c…", index: 2 }; an id without suffix is index 1. */
export function splitId(id) {
  const match = /^(.+)_(\d{1,3})$/.exec(id);
  return match ? { base: match[1], index: Number(match[2]) } : { base: id, index: 1 };
}

const canReceive = (device, attribute) =>
  (device.capabilities?.canReceive ?? []).includes(attribute);
const has = (device, attribute) => device.attributes?.[attribute] !== undefined;

/** A spec whose command is accepted only when the hub says so. */
const writable = (device, attribute, write) => (canReceive(device, attribute) ? write : undefined);

const onOff = (device, category, type) => ({
  key: 'on',
  name: 'On/Off',
  category,
  type,
  min: 0,
  max: 1,
  kind: 'state',
  keys: ['isOn'],
  read: (a) => bit(a.isOn),
  write: writable(device, 'isOn', (value) => [{ isOn: value >= 1 }]),
});

const sensor = (
  key,
  name,
  category,
  unit,
  min,
  max,
  attribute,
  read = (a) => num(a[attribute]),
) => ({
  key,
  name,
  category,
  type: T.SENSOR.DECIMAL,
  unit,
  min,
  max,
  kind: 'measure',
  keys: [attribute],
  read,
});

const binarySensor = (key, name, category, attribute, read) => ({
  key,
  name,
  category,
  type: T.SENSOR.BINARY,
  min: 0,
  max: 1,
  kind: 'state',
  keys: [attribute],
  read,
});

const childLock = (device) => ({
  key: 'child_lock',
  name: 'Child lock',
  category: C.CHILD_LOCK,
  type: T.CHILD_LOCK.BINARY,
  min: 0,
  max: 1,
  kind: 'state',
  keepHistory: false,
  keys: ['childLock'],
  read: (a) => bit(a.childLock),
  write: writable(device, 'childLock', (value) => [{ childLock: value >= 1 }]),
});

const battery = () => batterySpec(['batteryPercentage'], (a) => num(a.batteryPercentage));

const pm25 = (attribute) =>
  sensor('pm25', 'PM2.5', C.PM25_SENSOR, U.MICROGRAM_PER_CUBIC_METER, 0, 1000, attribute);

function lightSpecs(device) {
  const a = device.attributes;
  const specs = [onOff(device, C.LIGHT, T.LIGHT.BINARY)];
  if (has(device, 'lightLevel')) {
    specs.push({
      key: 'brightness',
      name: 'Brightness',
      category: C.LIGHT,
      type: T.LIGHT.BRIGHTNESS,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      kind: 'state',
      keys: ['lightLevel'],
      read: (x) => num(x.lightLevel),
      write: writable(device, 'lightLevel', (value, x) => {
        if (value <= 0) {
          return [{ isOn: false }];
        }
        const level = { lightLevel: clamp(Math.round(value), 1, 100) };
        return x.isOn === false ? [{ isOn: true }, level] : [level];
      }),
    });
  }
  if (has(device, 'colorTemperature') || canReceive(device, 'colorTemperature')) {
    // colorTemperatureMin is the coldest (highest kelvin) end: sort the bounds.
    const bounds = [num(a.colorTemperatureMin), num(a.colorTemperatureMax)].filter((k) => k > 0);
    const kelvin =
      bounds.length === 2 ? { min: Math.min(...bounds), max: Math.max(...bounds) } : DEFAULT_KELVIN;
    const mired = { min: kelvinToMired(kelvin.max), max: kelvinToMired(kelvin.min) };
    specs.push({
      key: 'color_temperature',
      name: 'Color temperature',
      category: C.LIGHT,
      type: T.LIGHT.TEMPERATURE,
      min: mired.min,
      max: mired.max,
      kind: 'state',
      keys: ['colorTemperature'],
      read: (x) => (num(x.colorTemperature) > 0 ? kelvinToMired(x.colorTemperature) : undefined),
      write: writable(device, 'colorTemperature', (value) => [
        {
          colorTemperature: clamp(
            miredToKelvin(clamp(value, mired.min, mired.max)),
            kelvin.min,
            kelvin.max,
          ),
        },
      ]),
    });
  }
  if (canReceive(device, 'colorHue')) {
    specs.push({
      key: 'color',
      name: 'Color',
      category: C.LIGHT,
      type: T.LIGHT.COLOR,
      min: 0,
      max: RGB_MAX,
      kind: 'state',
      keys: ['colorHue', 'colorSaturation'],
      read: (x) =>
        num(x.colorHue) !== undefined && num(x.colorSaturation) !== undefined
          ? hsvToRgb(x.colorHue, x.colorSaturation, 1)
          : undefined,
      write: (value) => {
        const { h, s } = rgbToHsv(value);
        return [{ colorHue: round(h, 1), colorSaturation: round(s, 3) }];
      },
    });
  }
  return specs;
}

function outletSpecs(device) {
  const specs = [onOff(device, C.SWITCH, T.SWITCH.BINARY)];
  const meters = [
    ['power', 'Power', T.SWITCH.POWER, U.WATT, 4000, 'currentActivePower'],
    ['voltage', 'Voltage', T.SWITCH.VOLTAGE, U.VOLT, 300, 'currentVoltage'],
    ['current', 'Current', T.SWITCH.CURRENT, U.AMPERE, 20, 'currentAmps'],
    ['energy', 'Energy', T.SWITCH.ENERGY, U.KILOWATT_HOUR, 1_000_000, 'totalEnergyConsumed'],
  ];
  for (const [key, name, type, unit, max, attribute] of meters) {
    if (has(device, attribute)) {
      specs.push({
        key,
        name,
        category: C.SWITCH,
        type,
        unit,
        min: 0,
        max,
        kind: 'measure',
        keys: [attribute],
        read: (a) => num(a[attribute]),
      });
    }
  }
  if (has(device, 'childLock')) {
    specs.push(childLock(device));
  }
  return specs;
}

function blindsSpecs(device) {
  const specs = [
    {
      key: 'position',
      name: 'Position',
      category: C.SHUTTER,
      type: T.SHUTTER.POSITION,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      kind: 'state',
      keys: ['blindsCurrentLevel'],
      read: (a) =>
        num(a.blindsCurrentLevel) !== undefined
          ? 100 - clamp(a.blindsCurrentLevel, 0, 100)
          : undefined,
      write: (value) => [{ blindsTargetLevel: 100 - clamp(Math.round(value), 0, 100) }],
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
      keys: ['blindsState', 'blindsCurrentLevel'],
      read: (a) => {
        if (a.blindsState === 'up') {
          return COVER_STATE.OPEN;
        }
        if (a.blindsState === 'down') {
          return COVER_STATE.CLOSE;
        }
        if (a.blindsState !== 'stopped') {
          return undefined;
        }
        if (a.blindsCurrentLevel === 0) {
          return COVER_STATE.OPEN;
        }
        return a.blindsCurrentLevel === 100 ? COVER_STATE.CLOSE : COVER_STATE.STOP;
      },
      write: (value) => {
        if (value === COVER_STATE.OPEN) {
          return [{ blindsTargetLevel: 0 }];
        }
        if (value === COVER_STATE.CLOSE) {
          return [{ blindsTargetLevel: 100 }];
        }
        return [{ blindsState: 'stopped' }];
      },
    },
  ];
  if (has(device, 'batteryPercentage')) {
    specs.push(battery());
  }
  return specs;
}

function airPurifierSpecs(device) {
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
      keys: ['fanMode'],
      read: (a) => FAN_MODES[a.fanMode],
      write: writable(device, 'fanMode', (value) => {
        const fanMode = FAN_MODE_NAMES[value];
        if (!fanMode) {
          throw new Error(`unknown fan mode ${value}`);
        }
        return [{ fanMode }];
      }),
    },
    {
      // motorState: 0 (off) to 50, the speed the purifier runs at.
      key: 'speed',
      name: 'Speed',
      category: C.FAN,
      type: T.FAN.PERCENT,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      kind: 'state',
      keys: ['motorState'],
      read: (a) => (num(a.motorState) !== undefined ? clamp(a.motorState * 2, 0, 100) : undefined),
      write: writable(device, 'motorState', (value) => [
        { motorState: clamp(Math.round(value / 2), 0, 50) },
      ]),
    },
  ];
  if (has(device, 'currentPM25')) {
    specs.push(pm25('currentPM25'));
  }
  if (has(device, 'filterLifetime')) {
    specs.push({
      key: 'filter',
      name: 'Filter life remaining',
      category: C.HEPA_FILTER_MONITORING,
      type: T.FILTER_MONITORING.FILTER_LIFE_REMAINING,
      unit: U.PERCENT,
      min: 0,
      max: 100,
      kind: 'measure',
      keys: ['filterElapsedTime', 'filterLifetime'],
      read: (a) =>
        num(a.filterLifetime) > 0 && num(a.filterElapsedTime) !== undefined
          ? clamp(Math.round(100 - (a.filterElapsedTime / a.filterLifetime) * 100), 0, 100)
          : undefined,
    });
  }
  if (has(device, 'childLock')) {
    specs.push(childLock(device));
  }
  return specs;
}

function environmentSpecs(device) {
  const specs = [];
  const add = (attribute, spec) => has(device, attribute) && specs.push(spec);
  add(
    'currentTemperature',
    sensor(
      'temperature',
      'Temperature',
      C.TEMPERATURE_SENSOR,
      U.CELSIUS,
      -40,
      85,
      'currentTemperature',
    ),
  );
  add(
    'currentRH',
    sensor('humidity', 'Humidity', C.HUMIDITY_SENSOR, U.PERCENT, 0, 100, 'currentRH'),
  );
  add('currentPM25', pm25('currentPM25'));
  add('currentCO2', sensor('co2', 'CO2', C.CO2_SENSOR, U.PPM, 0, 10_000, 'currentCO2'));
  add('vocIndex', {
    ...sensor('voc', 'VOC index', C.VOC_INDEX_SENSOR, undefined, 0, 500, 'vocIndex'),
    type: T.VOC_INDEX_SENSOR.INTEGER,
  });
  add('batteryPercentage', battery());
  return specs;
}

const withBattery = (device, specs) =>
  has(device, 'batteryPercentage') ? [...specs, battery()] : specs;

function controllerSpecs(device, index, buttonName) {
  const specs = [];
  if (pressCapable(device)) {
    specs.push({
      key: `button_${index}`,
      name: buttonName,
      category: C.BUTTON,
      type: T.BUTTON.CLICK,
      min: 0,
      max: 255,
      kind: 'event',
      keys: [],
    });
  }
  return withBattery(device, specs);
}

/** Whether a controller sends remotePressEvent (shortcut buttons, BILRESA, or as it says). */
export function pressCapable(device) {
  if (device.type !== 'controller') {
    return false;
  }
  if (['shortcutController', 'genericSwitch'].includes(device.deviceType)) {
    return true;
  }
  return (device.capabilities?.canSend ?? []).some((pattern) => pattern in CLICK_PATTERNS);
}

/** The specs of one hub device; [] for what Gladys cannot use (hub, repeater, speaker). */
export function specsOf(device, index = 1, buttonName = 'Button') {
  switch (device.deviceType) {
    case 'light':
      return lightSpecs(device);
    case 'outlet':
      return outletSpecs(device);
    case 'blinds':
      return blindsSpecs(device);
    case 'airPurifier':
      return airPurifierSpecs(device);
    case 'environmentSensor':
      return environmentSpecs(device);
    case 'openCloseSensor':
      return withBattery(device, [
        binarySensor('opening', 'Opening', C.OPENING_SENSOR, 'isOpen', (a) =>
          typeof a.isOpen === 'boolean'
            ? a.isOpen
              ? OPENING_SENSOR_STATE.OPEN
              : OPENING_SENSOR_STATE.CLOSE
            : undefined,
        ),
      ]);
    case 'waterSensor':
      return withBattery(device, [
        binarySensor('leak', 'Water leak', C.LEAK_SENSOR, 'waterLeakDetected', (a) =>
          bit(a.waterLeakDetected),
        ),
      ]);
    case 'motionSensor':
    case 'occupancySensor':
      return withBattery(device, [
        binarySensor('motion', 'Motion', C.MOTION_SENSOR, 'isDetected', (a) => bit(a.isDetected)),
      ]);
    case 'lightSensor':
      return withBattery(device, [
        sensor('illuminance', 'Illuminance', C.LIGHT_SENSOR, U.LUX, 0, 100_000, 'illuminance'),
      ]);
    default:
      return device.type === 'controller' ? controllerSpecs(device, index, buttonName) : [];
  }
}

const label = (device) =>
  (typeof device.attributes?.customName === 'string' && device.attributes.customName.trim()) ||
  (typeof device.attributes?.model === 'string' && device.attributes.model.trim()) ||
  '';

/**
 * @param {object} gladys the SDK client (for the external ids)
 * @param {object[]} hubDevices GET /v1/devices
 * @returns the model (see src/features.js) plus `buttons`: hub device id ->
 * `{ deviceId, featureId, button }` for the remote presses
 */
export function buildDirigeraModel(gladys, hubDevices) {
  const model = { ...emptyModel(), buttons: new Map() };
  const groups = new Map();
  for (const device of Array.isArray(hubDevices) ? hubDevices : []) {
    if (typeof device?.id !== 'string' || !device.id || typeof device.attributes !== 'object') {
      continue;
    }
    const { base, index } = splitId(device.id);
    const group = groups.get(base) ?? [];
    group.push({ device, index });
    groups.set(base, group);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [base, members] of ordered.slice(0, LIMITS.devices)) {
    members.sort((a, b) => a.index - b.index);
    const main = members[0].device;
    const ids = gladys.externalIds(DEVICE_TYPE, base);
    const buttons = members.filter((m) => pressCapable(m.device));
    const parts = members.map(({ device, index }) => {
      const buttonName = buttons.length > 1 ? `Button ${index}` : 'Button';
      const specs = specsOf(device, index, buttonName);
      if (pressCapable(device)) {
        model.buttons.set(device.id, {
          deviceId: ids.device,
          featureId: ids.feature(`button_${index}`),
          button: index,
        });
      }
      return { sourceId: device.id, specs };
    });
    const a = main.attributes;
    addDevice(
      model,
      ids,
      {
        name: label(main) || 'IKEA device',
        params: params({
          MODEL: a.model,
          PRODUCT_CODE: a.productCode,
          FIRMWARE: a.firmwareVersion,
          IKEA_ROOM: main.room?.name,
        }),
      },
      parts,
    );
  }
  model.devices.sort((a, b) => a.name.localeCompare(b.name));
  return model;
}

/** The hub itself, in GET /v1/devices (its name and firmware for the status). */
export const hubOf = (hubDevices) =>
  (Array.isArray(hubDevices) ? hubDevices : []).find((d) => d?.deviceType === 'gateway');
