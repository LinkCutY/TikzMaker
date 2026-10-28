/**
 * CJK support for generated documents.
 *
 * Our emitters produce bare standalone documents. XeLaTeX's default Latin fonts
 * have no CJK glyphs, so a \\node{球} compiles "successfully" and renders
 * nothing — the worst kind of failure. ctex is already a hard dependency of the
 * editor (the fragment preamble loads it), so load it whenever a document
 * actually contains CJK text.
 */

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;

export function hasCjk(text) {
  return CJK.test(String(text || ""));
}

/** Lines to insert right after \\documentclass when the document has CJK text. */
export function cjkPreamble(text) {
  return hasCjk(text) ? ["\\usepackage{ctex}"] : [];
}

const GREEK = {
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "ζ": "zeta", "η": "eta",
  "θ": "theta", "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi",
  "ρ": "rho", "σ": "sigma", "τ": "tau", "υ": "upsilon", "φ": "phi", "χ": "chi", "ψ": "psi", "ω": "omega",
  "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Ξ": "Xi", "Π": "Pi", "Σ": "Sigma",
  "Υ": "Upsilon", "Φ": "Phi", "Ψ": "Psi", "Ω": "Omega",
};

/**
 * Make a model-supplied label safe inside \\node{...}.
 *
 * The model writes axis labels the way they are printed, e.g. "z/l_0" or
 * "γ(z)". A bare underscore in text mode is a hard LaTeX error ("Missing $
 * inserted."), so anything containing maths gets wrapped in $...$ and Greek
 * letters become commands. Text that is already maths is left alone.
 */
export function safeNodeText(input) {
  let text = String(input == null ? "" : input).trim();
  if (!text) return text;
  text = text.replace(/[α-ωΑ-Ω]/g, function (ch) { return GREEK[ch] ? "\\" + GREEK[ch] : ch; });
  if (text.includes("$")) return text;
  const needsMath = /[_^]/.test(text) || /\\[a-zA-Z]+/.test(text);
  text = text.replace(/([%#&])/g, "\\$1");
  return needsMath ? "$" + text + "$" : text;
}
