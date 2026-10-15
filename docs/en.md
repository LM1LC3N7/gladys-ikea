# IKEA DIRIGERA & TRÅDFRI

Control your **IKEA smart home devices** from Gladys, through your **DIRIGERA
hub** or your **TRÅDFRI gateway**, on your local network: no cloud, no IKEA
account. The lights, plugs, blinds, air purifiers and sensors paired with the
gateway appear in the **Discovery** tab of Gladys, ready to be added.
Unofficial integration, not affiliated with IKEA.

> **Development version (0.1).** Built from the documented local APIs of both
> gateways and tested against simulated gateways, not yet against real
> hardware. Your feedback is welcome on the GitHub repository.

## What you get

| IKEA device                                         | In Gladys                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Bulbs, lamps, LED strips                            | a light: on/off, brightness, color temperature (white spectrum), color (CWS) |
| TRETAKT, INSPELNING, TRÅDFRI plugs                  | a switch; power, voltage, current and energy for the INSPELNING              |
| FYRTUR, KADRILJ, PRAKTLYSING, TREDANSEN blinds      | a shutter: open, close, stop, position; the battery                          |
| STARKVIND air purifier                              | mode (off, low, medium, high, auto), speed, PM2.5, filter life, child lock   |
| VINDSTYRKA, ALPSTUGA, TIMMERFLOTTE                  | temperature, humidity, PM2.5, VOC index, CO₂ (depending on the model)        |
| PARASOLL, BADRING, VALLHORN, TRÅDFRI motion sensor  | opening, water leak, motion, light level; the battery                        |
| SOMRIG, TRÅDFRI shortcut button, BILRESA (DIRIGERA) | one button per key and the **IKEA remote button** scene trigger              |
| Other remotes                                       | the battery                                                                  |

The devices are updated in real time: the DIRIGERA hub pushes its events on a
websocket, the TRÅDFRI gateway notifies every change (CoAP observe).

## Installation

### DIRIGERA hub

1. Install the integration, then open its **Configuration** tab.
2. Click **Pair the DIRIGERA hub**, then press the **action button** under
   the hub (the small button on its bottom) within **90 seconds**.
3. Once paired, open the **Discovery** tab and add the devices you want.

### TRÅDFRI gateway

1. Find the **security code** printed under the gateway (16 characters, next
   to the QR code).
2. Click **Pair the TRÅDFRI gateway**, type the code, confirm.
3. Open the **Discovery** tab and add the devices.

The code is only used once, to create an access of its own for Gladys: it is
not kept. Both gateways can be paired at the same time.

## Gateway address

The gateways are **found on the network by themselves** (mDNS, through Gladys).
If the search fails (another network, a router that filters multicast), type
the **IP address** of the gateway in the configuration (for example
`192.168.1.20`; a `.local` name does not work from the integration container).
Give the gateway a fixed address in your router if you can. Without a typed
address, a gateway whose address changed is found again by itself.

The **Find the IKEA gateways on the network** button lists what answers.

## Scenes

- **Shortcut buttons and remotes** paired with a DIRIGERA hub become
  "button" features (single press, double press, long press), usable in the
  "Device state change" trigger.
- The **IKEA remote button** scene trigger receives every press, filtered by
  remote, button number and press type.
- The **TRÅDFRI gateway does not forward** the presses of its remotes nor the
  detections of its motion sensors: there, only their battery level is
  available. Move them to a DIRIGERA hub to use them in Gladys scenes.

## Troubleshooting

- **"not found on the network"**: type the IP address of the gateway.
- **"the hub refused the access"**: the access was removed from the IKEA app,
  or the hub was reset: pair it again.
- **"was not issued by IKEA"**: the address does not point to a DIRIGERA hub,
  or its certificate changed. If it really is your hub, turn off **Check that
  the hub certificate was issued by IKEA**.
- **"the gateway refused the key"** (TRÅDFRI): the gateway was reset: pair it
  again with its security code.
- **The button presses of a remote do not show**: only the remotes that the
  DIRIGERA hub exposes as shortcut buttons send their presses; a remote linked
  directly to lights controls them without telling the hub.

## Privacy

Everything stays on your network: the integration only talks to your gateway,
directly. The access given by the hub (DIRIGERA) or the key given by the
gateway (TRÅDFRI) is stored by Gladys, never shown in the interface and never
written in the logs.
