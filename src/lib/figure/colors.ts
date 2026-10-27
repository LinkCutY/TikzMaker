const NAMED: Record<string, string> = {
  black: "000000", white: "ffffff", red: "ff0000", green: "00ff00", blue: "0000ff", cyan: "00ffff", magenta: "ff00ff", yellow: "ffff00",
  gray: "808080", darkgray: "404040", lightgray: "bfbfbf", brown: "bf8040", lime: "bfff00", olive: "808000", orange: "ff8000", pink: "ffbfbf", purple: "bf0040", teal: "008080", violet: "800080",
};

export function splitOptions(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (text[i] === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

/** Resolve xcolor names/mixes and explicit RGB into a portable hex color. */
export function colorToHex(value: string, definitions: Record<string, string> = {}): string | null {
  const raw = value.trim();
  if (/^#[\da-f]{6}$/i.test(raw)) return raw.toLowerCase();
  const direct = definitions[raw] || NAMED[raw];
  if (direct) return direct.startsWith("#") ? direct : "#" + direct;
  const rgb = /^\{?rgb\s*,\s*(1|255)\s*:\s*red\s*,\s*([\d.]+)\s*;\s*green\s*,\s*([\d.]+)\s*;\s*blue\s*,\s*([\d.]+)\s*\}?$/i.exec(raw);
  if (rgb) {
    const k = rgb[1] === "1" ? 255 : 1;
    return "#" + rgb.slice(2).map(v => Math.max(0, Math.min(255, Math.round(Number(v) * k))).toString(16).padStart(2, "0")).join("");
  }
  const parts = raw.split("!");
  if (parts.length < 2 || parts.length > 12) return null;
  let result = colorToHex(parts[0], definitions);
  if (!result) return null;
  for (let i = 1; i < parts.length; i += 2) {
    const share = Number(parts[i]) / 100;
    const other = colorToHex(parts[i + 1] || "white", definitions);
    if (!Number.isFinite(share) || share < 0 || share > 1 || !other) return null;
    result = "#" + [1, 3, 5].map(j => Math.round(parseInt(result!.slice(j, j + 2), 16) * share + parseInt(other.slice(j, j + 2), 16) * (1 - share)).toString(16).padStart(2, "0")).join("");
  }
  return result;
}

export function tikzColor(value: string): string {
  if (!/^#[\da-f]{6}$/i.test(value)) return value;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  return `{rgb,255:red,${r};green,${g};blue,${b}}`;
}

export function colorDefinitions(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/\\definecolor\s*\{([^}]+)\}\s*\{(RGB|rgb|HTML)\}\s*\{([^}]+)\}/g)) {
    const hex = m[2] === "HTML" ? "#" + m[3].trim() : "#" + m[3].split(",").map(v => Math.max(0, Math.min(255, Math.round(Number(v) * (m[2] === "rgb" ? 255 : 1)))).toString(16).padStart(2, "0")).join("");
    if (/^#[\da-f]{6}$/i.test(hex)) out[m[1]] = hex.toLowerCase();
  }
  return out;
}
