// Unified image compression — replaces 3 duplicate implementations
// (sell/page.tsx compressImage, profile compressAvatar, tomga/books compressCover)
//
// ใช้ canvas resize + JPEG quality iteration จนได้ขนาดต่ำกว่า maxKB
// รองรับ 3 modes: standard (book cover 3:4), square crop (avatar), portrait rotation
// Browser compat: createImageBitmap + imageOrientation='from-image' สำหรับ EXIF auto-rotate
// (fallback: <img> + onload — browser เก่ากว่านี้)

export type CompressOptions = {
  /** Max dimension (longest edge) px — default 1000 */
  maxDimension?: number
  /** Target max file size KB — default 220 */
  maxKB?: number
  /** Crop to square center (avatar) — default false */
  squareCrop?: boolean
  /** Auto-rotate landscape → portrait (หนังสือเป็นแนวตั้ง) — default false */
  autoRotatePortrait?: boolean
  /** Initial JPEG quality — default 0.85 (step down 0.1 จนผ่าน maxKB หรือถึง 0.1) */
  startQuality?: number
}

export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const {
    maxDimension = 1000,
    maxKB = 220,
    squareCrop = false,
    autoRotatePortrait = false,
    startQuality = 0.85,
  } = options

  // Try modern createImageBitmap path (handles EXIF rotation)
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Fallback to <img> path (older browsers)
    return compressViaImgTag(file, { maxDimension, maxKB, squareCrop, autoRotatePortrait, startQuality })
  }

  const canvas = drawToCanvas(bitmap, { maxDimension, squareCrop, autoRotatePortrait })
  bitmap.close?.()

  return await encodeToMaxSize(canvas, file.name, maxKB, startQuality)
}

// ─── Internal helpers ─────────────────────────────────────────

function drawToCanvas(
  source: CanvasImageSource & { width: number; height: number },
  opts: { maxDimension: number; squareCrop: boolean; autoRotatePortrait: boolean }
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const sw = source.width, sh = source.height

  if (opts.squareCrop) {
    // Square center crop → resize to maxDimension
    const minSide = Math.min(sw, sh)
    const sx = (sw - minSide) / 2
    const sy = (sh - minSide) / 2
    canvas.width = opts.maxDimension
    canvas.height = opts.maxDimension
    ctx.drawImage(source, sx, sy, minSide, minSide, 0, 0, opts.maxDimension, opts.maxDimension)
    return canvas
  }

  // Compute resize dimensions (keep aspect ratio)
  let width = sw, height = sh
  if (width > opts.maxDimension || height > opts.maxDimension) {
    if (width > height) {
      height = Math.round(height * opts.maxDimension / width)
      width = opts.maxDimension
    } else {
      width = Math.round(width * opts.maxDimension / height)
      height = opts.maxDimension
    }
  }

  // Auto-rotate landscape → portrait (book covers are portrait by default)
  const isLandscape = width > height
  if (opts.autoRotatePortrait && isLandscape) {
    canvas.width = height
    canvas.height = width
    ctx.translate(height / 2, width / 2)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(source, -width / 2, -height / 2, width, height)
  } else {
    canvas.width = width
    canvas.height = height
    ctx.drawImage(source, 0, 0, width, height)
  }
  return canvas
}

function encodeToMaxSize(
  canvas: HTMLCanvasElement, name: string, maxKB: number, startQ: number
): Promise<File> {
  return new Promise(resolve => {
    const cleanup = () => { canvas.width = 0; canvas.height = 0 }
    const tryQ = (q: number) => {
      canvas.toBlob(blob => {
        if (!blob) {
          cleanup()
          // Fallback — return original file ถ้า toBlob พัง
          return resolve(new File([], name, { type: 'image/jpeg' }))
        }
        if (blob.size <= maxKB * 1024 || q <= 0.1) {
          cleanup()
          resolve(new File([blob], name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
        } else {
          tryQ(Math.round((q - 0.1) * 10) / 10)
        }
      }, 'image/jpeg', q)
    }
    tryQ(startQ)
  })
}

// Fallback path — browser ที่ไม่รองรับ createImageBitmap (เก่ามาก)
function compressViaImgTag(file: File, opts: Required<CompressOptions>): Promise<File> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = drawToCanvas(img, opts)
      encodeToMaxSize(canvas, file.name, opts.maxKB, opts.startQuality).then(resolve)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// ─── Convenience exports ─────────────────────────────────────

/** Book cover / listing photo — max 1000px, 220KB, auto-rotate landscape→portrait */
export function compressBookPhoto(file: File): Promise<File> {
  return compressImage(file, { maxDimension: 1000, maxKB: 220, autoRotatePortrait: true })
}

/** Avatar — 400×400 square crop, 100KB */
export function compressAvatarImage(file: File): Promise<File> {
  return compressImage(file, { maxDimension: 400, maxKB: 100, squareCrop: true })
}

/** Admin cover upload — 800px, 300KB (retina-friendly) */
export function compressCoverUpload(file: File): Promise<File> {
  return compressImage(file, { maxDimension: 800, maxKB: 300 })
}
