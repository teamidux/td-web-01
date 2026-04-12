// Shared barcode scan pipeline — used by home and sell pages.
// Strategy: build multiple canvas variants (crop / rotate / downscale) and try
// BarcodeDetector → ZXing on each, then html5-qrcode as last resort.
// Returns rich debug log so iPhone users can see exactly which step succeeded/failed.

import { resizeForScan } from '@/components/ui'

export function isValidISBN(v: string): boolean {
  return /^(978|979)\d{10}$/.test(v)
}

export function correctISBN(v: string): string {
  if (isValidISBN(v)) return v
  if (/^\d{13}$/.test(v)) {
    const attempt = '9' + v.slice(1)
    if (isValidISBN(attempt)) return attempt
  }
  return v
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    const u = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(u)
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      c.getContext('2d')!.drawImage(img, 0, 0)
      res(c)
    }
    img.onerror = e => { URL.revokeObjectURL(u); rej(e) }
    img.src = u
  })
}

function cropCenter(src: HTMLCanvasElement, ratio: number): HTMLCanvasElement {
  const w = Math.round(src.width * ratio)
  const h = Math.round(src.height * ratio)
  const x = Math.round((src.width - w) / 2)
  const y = Math.round((src.height - h) / 2)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h)
  return c
}

function rotate90(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.height; c.height = src.width
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

function downscale(src: HTMLCanvasElement, maxPx: number): HTMLCanvasElement {
  let w = src.width, h = src.height
  if (w <= maxPx && h <= maxPx) return src
  if (w > h) { h = Math.round(h * maxPx / w); w = maxPx }
  else { w = Math.round(w * maxPx / h); h = maxPx }
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d')!.drawImage(src, 0, 0, w, h)
  return c
}

async function tryBarcodeDetector(canvas: HTMLCanvasElement): Promise<string | null> {
  if (!('BarcodeDetector' in window)) return null
  try {
    const detector = new (window as any).BarcodeDetector({ formats: ['ean_13', 'ean_8'] })
    const codes = await detector.detect(canvas)
    return codes.length > 0 ? codes[0].rawValue : null
  } catch { return null }
}

function tryZXing(canvas: HTMLCanvasElement, zxing: any): string | null {
  try {
    const { MultiFormatReader, HTMLCanvasElementLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType, BarcodeFormat } = zxing
    const reader = new MultiFormatReader()
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8])
    hints.set(DecodeHintType.TRY_HARDER, true)
    reader.setHints(hints)
    const source = new HTMLCanvasElementLuminanceSource(canvas)
    const bitmap = new BinaryBitmap(new HybridBinarizer(source))
    const result = reader.decode(bitmap)
    return result.getText()
  } catch { return null }
}

export interface ScanResult {
  raw: string | null       // ค่าที่ decoder อ่านได้ (อาจไม่ใช่ ISBN ที่ valid)
  isbn: string | null      // ISBN ที่ valid หลัง correctISBN
  debug: string[]          // log ของแต่ละ step
  variantHit: string | null
}

function finalize(raw: string, debug: string[], variantHit: string): ScanResult {
  const trimmed = raw.trim()
  const corrected = correctISBN(trimmed)
  return {
    raw: trimmed,
    isbn: isValidISBN(corrected) ? corrected : null,
    debug,
    variantHit,
  }
}

// Release canvas memory — set dimensions to 0 to free GPU/bitmap backing store
function freeCanvas(c: HTMLCanvasElement) {
  c.width = 0
  c.height = 0
}

export async function scanBarcode(rawFile: File): Promise<ScanResult> {
  const debug: string[] = []

  // 1. Resize + EXIF normalization
  let file: File
  try {
    file = await resizeForScan(rawFile, 1920)
    debug.push(`resize OK: ${file.size}b ${rawFile.type}→JPEG`)
  } catch (e: any) {
    debug.push(`resize FAIL: ${e?.message}`)
    file = rawFile
  }

  // 2. File → base canvas
  let baseCanvas: HTMLCanvasElement
  try {
    baseCanvas = await fileToCanvas(file)
    debug.push(`canvas OK: ${baseCanvas.width}x${baseCanvas.height}`)
  } catch (e: any) {
    debug.push(`canvas FAIL: ${e?.message}`)
    return { raw: null, isbn: null, debug, variantHit: null }
  }

  // 3. Build variants — barcodes usually live in the center, sometimes rotated
  const variants: { name: string; canvas: HTMLCanvasElement }[] = []
  try {
    variants.push({ name: 'full', canvas: baseCanvas })
    variants.push({ name: 'center70', canvas: cropCenter(baseCanvas, 0.7) })
    variants.push({ name: 'center50', canvas: cropCenter(baseCanvas, 0.5) })
    variants.push({ name: 'downscale1080', canvas: downscale(baseCanvas, 1080) })
    const rot = rotate90(baseCanvas)
    variants.push({ name: 'rotate90', canvas: rot })
    variants.push({ name: 'rotate90+center50', canvas: cropCenter(rot, 0.5) })
    debug.push(`variants: ${variants.length}`)
  } catch (e: any) {
    debug.push(`variants build FAIL: ${e?.message}`)
  }

  // Helper: free all variant canvases to release memory
  const cleanup = () => {
    for (const v of variants) freeCanvas(v.canvas)
  }

  // 4. BarcodeDetector across variants (Chrome/Android — fast native)
  if ('BarcodeDetector' in window) {
    for (const v of variants) {
      const r = await tryBarcodeDetector(v.canvas)
      if (r) {
        debug.push(`BarcodeDetector HIT on ${v.name}: ${r}`)
        cleanup()
        return finalize(r, debug, `BD:${v.name}`)
      }
    }
    debug.push('BarcodeDetector: no hit on any variant')
  } else {
    debug.push('BarcodeDetector: not supported (iOS Safari)')
  }

  // 5. ZXing across variants (works on iOS Safari)
  try {
    const zxing: any = await import('@zxing/library')
    for (const v of variants) {
      const r = tryZXing(v.canvas, zxing)
      if (r) {
        debug.push(`ZXing HIT on ${v.name}: ${r}`)
        cleanup()
        return finalize(r, debug, `ZX:${v.name}`)
      }
    }
    debug.push('ZXing: no hit on any variant')
  } catch (e: any) {
    debug.push(`ZXing import FAIL: ${e?.message}`)
  }

  // Free variant canvases before html5-qrcode (it works on the file, not canvas)
  cleanup()

  // 6. html5-qrcode on the file (last resort — slower, different engine)
  try {
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
    let el = document.getElementById('scan-tmp')
    if (!el) { el = document.createElement('div'); el.id = 'scan-tmp'; el.style.display = 'none'; document.body.appendChild(el) }
    const scanner = new Html5Qrcode('scan-tmp', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13], verbose: false })
    try {
      const r = await scanner.scanFile(file, false)
      debug.push(`html5-qrcode HIT: ${r}`)
      scanner.clear()
      return finalize(r, debug, 'h5q')
    } catch (e: any) {
      debug.push(`html5-qrcode FAIL: ${e?.message}`)
      scanner.clear()
    }
  } catch (e: any) {
    debug.push(`html5-qrcode import FAIL: ${e?.message}`)
  }

  return { raw: null, isbn: null, debug, variantHit: null }
}
