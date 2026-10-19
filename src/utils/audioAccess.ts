/** Authorize a saved music file before creating its WebView audio element.
 * Asset scope and filesystem scope are separate in Tauri 2.
 */
export async function restoreAudioAssetAccess(
  filePath: string | undefined,
  desktop: boolean,
  authorize: (path: string) => Promise<void>,
): Promise<void> {
  if (desktop && filePath) {
    await authorize(filePath)
  }
}
