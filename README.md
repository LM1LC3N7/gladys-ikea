# gladys-ikea

[Gladys Assistant](https://gladysassistant.com) external integration for the
**IKEA DIRIGERA hub** and the **TRÅDFRI gateway**, on the local network: lights,
plugs, blinds, STARKVIND air purifiers, VINDSTYRKA / PARASOLL / BADRING /
VALLHORN sensors and remotes become Gladys devices of the Discovery tab, with
real-time states, commands and a remote button scene trigger. Unofficial, not
affiliated with IKEA.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> Work in progress (0.1, not published to the store yet): announced on the
> [Gladys forum](https://community.gladysassistant.com/t/integrations-home-assistant-les-plus-populaires-candidates-pour-des-integrations-externes-gladys/10385/159).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (IkeaApp)
                                   ├─ src/dirigera/gateway.js ⇄ src/dirigera/client.js ⇄ HTTPS + wss :8443
                                   │    └─ src/dirigera/model.js   hub devices -> Gladys devices (pure)
                                   ├─ src/tradfri/gateway.js  ⇄ src/tradfri/client.js  ⇄ CoAP/DTLS :5684
                                   │    └─ src/tradfri/model.js    IPSO accessories -> Gladys devices (pure)
                                   ├─ src/mdns.js       gladys.scanNetwork('mdns') -> the gateways (pure)
                                   └─ src/publisher.js  states within 300/min, measurements spaced
```

- **DIRIGERA**: pairing by OAuth code flow with PKCE, approved with the action
  button under the hub; then `GET /v1/devices`, the websocket events
  (`deviceStateChanged`, `deviceAdded`, `deviceRemoved`, `remotePressEvent`)
  and `PATCH /v1/devices/<id>`. The hub certificate is verified against the
  IKEA Home smart root CA (its host name is not: the hub is reached by IP).
- **TRÅDFRI**: the security code opens a DTLS session as `Client_identity` to
  obtain an identity and its pre-shared key (the code is never stored), then
  `15001` is read and observed, commands are `PUT 15001/<id>`.
- **Discovery**: mDNS `_ihsp._tcp` (DIRIGERA) and `_coap._udp` (TRÅDFRI,
  instances named `gw-<MAC>`) through the core (`network_discovery`): the
  container is on a bridge network. A gateway whose address changed is found
  again after three failed connections.
- **Devices**: external ids are `dirigera:<hub device id>` (the `_1`, `_2`…
  hub devices of one physical device are one Gladys device) and
  `tradfri:<instance id>`. States are only sent for the devices the user
  created; a device created later receives the last values read.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/` holds hub and gateway payloads shaped like the real ones;
`test/helpers/fakes.js` plays the hub (websocket included) and the gateway
(CoAP observe included) for the end-to-end tests, run against the SDK's fake
Gladys.

## Credits

The local protocols are documented by the work of others, which this
integration follows without copying their code:

- [`dirigera`](https://github.com/lpgera/dirigera) by lpgera (MIT): the
  DIRIGERA API, its device attributes and events, and the IKEA root
  certificate shipped in `src/dirigera/certificate.js`;
- [`dirigera_platform`](https://github.com/sanjoyg/dirigera_platform) by
  sanjoyg (MIT), the Home Assistant integration for DIRIGERA;
- [`node-tradfri-client`](https://github.com/AlCalzone/node-tradfri-client) by
  AlCalzone (MIT) and the Home Assistant
  [`tradfri`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/tradfri)
  integration (Apache-2.0): the TRÅDFRI resources and value ranges;
- [`node-coap-client`](https://github.com/AlCalzone/node-coap-client) by
  AlCalzone (MIT), the CoAP/DTLS client used at runtime.

IKEA, DIRIGERA, TRÅDFRI and the product names are trademarks of Inter IKEA
Systems B.V., used here only to name the compatible products.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0.
