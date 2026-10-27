/**
 * The longest a fit waits for web fonts. A font that never arrives must not
 * leave the table unfitted; past this the fit measures with what is there.
 */
const MAX_FONT_WAIT_MS = 1000

/**
 * Run `measure` once the web fonts the table draws with have loaded — or
 * straight away when nothing is loading, as with fonts already cached.
 *
 * A canvas measures a font that has not arrived with the fallback family, and
 * the width that came out of it was the one stored. The layout read first is
 * there because a font starts loading when laid-out text first needs it: in
 * the first layout effect no layout has run yet, and `status` could still
 * read "loaded" for a font the new rows are about to ask for.
 *
 * @param element - An element of the document whose fonts are waited for.
 * @param measure - What runs once they have loaded, or once the wait is over.
 * @returns A cancel for a wait still pending.
 *
 * @example
 * const cancel = afterFontsLoad(tableElement, fit)
 */
export function afterFontsLoad(element: HTMLElement, measure: () => void): () => void {
  const fonts: FontFaceSet | undefined = element.ownerDocument.fonts
  if (fonts !== undefined) void element.offsetWidth
  if (fonts === undefined || fonts.status === "loaded") {
    measure()
    return () => undefined
  }
  let isSettled = false
  const settle = () => {
    if (isSettled) return
    isSettled = true
    clearTimeout(timer)
    measure()
  }
  const timer = setTimeout(settle, MAX_FONT_WAIT_MS)
  fonts.ready.then(settle, settle)
  return () => {
    isSettled = true
    clearTimeout(timer)
  }
}
