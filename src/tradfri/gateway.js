// -----------------------------------------------------------------------------
// The TRÅDFRI driver: opens the DTLS session with the stored identity, reads
// the accessories (15001, then 15001/<id>), observes each of them and the
// list itself, and sends the commands (PUT 15001/<id>).
//
// A CoAP ping every minute checks the session: after two missed pings the
// session is reopened and everything is read again.
// -----------------------------------------------------------------------------

import { LIMITS, STORED, TIMINGS } from '../constants.js';
import { Gateway } from '../gateway.js';
import { createTradfriClient, errorKind, errorReason, exchangeSecurityCode } from './client.js';
import { aliveOf, buildTradfriModel, K, specsOf } from './model.js';

const DEVICES = '15001';

const idOf = (accessory) =>
  Number.isInteger(accessory?.[K.ID]) ? String(accessory[K.ID]) : undefined;

/** What makes the Gladys device change: its name, type and features. */
const shapeOf = (accessory) =>
  JSON.stringify([accessory?.[K.NAME], accessory?.[K.TYPE], specsOf(accessory).map((s) => s.key)]);

export class TradfriGateway extends Gateway {
  constructor({ createClient = createTradfriClient, ...options }) {
    super({ kind: 'tradfri', ...options });
    this.label = 'TRÅDFRI';
    this.createClient = createClient;
    this.client = null;
    this.pingTimer = undefined;
    this.missedPings = 0;
    /** accessory id -> its last resource */
    this.cache = new Map();
    this.observed = new Set();
    this.name = undefined;
  }

  blocked(config) {
    if (config.hostError) {
      return 'bad-host';
    }
    return config.identity && config.psk ? undefined : 'not-paired';
  }

  errorKind(err) {
    return errorKind(err);
  }

  errorReason(err) {
    return errorReason(err);
  }

  async open(host, current) {
    const client = this.createClient({ host });
    const accessories = [];
    try {
      await client.connect(this.config.identity, this.config.psk);
      const ids = await client.get(DEVICES);
      for (const id of (Array.isArray(ids) ? ids : [])
        .filter(Number.isInteger)
        .slice(0, LIMITS.devices)) {
        if (!current()) {
          break;
        }
        const accessory = await client.get(`${DEVICES}/${id}`);
        if (idOf(accessory)) {
          accessories.push(accessory);
        }
      }
    } catch (err) {
      client.close();
      throw err;
    }
    if (!current()) {
      client.close();
      return;
    }
    this.client = client;
    this.cache = new Map(accessories.map((a) => [idOf(a), a]));
    this.rebuild();
    await this.observeAll(this.generation);
    this.watch(this.generation);
  }

  close() {
    this.timers.clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    this.missedPings = 0;
    if (this.client) {
      for (const path of this.observed) {
        this.client.stopObserving(path);
      }
      this.client.close();
    }
    this.observed.clear();
    this.client = null;
  }

  sourceReachable(sourceId) {
    const alive = aliveOf(this.cache.get(sourceId));
    return alive === undefined ? undefined : alive === 1;
  }

  rebuild() {
    this.model = buildTradfriModel(this.gladys, [...this.cache.values()]);
    this.sink.changed();
    for (const [id, accessory] of this.cache) {
      this.emitRoutes(id, accessory);
    }
    this.emitReachability();
    if (this.connected) {
      this.sink.status();
    }
  }

  /** Reads the accessories again (Discovery scan). */
  async refresh() {
    if (!this.client || !this.connected) {
      return;
    }
    const generation = this.generation;
    const ids = await this.client.get(DEVICES);
    if (this.isCurrent(generation)) {
      await this.onList(ids, generation);
    }
  }

  async observeAll(generation) {
    await this.observe(DEVICES, (ids) => this.onList(ids, generation), generation);
    for (const id of this.cache.keys()) {
      await this.observe(`${DEVICES}/${id}`, (a) => this.onAccessory(a), generation);
    }
  }

  async observe(path, callback, generation) {
    if (!this.client || this.observed.has(path)) {
      return;
    }
    this.observed.add(path);
    await this.client.observe(path, (payload) => {
      if (this.isCurrent(generation) && payload !== undefined) {
        Promise.resolve(callback(payload)).catch((err) =>
          this.logger.warn(`TRÅDFRI ${path}: ${errorReason(err)}`),
        );
      }
    });
  }

  /** The accessory list changed: read the new ones, forget the removed ones. */
  async onList(ids, generation) {
    if (!Array.isArray(ids) || !this.client) {
      return;
    }
    const wanted = new Set(ids.filter(Number.isInteger).slice(0, LIMITS.devices).map(String));
    let changed = false;
    for (const id of [...this.cache.keys()]) {
      if (!wanted.has(id)) {
        this.cache.delete(id);
        this.client.stopObserving(`${DEVICES}/${id}`);
        this.observed.delete(`${DEVICES}/${id}`);
        changed = true;
      }
    }
    for (const id of wanted) {
      if (this.cache.has(id) || !this.isCurrent(generation)) {
        continue;
      }
      const accessory = await this.client.get(`${DEVICES}/${id}`);
      if (idOf(accessory) === id && this.isCurrent(generation)) {
        this.cache.set(id, accessory);
        await this.observe(`${DEVICES}/${id}`, (a) => this.onAccessory(a), generation);
        changed = true;
      }
    }
    if (changed) {
      this.scheduleRebuild();
    }
  }

  onAccessory(accessory) {
    const id = idOf(accessory);
    if (!id) {
      return;
    }
    const previous = this.cache.get(id);
    this.cache.set(id, accessory);
    if (!previous || shapeOf(previous) !== shapeOf(accessory)) {
      this.scheduleRebuild();
      return;
    }
    this.emitRoutes(id, accessory);
    this.emitReachability();
  }

  watch(generation) {
    this.pingTimer = this.timers.setInterval(async () => {
      if (!this.isCurrent(generation) || !this.client) {
        return;
      }
      const alive = await this.client.ping().catch(() => false);
      if (!this.isCurrent(generation)) {
        return;
      }
      this.missedPings = alive ? 0 : this.missedPings + 1;
      if (this.missedPings >= TIMINGS.tradfriPingFailures) {
        this.lost(generation, 'no answer to the CoAP ping');
      }
    }, TIMINGS.tradfriPing);
  }

  // --- Commands ----------------------------------------------------------------

  async setValue(featureId, value) {
    const writer = this.model.writers.get(featureId);
    if (!writer) {
      throw new Error('this feature cannot be controlled');
    }
    if (!this.client || !this.connected) {
      throw new Error('the TRÅDFRI gateway is not connected');
    }
    const payload = writer.write(Number(value), this.cache.get(writer.sourceId));
    await this.client.put(`${DEVICES}/${writer.sourceId}`, payload);
  }

  // --- Pairing -----------------------------------------------------------------

  /** Exchanges the security code printed under the gateway for an identity and its key. */
  pair(host, securityCode) {
    return exchangeSecurityCode(this.createClient({ host }), securityCode);
  }
}

/** What a successful pairing stores. */
export const pairedConfig = (host, { identity, psk }) => ({
  [STORED.TRADFRI_IDENTITY]: identity,
  [STORED.TRADFRI_PSK]: psk,
  [STORED.TRADFRI_ADDRESS]: host,
});
