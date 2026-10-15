// -----------------------------------------------------------------------------
// Raw results of gladys.scanNetwork('mdns'), as the Gladys core aggregates
// them ({ name, host, addresses, port, txt } per instance).
// -----------------------------------------------------------------------------

export const DIRIGERA = {
  name: 'gw2-0123456789ab._ihsp._tcp.local',
  host: 'gw2-0123456789ab.local',
  addresses: ['fe80::1234:5678', '192.168.1.20'],
  port: 8000,
  txt: ['uuid=hub-0001', 'api=1'],
};

export const TRADFRI = {
  name: 'gw-b072bf257a41._coap._udp.local',
  host: 'TRADFRI-Gateway-b072bf257a41.local',
  addresses: ['192.168.1.21'],
  port: 5684,
  txt: ['version=1.21.31'],
};

/** Another CoAP device of the network (not a TRÅDFRI gateway). */
export const OTHER_COAP = {
  name: 'shellyplus1-a8032ab1._coap._udp.local',
  host: 'shellyplus1-a8032ab1.local',
  addresses: ['192.168.1.50'],
  port: 5683,
  txt: [],
};

export const ALL = [DIRIGERA, TRADFRI, OTHER_COAP];
