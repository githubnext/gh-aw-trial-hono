const normalizeElementKeyMap: Map<string, string> = new Map([
  ['className', 'class'],
  ['htmlFor', 'for'],
  ['crossOrigin', 'crossorigin'],
  ['httpEquiv', 'http-equiv'],
  ['itemProp', 'itemprop'],
  ['fetchPriority', 'fetchpriority'],
  ['noModule', 'nomodule'],
  ['formAction', 'formaction'],
])
export const normalizeIntrinsicElementKey = (key: string): string =>
  normalizeElementKeyMap.get(key) || key

export const styleObjectForEach = (
  style: Record<string, string | number>,
  fn: (key: string, value: string | null) => void
): void => {
  // Use for...in instead of Object.entries() to avoid intermediate array allocation
  for (const k in style) {
    if (!style.hasOwnProperty(k)) continue
    const v = style[k]
    const key =
      k[0] === '-' || !/[A-Z]/.test(k)
        ? k // a CSS variable or a lowercase only property
        : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`) // a camelCase property. convert to kebab-case
    fn(
      key,
      v == null
        ? null
        : typeof v === 'number'
        ? !key.match(
            /^(?:a|border-im|column(?:-c|s)|flex(?:$|-[^b])|grid-(?:ar|[^a])|font-w|li|or|sca|st|ta|wido|z)|ty$/
          )
          ? `${v}px`
          : `${v}`
        : v
    )
  }
}
