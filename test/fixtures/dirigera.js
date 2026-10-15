// -----------------------------------------------------------------------------
// GET /v1/devices of a DIRIGERA hub, and websocket events, shaped like the
// hub's answers (attribute names and ranges as documented by the `dirigera`
// npm library). Ids are made up.
// -----------------------------------------------------------------------------

const room = { id: 'room-1', name: 'Salon', color: 'ikea_green_no_65', icon: 'rooms_sofa' };

const common = (overrides) => ({
  createdAt: '2025-01-01T00:00:00.000Z',
  isReachable: true,
  lastSeen: '2026-10-15T10:00:00.000Z',
  room,
  deviceSet: [],
  remoteLinks: [],
  isHidden: false,
  ...overrides,
});

export const HUB = common({
  id: 'hub-0001',
  relationId: 'hub-0001',
  type: 'gateway',
  deviceType: 'gateway',
  attributes: {
    customName: 'Maison',
    model: 'DIRIGERA Hub for smart products',
    manufacturer: 'IKEA of Sweden',
    firmwareVersion: '2.615.6',
    hardwareVersion: 'P2.5',
    serialNumber: 'hub-0001',
    productCode: 'E2006',
  },
  capabilities: { canSend: [], canReceive: ['customName', 'permittingJoin'] },
});

export const COLOR_LIGHT = common({
  id: 'light-color',
  type: 'light',
  deviceType: 'light',
  attributes: {
    customName: 'Lampe salon',
    model: 'TRADFRI bulb E27 CWS 806lm',
    manufacturer: 'IKEA of Sweden',
    firmwareVersion: '1.0.021',
    productCode: 'LED1924G9',
    isOn: true,
    startupOnOff: 'startOn',
    lightLevel: 80,
    colorHue: 120,
    colorSaturation: 1,
    colorTemperature: 2801,
    colorTemperatureMin: 4000,
    colorTemperatureMax: 2202,
    colorMode: 'color',
  },
  capabilities: {
    canSend: [],
    canReceive: [
      'customName',
      'isOn',
      'lightLevel',
      'colorTemperature',
      'colorHue',
      'colorSaturation',
    ],
  },
});

export const WHITE_LIGHT = common({
  id: 'light-white',
  type: 'light',
  deviceType: 'light',
  attributes: {
    customName: 'Plafonnier',
    model: 'TRADFRI bulb E27 WS opal 1000lm',
    manufacturer: 'IKEA of Sweden',
    firmwareVersion: '2.3.095',
    productCode: 'LED1732G11E27',
    isOn: false,
    lightLevel: 100,
    colorTemperature: 4000,
    colorTemperatureMin: 4000,
    colorTemperatureMax: 2202,
    colorMode: 'temperature',
  },
  capabilities: {
    canSend: [],
    canReceive: ['customName', 'isOn', 'lightLevel', 'colorTemperature'],
  },
});

export const DIMMABLE_LIGHT = common({
  id: 'light-dim',
  type: 'light',
  deviceType: 'light',
  attributes: {
    customName: 'Applique',
    model: 'STOFTMOLN ceiling/wall lamp WW37',
    manufacturer: 'IKEA of Sweden',
    isOn: true,
    lightLevel: 1,
  },
  capabilities: { canSend: [], canReceive: ['customName', 'isOn', 'lightLevel'] },
});

export const INSPELNING = common({
  id: 'outlet-energy',
  type: 'outlet',
  deviceType: 'outlet',
  attributes: {
    customName: 'Prise lave-linge',
    model: 'INSPELNING Smart plug',
    manufacturer: 'IKEA of Sweden',
    productCode: 'E2206',
    isOn: true,
    startupOnOff: 'startPrevious',
    lightLevel: 100,
    currentActivePower: 1834.5,
    currentVoltage: 231.2,
    currentAmps: 7.9,
    totalEnergyConsumed: 152.31,
    energyConsumedAtLastReset: 0,
    childLock: false,
    statusLight: true,
  },
  capabilities: {
    canSend: [],
    canReceive: ['customName', 'isOn', 'childLock', 'statusLight', 'energyConsumedAtLastReset'],
  },
});

export const TRETAKT = common({
  id: 'outlet-plain',
  type: 'outlet',
  deviceType: 'outlet',
  attributes: {
    customName: '',
    model: 'TRETAKT Smart plug',
    manufacturer: 'IKEA of Sweden',
    isOn: false,
    lightLevel: 100,
  },
  capabilities: { canSend: [], canReceive: ['customName', 'isOn'] },
});

export const BLINDS = common({
  id: 'blinds-1',
  type: 'blinds',
  deviceType: 'blinds',
  attributes: {
    customName: 'Store chambre',
    model: 'PRAKTLYSING cellular blind',
    manufacturer: 'IKEA of Sweden',
    batteryPercentage: 87,
    blindsTargetLevel: 30,
    blindsCurrentLevel: 30,
    blindsState: 'stopped',
  },
  capabilities: { canSend: [], canReceive: ['customName', 'blindsTargetLevel', 'blindsState'] },
});

export const STARKVIND = common({
  id: 'purifier-1',
  type: 'airPurifier',
  deviceType: 'airPurifier',
  attributes: {
    customName: 'Purificateur',
    model: 'STARKVIND Air purifier',
    manufacturer: 'IKEA of Sweden',
    fanMode: 'auto',
    fanModeSequence: 'lowMediumHighAuto',
    motorState: 10,
    motorRuntime: 1200,
    filterElapsedTime: 64800,
    filterAlarmStatus: false,
    filterLifetime: 259200,
    childLock: false,
    statusLight: true,
    currentPM25: 4,
  },
  capabilities: {
    canSend: [],
    canReceive: ['customName', 'fanMode', 'motorState', 'childLock', 'statusLight'],
  },
});

export const VINDSTYRKA = common({
  id: 'env-1',
  type: 'sensor',
  deviceType: 'environmentSensor',
  attributes: {
    customName: 'Qualité air',
    model: 'VINDSTYRKA',
    manufacturer: 'IKEA of Sweden',
    currentTemperature: 21.4,
    currentRH: 48,
    currentPM25: 6,
    maxMeasuredPM25: 999,
    minMeasuredPM25: 0,
    vocIndex: 102,
  },
  capabilities: { canSend: [], canReceive: ['customName'] },
});

export const PARASOLL = common({
  id: 'door-1',
  type: 'sensor',
  deviceType: 'openCloseSensor',
  attributes: {
    customName: 'Porte entrée',
    model: 'PARASOLL Door/Window Sensor',
    manufacturer: 'IKEA of Sweden',
    isOpen: false,
    batteryPercentage: 94,
  },
  capabilities: { canSend: [], canReceive: ['customName'] },
});

export const BADRING = common({
  id: 'leak-1',
  type: 'sensor',
  deviceType: 'waterSensor',
  attributes: {
    customName: 'Fuite cuisine',
    model: 'BADRING Water Leakage Sensor',
    manufacturer: 'IKEA of Sweden',
    waterLeakDetected: false,
    batteryPercentage: 100,
  },
  capabilities: { canSend: [], canReceive: ['customName'] },
});

/** VALLHORN: a motion sensor and a light sensor, one physical device. */
export const VALLHORN_MOTION = common({
  id: 'vallhorn-1_1',
  relationId: 'vallhorn-1',
  type: 'sensor',
  deviceType: 'motionSensor',
  attributes: {
    customName: 'Détecteur couloir',
    model: 'VALLHORN Wireless Motion Sensor',
    manufacturer: 'IKEA of Sweden',
    batteryPercentage: 70,
    isOn: false,
    isDetected: false,
  },
  capabilities: { canSend: ['isOn', 'lightLevel'], canReceive: ['customName'] },
});

export const VALLHORN_LIGHT = common({
  id: 'vallhorn-1_3',
  relationId: 'vallhorn-1',
  type: 'unknown',
  deviceType: 'lightSensor',
  attributes: {
    customName: 'Détecteur couloir',
    model: 'VALLHORN Wireless Motion Sensor',
    manufacturer: 'IKEA of Sweden',
    illuminance: 42,
    batteryPercentage: 70,
  },
  capabilities: { canSend: [], canReceive: ['customName'] },
});

/** SOMRIG: two shortcut buttons, two hub devices. */
const somrig = (index) =>
  common({
    id: `somrig-1_${index}`,
    relationId: 'somrig-1',
    type: 'controller',
    deviceType: 'shortcutController',
    attributes: {
      customName: 'Raccourcis',
      model: 'SOMRIG shortcut button',
      manufacturer: 'IKEA of Sweden',
      batteryPercentage: 55,
      isOn: false,
      lightLevel: 1,
    },
    capabilities: {
      canSend: ['singlePress', 'doublePress', 'longPress'],
      canReceive: ['customName'],
    },
  });
export const SOMRIG_1 = somrig(1);
export const SOMRIG_2 = somrig(2);

/** A remote paired to a light: it only reports its battery. */
export const STYRBAR = common({
  id: 'styrbar-1',
  type: 'controller',
  deviceType: 'lightController',
  attributes: {
    customName: 'Télécommande salon',
    model: 'Remote Control N2',
    manufacturer: 'IKEA of Sweden',
    batteryPercentage: 20,
    isOn: false,
    lightLevel: 1,
  },
  capabilities: { canSend: ['isOn', 'lightLevel'], canReceive: ['customName'] },
});

export const REPEATER = common({
  id: 'repeater-1',
  type: 'repeater',
  deviceType: 'repeater',
  attributes: { customName: 'Répéteur', model: 'TRADFRI Signal Repeater' },
  capabilities: { canSend: [], canReceive: ['customName'] },
});

export const SPEAKER = common({
  id: 'speaker-1',
  type: 'speaker',
  deviceType: 'speaker',
  attributes: { customName: 'Enceinte', model: 'SYMFONISK', volume: 20, playback: 'playbackIdle' },
  capabilities: { canSend: [], canReceive: ['customName', 'volume', 'playback'] },
});

export const ALL = [
  HUB,
  COLOR_LIGHT,
  WHITE_LIGHT,
  DIMMABLE_LIGHT,
  INSPELNING,
  TRETAKT,
  BLINDS,
  STARKVIND,
  VINDSTYRKA,
  PARASOLL,
  BADRING,
  VALLHORN_MOTION,
  VALLHORN_LIGHT,
  SOMRIG_1,
  SOMRIG_2,
  STYRBAR,
  REPEATER,
  SPEAKER,
];

const envelope = (type, body) => ({
  id: `event-${type}`,
  time: '2026-10-15T10:00:01.000Z',
  specversion: '1.1.0',
  source: 'urn:com:ikea:homesmart:iotc:zigbee',
  type,
  ...body,
});

export const stateChanged = (id, attributes, extra = {}) =>
  envelope('deviceStateChanged', {
    data: { id, type: 'x', deviceType: 'x', attributes, ...extra },
  });

export const remotePress = (id, clickPattern) =>
  envelope('remotePressEvent', { data: { id, clickPattern } });

export const deviceAdded = (device) => envelope('deviceAdded', { data: device });

export const deviceRemoved = (id) =>
  envelope('deviceRemoved', { removedDeviceId: { id, type: 'light' } });
