import path from "node:path"
import type { AliasOptions } from "vite"

const src = (file: string) => path.resolve(import.meta.dirname, "src", file)

/**
 * Module aliases shared by the library config (dev server, Vitest) and the
 * demo-site config.
 *
 * The two package specifiers exist for the docs page: its live examples are
 * shown verbatim as copyable code, so they import the package by its published
 * name — and that name has to resolve to this repo's own source, or the page
 * would either run an npm release instead of the code beside it or show an
 * import line nobody can paste. Exact-match patterns, so `@` below never
 * swallows an `@hojiakbar_dev/…` specifier and vice versa.
 */
export const sourceAliases: AliasOptions = [
  { find: /^@hojiakbar_dev\/data-table\/styles\.css$/, replacement: src("styles.css") },
  { find: /^@hojiakbar_dev\/data-table$/, replacement: src("index.ts") },
  { find: "@", replacement: path.resolve(import.meta.dirname, "src") },
]
