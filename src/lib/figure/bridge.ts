export { buildDocument, generateBody, upsertBody, extractBody, elementToTikz, fmtNum } from "./generate";
export { parseBody } from "./parse";
import { parseBody } from "./parse";
import type { Figure } from "./types";

/** Parse a document body, returning null instead of throwing. */
export function parseBodySafe(source: string): Figure | null {
  try {
    const m = /\\begin\{tikzpicture\}(\[[^\]]*\])?([\s\S]*?)\\end\{tikzpicture\}/.exec(source);
    const pictureOptions = m && m[1] ? m[1] : "";
    const body = m ? m[2] : source;
    // The picture options carry the global font: hand them to the parser instead of
    // dropping them, otherwise every label comes back at 10pt and the anchors move.
    const fig = parseBody(body, { pictureOptions });
    return fig.elements.length ? fig : null;
  } catch {
    return null;
  }
}
