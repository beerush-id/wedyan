/** What asking before an action says: the question, what answering yes does, and the answer that does it. */
export type ActionConfirm = { title: string; description: string; action: string };

/**
 * What asking before deleting what's picked says, for any app: one by its kind, several by how many.
 *
 * @param count - How many are picked.
 * @param one - What one is called, e.g. `photo`.
 * @param many - What several are called, e.g. `photos`.
 * @param from - Where they're taken from, e.g. `your drive`.
 * @returns The question, the line under it, and the answer.
 */
export function deleteConfirm(count: number, one: string, many: string, from: string): ActionConfirm {
  return {
    title: count === 1 ? `Delete this ${one}?` : `Delete ${count} ${many}?`,
    description: `${count === 1 ? 'It’s' : 'They’re'} taken off ${from}.`,
    action: 'Delete',
  };
}
