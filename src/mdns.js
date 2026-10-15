// -----------------------------------------------------------------------------
// The raw results of the mediated mDNS scan (gladys.scanNetwork('mdns')) ->
// the IKEA gateways found (pure). The scan browses every service declared in
// the manifest and returns `{ name, host, addresses, port, txt }` per instance,
// `name` being the full instance name ("gw2-…._ihsp._tcp.local").
//
// - DIRIGERA announces `_ihsp._tcp`.
// - The TRÅDFRI gateway announces `_coap._udp` as "gw-<its MAC>"; other CoAP
//   devices of the network announce the same service and are left out.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { MDNS_SERVICES } from './constants.js';

const TRADFRI_NAME = /^gw-[0-9a-f]{12}$/i;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const LINK_LOCAL_V6 = /^fe[89ab][0-9a-f]:/i;

/** The address to reach a gateway with: IPv4 first, then a routable IPv6. */
export function bestAddress(addresses) {
  const list = (Array.isArray(addresses) ? addresses : []).filter((a) => typeof a === 'string');
  return (
    list.find((a) => IPV4.test(a)) ??
    list.find((a) => a.includes(':') && a !== '::1' && !LINK_LOCAL_V6.test(a))
  );
}

/**
 * @param {object[]} results raw mDNS scan results
 * @returns {{ dirigera: object[], tradfri: object[] }} `{ name, address, txt }`
 * per gateway, by name
 */
export function classifyServices(results) {
  const found = { dirigera: new Map(), tradfri: new Map() };
  for (const result of Array.isArray(results) ? results : []) {
    if (typeof result?.name !== 'string') {
      continue;
    }
    const full = result.name.replace(/\.$/, '');
    const lower = full.toLowerCase();
    const name = full.split('.')[0];
    const address = bestAddress(result.addresses);
    if (!address || !name) {
      continue;
    }
    const entry = { name, address, txt: parseMdnsTxt(result.txt) };
    if (lower.endsWith(`.${MDNS_SERVICES.DIRIGERA}.local`)) {
      found.dirigera.set(name, entry);
    } else if (lower.endsWith(`.${MDNS_SERVICES.TRADFRI}.local`) && TRADFRI_NAME.test(name)) {
      found.tradfri.set(name, entry);
    }
  }
  const sorted = (map) => [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { dirigera: sorted(found.dirigera), tradfri: sorted(found.tradfri) };
}
