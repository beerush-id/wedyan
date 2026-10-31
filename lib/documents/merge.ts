/** The field an item of a list is known by, so it stays the same object when the list changes. */
const ENTITY_KEY = 'id';

/**
 * Puts `next` into `current` in place, keeping every object and array that's still there, so
 * whoever holds one sees the change: list items are matched by `ENTITY_KEY`, else by position.
 *
 * @param current - What's held.
 * @param next - What it's becoming.
 * @returns What to keep: `current` changed in place, or `next` when they aren't the same kind.
 */
export function merge(current: unknown, next: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(next)) {
    const known = new Map(current.filter(isEntity).map((item) => [item[ENTITY_KEY], item]));
    const merged = next.map((item, index) =>
      merge(isEntity(item) ? known.get(item[ENTITY_KEY]) : current[index], item),
    );
    merged.forEach((item, index) => {
      if (current[index] !== item) current[index] = item;
    });
    if (current.length > merged.length) current.splice(merged.length);
    return current;
  }

  if (isRecord(current) && isRecord(next)) {
    for (const key of Object.keys(current)) if (!(key in next)) delete current[key];
    for (const [key, value] of Object.entries(next)) {
      const merged = merge(current[key], value);
      if (current[key] !== merged) current[key] = merged;
    }
    return current;
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntity(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value[ENTITY_KEY] !== undefined;
}
