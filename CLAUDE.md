# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It pairs
with the user's IKEA **DIRIGERA hub** (HTTPS + websocket on 8443) and/or
**TRÅDFRI gateway** (CoAP over DTLS on UDP 5684), turns their devices into
Gladys devices, follows their states, sends the commands, and fires the
`remote_button` scene trigger. Unofficial, not affiliated with IKEA.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js                  SDK bootstrap only
src/handlers.js           every SDK handler -> the app (shared with the tests)
src/app.js                IkeaApp: both drivers, Discovery, states, badges,
                          presses, commands, the configuration buttons
src/gateway.js            what both drivers share: lifecycle, backoff, mDNS
                          rediscovery, reachability
src/dirigera/gateway.js   DIRIGERA driver: device list, websocket, PKCE pairing
src/dirigera/client.js    the only network access to the hub (HTTPS, ws)
src/dirigera/model.js     hub devices -> Gladys devices (pure)
src/dirigera/auth.js      PKCE verifier and challenge (pure)
src/dirigera/certificate.js  IKEA Home smart root CA
src/tradfri/gateway.js    TRÅDFRI driver: accessories, observe, ping, pairing
src/tradfri/client.js     the only network access to the gateway (node-coap-client)
src/tradfri/model.js      IPSO accessories -> Gladys devices (pure)
src/features.js           feature specs -> Gladys features, routes, writers (pure)
src/mdns.js               mDNS scan results -> gateways (pure)
src/color.js              RGB/HSV, kelvin/mireds (pure)
src/publisher.js          states within the Gladys rate limit
src/config.js             config_schema + stored keys, normalized
src/constants.js          manifest keys, Gladys enums, limits, timings
src/i18n.js               runtime texts (en/fr)
test/fixtures/            hub, gateway and mDNS payloads shaped like the real ones
test/helpers/fakes.js     fake hub (websocket) and gateway (observe); Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `dirigera:<hub id>` (the hub device
  id without its `_N` suffix) or `tradfri:<instance id>`, feature =
  `<device>:<key>` (`on`, `brightness`, `button_2`…). Never change how they
  are built.
- Manifest keys (`find_gateways`, `pair_dirigera`, `pair_tradfri` and its
  `security_code` field, `remote_button` and its fields) and the stored config
  keys (`STORED` in src/constants.js) are frozen: users store them.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only; mDNS only through
  `gladys.scanNetwork`).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Never log or put in a status message the DIRIGERA token, the TRÅDFRI
  identity key (PSK) or the security code.
- Value enums come from Gladys core `server/utils/constants.js` (copied in
  src/constants.js): blind position 100 = open, opening sensor 0 = open.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
