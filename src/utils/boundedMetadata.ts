import { open } from '@tauri-apps/plugin-fs'

export interface BoundedReader {
  stat(): Promise<{ size: number }>
  read(buffer: Uint8Array): Promise<number | null>
  close(): Promise<void>
}

export const MAX_METADATA_BYTES = 4 * 1024 * 1024 // 4 MB limit

export function parseId3Header(header: Uint8Array): {
  isValid: boolean
  version: number
  tagBodySize: number
  totalTagSize: number
} {
  if (header.length < 10) {
    return { isValid: false, version: 0, tagBodySize: 0, totalTagSize: 0 }
  }
  // Check 'ID3' magic
  if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) {
    return { isValid: false, version: 0, tagBodySize: 0, totalTagSize: 0 }
  }
  const version = header[3]
  if (version < 2 || version > 4) {
    return { isValid: false, version, tagBodySize: 0, totalTagSize: 0 }
  }

  // Synchsafe integers must have bit 7 unset in each size byte
  if (
    (header[6] & 0x80) !== 0 ||
    (header[7] & 0x80) !== 0 ||
    (header[8] & 0x80) !== 0 ||
    (header[9] & 0x80) !== 0
  ) {
    return { isValid: false, version, tagBodySize: 0, totalTagSize: 0 }
  }

  const tagBodySize =
    ((header[6] & 0x7f) << 21) |
    ((header[7] & 0x7f) << 14) |
    ((header[8] & 0x7f) << 7) |
    (header[9] & 0x7f)

  if (tagBodySize < 0 || !Number.isFinite(tagBodySize)) {
    return { isValid: false, version, tagBodySize: 0, totalTagSize: 0 }
  }

  // In ID3v2.4, bit 4 of flags indicates an extra 10-byte footer
  const hasFooter = version === 4 && (header[5] & 0x10) !== 0
  const footerSize = hasFooter ? 10 : 0

  return {
    isValid: true,
    version,
    tagBodySize,
    totalTagSize: 10 + tagBodySize + footerSize,
  }
}

/**
 * Reads only the bounded metadata region from a random access reader.
 * If the file does not have an ID3 tag, reads only 10 bytes and stops immediately.
 * If the file has an ID3 tag, reads up to min(fileSize, declaredTagSize, maxBytes).
 */
export async function readBoundedMetadataFromReader(
  reader: BoundedReader,
  maxBytes = MAX_METADATA_BYTES,
): Promise<Uint8Array | null> {
  try {
    const fileInfo = await reader.stat()
    const fileSize = fileInfo.size

    if (fileSize < 10) {
      return null
    }

    const header = new Uint8Array(10)
    let headerRead = 0
    while (headerRead < 10) {
      const n = await reader.read(header.subarray(headerRead))
      if (n === null || n === 0) break
      headerRead += n
    }

    if (headerRead < 10) {
      return null
    }

    const parsed = parseId3Header(header)
    if (!parsed.isValid) {
      return null
    }

    const targetSize = Math.min(fileSize, parsed.totalTagSize, maxBytes)
    const result = new Uint8Array(targetSize)
    result.set(header)

    let bytesRead = 10
    while (bytesRead < targetSize) {
      const slice = result.subarray(bytesRead)
      const n = await reader.read(slice)
      if (n === null || n === 0) break
      bytesRead += n
    }

    return result.subarray(0, bytesRead)
  } catch (err) {
    console.warn('Error reading bounded metadata:', err)
    return null
  } finally {
    try {
      await reader.close()
    } catch {
      // ignore
    }
  }
}

/**
 * Reads bounded metadata region from a native file path via Tauri filesystem API.
 */
export async function readBoundedNativeFile(
  filePath: string,
  maxBytes = MAX_METADATA_BYTES,
): Promise<Uint8Array | null> {
  try {
    const handle = await open(filePath, { read: true })
    return await readBoundedMetadataFromReader(handle, maxBytes)
  } catch (err) {
    console.warn(`Failed opening native file for bounded metadata: ${filePath}`, err)
    return null
  }
}
