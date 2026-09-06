/** Collapse whitespace/newlines to single spaces, trim, and cap length. */
export function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
