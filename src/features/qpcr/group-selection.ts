/** Ordered worksheet selection helpers for qPCR group rows. */

export function groupRange(
  groups: string[],
  anchor: number,
  focus: number,
  base: string[] = [],
): string[] {
  if (groups.length === 0) return [];
  const start = Math.max(0, Math.min(groups.length - 1, Math.min(anchor, focus)));
  const end = Math.max(0, Math.min(groups.length - 1, Math.max(anchor, focus)));
  const included = new Set(base);
  for (let index = start; index <= end; index += 1) included.add(groups[index]);
  return groups.filter((group) => included.has(group));
}

export function toggleGroup(groups: string[], selected: string[], group: string): string[] {
  const included = new Set(selected);
  if (included.has(group)) included.delete(group);
  else included.add(group);
  return groups.filter((item) => included.has(item));
}
