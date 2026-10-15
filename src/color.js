// -----------------------------------------------------------------------------
// Colour conversions between the gateways and Gladys (pure).
//
// Gladys: a colour is one integer 0xRRGGBB, a colour temperature is in mireds.
// DIRIGERA: hue 0-360 and saturation 0-1, temperature in kelvin.
// TRÅDFRI: hue and saturation 0-65279, temperature in mireds.
// -----------------------------------------------------------------------------

export const RGB_MAX = 0xffffff;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** HSV (h 0-360, s 0-1, v 0-1) -> 0xRRGGBB. */
export function hsvToRgb(h, s, v = 1) {
  const hue = (((h % 360) + 360) % 360) / 60;
  const sat = clamp(s, 0, 1);
  const val = clamp(v, 0, 1);
  const c = val * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = val - c;
  const [r, g, b] =
    hue < 1
      ? [c, x, 0]
      : hue < 2
        ? [x, c, 0]
        : hue < 3
          ? [0, c, x]
          : hue < 4
            ? [0, x, c]
            : hue < 5
              ? [x, 0, c]
              : [c, 0, x];
  const byte = (n) => Math.round((n + m) * 255);
  return byte(r) * 0x10000 + byte(g) * 0x100 + byte(b);
}

/** 0xRRGGBB -> { h 0-360, s 0-1, v 0-1 }. */
export function rgbToHsv(rgb) {
  const value = clamp(Math.round(Number(rgb) || 0), 0, RGB_MAX);
  const r = Math.floor(value / 0x10000) / 255;
  const g = (Math.floor(value / 0x100) % 0x100) / 255;
  const b = (value % 0x100) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) {
      h = 60 * (((g - b) / d) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / d + 2);
    } else {
      h = 60 * ((r - g) / d + 4);
    }
  }
  return { h: h < 0 ? h + 360 : h, s: max === 0 ? 0 : d / max, v: max };
}

export const kelvinToMired = (kelvin) => Math.round(1_000_000 / kelvin);
export const miredToKelvin = (mired) => Math.round(1_000_000 / mired);
