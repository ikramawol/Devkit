/**
 * JSON.parse that accepts a leading byte-order mark. Windows Notepad and PowerShell 5's
 * `Set-Content -Encoding utf8` add one, and plain JSON.parse rejects the file because of it.
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}
