/** Stable across re-imports so playlist membership survives a refresh.
 * Paths disambiguate album folders; content-identical files in distinct locations remain distinct.
 */
export function trackIdForFile(file: Pick<File, 'name' | 'size' | 'lastModified' | 'webkitRelativePath'>): string {
  const path = file.webkitRelativePath || file.name
  return [path, String(file.size), String(file.lastModified)].map(encodeURIComponent).join(':')
}
