// -----------------------------------------------------------------------------
// TRÅDFRI gateway resources (15001/<id>), shaped like the gateway's IPSO JSON
// (keys as documented by node-tradfri-client). Ids are made up.
// -----------------------------------------------------------------------------

const info = (model, extra = {}) => ({
  0: 'IKEA of Sweden',
  1: model,
  2: '',
  3: '2.3.087',
  6: 1,
  ...extra,
});

const accessory = (id, type, name, model, body = {}, extra = {}) => ({
  9001: name,
  9002: 1_600_000_000,
  9003: id,
  9019: 1,
  9020: 1_760_000_000,
  9054: 0,
  5750: type,
  3: info(model, extra),
  ...body,
});

export const WS_BULB = accessory(65537, 2, 'Plafonnier', 'TRADFRI bulb E27 WS opal 980lm', {
  3311: [{ 5850: 1, 5851: 254, 5711: 370, 5706: 'f1e0b5', 5709: 30138, 5710: 26909, 9003: 0 }],
});

export const CWS_BULB = accessory(65538, 2, 'Lampe couleur', 'TRADFRI bulb E27 CWS opal 600lm', {
  3311: [
    { 5850: 0, 5851: 127, 5706: '4a418a', 5707: 10000, 5708: 65279, 5709: 0, 5710: 0, 9003: 0 },
  ],
});

export const PLUG = accessory(65539, 3, 'Prise bureau', 'TRADFRI control outlet', {
  3312: [{ 5850: 1, 5851: 254, 9003: 0 }],
});

export const BLIND = accessory(
  65540,
  7,
  'Store salon',
  'FYRTUR block-out roller blind',
  {
    15015: [{ 5536: 25, 9003: 0 }],
  },
  { 9: 77, 6: 3 },
);

export const PURIFIER = accessory(65541, 10, 'STARKVIND', 'STARKVIND Air purifier', {
  15025: [
    {
      5900: 1,
      5902: 1000,
      5903: 0,
      5904: 259200,
      5905: 0,
      5906: 0,
      5907: 5,
      5908: 10,
      5909: 2000,
      5910: 194400,
      9003: 0,
    },
  ],
});

export const REMOTE = accessory(
  65542,
  0,
  'Télécommande',
  'TRADFRI remote control',
  {
    15009: [{ 9003: 0 }],
  },
  { 9: 40, 6: 3 },
);

export const MOTION = accessory(
  65543,
  4,
  'Détecteur',
  'TRADFRI motion sensor',
  {
    3300: [{ 9003: 0 }],
  },
  { 9: 90, 6: 3 },
);

export const REPEATER = accessory(65544, 6, 'Répéteur', 'TRADFRI signal repeater');

export const ALL = [WS_BULB, CWS_BULB, PLUG, BLIND, PURIFIER, REMOTE, MOTION, REPEATER];

/** The resources of a gateway holding these accessories: path -> JSON. */
export function resourcesOf(accessories = ALL) {
  const resources = new Map([['15001', accessories.map((a) => a[9003])]]);
  for (const a of accessories) {
    resources.set(`15001/${a[9003]}`, structuredClone(a));
  }
  return resources;
}
