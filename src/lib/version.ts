/**
 * Compare two semver-like version strings.
 * Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  // Strip leading 'v' and any pre-release suffix (e.g. "-beta", "-rc1")
  const cleanA = a.replace(/^v/, "").replace(/-.*$/, "");
  const cleanB = b.replace(/^v/, "").replace(/-.*$/, "");
  const aParts = cleanA.split(".").map(Number);
  const bParts = cleanB.split(".").map(Number);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    if (Number.isNaN(aPart)) return -1;
    if (Number.isNaN(bPart)) return 1;
    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }
  return 0;
}
