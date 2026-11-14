/** Trailing origin codes the catalogue appends to names, e.g. "MIXED LETTUCE FI". */
const COUNTRY_SUFFIX = /\s+(FI|SE|EE|LV|LT|PL|DE|DK|NO|NL|BE|FR|ES|IT|PT|GR|HU|AT|IE|GB|UK|US|CN|TH|VN|IN|BR|CL|PE|EC|CR|ZA|MA|TR|EG|IL|NZ|AU)$/;
const SHORT_MAX = 42;

const isAllCaps = (s: string) => /[A-ZÄÖÅ]/.test(s) && s === s.toUpperCase();

/** Catalogue name made readable: no trailing country code, all-caps turned into sentence case. */
export function displayName(name: string): string {
  const trimmed = name.trim().replace(COUNTRY_SUFFIX, '');
  if (!isAllCaps(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * A short name for tight rows: the words before the first size/spec token (anything with a digit),
 * cut at a word boundary. Show the full name in a tooltip next to it.
 */
export function shortName(name: string, max = SHORT_MAX): string {
  const words = displayName(name).split(/\s+/);
  const spec = words.findIndex((w, i) => i >= 2 && /\d/.test(w));
  let out = (spec > 0 ? words.slice(0, spec) : words).join(' ');
  if (out.length > max) {
    const cut = out.slice(0, max);
    out = `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[\s,.;:-]+$/, '')}…`;
  }
  return out;
}
