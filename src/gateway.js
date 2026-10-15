// -----------------------------------------------------------------------------
// What the DIRIGERA and TRÅDFRI drivers share: the connection lifecycle
// (generations, backoff, mDNS rediscovery of a gateway whose address changed),
// the state shown in the status, and the reachability of the devices.
//
// A driver implements `blocked(config)` (why it cannot start: not paired…),
// `open(host, isCurrent)` (connect, load the devices, listen), `close()`, and
// `sourceReachable(sourceId)`. It talks to the app through `sink`:
//   state(featureId, value), reachable(deviceId, boolean), press(event),
//   changed(), status(), discover() -> { dirigera, tradfri }, remember(kind, address)
// -----------------------------------------------------------------------------

import { TIMINGS } from './constants.js';
import { emptyModel } from './features.js';

export const backoff = (failures) =>
  Math.min(TIMINGS.reconnectMax, TIMINGS.reconnectMin * 2 ** Math.max(0, failures - 1));

export class Gateway {
  constructor({ kind, gladys, sink, logger, timers = globalThis, now = Date.now }) {
    this.kind = kind;
    this.gladys = gladys;
    this.sink = sink;
    this.logger = logger;
    this.timers = timers;
    this.now = now;
    this.config = undefined;
    this.model = emptyModel();
    this.state = { phase: 'off' };
    this.generation = 0;
    this.failures = 0;
    this.retryTimer = undefined;
    this.rebuildTimer = undefined;
    /** Gladys device id -> reachability last sent */
    this.reachability = new Map();
  }

  get connected() {
    return this.state.phase === 'connected';
  }

  get devices() {
    return this.model.devices;
  }

  owns(featureId) {
    return this.model.writers.has(featureId);
  }

  setState(state) {
    this.state = state;
    this.sink.status();
  }

  start(config) {
    this.stop();
    this.config = config;
    this.failures = 0;
    const blocked = this.blocked(config);
    if (blocked) {
      this.setState({ phase: blocked });
      return;
    }
    const generation = this.generation;
    this.run(generation);
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.retryTimer);
    this.timers.clearTimeout(this.rebuildTimer);
    this.retryTimer = undefined;
    this.rebuildTimer = undefined;
    this.close();
  }

  isCurrent(generation) {
    return generation === this.generation;
  }

  async run(generation) {
    const current = () => this.isCurrent(generation);
    try {
      const host = await this.resolveHost();
      if (!current()) {
        return;
      }
      if (!host) {
        this.setState({ phase: 'not-found' });
        this.failures += 1;
        this.retry(generation);
        return;
      }
      this.setState({ phase: 'connecting', host });
      await this.open(host, current);
      if (!current()) {
        return;
      }
      this.failures = 0;
      this.setState({ phase: 'connected', host, name: this.name });
    } catch (err) {
      if (current()) {
        this.fail(err, generation);
      }
    }
  }

  /** The address to connect to: typed, last known, or found again with mDNS. */
  async resolveHost() {
    const { host, typed } = this.config;
    if (typed || (host && this.failures < TIMINGS.rediscoverAfter)) {
      return host;
    }
    this.setState({ phase: 'searching', host });
    let found = [];
    try {
      found = (await this.sink.discover())[this.kind] ?? [];
    } catch (err) {
      this.logger.warn(`${this.label}: mDNS scan failed: ${err.message}`);
    }
    if (found.some((g) => g.address === host)) {
      return host;
    }
    const address = found[0]?.address;
    if (!address) {
      return host;
    }
    if (address !== host) {
      this.logger.info(`${this.label}: found at ${address}`);
      this.config = { ...this.config, host: address };
      await this.sink.remember(this.kind, address);
    }
    return address;
  }

  /** A connection attempt failed. */
  fail(err, generation) {
    const kind = this.errorKind(err);
    const reason = this.errorReason(err);
    this.logger.warn(`${this.label} ${this.config.host ?? ''}: ${reason}`);
    this.close();
    this.markUnreachable();
    this.failures += 1;
    this.setState({
      phase: kind === 'error' ? 'unreachable' : kind,
      host: this.config.host,
      reason,
    });
    // A refused key or token needs a new pairing: retrying would not help.
    if (kind !== 'auth') {
      this.retry(generation);
    }
  }

  /** The connection was lost after it was established. */
  lost(generation, reason) {
    if (!this.isCurrent(generation)) {
      return;
    }
    this.logger.warn(`${this.label}: connection lost (${reason})`);
    this.close();
    this.markUnreachable();
    this.failures += 1;
    this.setState({ phase: 'unreachable', host: this.config.host, reason });
    this.retry(generation);
  }

  retry(generation) {
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      if (this.isCurrent(generation)) {
        this.run(generation);
      }
    }, backoff(this.failures));
  }

  /** Rebuilds the model after a burst of additions, removals or renamings. */
  scheduleRebuild() {
    this.timers.clearTimeout(this.rebuildTimer);
    const generation = this.generation;
    this.rebuildTimer = this.timers.setTimeout(() => {
      this.rebuildTimer = undefined;
      if (this.isCurrent(generation)) {
        this.rebuild();
      }
    }, TIMINGS.rebuildDebounce);
  }

  /** Sends the reachability of every device that changed. */
  emitReachability() {
    const members = new Map();
    for (const [sourceId, deviceId] of this.model.owners) {
      members.set(deviceId, [...(members.get(deviceId) ?? []), sourceId]);
    }
    for (const [deviceId, sources] of members) {
      const reachable = sources.some((s) => this.sourceReachable(s) !== false);
      if (this.reachability.get(deviceId) !== reachable) {
        this.reachability.set(deviceId, reachable);
        this.sink.reachable(deviceId, reachable);
      }
    }
  }

  markUnreachable() {
    for (const deviceId of new Set(this.model.owners.values())) {
      if (this.reachability.get(deviceId) !== false) {
        this.reachability.set(deviceId, false);
        this.sink.reachable(deviceId, false);
      }
    }
  }

  /** Sends the values a gateway device feeds. */
  emitRoutes(sourceId, source, changedKeys) {
    for (const route of this.model.routes.get(sourceId) ?? []) {
      if (changedKeys && route.keys && !route.keys.some((k) => changedKeys.includes(k))) {
        continue;
      }
      const value = route.read(source);
      if (value !== undefined) {
        this.sink.state(route.featureId, value);
      }
    }
  }
}
