// -----------------------------------------------------------------------------
// The integration: the DIRIGERA and TRÅDFRI drivers, the Gladys devices they
// build, the states, badges and remote presses they report, the commands sent
// back, and the configuration screen buttons. index.js only wires the SDK
// handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { LIMITS, SCENE_TRIGGERS, STORED, TIMINGS } from './constants.js';
import {
  errorKind as dirigeraErrorKind,
  errorReason as dirigeraReason,
} from './dirigera/client.js';
import { DirigeraGateway, pairedConfig as dirigeraPaired } from './dirigera/gateway.js';
import { gatewayStatus, T } from './i18n.js';
import { classifyServices } from './mdns.js';
import { StatePublisher } from './publisher.js';
import {
  cleanSecurityCode,
  errorKind as tradfriErrorKind,
  errorReason as tradfriReason,
} from './tradfri/client.js';
import { TradfriGateway, pairedConfig as tradfriPaired } from './tradfri/gateway.js';

const ADDRESS_KEYS = { dirigera: STORED.DIRIGERA_ADDRESS, tradfri: STORED.TRADFRI_ADDRESS };

export class IkeaApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'ikea' }),
    dirigeraClient,
    tradfriClient,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.raw = {};
    this.config = normalizeConfig();
    this.started = false;
    const options = { gladys, logger, now, timers, sink: this.sink() };
    this.dirigera = new DirigeraGateway({
      ...options,
      ...(dirigeraClient && { createClient: dirigeraClient }),
    });
    this.tradfri = new TradfriGateway({
      ...options,
      ...(tradfriClient && { createClient: tradfriClient }),
    });
    this.gateways = { dirigera: this.dirigera, tradfri: this.tradfri };
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    /** featureId -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    /** deviceId -> reachable, as the gateways say */
    this.reachable = new Map();
    /** deviceId -> transport badge last published */
    this.transports = new Map();
    /** send times of the scene events of the last minute */
    this.eventWindow = [];
    this.publishing = Promise.resolve();
    this.lastStatus = undefined;
    this.scanning = undefined;
    this.warned = new Set();
  }

  /** What the drivers call (see src/gateway.js). */
  sink() {
    return {
      state: (featureId, value) => this.record(featureId, value),
      reachable: (deviceId, reachable) => this.onReachable(deviceId, reachable),
      press: (event) => this.onPress(event),
      changed: () => this.publishDevices(),
      status: () => this.updateStatus(),
      discover: () => this.discover(),
      remember: (kind, address) => this.remember(kind, address),
    };
  }

  // --- Lifecycle -------------------------------------------------------------

  /** (Re)starts the gateways whose configuration changed. */
  async start(raw = {}) {
    this.raw = { ...(raw ?? {}) };
    const next = normalizeConfig(this.raw);
    this.refreshCreated();
    this.publisher.start();
    for (const [kind, gateway] of Object.entries(this.gateways)) {
      if (!this.started || JSON.stringify(next[kind]) !== JSON.stringify(gateway.config)) {
        gateway.start(next[kind]);
      }
    }
    this.config = next;
    this.started = true;
    // After a reconnection to Gladys: the discovered devices and badges again.
    this.transports.clear();
    if (this.dirigera.devices.length + this.tradfri.devices.length > 0) {
      await this.publishDevices();
    }
    await this.publishAllTransports();
    this.updateStatus();
  }

  stop() {
    this.publisher.stop();
    this.dirigera.stop();
    this.tradfri.stop();
  }

  updateStatus() {
    const parts = [];
    let connected = false;
    for (const [kind, gateway] of Object.entries(this.gateways)) {
      connected ||= gateway.connected;
      const text = gatewayStatus(kind, gateway.state, gateway.devices.length);
      if (text) {
        parts.push(text);
      }
    }
    const message =
      parts.length === 0
        ? T.notPaired
        : { en: parts.map((p) => p.en).join(' '), fr: parts.map((p) => p.fr).join(' ') };
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** One mDNS scan at a time, shared by the drivers and the buttons. */
  discover() {
    if (!this.scanning) {
      this.scanning = this.gladys
        .scanNetwork('mdns', { timeoutSeconds: TIMINGS.mdnsSeconds })
        .then(classifyServices)
        .finally(() => {
          this.scanning = undefined;
        });
    }
    return this.scanning;
  }

  /** A gateway found at a new address: kept for the next start. */
  async remember(kind, address) {
    const key = ADDRESS_KEYS[kind];
    this.raw = { ...this.raw, [key]: address };
    this.config = normalizeConfig(this.raw);
    await this.gladys
      .setConfig({ [key]: address })
      .catch((err) => this.logger.warn(`Saving the address failed: ${err.message}`));
  }

  // --- Devices ---------------------------------------------------------------

  /** Publishes the devices of both gateways (calls are chained, the last list wins). */
  publishDevices() {
    this.publishing = this.publishing.then(async () => {
      const devices = [...this.dirigera.devices, ...this.tradfri.devices];
      const union = (key) => new Set([...this.dirigera.model[key], ...this.tradfri.model[key]]);
      this.publisher.configure({ throttled: union('throttled'), events: union('events') });
      await this.gladys
        .publishDiscoveredDevices(devices.slice(0, 2000))
        .catch((err) =>
          this.logger.warn(`Publishing the discovered devices failed: ${err.message}`),
        );
    });
    return this.publishing;
  }

  /** Discovery "scan": the device lists are read again. */
  async scan() {
    const results = await Promise.allSettled([this.dirigera.refresh(), this.tradfri.refresh()]);
    for (const r of results.filter((r) => r.status === 'rejected')) {
      this.logger.warn(`Reading the devices failed: ${r.reason?.message ?? r.reason}`);
    }
    await this.publishDevices();
  }

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- What the gateways report ------------------------------------------------

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    const entry = { state: value };
    this.lastValues.set(featureId, entry);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, entry);
    }
  }

  onReachable(deviceId, reachable) {
    this.reachable.set(deviceId, reachable);
    this.publishTransport(deviceId).catch((err) =>
      this.logger.warn(`Transport badge failed: ${err.message}`),
    );
  }

  transportOf(deviceId) {
    return this.reachable.get(deviceId) === false
      ? DEVICE_TRANSPORTS.UNREACHABLE
      : DEVICE_TRANSPORTS.LOCAL;
  }

  async publishTransport(deviceId) {
    if (!this.reachable.has(deviceId) || !this.createdDevices().has(deviceId)) {
      return;
    }
    const transport = this.transportOf(deviceId);
    if (this.transports.get(deviceId) === transport) {
      return;
    }
    this.transports.set(deviceId, transport);
    await this.gladys.publishTransports([{ external_id: deviceId, transport }]);
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdDevices()) {
      if (!this.reachable.has(deviceId)) {
        continue;
      }
      const transport = this.transportOf(deviceId);
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  /** A remote button: its button feature, and the scene trigger. */
  onPress({ deviceId, featureId, button, value, action }) {
    if (featureId && this.created.has(featureId)) {
      this.publisher.push(featureId, { state: value });
    }
    const now = this.now();
    this.eventWindow = this.eventWindow.filter((t) => now - t < 60_000);
    if (this.eventWindow.length >= LIMITS.eventsPerMinute) {
      this.warnOnce(
        'events',
        'More than 250 remote presses in a minute: the next ones are dropped',
      );
      return;
    }
    this.eventWindow.push(now);
    this.gladys
      .publishSceneEvent(SCENE_TRIGGERS.REMOTE_BUTTON, {
        device: deviceId,
        button: String(button),
        action,
      })
      .catch((err) => this.logger.warn(`Scene event failed: ${err.message}`));
  }

  // --- Commands --------------------------------------------------------------

  async setValue(device, feature, value) {
    const gateway = Object.values(this.gateways).find((g) => g.owns(feature.external_id));
    if (!gateway) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    await gateway.setValue(feature.external_id, value);
  }

  // --- Configuration screen buttons ------------------------------------------

  async findGateways() {
    let found;
    try {
      found = await this.discover();
    } catch (err) {
      return T.find.failed(err.message);
    }
    const lines = [
      ...found.dirigera.map((g) => `DIRIGERA ${g.name} (${g.address})`),
      ...found.tradfri.map((g) => `TRÅDFRI ${g.name} (${g.address})`),
    ];
    return lines.length > 0 ? T.find.found(lines) : T.find.none;
  }

  /** The address to pair with: typed, else found with mDNS, else the last known one. */
  async pairingHost(kind) {
    const config = this.config[kind];
    if (config.typed) {
      return config.host;
    }
    let found = [];
    try {
      found = (await this.discover())[kind];
    } catch (err) {
      this.logger.warn(`mDNS scan failed: ${err.message}`);
    }
    return (
      found.find((g) => g.address === config.host)?.address ?? found[0]?.address ?? config.host
    );
  }

  async pairDirigera() {
    const config = this.config.dirigera;
    if (config.hostError) {
      return T.badHost;
    }
    const host = await this.pairingHost('dirigera');
    if (!host) {
      return T.dirigera.noHub;
    }
    let token;
    try {
      token = await this.dirigera.pair(host, { verifyCertificate: config.verifyCertificate });
    } catch (err) {
      if (err.code === 'not-pressed') {
        return T.dirigera.notPressed;
      }
      this.logger.warn(`DIRIGERA pairing with ${host}: ${dirigeraReason(err)}`);
      return dirigeraErrorKind(err) === 'certificate'
        ? T.dirigera.certificate(host)
        : T.dirigera.unreachable(host, dirigeraReason(err));
    }
    await this.store(dirigeraPaired(host, token));
    this.dirigera.start(this.config.dirigera);
    this.logger.info(`DIRIGERA hub ${host} paired`);
    return T.dirigera.paired(host);
  }

  async pairTradfri(fields) {
    const code = cleanSecurityCode(fields?.security_code);
    if (code === '') {
      return T.tradfri.noCode;
    }
    if (this.config.tradfri.hostError) {
      return T.badHost;
    }
    const host = await this.pairingHost('tradfri');
    if (!host) {
      return T.tradfri.noGateway;
    }
    // node-coap-client keeps one DTLS session per host: the driver steps aside.
    this.tradfri.stop();
    let credentials;
    try {
      credentials = await this.tradfri.pair(host, code);
    } catch (err) {
      this.tradfri.start(this.config.tradfri);
      this.logger.warn(`TRÅDFRI pairing with ${host}: ${tradfriReason(err)}`);
      return tradfriErrorKind(err) === 'auth'
        ? T.tradfri.badCode
        : T.tradfri.unreachable(host, tradfriReason(err));
    }
    await this.store(tradfriPaired(host, credentials));
    this.tradfri.start(this.config.tradfri);
    this.logger.info(`TRÅDFRI gateway ${host} paired`);
    return T.tradfri.paired(host);
  }

  /** Saves keys outside the config_schema (never shown in the UI). */
  async store(values) {
    await this.gladys.setConfig(values);
    this.raw = { ...this.raw, ...values };
    this.config = normalizeConfig(this.raw);
  }
}
