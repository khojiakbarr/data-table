/**
 * Join class names, skipping the falsy ones.
 *
 * @param parts - Class names, or `false` / `null` / `undefined` for the ones
 *   that do not apply this render.
 * @returns A space-separated class string.
 *
 * @example
 * classNames("dt-td", isPinned && "dt-pinned") // "dt-td pinned" or "dt-td"
 */
export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}

/**
 * A copy of `list` with `item` inserted at `index`.
 *
 * @param list - Not modified.
 * @param index - Where the item goes; `list.length` appends.
 * @param item - The item to insert.
 * @returns A new array.
 */
export function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  return [...list.slice(0, index), item, ...list.slice(index)]
}
