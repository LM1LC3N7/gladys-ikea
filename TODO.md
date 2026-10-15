# TODO — IKEA DIRIGERA & TRÅDFRI v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm audit`, then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md`
  and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).

## Status

- [x] **Milestone 1 — both gateways** (2026-10-15): DIRIGERA (PKCE pairing
      with the hub button, device list, websocket events, commands, IKEA root
      CA verification, ping and silence watchdog), TRÅDFRI (security code
      exchange, CoAP/DTLS observe, commands, ping watchdog), mDNS discovery and
      rediscovery, lights, plugs, blinds, STARKVIND, environment / opening /
      leak / motion / light sensors, remotes (buttons + `remote_button`
      trigger), reachability badges, states within the rate limit, three
      buttons, manifest, docs en/fr. Tested against fixtures and fakes only.
- [ ] **Milestone 2 — real hardware**: run against a real DIRIGERA hub and a
      real TRÅDFRI gateway (testers on the forum), record their answers as
      fixtures, fix what differs. To check first:
  - the `remotePressEvent` ids of multi-button remotes (`<id>_1`, `_2`…?) and
    which remotes send them (STYRBAR, RODRET, BILRESA);
  - the shape of `deviceRemoved` and `deviceConfigurationChanged`;
  - the hub answers the websocket `ping` event (or the silence watchdog
    reopens the socket every 95 s);
  - the token endpoint refusal before the button press (status code);
  - writing `motorState` on a STARKVIND (does it switch `fanMode` to `on`?),
    `blindsState: 'stopped'` to stop a blind;
  - the instance names announced in mDNS by DIRIGERA (`gw2-…`?);
  - TRÅDFRI firmware 1.21: DTLS handshake with node-coap-client 3 on Node 24.
- [ ] **Milestone 3 — more**: SYMFONISK speakers (DIRIGERA `speaker`),
      DIRIGERA scenes as push buttons, light transitions, the outlets' status
      light, TRÅDFRI groups, an option to switch the certificate pinning to the
      hub's own certificate.
- [ ] **Milestone 4 — first release**: Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, forum thread in Développement.

## Decisions

- One DIRIGERA hub and one TRÅDFRI gateway at most, both possible at once.
- DIRIGERA hub devices sharing an id with a `_N` suffix are one Gladys device
  (SOMRIG buttons, VALLHORN motion + light sensors); a feature present on
  several (the battery) is read from the first one.
- Button features exist for the controllers that can send presses
  (`shortcutController`, `genericSwitch`, or a `canSend` listing
  `singlePress`/`doublePress`/`longPress`); a press from any other known
  controller still fires the scene trigger. No dummy scenes are created on the
  hub (the trick of `dirigera_platform`): `remotePressEvent` is used instead.
- TRÅDFRI remotes and motion sensors: battery only (the gateway never
  forwards presses nor detections).
- The hub certificate is verified against the IKEA root CA by default, the
  host name never (the hub is reached by IP). The option to turn it off is
  for a hub whose certificate changed.
- The TRÅDFRI security code is an action field, never stored; the identity and
  its key are stored with `setConfig` outside the config_schema (never shown in
  the UI, kept when the user saves the form).
- A typed address is never replaced; a discovered one is stored and searched
  again (mDNS) after three failed connections.
- A refused DIRIGERA token or TRÅDFRI key stops the retries: the status asks
  for a new pairing.
- Light colour temperature in mireds, colour as an RGB integer, brightness in
  %: brightness 0 turns the light off; a brightness on an off DIRIGERA light
  sends `isOn` then `lightLevel` (two PATCH, the hub refuses some combinations).
- Measurements (power, voltage, current, energy, temperature, PM2.5…) are
  spaced by 10 s per feature; switches, detections and buttons are not
  delayed; a repeated button press is sent again.
