// -----------------------------------------------------------------------------
// The DIRIGERA driver: loads the hub devices (GET /v1/devices), then follows
// the websocket events (deviceStateChanged, deviceAdded, deviceRemoved,
// remotePressEvent) and sends the commands (PATCH /v1/devices/<id>).
//
// The websocket gets a ping every 30 s (a protocol ping frame, and the ping
// event of the `dirigera` library); after 95 s without any message nor pong it
// is reopened, and every reopening reloads the device list, so no change is
// lost.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { LIMITS, STORED, TIMINGS } from '../constants.js';
import { Gateway } from '../gateway.js';
import { CLIENT_NAME, challengeOf, createVerifier } from './auth.js';
import { createDirigeraClient, errorKind, errorReason } from './client.js';
import { buildDirigeraModel, CLICK_PATTERNS, hubOf, splitId } from './model.js';

/** remotePressEvent click patterns -> the `action` of the scene trigger. */
export const ACTION_NAMES = {
  singlePress: 'single_press',
  doublePress: 'double_press',
  longPress: 'long_press',
};

const validDevice = (d) =>
  typeof d?.id === 'string' && d.id !== '' && d.attributes && typeof d.attributes === 'object';

export class DirigeraGateway extends Gateway {
  constructor({ createClient = createDirigeraClient, ...options }) {
    super({ kind: 'dirigera', ...options });
    this.label = 'DIRIGERA';
    this.createClient = createClient;
    this.client = null;
    this.socket = null;
    this.pingTimer = undefined;
    this.refreshTimer = undefined;
    this.lastMessage = 0;
    /** hub device id -> device JSON, attributes kept up to date by the events */
    this.cache = new Map();
    this.model = { ...this.model, buttons: new Map() };
    this.name = undefined;
  }

  blocked(config) {
    if (config.hostError) {
      return 'bad-host';
    }
    return config.token ? undefined : 'not-paired';
  }

  errorKind(err) {
    return errorKind(err);
  }

  errorReason(err) {
    return errorReason(err);
  }

  async open(host, current) {
    const client = this.createClient({
      host,
      token: this.config.token,
      verifyCertificate: this.config.verifyCertificate,
    });
    const devices = await client.devices();
    if (!current()) {
      return;
    }
    this.client = client;
    this.load(devices);
    this.listen(this.generation);
  }

  close() {
    this.timers.clearInterval(this.pingTimer);
    this.timers.clearTimeout(this.refreshTimer);
    this.pingTimer = undefined;
    this.refreshTimer = undefined;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners?.();
      socket.on?.('error', () => {});
      if (typeof socket.terminate === 'function') {
        socket.terminate();
      } else {
        socket.close?.();
      }
    }
    this.client = null;
  }

  sourceReachable(sourceId) {
    return this.cache.get(sourceId)?.isReachable;
  }

  /** A full device list: the model is rebuilt and every value sent. */
  load(devices) {
    this.cache = new Map(devices.filter(validDevice).map((d) => [d.id, structuredClone(d)]));
    const hub = hubOf(devices);
    this.name = hub?.attributes?.customName?.trim?.() || undefined;
    this.rebuild();
  }

  rebuild() {
    this.model = buildDirigeraModel(this.gladys, [...this.cache.values()]);
    this.sink.changed();
    for (const [id, device] of this.cache) {
      this.emitRoutes(id, device.attributes);
    }
    this.emitReachability();
    if (this.connected) {
      this.sink.status();
    }
  }

  /** Reloads the device list (Discovery scan, an unknown device in an event). */
  async refresh() {
    if (!this.client || !this.connected) {
      return;
    }
    const generation = this.generation;
    const devices = await this.client.devices();
    if (this.isCurrent(generation)) {
      this.load(devices);
    }
  }

  scheduleRefresh() {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = this.timers.setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh().catch((err) =>
        this.logger.warn(`DIRIGERA: reload failed: ${errorReason(err)}`),
      );
    }, TIMINGS.rebuildDebounce);
  }

  // --- Websocket ---------------------------------------------------------------

  listen(generation) {
    const socket = this.client.events();
    this.socket = socket;
    this.lastMessage = this.now();
    const current = () => this.isCurrent(generation) && this.socket === socket;
    socket.on('open', () => {
      if (current()) {
        this.lastMessage = this.now();
      }
    });
    socket.on('message', (data) => {
      if (current()) {
        this.lastMessage = this.now();
        this.onMessage(data);
      }
    });
    socket.on('pong', () => {
      if (current()) {
        this.lastMessage = this.now();
      }
    });
    socket.on('error', (err) => {
      if (current()) {
        this.logger.warn(`DIRIGERA websocket: ${errorReason(err)}`);
      }
    });
    socket.on('close', () => {
      if (current()) {
        this.lost(generation, 'websocket closed');
      }
    });
    this.pingTimer = this.timers.setInterval(() => {
      if (!current()) {
        return;
      }
      if (this.now() - this.lastMessage > TIMINGS.wsSilence) {
        this.lost(generation, 'no message from the hub');
        return;
      }
      if (socket.readyState === 1) {
        // A protocol ping (answered by any websocket server) and the event
        // the `dirigera` library sends (the hub answers a pong event).
        socket.ping?.();
        socket.send(
          JSON.stringify({
            id: randomUUID(),
            specversion: '1.1.0',
            source: 'urn:gladys-assistant:ikea',
            time: new Date(this.now()).toISOString(),
            type: 'ping',
            data: null,
          }),
        );
      }
    }, TIMINGS.wsPing);
  }

  onMessage(data) {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? '');
    if (text.length > LIMITS.messageBytes) {
      return;
    }
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }
    switch (event?.type) {
      case 'deviceStateChanged':
      case 'deviceConfigurationChanged':
        this.onStateChanged(event.data);
        break;
      case 'deviceAdded':
        if (validDevice(event.data)) {
          this.cache.set(event.data.id, structuredClone(event.data));
          this.scheduleRebuild();
        }
        break;
      case 'deviceRemoved': {
        const id = event.data?.id ?? event.removedDeviceId?.id;
        if (this.cache.delete(id)) {
          this.scheduleRebuild();
        }
        break;
      }
      case 'remotePressEvent':
        this.onPress(event.data);
        break;
      default:
        break;
    }
  }

  onStateChanged(data) {
    if (typeof data?.id !== 'string') {
      return;
    }
    const known = this.cache.get(data.id);
    if (!known) {
      // A device the list does not have yet: reload it.
      this.scheduleRefresh();
      return;
    }
    const attributes =
      data.attributes && typeof data.attributes === 'object' ? data.attributes : {};
    Object.assign(known.attributes, attributes);
    if (data.room && typeof data.room === 'object') {
      known.room = data.room;
    }
    if (typeof data.isReachable === 'boolean') {
      known.isReachable = data.isReachable;
      this.emitReachability();
    }
    this.emitRoutes(data.id, known.attributes, Object.keys(attributes));
    if ('customName' in attributes) {
      this.scheduleRebuild();
    }
  }

  onPress(data) {
    const value = CLICK_PATTERNS[data?.clickPattern];
    if (typeof data?.id !== 'string' || value === undefined) {
      return;
    }
    const target =
      this.model.buttons.get(data.id) ??
      (this.model.owners.has(data.id)
        ? { deviceId: this.model.owners.get(data.id), button: splitId(data.id).index }
        : undefined);
    if (!target) {
      return;
    }
    this.sink.press({ ...target, value, action: ACTION_NAMES[data.clickPattern] });
  }

  // --- Commands ----------------------------------------------------------------

  async setValue(featureId, value) {
    const writer = this.model.writers.get(featureId);
    if (!writer) {
      throw new Error('this feature cannot be controlled');
    }
    if (!this.client || !this.connected) {
      throw new Error('the DIRIGERA hub is not connected');
    }
    const attributes = this.cache.get(writer.sourceId)?.attributes ?? {};
    for (const change of writer.write(Number(value), attributes)) {
      await this.client.setAttributes(writer.sourceId, change);
    }
  }

  // --- Pairing -----------------------------------------------------------------

  /**
   * Asks the hub for a token, accepted once the user presses its action button.
   * @returns {Promise<string>} the access token
   */
  async pair(host, { verifyCertificate = true } = {}) {
    const client = this.createClient({ host, verifyCertificate });
    const verifier = createVerifier();
    const code = await client.authorize(challengeOf(verifier));
    const deadline = this.now() + TIMINGS.pairingWindow;
    let last;
    for (;;) {
      try {
        return await client.token({ code, verifier, name: CLIENT_NAME });
      } catch (err) {
        last = err;
        if (errorKind(err) === 'certificate') {
          throw err;
        }
      }
      if (this.now() + TIMINGS.pairingPoll > deadline) {
        break;
      }
      await new Promise((resolve) => this.timers.setTimeout(resolve, TIMINGS.pairingPoll));
    }
    const err = new Error('the action button was not pressed in time');
    err.code = 'not-pressed';
    err.cause = last;
    throw err;
  }
}

/** What a successful pairing stores. */
export const pairedConfig = (host, token) => ({
  [STORED.DIRIGERA_TOKEN]: token,
  [STORED.DIRIGERA_ADDRESS]: host,
});
