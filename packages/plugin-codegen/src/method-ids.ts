export function canonicalMethodName(
  packageName: string,
  serviceName: string,
  methodName: string,
): string {
  return `${packageName}.${serviceName}/${methodName}`;
}

export function stableMethodId(canonicalName: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < canonicalName.length; index += 1) {
    hash ^= canonicalName.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  if (hash === 0) {
    return 1;
  }

  return hash;
}

export function assertUniqueMethodIds(canonicalNames: string[]): void {
  const seenCanonicalNames = new Set<string>();
  const seenIds = new Map<number, string>();

  for (const canonicalName of canonicalNames) {
    if (seenCanonicalNames.has(canonicalName)) {
      throw new Error(`Duplicate canonical method name: ${canonicalName}`);
    }
    seenCanonicalNames.add(canonicalName);

    const methodId = stableMethodId(canonicalName);
    const existing = seenIds.get(methodId);
    if (existing !== undefined) {
      throw new Error(
        `Method ID collision: ${canonicalName} and ${existing} both map to ${methodId}`,
      );
    }
    seenIds.set(methodId, canonicalName);
  }
}
