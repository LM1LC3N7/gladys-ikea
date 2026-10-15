// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their scenes and
// configuration), the Gladys core value enums the SDK does not export, and the
// tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  FIND: 'find_gateways',
  PAIR_DIRIGERA: 'pair_dirigera',
  PAIR_TRADFRI: 'pair_tradfri',
};

/** Manifest `scene_triggers` keys. */
export const SCENE_TRIGGERS = {
  REMOTE_BUTTON: 'remote_button',
};

/**
 * Configuration keys stored by the integration itself (setConfig), outside the
 * config_schema: never shown in the UI. Frozen, like the schema keys.
 */
export const STORED = {
  DIRIGERA_TOKEN: 'dirigera_token',
  DIRIGERA_ADDRESS: 'dirigera_address',
  TRADFRI_IDENTITY: 'tradfri_identity',
  TRADFRI_PSK: 'tradfri_psk',
  TRADFRI_ADDRESS: 'tradfri_address',
};

/** mDNS service types, mirrored by the manifest `network_discovery`. */
export const MDNS_SERVICES = {
  DIRIGERA: '_ihsp._tcp',
  TRADFRI: '_coap._udp',
};

export const PORTS = {
  /** DIRIGERA local API: HTTPS and websocket. */
  DIRIGERA: 8443,
  /** TRÅDFRI gateway: CoAP over DTLS (UDP). */
  TRADFRI: 5684,
};

// Gladys core enums (server/utils/constants.js), not exported by the SDK.
export const BUTTON_STATUS = { CLICK: 1, DOUBLE_CLICK: 2, LONG_CLICK: 6 };
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const FAN_MODE = { OFF: 0, LOW: 1, MEDIUM: 2, HIGH: 3, AUTO: 4 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Gladys accepts 300 scene events per minute. */
  eventsPerMinute: 250,
  /** Devices published (Gladys accepts 2000 per publication). */
  devices: 1000,
  /** Body of a DIRIGERA HTTP response (the device list of a large home is ~1 MB). */
  responseBytes: 8 * 1024 * 1024,
  /** One websocket or CoAP message. */
  messageBytes: 1024 * 1024,
  /** Scene event strings. */
  eventText: 1000,
};

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** Measurements (power, temperature, PM2.5…) of a feature are spaced by this much. */
  measureInterval: 10_000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** Device additions and removals arrive in bursts: wait for the burst to end. */
  rebuildDebounce: 1000,
  /** One HTTP request or DTLS handshake. */
  requestTimeout: 10_000,
  /** The DIRIGERA pairing: how long the user has to press the button, and the polling pace. */
  pairingWindow: 90_000,
  pairingPoll: 2000,
  /** DIRIGERA websocket: application ping, and the silence after which it is reopened. */
  wsPing: 30_000,
  wsSilence: 95_000,
  /** TRÅDFRI gateway: a CoAP ping this often, reconnection after this many failures. */
  tradfriPing: 60_000,
  tradfriPingFailures: 2,
  /** Reconnection backoff of both gateways. */
  reconnectMin: 5000,
  reconnectMax: 60_000,
  /** After this many failed reconnections, the gateway is searched again with mDNS. */
  rediscoverAfter: 3,
  /** mDNS scan duration (seconds, 1–30). */
  mdnsSeconds: 5,
};
