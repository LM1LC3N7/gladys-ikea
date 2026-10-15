// -----------------------------------------------------------------------------
// Fake gateways for the end-to-end tests: they replace the clients of
// src/dirigera/client.js and src/tradfri/client.js, record what the
// integration sends, and let the test play the hub (events, notifications).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { DirigeraError } from '../../src/dirigera/client.js';
import { TradfriError } from '../../src/tradfri/client.js';
import { ALL as HUB_DEVICES } from '../fixtures/dirigera.js';
import { ALL as ACCESSORIES, resourcesOf } from '../fixtures/tradfri.js';

/** Lets the pending promises and immediate callbacks run. */
export async function settle() {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** The DIRIGERA event websocket (a `ws` WebSocket for the integration). */
export class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    this.pings = 0;
    /** Whether the hub answers the protocol pings. */
    this.answersPings = false;
    this.terminated = false;
  }

  ping() {
    this.pings += 1;
    if (this.answersPings) {
      this.emit('pong');
    }
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  deliver(event) {
    this.emit('message', Buffer.from(JSON.stringify(event)));
  }

  send(text) {
    this.sent.push(JSON.parse(text));
  }

  terminate() {
    this.terminated = true;
    this.readyState = 3;
  }

  /** The hub closes the connection. */
  drop() {
    this.readyState = 3;
    this.emit('close', 1006);
  }
}

export function fakeDirigera({ devices = HUB_DEVICES } = {}) {
  const hub = {
    devices: structuredClone(devices),
    clients: [],
    sockets: [],
    patches: [],
    challenges: [],
    tokenRequests: [],
    /** token() is refused this many times (the button is not pressed yet). */
    refuseToken: 0,
    devicesError: null,
    authorizeError: null,
    /** Addresses where no hub answers. */
    unreachable: new Set(),
    /** GET /v1/devices count. */
    listed: 0,
  };
  hub.createClient = (options) => {
    hub.clients.push(options);
    const refuseConnection = () => {
      if (hub.unreachable.has(options.host)) {
        throw new DirigeraError('GET /devices: ECONNREFUSED', { code: 'ECONNREFUSED' });
      }
    };
    return {
      host: options.host,
      async authorize(challenge) {
        if (hub.authorizeError) {
          throw hub.authorizeError;
        }
        hub.challenges.push(challenge);
        return 'auth-code';
      },
      async token(request) {
        hub.tokenRequests.push(request);
        if (hub.tokenRequests.length <= hub.refuseToken) {
          throw new DirigeraError('POST /oauth/token: HTTP 403', { status: 403 });
        }
        return 'new-token';
      },
      async devices() {
        refuseConnection();
        if (hub.devicesError) {
          throw hub.devicesError;
        }
        hub.listed += 1;
        return structuredClone(hub.devices);
      },
      async setAttributes(id, attributes) {
        hub.patches.push({ id, attributes });
      },
      events() {
        const socket = new FakeSocket();
        hub.sockets.push(socket);
        return socket;
      },
    };
  };
  hub.socket = () => hub.sockets.at(-1);
  return hub;
}

export function fakeTradfri({ accessories = ACCESSORIES } = {}) {
  const gateway = {
    resources: resourcesOf(accessories),
    clients: [],
    connects: [],
    puts: [],
    posts: [],
    observers: new Map(),
    alive: true,
    connectError: null,
    psk: 'gateway-psk',
  };
  gateway.createClient = ({ host }) => {
    const client = {
      host,
      closed: false,
      async connect(identity, psk) {
        gateway.connects.push({ host, identity, psk });
        if (gateway.connectError) {
          throw gateway.connectError;
        }
      },
      async get(path) {
        return structuredClone(gateway.resources.get(path));
      },
      async put(path, json) {
        gateway.puts.push({ path, json });
      },
      async post(path, json) {
        gateway.posts.push({ path, json });
        return path === '15011/9063' ? { 9091: gateway.psk, 9029: '1.21.31' } : undefined;
      },
      async observe(path, callback) {
        gateway.observers.set(path, callback);
      },
      stopObserving(path) {
        gateway.observers.delete(path);
      },
      async ping() {
        return gateway.alive;
      },
      close() {
        client.closed = true;
      },
    };
    gateway.clients.push(client);
    return client;
  };
  /** The gateway notifies an observed resource. */
  gateway.notify = (path, json) => gateway.observers.get(path)?.(structuredClone(json));
  gateway.refuse = () => {
    gateway.connectError = new TradfriError('the gateway refused the key', { code: 'auth' });
  };
  return gateway;
}
