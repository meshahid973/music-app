import { open } from '@tauri-apps/plugin-fs'

export interface BoundedReader {
  stat(): Promise<{ size: number }>
  read(buffer: Uint8Array): Promise<number | null>
  seek?(offset: number, whence: number): Promise<number>
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

async function skipReaderBytes(
  reader: BoundedReader,
  count: number,
  maxAllowedScratchRead?: number,
): Promise<boolean> {
  if (count <= 0) return true
  const anyReader = reader as unknown as { seek?: (offset: number, whence: number) => Promise<number> }
  if (typeof anyReader.seek === 'function') {
    try {
      await anyReader.seek(count, 1) // 1 = SeekMode.Current
      return true
    } catch {
      // Fall through to scratch buffer
    }
  }
  if (maxAllowedScratchRead !== undefined && count > maxAllowedScratchRead) {
    return false
  }
  const scratch = new Uint8Array(Math.min(count, 64 * 1024))
  let remaining = count
  while (remaining > 0) {
    const toRead = Math.min(remaining, scratch.length)
    const n = await reader.read(scratch.subarray(0, toRead))
    if (n === null || n === 0) return false
    remaining -= n
  }
  return true
}

async function readExactBytes(reader: BoundedReader, buffer: Uint8Array): Promise<number> {
  let bytesRead = 0
  while (bytesRead < buffer.length) {
    const n = await reader.read(buffer.subarray(bytesRead))
    if (n === null || n === 0) break
    bytesRead += n
  }
  return bytesRead
}

/**
 * Reads only the bounded metadata region from a random access reader.
 * If the file does not have an ID3 tag, reads only 10 bytes and stops immediately.
 * If the file has an ID3 tag, reads up to min(fileSize, declaredTagSize, maxBytes).
 * If the tag exceeds maxBytes because of an oversized artwork frame, skips the
 * oversized artwork to recover subsequent title/artist text frames within the limit.
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

    // Fast path: entire tag fits within the bounded memory/read limit
    if (parsed.totalTagSize <= maxBytes) {
      const targetSize = Math.min(fileSize, parsed.totalTagSize)
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
    }

    // Oversized tag handling: read frames selectively within maxBytes budget,
    // skipping oversized artwork (APIC/PIC) so later title/artist frames are not lost.
    const version = parsed.version
    const headerLen = version === 2 ? 6 : 10
    const idLen = version === 2 ? 3 : 4
    let tagBytesRemaining = Math.min(fileSize - 10, parsed.tagBodySize)
    const tagBudget = maxBytes - 10
    const collectedChunks: Uint8Array[] = []
    let collectedBytes = 0
    let lastHeader: Uint8Array | null = null
    let lastHeaderLen = 0

    while (tagBytesRemaining >= headerLen && collectedBytes < tagBudget) {
      const frameHeader = new Uint8Array(headerLen)
      const nHdr = await readExactBytes(reader, frameHeader)
      if (nHdr < headerLen) {
        lastHeader = frameHeader
        lastHeaderLen = nHdr
        break
      }
      tagBytesRemaining -= headerLen

      // 0x00 padding reached
      if (frameHeader[0] === 0) {
        lastHeader = frameHeader
        lastHeaderLen = nHdr
        break
      }

      const frameId = String.fromCharCode(...frameHeader.subarray(0, idLen))
      if (!/^[A-Z0-9]+$/.test(frameId)) {
        lastHeader = frameHeader
        lastHeaderLen = nHdr
        break
      }

      const frameSize =
        version === 2
          ? (frameHeader[3] << 16) | (frameHeader[4] << 8) | frameHeader[5]
          : version === 4
            ? ((frameHeader[4] & 0x7f) << 21) |
              ((frameHeader[5] & 0x7f) << 14) |
              ((frameHeader[6] & 0x7f) << 7) |
              (frameHeader[7] & 0x7f)
            : new DataView(frameHeader.buffer, frameHeader.byteOffset).getUint32(4)

      if (frameSize <= 0 || frameSize > tagBytesRemaining) {
        lastHeader = frameHeader
        lastHeaderLen = nHdr
        break
      }

      const isArtwork = frameId === 'APIC' || frameId === 'PIC'
      // If artwork frame cannot fit into remaining budget, skip it so later text frames can be read
      if (isArtwork && collectedBytes + headerLen + frameSize > tagBudget) {
        const skipped = await skipReaderBytes(reader, frameSize, tagBudget - collectedBytes)
        tagBytesRemaining -= frameSize
        if (!skipped) break
        continue
      }

      if (collectedBytes + headerLen + frameSize <= tagBudget) {
        const frameBody = new Uint8Array(frameSize)
        const nBody = await readExactBytes(reader, frameBody)
        tagBytesRemaining -= frameSize
        if (nBody < frameSize) break

        collectedChunks.push(frameHeader, frameBody)
        collectedBytes += headerLen + frameSize
      } else {
        // Tag budget exhausted
        lastHeader = frameHeader
        lastHeaderLen = nHdr
        break
      }
    }

    if (collectedChunks.length > 0) {
      const synchsafeSize = (n: number) => [
        (n >>> 21) & 0x7f,
        (n >>> 14) & 0x7f,
        (n >>> 7) & 0x7f,
        n & 0x7f,
      ]
      const newHeader = new Uint8Array(10)
      newHeader.set(header.subarray(0, 6))
      const sz = synchsafeSize(collectedBytes)
      newHeader[6] = sz[0]
      newHeader[7] = sz[1]
      newHeader[8] = sz[2]
      newHeader[9] = sz[3]

      const result = new Uint8Array(10 + collectedBytes)
      result.set(newHeader, 0)
      let pos = 10
      for (const chunk of collectedChunks) {
        result.set(chunk, pos)
        pos += chunk.length
      }
      return result
    }

    // Fallback if no structured frames were parsed: return raw bounded slice up to maxBytes
    const targetSize = Math.min(fileSize, maxBytes)
    const fallbackResult = new Uint8Array(targetSize)
    fallbackResult.set(header)
    let alreadyFilled = 10
    if (lastHeader && lastHeaderLen > 0) {
      fallbackResult.set(lastHeader.subarray(0, lastHeaderLen), 10)
      alreadyFilled += lastHeaderLen
    }
    if (alreadyFilled < targetSize) {
      await readExactBytes(reader, fallbackResult.subarray(alreadyFilled))
    }
    return fallbackResult
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
