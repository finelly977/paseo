export const DEFAULT_TEXT_BRIGHTNESS = 100;
export const MIN_TEXT_BRIGHTNESS = 70;
export const MAX_TEXT_BRIGHTNESS = 150;

interface TextBrightnessInput {
  foreground: string;
  background: string;
  colorScheme: "light" | "dark";
  brightness: number;
}

function normalizeHexColor(color: string): string {
  if (/^#[\da-f]{3}$/i.test(color)) {
    return color
      .slice(1)
      .split("")
      .map((channel) => channel.repeat(2))
      .join("");
  }
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color)) return color.slice(1);
  throw new Error(`Unsupported text brightness color: ${color}`);
}

export function resolveTextBrightness({
  foreground,
  background,
  colorScheme,
  brightness,
}: TextBrightnessInput): string {
  if (brightness === DEFAULT_TEXT_BRIGHTNESS) return foreground;

  const dimming = brightness < DEFAULT_TEXT_BRIGHTNESS;
  const contrastColor = colorScheme === "dark" ? "#ffffff" : "#000000";
  const source = normalizeHexColor(foreground);
  const target = normalizeHexColor(dimming ? background : contrastColor);
  const amount = dimming
    ? 1 - brightness / DEFAULT_TEXT_BRIGHTNESS
    : (brightness - DEFAULT_TEXT_BRIGHTNESS) / (MAX_TEXT_BRIGHTNESS - DEFAULT_TEXT_BRIGHTNESS);
  const channels = [0, 2, 4].map((offset) => {
    const start = Number.parseInt(source.slice(offset, offset + 2), 16);
    const end = Number.parseInt(target.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * amount)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}${source.slice(6)}`;
}
