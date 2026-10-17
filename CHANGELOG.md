# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- LICENSE file (Apache-2.0, as declared in package.json), also copied into the
  image.

### Changed

- README: the store install note replaces the work-in-progress notice, and the
  Releasing section no longer says the store topic is still to be added.

## [0.1.1] - 2026-10-15

### Added

- DIRIGERA hub: pairing with the action button under the hub, the devices of
  the hub in Discovery, real-time states through its websocket, commands. The
  hub certificate is checked against the IKEA root certificate (can be turned
  off).
- TRÅDFRI gateway: pairing with the security code printed under it (the code
  is not kept), real-time states (CoAP observe), commands.
- Both gateways found on the network by themselves (mDNS through Gladys), and
  found again when their address changes; an IP address can be typed instead.
- Lights (on/off, brightness, colour temperature, colour), plugs (and the
  INSPELNING meters), blinds (open, close, stop, position), STARKVIND air
  purifiers (mode, speed, PM2.5, filter, child lock), environment, opening,
  water leak, motion and light sensors, batteries.
- Remote buttons of the DIRIGERA hub as button features, and the "IKEA remote
  button" scene trigger.
- The reachability of the devices on their transport badge.
- "Find the IKEA gateways on the network", "Pair the DIRIGERA hub" and "Pair
  the TRÅDFRI gateway" buttons.
- States within the Gladys rate limit, measurements spaced by 10 seconds.

[Unreleased]: https://github.com/LM1LC3N7/gladys-ikea/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-ikea/releases/tag/v0.1.1
