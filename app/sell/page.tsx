'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase, fetchBookByISBN, Book } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, useToast, Toast, ScanErrorSheet, MultiLoginButton, useCapture, CameraCaptureModal } from '@/components/ui'
import { scanBarcode } from '@/lib/scan'

const CONDITIONS = [
  { key: 'brand_new', label: '🆕 มือหนึ่ง', desc: 'ยังไม่ผ่านการใช้งาน ซื้อมาแล้วไม่ได้อ่าน' },
  { key: 'new', label: '✨ ใหม่มาก', desc: 'ไม่มีรอยใดๆ เหมือนซื้อจากร้าน' },
  { key: 'good', label: '👍 ดี', desc: 'มีรอยการใช้งานเล็กน้อย อ่านได้ปกติ' },
  { key: 'fair', label: '📖 พอใช้', desc: 'มีรอยชัดเจน แต่เนื้อหาครบถ้วน' },
]

// วาด bitmap/image ลง canvas — ถ้าเป็นแนวนอน (landscape) หมุน 90° ให้เป็นแนวตั้ง
// เพราะหนังสือ ~95% เป็นแนวตั้ง — user อัปรูปแนวนอนมา = ถ่ายผิดแนว ส่วนใหญ่
function drawRotatedIfLandscape(source: CanvasImageSource, sw: number, sh: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const isLandscape = sw > sh
  if (isLandscape) {
    canvas.width = sh  // สลับ w/h
    canvas.height = sw
    const ctx = canvas.getContext('2d')!
    ctx.translate(canvas.width, 0)
    ctx.rotate(Math.PI / 2) // 90° CW
    ctx.drawImage(source, 0, 0, sw, sh)
  } else {
    canvas.width = sw
    canvas.height = sh
    canvas.getContext('2d')!.drawImage(source, 0, 0, sw, sh)
  }
  return canvas
}

// Resize + compress: MAX 1000px (เผื่อ zoom ดูตำหนิบน retina), ≤ 220KB, JPEG
// ใช้ createImageBitmap + imageOrientation เพื่อ auto-rotate ตาม EXIF
// + auto-rotate landscape → portrait (หนังสือส่วนใหญ่เป็นแนวตั้ง)
async function compressImage(file: File, maxKB = 220): Promise<File> {
  const MAX = 1000
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Fallback: browser เก่า — ใช้ <img>
    return new Promise(resolve => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        let { width, height } = img
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX }
          else { width = Math.round(width * MAX / height); height = MAX }
        }
        const canvas = drawRotatedIfLandscape(img, width, height)
        const tryQ = (q: number) => {
          canvas.toBlob(blob => {
            if (!blob) { canvas.width = 0; canvas.height = 0; resolve(file); return }
            if (blob.size <= maxKB * 1024 || q <= 0.1) {
              canvas.width = 0; canvas.height = 0
              resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
            } else tryQ(Math.round((q - 0.1) * 10) / 10)
          }, 'image/jpeg', q)
        }
        tryQ(0.8)
      }
      img.onerror = () => resolve(file)
      img.src = url
    })
  }

  let width = bitmap.width
  let height = bitmap.height
  if (width > MAX || height > MAX) {
    if (width > height) { height = Math.round(height * MAX / width); width = MAX }
    else { width = Math.round(width * MAX / height); height = MAX }
  }
  const canvas = drawRotatedIfLandscape(bitmap, width, height)
  bitmap.close?.()

  return new Promise(resolve => {
    const tryQ = (q: number) => {
      canvas.toBlob(blob => {
        if (!blob) { canvas.width = 0; canvas.height = 0; resolve(file); return }
        if (blob.size <= maxKB * 1024 || q <= 0.1) {
          canvas.width = 0; canvas.height = 0
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
        } else tryQ(Math.round((q - 0.1) * 10) / 10)
      }, 'image/jpeg', q)
    }
    tryQ(0.8)
  })
}

const MAX_PHOTOS = 5

// Book cover SVG — ใช้ใน pre-capture guide แทน emoji 📕
function BookCoverSvg({ tilted = false }: { tilted?: boolean }) {
  return (
    <svg
      viewBox="0 0 60 84"
      style={{
        width: 52,
        transform: tilted ? 'rotate(12deg)' : 'none',
        opacity: tilted ? 0.55 : 1,
        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.15))',
      }}
    >
      {/* book body */}
      <rect x="1" y="1" width="58" height="82" rx="2" fill="white" stroke="#cbd5e1" strokeWidth="0.6" />
      {/* spine gradient (left edge) */}
      <rect x="1" y="1" width="3" height="82" rx="1" fill="#e2e8f0" />
      {/* decorative blobs — top-right */}
      <circle cx="48" cy="12" r="6" fill="#facc15" opacity="0.75" />
      <circle cx="54" cy="20" r="4" fill="#a78bfa" opacity="0.7" />
      {/* title text — black bars */}
      <rect x="14" y="30" width="32" height="4" rx="1" fill="#1e293b" />
      <rect x="16" y="38" width="28" height="6" rx="1" fill="#1e293b" />
      <rect x="20" y="47" width="20" height="3" rx="1" fill="#1e293b" />
      {/* author line */}
      <rect x="18" y="64" width="24" height="2" rx="0.5" fill="#64748b" />
      {/* publisher bar */}
      <rect x="22" y="74" width="16" height="2" rx="0.5" fill="#94a3b8" />
      {/* decorative blobs — bottom-left */}
      <circle cx="10" cy="76" r="5" fill="#facc15" opacity="0.7" />
      <circle cx="6" cy="70" r="3" fill="#a78bfa" opacity="0.6" />
    </svg>
  )
}

// Barcode SVG — ใช้ใน pre-capture guide แทน emoji
function BarcodeSvg({ tilted = false }: { tilted?: boolean }) {
  // ลำดับความกว้างของแท่ง (สลับ ดำ/ขาว) แบบ EAN-13 ตัวอย่าง
  const bars = [2, 1, 3, 1, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1, 2, 1, 1, 3, 1, 2, 1, 3, 1, 2, 1, 3, 1, 2]
  let x = 2
  const rects: React.ReactElement[] = []
  bars.forEach((w, i) => {
    if (i % 2 === 0) rects.push(<rect key={i} x={x} y={0} width={w} height={28} fill="currentColor" />)
    x += w
  })
  return (
    <svg viewBox="0 0 80 36" style={{ width: 64, transform: tilted ? 'rotate(10deg)' : 'none', opacity: tilted ? 0.55 : 1 }}>
      {rects}
      <text x="40" y="34" fontSize="4" textAnchor="middle" fill="currentColor" fontFamily="monospace">9786163887542</text>
    </svg>
  )
}

export default function SellPageWrapper() {
  return (
    <Suspense fallback={
      <><Nav /><div style={{ textAlign: 'center', padding: 60 }}><span className="spin" style={{ width: 28, height: 28 }} /></div></>
    }>
      <SellPage />
    </Suspense>
  )
}

function SellPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading, loginWithLine, reloadUser } = useAuth()
  const { msg, show } = useToast()
  const capture = useCapture()
  const isLineIAB = capture === undefined
  const [showCamera, setShowCamera] = useState(false)

  // showLogin removed — login goes directly to LINE OAuth
  const goLogin = () => loginWithLine(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/sell')
  // ref เก็บเบอร์ที่เพิ่งบันทึกจาก guard — กัน stale closure ตอน auto-retry submit
  const savedPhoneRef = useRef('')
  const [isbn, setIsbn] = useState(searchParams.get('isbn') || '')
  const [fetchedBook, setFetchedBook] = useState<Partial<Book> | null>(null)
  // notFoundMode: null=ยังค้นหา | 'has_isbn'=มี ISBN แต่ไม่อยู่ในระบบ | 'no_isbn'=ไม่มีบาร์โค้ด
  const [notFoundMode, setNotFoundMode] = useState<null | 'has_isbn' | 'no_isbn'>(null)
  const [fetching, setFetching] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState(false)
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const coverCaptureRef = useRef<HTMLInputElement | null>(null)
  const coverGalleryRef = useRef<HTMLInputElement | null>(null)
  // Pre-capture guide modal — แสดงก่อนเปิดกล้อง
  const [captureGuide, setCaptureGuide] = useState<null | 'barcode' | 'cover'>(null)
  const [cond, setCond] = useState('good')
  const [price, setPrice] = useState('')
  const [shipping, setShipping] = useState('buyer')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [pioneerBook, setPioneerBook] = useState<{ title: string; coverUrl: string } | null>(null)
  // Inline guard: บังคับเบอร์โทรก่อนลงขาย
  const [showPhoneGuard, setShowPhoneGuard] = useState(false)
  const [guardPhoneInput, setGuardPhoneInput] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [phoneGuardError, setPhoneGuardError] = useState('')
  const [marketPrice, setMarketPrice] = useState<{ min: number; max: number; avg: number } | null>(null)
  const [manualTitle, setManualTitle] = useState('')
  const [manualAuthor, setManualAuthor] = useState('')
  const [manualTranslator, setManualTranslator] = useState('')
  const [notes, setNotes] = useState('')
  const [bmIsbn] = useState(() => 'BM-' + Math.random().toString(36).toUpperCase().slice(2, 7))
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [compressing, setCompressing] = useState(false)
  // AI cover extract (has_isbn mode): flag กันยิงซ้ำต่อ session เดียวกัน
  const [aiExtractedIsbn, setAiExtractedIsbn] = useState<string | null>(null)
  // Ref เก็บ latest previews สำหรับ cleanup ตอน unmount (กัน memory leak จาก Object URL)
  const photoPreviewsRef = useRef<string[]>([])
  useEffect(() => { photoPreviewsRef.current = photoPreviews }, [photoPreviews])
  useEffect(() => {
    return () => {
      photoPreviewsRef.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])
  // แสดงข้อความแนะนำครั้งแรกที่หาไม่เจอ (per session)
  const [seenNotFoundTip, setSeenNotFoundTip] = useState(() =>
    typeof window !== 'undefined' && sessionStorage.getItem('bm_notfound_tip') === '1'
  )

  // Unified search state (main)
  const [sellSearch, setSellSearch] = useState('')
  const [sellResults, setSellResults] = useState<any[]>([])
  const [sellSearching, setSellSearching] = useState(false)

  // no_isbn mode: search while typing title
  const [noIsbnResults, setNoIsbnResults] = useState<any[]>([])
  const [noIsbnSearching, setNoIsbnSearching] = useState(false)
  const [noIsbnSearchDone, setNoIsbnSearchDone] = useState(false)

  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const [showPhotoPicker, setShowPhotoPicker] = useState(false)

  // Debounced search: ISBN → fetchBook / title → DB search
  useEffect(() => {
    if (!sellSearch.trim()) { setSellResults([]); return }
    const t = setTimeout(async () => {
      const q = sellSearch.trim()
      const digits = q.replace(/[^0-9]/g, '')
      if (digits.length === 13) {
        const corrected = correctISBN(digits)
        if (isValidISBN(corrected)) { setIsbn(corrected); fetchBook(corrected); return }
      }
      setSellSearching(true)
      const escaped = q.replace(/[%_]/g, '\\$&')
      const { data } = await supabase
        .from('books')
        .select('id, isbn, title, author, cover_url')
        .or(`title.ilike.%${escaped}%,author.ilike.%${escaped}%`)
        .limit(8)
      setSellResults(data || [])
      setSellSearching(false)
    }, 400)
    return () => clearTimeout(t)
  }, [sellSearch])

  // no_isbn: ค้นหา DB ขณะพิมพ์ชื่อ — ถ้าพบให้เลือก ถ้าไม่พบค่อยกรอกเอง
  useEffect(() => {
    if (notFoundMode !== 'no_isbn') return
    if (!manualTitle.trim()) { setNoIsbnResults([]); setNoIsbnSearchDone(false); return }
    const t = setTimeout(async () => {
      setNoIsbnSearching(true)
      const term = manualTitle.trim().replace(/[%_]/g, '\\$&')
      const { data } = await supabase
        .from('books')
        .select('id, isbn, title, author, cover_url')
        .or(`title.ilike.%${term}%,author.ilike.%${term}%`)
        .limit(5)
      setNoIsbnResults(data || [])
      setNoIsbnSearchDone(true)
      setNoIsbnSearching(false)
    }, 400)
    return () => clearTimeout(t)
  }, [manualTitle, notFoundMode])

  useEffect(() => {
    // Pre-fill contact: priority = LINE ID > phone (LINE สำคัญที่สุดเพราะมีปุ่ม Add)
    if (user?.line_id) setContact(user.line_id)
    else if (user?.phone) setContact(user.phone)
    const isbnParam = searchParams.get('isbn')
    if (isbnParam) fetchBook(isbnParam)
  }, [user])

  const isValidISBN = (v: string) => /^(978|979)\d{10}$/.test(v)

  // auto-correct digit แรกที่อ่านผิด (EAN-13 parity error ทำให้ 9→4)
  const correctISBN = (v: string) => {
    if (isValidISBN(v)) return v
    if (/^\d{13}$/.test(v)) {
      const attempt = '9' + v.slice(1)
      if (isValidISBN(attempt)) return attempt
    }
    return v
  }

  const fetchBook = async (isbnVal?: string) => {
    const raw = (isbnVal || isbn).trim()
    if (!raw) { show('กรุณากรอก ISBN'); return }
    const q = correctISBN(raw)
    if (q !== raw) { setIsbn(q); show(`แก้ไขอัตโนมัติ: ${raw} → ${q}`) }
    if (!isValidISBN(q)) { show('กล้องอ่านบาร์โค้ดไม่ชัด ลองสแกนใหม่อีกครั้ง หรือพิมพ์ ISBN เอง'); return }
    setFetching(true)
    setNotFoundMode(null)
    // ค้น DB ก่อน → ถ้าไม่มี ลอง /api/search ที่ค้น Google Books ฝั่ง server (ไม่โดน client quota)
    let book = await fetchBookByISBN(q)
    if (!book?.title) {
      try {
        const r = await fetch(`/api/search?q=${q}&mode=all`)
        const { results } = await r.json()
        if (results?.length) book = results[0]
      } catch {}
    }
    if (book?.title) {
      setFetchedBook(book)
      setSellSearch('')
      if ((book as any).id) {
        const { data: ls } = await supabase.from('listings').select('price').eq('book_id', (book as any).id).eq('status', 'active')
        if (ls?.length) {
          const prices = ls.map((l: any) => l.price)
          setMarketPrice({ min: Math.min(...prices), max: Math.max(...prices), avg: Math.round(prices.reduce((a: number, b: number) => a + b) / prices.length) })
        }
      }
    } else {
      // ISBN สแกนได้ แต่ไม่อยู่ใน DB → silent redirect ไป /sell/cover
      // ไม่ต้องบอก "ไม่เจอ" — เก็บ ISBN แล้วให้ user ถ่ายปกเลย flow ต่อเนื่อง
      if (process.env.NEXT_PUBLIC_ENABLE_COVER_SCAN === '1') {
        router.push(`/sell/cover?isbn=${encodeURIComponent(q)}`)
        return
      }
      // Fallback: ถ้าปิด feature → พฤติกรรมเดิม (has_isbn manual form)
      setNotFoundMode('has_isbn')
      setSellSearch('')
    }
    setFetching(false)
  }

  const processScanPhoto = async (rawFile: File) => {
    setScanning(true)
    try {
      const result = await scanBarcode(rawFile)
      if (result.isbn) {
        setIsbn(result.isbn)
        fetchBook(result.isbn)
      } else if (result.raw) {
        setIsbn(result.raw)
        show('อ่านบาร์โค้ดไม่ชัด ลองสแกนใหม่')
      } else {
        setScanError(true)
      }
    } finally {
      setScanning(false)
    }
  }

  const scanFromPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) { goLogin(); return }
    const rawFile = e.target.files?.[0]
    if (!rawFile) return
    e.target.value = ''
    processScanPhoto(rawFile)
  }

  const handleAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return

    // Validate: เฉพาะรูป + ≤ 15MB (ก่อน compress — กันไฟล์ใหญ่มากทำ memory spike)
    const MAX_FILE_BYTES = 15 * 1024 * 1024
    const valid: File[] = []
    let rejectedCount = 0
    for (const f of files) {
      if (!f.type.startsWith('image/') || f.size > MAX_FILE_BYTES) {
        rejectedCount++
        continue
      }
      valid.push(f)
    }
    if (rejectedCount > 0) show(`ข้าม ${rejectedCount} ไฟล์ที่ไม่ใช่รูปหรือใหญ่เกิน 15MB`)
    if (valid.length === 0) return

    const remaining = MAX_PHOTOS - photoFiles.length
    const accepted = valid.slice(0, remaining)
    setCompressing(true)
    const wasFirstUpload = photoFiles.length === 0
    try {
      const compressed = await Promise.all(accepted.map(f => compressImage(f)))
      const previews = compressed.map(f => URL.createObjectURL(f))
      setPhotoFiles(prev => [...prev, ...compressed])
      setPhotoPreviews(prev => [...prev, ...previews])

      // AI extract จากรูปแรก — ทั้ง has_isbn และ no_isbn (silent, fill เฉพาะช่องว่าง)
      // ถ้า user พิมพ์ title แล้ว → ไม่ทับ (เคารพ input), AI เติมแค่ author/publisher
      const shouldAiExtract =
        wasFirstUpload &&
        (notFoundMode === 'has_isbn' || notFoundMode === 'no_isbn') &&
        isbn && aiExtractedIsbn !== isbn &&
        process.env.NEXT_PUBLIC_ENABLE_COVER_SCAN === '1' &&
        compressed[0]
      if (shouldAiExtract) {
        setAiExtractedIsbn(isbn)
        ;(async () => {
          try {
            const arr = await compressed[0].arrayBuffer()
            const bytes = new Uint8Array(arr)
            let bin = ''
            for (let i = 0; i < bytes.length; i += 0x8000) {
              bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
            }
            const b64 = btoa(bin)
            const r = await fetch('/api/test/cover-scan', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ imageBase64: b64, mimeType: 'image/jpeg' }),
            })
            const j = await r.json()
            const parsed = j?.parsed
            if (!parsed) return
            let filled = false
            // Fill ONLY ช่องว่าง (เคารพสิ่งที่ user พิมพ์)
            if (!manualTitle && parsed.title) {
              const sub = (parsed.subtitle || '').trim()
              const t = (parsed.title || '').trim()
              const full = (sub && sub.length <= 60) ? `${t} ${sub}` : t
              setManualTitle(full)
              filled = true
            }
            if (!manualAuthor && parsed.authors?.length) {
              setManualAuthor(parsed.authors.join(', '))
              filled = true
            }
            if (filled) show('✨ อ่านข้อมูลจากปกให้แล้ว — ตรวจสอบก่อนลงขายได้')
          } catch {
            // เงียบๆ ไม่รบกวน user
          }
        })()
      }
    } finally {
      setCompressing(false)
    }
  }

  const selectBook = async (book: any) => {
    setFetchedBook(book)
    setIsbn(book.isbn)
    setSellSearch('')
    setSellResults([])
    const { data: ls } = await supabase.from('listings').select('price').eq('book_id', book.id).eq('status', 'active')
    if (ls?.length) {
      const prices = ls.map((l: any) => l.price)
      setMarketPrice({ min: Math.min(...prices), max: Math.max(...prices), avg: Math.round(prices.reduce((a: number, b: number) => a + b) / prices.length) })
    }
  }

  const resetSearch = () => {
    setSellSearch('')
    setSellResults([])
    setNotFoundMode(null)
    setFetchedBook(null)
    setManualTitle('')
    setManualAuthor('')
    setManualTranslator('')
    setIsbn('')
    setMarketPrice(null)
    setAiExtractedIsbn(null)
  }

  const removePhoto = (index: number) => {
    const preview = photoPreviews[index]
    if (preview) URL.revokeObjectURL(preview)
    setPhotoFiles(prev => prev.filter((_, i) => i !== index))
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index))
  }

  // ถ่ายปก/เลือก gallery → compress → base64 → sessionStorage → /sell/cover
  const handleCoverPick = async (e: React.ChangeEvent<HTMLInputElement>, _src: 'camera' | 'gallery') => {
    const f = e.target.files?.[0]; if (!f) return
    if (!user) { goLogin(); return }
    try {
      const compressed = await compressImage(f)
      const buf = await compressed.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
      }
      sessionStorage.setItem('bm_cover_scan', JSON.stringify({
        data: btoa(bin), mimeType: 'image/jpeg', ts: Date.now(),
      }))
      e.target.value = '' // reset กัน pick เดิมไม่ trigger onChange
      router.push('/sell/cover')
    } catch {
      show('อ่านรูปไม่ได้ ลองใหม่อีกที')
    }
  }

  const submit = async () => {
    if (!user) { goLogin(); return }

    // Guard: บังคับเบอร์โทรก่อน — ต้องเช็คก่อน validation อื่น
    // ใช้ savedPhoneRef กัน stale closure ตอน auto-retry หลัง guard
    const phone = user.phone || savedPhoneRef.current
    if (!phone) {
      setGuardPhoneInput('')
      setPhoneGuardError('')
      setShowPhoneGuard(true)
      return
    }

    if (!fetchedBook?.title && !manualTitle) { show('กรุณาดึงข้อมูลหนังสือก่อน'); return }
    if (photoFiles.length === 0) { show('กรุณาใส่รูปหน้าปก'); return }
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) { show('กรุณาใส่ราคาที่ถูกต้อง'); return }
    // contact: ใช้ค่าที่ auto-fill ไว้ หรือ fallback เป็นเบอร์โทร
    const finalContact = contact.trim() || phone
    if (!finalContact) { show('กรุณาใส่ช่องทางติดต่อ'); return }

    setSubmitting(true)
    show('กำลังบันทึก...')

    try {
      const currentIsbn = (fetchedBook as any)?.isbn || (notFoundMode === 'no_isbn' ? bmIsbn : isbn)
      // Upload รูปทั้งหมดแบบขนาน (รูปแรก = ปกหน้า)
      const ts = Date.now()
      const uploadResults = await Promise.all(
        photoFiles.map(async (file, i) => {
          const path = `covers/${user.id}/${ts}_${i}.jpg`
          const { error } = await supabase.storage
            .from('listing-photos')
            .upload(path, file, { contentType: 'image/jpeg', upsert: false })
          if (error) {
            if (error.message.toLowerCase().includes('bucket')) {
              throw new Error('กรุณาสร้าง bucket "listing-photos" ใน Supabase Storage ก่อน (ดูวิธีด้านล่าง)')
            }
            throw new Error(error.message)
          }
          return supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl
        })
      )
      const photoUrls = uploadResults
      const publicUrl = photoUrls[0]

      // สร้าง listing ผ่าน API (กัน anon key abuse)
      const createRes = await fetch('/api/listings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isbn: currentIsbn,
          title: fetchedBook?.title || manualTitle,
          author: fetchedBook?.author || manualAuthor || '',
          translator: manualTranslator || '',
          cover_url: fetchedBook?.cover_url || '',
          language: fetchedBook?.language || 'th',
          condition: cond,
          price: parseFloat(price),
          price_includes_shipping: shipping === 'free',
          contact: finalContact,
          notes: notes.trim() || null,
          photos: photoUrls,
          existing_book_id: (fetchedBook as any)?.id || null,
          existing_cover_url: fetchedBook?.cover_url || '',
        }),
      })
      const createData = await createRes.json()
      if (!createRes.ok) throw new Error(createData.error || 'สร้าง listing ไม่สำเร็จ')
      const bookId = createData.book_id

      // แจ้งเตือนคนที่ตามหาเล่มนี้ (fire-and-forget ไม่ block UX)
      fetch('/api/notify/wanted-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId, seller_id: user.id, price: parseFloat(price), isbn: currentIsbn }),
      }).catch(() => {})

      setSubmitSuccess(true)
      sessionStorage.setItem(`bm_viewed_${currentIsbn}`, '1')

      // ถ้าเป็นหนังสือใหม่ → แสดง pioneer popup ก่อน redirect
      if (createData.is_new_book) {
        setPioneerBook({
          title: fetchedBook?.title || manualTitle,
          coverUrl: photoPreviews[0] || '',
        })
      } else {
        show('ลงขายเรียบร้อยแล้ว 🎉')
        router.push(`/book/${currentIsbn}`)
      }
      return // ไม่ต้อง setSubmitting(false) — ค้าง loading จน redirect เสร็จ
    } catch (e: any) {
      const msg = e.message || 'เกิดข้อผิดพลาด'
      if (msg.includes('fetch') || msg.includes('network')) {
        show('❌ เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')
      } else {
        show('❌ ' + msg)
      }
      setSubmitSuccess(false)
    }
    setSubmitting(false)
  }

  // Save เบอร์โทรจาก guard modal → reload user → retry submit อัตโนมัติ
  const savePhoneAndContinue = async () => {
    if (!user) return
    const cleaned = guardPhoneInput.replace(/\D/g, '')
    if (!/^0\d{9}$/.test(cleaned)) { setPhoneGuardError('กรุณากรอกเบอร์โทร 10 หลัก ขึ้นต้น 0'); return }
    setSavingPhone(true)
    setPhoneGuardError('')
    try {
      const res = await fetch('/api/user/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, data: { phone: cleaned } }),
      })
      const d = await res.json()
      if (!res.ok) {
        setPhoneGuardError(d.message || 'บันทึกไม่สำเร็จ ลองใหม่')
        return
      }
      savedPhoneRef.current = cleaned
      setContact(cleaned)
      await reloadUser()
      setShowPhoneGuard(false)
      // ลงขายต่อทันที (savedPhoneRef กัน stale closure)
      setTimeout(() => submit(), 150)
    } catch {
      setPhoneGuardError('เกิดข้อผิดพลาด ลองใหม่')
    } finally {
      setSavingPhone(false)
    }
  }

  return (
    <>
      <Nav />
      <Toast msg={msg} />

      {/* Guard: บังคับเบอร์โทรก่อนลงขาย */}
      {showPhoneGuard && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '28px 24px', width: '100%', maxWidth: 380 }}>
            <div style={{ fontSize: 40, marginBottom: 10, textAlign: 'center' }}>📞</div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 19, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
              เพิ่มเบอร์โทรก่อนลงขาย
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.65, marginBottom: 18, textAlign: 'center' }}>
              เพื่อให้ลูกค้าติดต่อซื้อหนังสือจากคุณได้
            </div>

            <input
              type="tel"
              inputMode="numeric"
              value={guardPhoneInput}
              onChange={e => { setGuardPhoneInput(e.target.value); if (phoneGuardError) setPhoneGuardError('') }}
              onKeyDown={e => { if (e.key === 'Enter' && !savingPhone) savePhoneAndContinue() }}
              placeholder="08X-XXX-XXXX"
              autoFocus
              style={{ width: '100%', padding: '12px 14px', border: `1.5px solid ${phoneGuardError ? '#DC2626' : '#E2E8F0'}`, borderRadius: 10, fontFamily: 'Kanit', fontSize: 15, outline: 'none', marginBottom: 6 }}
            />
            <div style={{ fontSize: 13, color: phoneGuardError ? '#DC2626' : '#94A3B8', marginBottom: 16, lineHeight: 1.5 }}>
              {phoneGuardError || 'กรอกเบอร์โทรศัพท์ 10 หลัก'}
            </div>

            <button
              onClick={savePhoneAndContinue}
              disabled={savingPhone || !guardPhoneInput.trim()}
              className="btn"
              style={{ marginBottom: 8, opacity: (savingPhone || !guardPhoneInput.trim()) ? 0.5 : 1 }}
            >
              {savingPhone ? 'กำลังบันทึก...' : 'บันทึกและลงขายต่อ'}
            </button>
            <button
              onClick={() => { setShowPhoneGuard(false); setGuardPhoneInput(''); setPhoneGuardError('') }}
              className="btn btn-ghost"
              disabled={savingPhone}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* Photo picker sheet — เลือกกล้อง/คลังภาพ */}
      {showPhotoPicker && (
        <div
          onClick={() => setShowPhotoPicker(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '20px 20px 24px', width: '100%', maxWidth: 480, margin: '0 auto' }}
          >
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 17, fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>
              เพิ่มรูป
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', textAlign: 'center', marginBottom: 16 }}>
              ถ่ายจากกล้อง หรือเลือกจากคลังภาพ
            </div>

            <button
              type="button"
              onClick={() => { setShowPhotoPicker(false); cameraInputRef.current?.click() }}
              style={{
                width: '100%',
                background: 'var(--primary)',
                border: 'none',
                borderRadius: 12,
                padding: '14px',
                color: 'white',
                fontFamily: 'Kanit',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              📷 ถ่ายรูปด้วยกล้อง
            </button>

            <button
              type="button"
              onClick={() => { setShowPhotoPicker(false); galleryInputRef.current?.click() }}
              style={{
                width: '100%',
                background: 'white',
                border: '1.5px solid var(--border)',
                borderRadius: 12,
                padding: '14px',
                color: 'var(--ink)',
                fontFamily: 'Kanit',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              🖼️ เลือกจากคลังภาพ
            </button>

            <button
              type="button"
              onClick={() => setShowPhotoPicker(false)}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                padding: '12px',
                color: 'var(--ink3)',
                fontFamily: 'Kanit',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* Scanning / Fetching overlay */}
      {(scanning || fetching) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '36px 24px', textAlign: 'center', maxWidth: 300, width: '100%' }}>
            <span className="spin" style={{ width: 32, height: 32, marginBottom: 16 }} />
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 17, fontWeight: 700 }}>กำลังค้นหาหนังสือ...</div>
          </div>
        </div>
      )}

      {/* Pre-capture guide — แสดงก่อนเปิดกล้อง (barcode หรือ cover) */}
      {captureGuide && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: 22, maxWidth: 360, width: '100%' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 14, textAlign: 'center' }}>
              {captureGuide === 'barcode' ? '📷 ถ่ายบาร์โค้ดให้ชัด' : '📖 ถ่ายปกให้ชัด'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
              <div style={{ background: '#dcfce7', border: '2px solid #86efac', borderRadius: 10, padding: 10, textAlign: 'center' }}>
                <div style={{ height: 64, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {captureGuide === 'barcode' ? <BarcodeSvg /> : <BookCoverSvg />}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>✓ แบบนี้ดี</div>
                <div style={{ fontSize: 11, color: '#166534', marginTop: 2, lineHeight: 1.4 }}>
                  {captureGuide === 'barcode' ? 'บาร์โค้ดชัด ตรง เต็มกรอบ' : 'ปกเต็มกรอบ ตรง ชัด'}
                </div>
              </div>
              <div style={{ background: '#fee2e2', border: '2px solid #fca5a5', borderRadius: 10, padding: 10, textAlign: 'center' }}>
                <div style={{ height: 64, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {captureGuide === 'barcode' ? <BarcodeSvg tilted /> : <BookCoverSvg tilted />}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b' }}>✗ แบบนี้ไม่ดี</div>
                <div style={{ fontSize: 11, color: '#991b1b', marginTop: 2, lineHeight: 1.4 }}>เอียง / มืด / เบลอ / ตัดขอบ</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 14, textAlign: 'center' }}>
              💡 ถ่ายตรง ๆ ในที่สว่าง หลีกเลี่ยงแสงสะท้อน
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setCaptureGuide(null)}
                style={{ flex: 1, padding: '12px', borderRadius: 10, background: 'white', border: '1px solid var(--border)', fontFamily: 'Kanit', fontSize: 14, fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer' }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  const mode = captureGuide
                  setCaptureGuide(null)
                  // Mark seen — ครั้งต่อไปข้าม guide ไปเลย
                  if (typeof window !== 'undefined') {
                    localStorage.setItem(`bm_seen_capture_guide_${mode}`, '1')
                  }
                  setTimeout(() => {
                    if (mode === 'barcode') {
                      if (isLineIAB) setShowCamera(true)
                      else scanInputRef.current?.click()
                    } else {
                      coverCaptureRef.current?.click()
                    }
                  }, 100)
                }}
                style={{ flex: 2, padding: '12px', borderRadius: 10, background: 'var(--primary)', border: 'none', fontFamily: 'Kanit', fontSize: 14, fontWeight: 700, color: 'white', cursor: 'pointer' }}
              >
                เริ่มถ่าย →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pioneer popup — แสดงเมื่อเพิ่มหนังสือใหม่เข้าระบบ */}
      {pioneerBook && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 20, padding: '32px 24px', maxWidth: 340, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🏆</div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, color: '#92400E', marginBottom: 10 }}>
              คุณคือผู้บุกเบิก!
            </div>

            {pioneerBook.coverUrl && (
              <div style={{ width: 80, height: 110, margin: '0 auto 12px', borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}>
                <img src={pioneerBook.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}

            <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.7, marginBottom: 6 }}>
              <b>"{pioneerBook.title}"</b>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.7, marginBottom: 16 }}>
              ถูกเพิ่มเข้า BookMatch เป็นครั้งแรกโดยคุณ
            </div>

            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 18, fontSize: 13, color: '#92400E', lineHeight: 1.6, textAlign: 'left' }}>
              &bull; ประกาศของคุณจะติดป้าย 🏆 ผู้บุกเบิก<br/>
              &bull; listing ขึ้นอันดับแรกของเล่มนี้<br/>
              &bull; รูปที่อัปโหลดจะเป็นปกประจำเล่ม
            </div>

            <button className="btn" onClick={() => {
              setPioneerBook(null)
              const currentIsbn = (fetchedBook as any)?.isbn || (notFoundMode === 'no_isbn' ? bmIsbn : isbn)
              router.push(`/book/${currentIsbn}`)
            }}>
              ดูหนังสือของฉัน
            </button>
          </div>
        </div>
      )}

      {/* Submitting overlay — ระหว่างกำลังอัปโหลด + บันทึก */}
      {submitting && !submitSuccess && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '36px 24px', textAlign: 'center', maxWidth: 320, width: '100%' }}>
            <span className="spin" style={{ width: 32, height: 32, marginBottom: 16 }} />
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 6 }}>กำลังลงขาย...</div>
            <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.6 }}>อัปโหลดรูปและบันทึกข้อมูล<br />กรุณารอสักครู่</div>
          </div>
        </div>
      )}

      {/* Success overlay — แสดงทันทีหลังลงขายสำเร็จ */}
      {submitSuccess && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.7)', zIndex: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '36px 24px', textAlign: 'center', maxWidth: 320, width: '100%' }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>🎉</div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>ลงขายสำเร็จ!</div>
            <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.6 }}>กำลังไปที่หน้าหนังสือ...</div>
            <span className="spin" style={{ width: 20, height: 20, marginTop: 16 }} />
          </div>
        </div>
      )}

      <div className="page">
        <div style={{ padding: '16px 16px 80px' }}>
          <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, marginBottom: 16 }}>ลงขายหนังสือ</div>

          {authLoading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>
              <span className="spin" style={{ width: 28, height: 28 }} />
            </div>
          ) : !user ? (
            <div style={{ background: 'var(--surface)', border: '2px dashed #BFDBFE', borderRadius: 14, padding: '36px 20px', textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>เข้าสู่ระบบก่อนลงขาย</div>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 20 }}>เพื่อให้ผู้ซื้อติดต่อคุณได้</div>
              <MultiLoginButton />
            </div>
          ) : (
            <>
              {scanError && (
                <ScanErrorSheet
                  onRetry={() => { setScanError(false); scanInputRef.current?.click() }}
                  onClose={() => setScanError(false)}
                />
              )}

              {/* ── แบ่ง 2 ส่วน: มี Barcode / ไม่มี Barcode ── */}
              {!fetchedBook && !notFoundMode && (
                <>
                  {/* ส่วนบน: มี Barcode → สแกนเลย */}
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)', marginBottom: 8, textAlign: 'center' }}>
                    ✓ แนะนำ — เร็วและแม่นที่สุด
                  </div>
                  {/* Primary: Barcode — big blue card */}
                  <input ref={scanInputRef} type="file" accept="image/*" capture={capture} onChange={scanFromPhoto} style={{ display: 'none' }} disabled={scanning} />
                  <button
                    type="button"
                    onClick={() => {
                      if (!user) { goLogin(); return }
                      // Show guide only if not seen before
                      const key = 'bm_seen_capture_guide_barcode'
                      if (typeof window !== 'undefined' && localStorage.getItem(key)) {
                        if (isLineIAB) setShowCamera(true)
                        else scanInputRef.current?.click()
                      } else {
                        setCaptureGuide('barcode')
                      }
                    }}
                    disabled={scanning}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      width: '100%', background: 'var(--primary)', border: 'none', borderRadius: 16,
                      padding: '28px 16px', cursor: 'pointer', fontFamily: 'Kanit',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: 12,
                    }}
                  >
                    <div style={{ fontSize: 44, marginBottom: 10 }}>📷</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'white', marginBottom: 4 }}>สแกนบาร์โค้ด ISBN</div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>เร็วที่สุด · ใช้ได้กับหนังสือที่มีบาร์โค้ด</div>
                  </button>

                  {showCamera && (
                    <CameraCaptureModal
                      onCapture={(file) => { setShowCamera(false); processScanPhoto(file) }}
                      onClose={() => setShowCamera(false)}
                    />
                  )}

                  {/* เส้นแบ่ง */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 12px' }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <span style={{ fontSize: 13, color: 'var(--ink3)', fontWeight: 600 }}>หรือ</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>

                  {/* Secondary: Cover scan — downrank visually (less prominent than barcode) */}
                  <input
                    ref={coverCaptureRef} type="file" accept="image/*" capture="environment"
                    style={{ display: 'none' }}
                    onChange={e => handleCoverPick(e, 'camera')}
                  />
                  <input
                    ref={coverGalleryRef} type="file" accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => handleCoverPick(e, 'gallery')}
                  />
                  <div style={{
                    background: 'white', border: '1.5px solid var(--border)', borderRadius: 14,
                    padding: 18, position: 'relative',
                  }}>
                    <span style={{ position: 'absolute', top: 12, right: 12, background: 'var(--accent)', color: 'var(--ink)', fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999 }}>
                      🆕 ใหม่
                    </span>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink2)', marginBottom: 4 }}>
                      📖 ไม่มี barcode?
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 14 }}>
                      ใช้ตัวเลือกนี้เฉพาะหนังสือเก่า/หนังสือหายาก AI จะช่วยอ่านปกให้
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!user) { goLogin(); return }
                          const key = 'bm_seen_capture_guide_cover'
                          if (typeof window !== 'undefined' && localStorage.getItem(key)) {
                            coverCaptureRef.current?.click()
                          } else {
                            setCaptureGuide('cover')
                          }
                        }}
                        style={{
                          width: '100%', padding: '12px 16px', borderRadius: 10,
                          background: 'var(--primary-light)', border: '1.5px solid var(--primary)',
                          fontFamily: 'Kanit', fontSize: 14, fontWeight: 700, color: 'var(--primary-strong)',
                          cursor: 'pointer',
                        }}
                      >
                        📷 ถ่ายหน้าปก
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (!user) { goLogin(); return }; coverGalleryRef.current?.click() }}
                        style={{
                          width: '100%', padding: '12px 16px', borderRadius: 10,
                          background: 'white', border: '1px solid var(--border)',
                          fontFamily: 'Kanit', fontSize: 14, fontWeight: 600, color: 'var(--ink2)',
                          cursor: 'pointer',
                        }}
                      >
                        🖼️ เลือกจากคลังรูป
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* ── มี Barcode แต่ไม่อยู่ในระบบ ── */}
              {notFoundMode === 'has_isbn' && !fetchedBook && (
                <>
                  <div style={{ background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 12, padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>🔖</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#713F12' }}>สแกนได้ ISBN แต่ยังไม่มีในระบบ</div>
                      {isbn && <div style={{ fontSize: 13, color: '#92400E', marginTop: 2 }}>ISBN: {isbn}</div>}
                    </div>
                    <button onClick={resetSearch} style={{ background: 'none', border: 'none', fontSize: 13, color: '#92400E', cursor: 'pointer', fontFamily: 'Kanit', flexShrink: 0 }}>← กลับ</button>
                  </div>
                  {/* AI hint: เมื่อ user อัปรูปปก จะดึง title/author ให้อัตโนมัติ */}
                  {process.env.NEXT_PUBLIC_ENABLE_COVER_SCAN === '1' && !manualTitle && (
                    <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#1E40AF', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>✨</span>
                      <span>อัปรูปปกแล้วจะอ่านชื่อ/ผู้แต่งให้อัตโนมัติ — แก้ไขได้ทีหลัง</span>
                    </div>
                  )}
                  <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 14, color: '#1E40AF', lineHeight: 1.7 }}>
                      หนังสือบางเล่มอาจเป็นสำนักพิมพ์อิสระ, หนังสือเก่า, หรือไม่ได้ขึ้นทะเบียน ISBN — กรอกข้อมูลด้านล่างเพื่อเพิ่มเข้าระบบได้เลย 🙏
                    </div>
                  </div>
                  <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                    <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>กรอกข้อมูลหนังสือ</div>
                    <div className="form-group">
                      <label className="label">ISBN</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input className="input" value={isbn} onChange={e => setIsbn(e.target.value)} placeholder="เช่น 9784088703251" style={{ flex: 1 }} />
                        {isLineIAB ? (
                          <button onClick={() => setShowCamera(true)} disabled={scanning}
                            style={{ padding: '8px 14px', background: 'var(--primary-light)', border: '1.5px solid var(--primary)', borderRadius: 10, fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, color: 'var(--primary)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            📷
                          </button>
                        ) : (
                          <label style={{ padding: '8px 14px', background: 'var(--primary-light)', border: '1.5px solid var(--primary)', borderRadius: 10, fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, color: 'var(--primary)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                            <input type="file" accept="image/*" capture={capture} onChange={scanFromPhoto} style={{ display: 'none' }} />
                            📷
                          </label>
                        )}
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="label">ชื่อหนังสือ <span style={{ color: 'var(--red)' }}>*</span></label>
                      <input className="input" value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="เช่น แฮร์รี่ พอตเตอร์ กับศิลาอาถรรพ์" autoFocus />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="label">ผู้แต่ง <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span></label>
                      <input className="input" value={manualAuthor} onChange={e => setManualAuthor(e.target.value)} placeholder="เช่น J.K. Rowling" />
                    </div>
                  </div>
                </>
              )}

              {/* ── ไม่มี Barcode / หนังสือชุด ── */}
              {notFoundMode === 'no_isbn' && !fetchedBook && (
                <>
                  <button onClick={resetSearch} style={{ background: 'none', border: 'none', fontSize: 14, color: 'var(--primary)', cursor: 'pointer', fontFamily: 'Kanit', fontWeight: 600, padding: 0, marginBottom: 12 }}>← กลับ</button>
                  {/* AI hint: เมื่อ user อัปรูปปก AI จะอ่านเติมช่องว่างให้ (ไม่ทับที่พิมพ์) */}
                  {process.env.NEXT_PUBLIC_ENABLE_COVER_SCAN === '1' && (
                    <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#1E40AF', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>✨</span>
                      <span>อัปรูปปกแล้วจะช่วยเติมช่องที่ว่างให้อัตโนมัติ</span>
                    </div>
                  )}
                  <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                    <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>เพิ่มหนังสือด้วยตัวเอง</div>
                    <div className="form-group">
                      <label className="label">ชื่อหนังสือ <span style={{ color: 'var(--red)' }}>*</span></label>
                      <input className="input" value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="เช่น สี่แผ่นดิน / Naruto เล่ม 1 / ชุด Harry Potter" autoFocus />
                    </div>
                    <div className="form-group">
                      <label className="label">ผู้แต่ง <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span></label>
                      <input className="input" value={manualAuthor} onChange={e => setManualAuthor(e.target.value)} placeholder="ผู้แต่ง หรือ ผู้แปล" />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="label">ผู้แปล <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span></label>
                      <input className="input" value={manualTranslator} onChange={e => setManualTranslator(e.target.value)} placeholder="ชื่อผู้แปล" />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {fetchedBook?.title && (
            <div style={{ background: 'var(--green-bg)', border: '1px solid #BBF7D0', borderLeft: '4px solid var(--green)', borderRadius: 14, padding: 14, display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
              <BookCover isbn={(fetchedBook as any).isbn || isbn} coverUrl={fetchedBook.cover_url} title={fetchedBook.title} size={68} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, color: '#121212', letterSpacing: '-0.01em', marginBottom: 4 }}>{fetchedBook.title}</div>
                {fetchedBook.author && (
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginBottom: 2 }}>
                    <span style={{ color: 'var(--ink3)' }}>ผู้เขียน </span>{fetchedBook.author}
                  </div>
                )}
                {(fetchedBook as any).translator && (
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginBottom: 2 }}>
                    <span style={{ color: 'var(--ink3)' }}>แปลโดย </span>{(fetchedBook as any).translator}
                  </div>
                )}
                <span style={{ fontSize: 13, background: '#E8F5E9', color: '#2E7D32', padding: '4px 10px', borderRadius: 9999, fontWeight: 700, display: 'inline-block', marginTop: 8, letterSpacing: '0.02em' }}>✓ ดึงข้อมูลสำเร็จ</span>
              </div>
              <button onClick={resetSearch} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', minHeight: 36, fontSize: 13, fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'Kanit', flexShrink: 0 }}>เปลี่ยน</button>
            </div>
          )}

          {(fetchedBook?.title || (notFoundMode && manualTitle)) && (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                กรอกข้อมูลหนังสือที่คุณจะขาย
              </div>
              <div className="form-group">
                <label className="label">
                  รูปสินค้า <span style={{ color: 'var(--red)' }}>*</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink3)', marginLeft: 8 }}>
                    ({photoFiles.length}/{MAX_PHOTOS})
                  </span>
                </label>

                {/* กล้อง — ถ่ายทีละรูป (capture=environment เรียกกล้องหลัง) */}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={cameraInputRef}
                  onChange={handleAddPhotos}
                  style={{ display: 'none' }}
                />
                {/* คลังภาพ — เลือกหลายรูปพร้อมกันได้ */}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  ref={galleryInputRef}
                  onChange={handleAddPhotos}
                  style={{ display: 'none' }}
                />

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {/* รูปที่เลือกแล้ว */}
                  {photoPreviews.map((preview, i) => (
                    <div key={i} style={{ position: 'relative', width: 96, height: 144, borderRadius: 10, overflow: 'hidden', background: 'var(--surface)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                      <img src={preview} alt={`รูป ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {i === 0 && (
                        <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--primary)', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
                          ปกหน้า
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,.65)', border: 'none', borderRadius: '50%', width: 22, height: 22, color: 'white', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  {/* ปุ่มเพิ่มรูป → เปิด sheet เลือกกล้อง/คลัง */}
                  {photoFiles.length < MAX_PHOTOS && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!user) { goLogin(); return }
                        setShowPhotoPicker(true)
                      }}
                      disabled={compressing}
                      style={{
                        width: 96, height: 144,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                        background: photoFiles.length === 0 ? 'var(--primary-light)' : 'var(--surface)',
                        border: photoFiles.length === 0 ? '1.5px dashed var(--primary)' : '1.5px dashed var(--border)',
                        borderRadius: 10, cursor: compressing ? 'wait' : 'pointer',
                        fontSize: 13, fontWeight: 600,
                        color: photoFiles.length === 0 ? 'var(--primary)' : 'var(--ink2)',
                        fontFamily: 'Kanit',
                        opacity: compressing ? 0.5 : 1,
                      }}
                    >
                      {compressing ? (
                        <>
                          <span className="spin" style={{ width: 20, height: 20 }} />
                          <span style={{ fontSize: 12 }}>ย่อรูป...</span>
                        </>
                      ) : photoFiles.length === 0 ? (
                        <>
                          <span style={{ fontSize: 28 }}>📷</span>
                          <span>ใส่รูปปก</span>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 28, lineHeight: 1 }}>+</span>
                          <span style={{ fontSize: 12, lineHeight: 1.3, textAlign: 'center', padding: '0 4px' }}>เพิ่มรูป</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {photoFiles.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--red)', lineHeight: 1.6, marginTop: 8 }}>
                    ⚠ กรุณาใส่รูปหน้าปก แนะนำถ่ายแนวตั้งให้เห็นทั้งเล่ม
                  </div>
                ) : photoFiles.length < MAX_PHOTOS && (
                  <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.6, marginTop: 8 }}>
                    💡 เพิ่มรูปสันปก / ตำหนิ / ปกหลัง ช่วยให้ขายได้เร็วขึ้น
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="label">สภาพหนังสือ</label>
                <div style={{ display: 'flex', gap: 7 }}>
                  {CONDITIONS.map(c => (
                    <button key={c.key} onClick={() => setCond(c.key)} style={{ flex: 1, padding: '10px 6px', border: `1.5px solid ${cond === c.key ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 10, background: cond === c.key ? 'var(--primary-light)' : 'white', fontFamily: 'Kanit', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: cond === c.key ? 'var(--primary-dark)' : 'var(--ink2)' }}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 6 }}>
                  {CONDITIONS.find(c => c.key === cond)?.desc}
                </div>
              </div>

              <div className="form-group">
                <label className="label">หมายเหตุเพิ่มเติม <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span></label>
                <textarea
                  className="input"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="เช่น มีรอยขีดดินสอบางหน้า / ปกมีรอยพับ / หน้า 45 มีรอยน้ำเล็กน้อย"
                  rows={2}
                  style={{ resize: 'none', lineHeight: 1.6 }}
                />
              </div>

              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 13 }}>
                {marketPrice && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 13, color: 'var(--ink3)' }}>ราคากลางในระบบ</div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>฿{marketPrice.min}–฿{marketPrice.max}</div>
                      <div style={{ fontSize: 13, color: 'var(--ink3)' }}>แนะนำ ฿{marketPrice.avg}</div>
                    </div>
                  </div>
                )}
                <label className="label">ราคาขาย (บาท)</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink3)' }}>฿</span>
                  <input className="input" type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="150" />
                </div>
              </div>

              <div className="form-group">
                <label className="label">ค่าส่ง</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { val: 'buyer', label: 'ไม่รวมค่าส่ง' },
                    { val: 'free', label: 'ส่งฟรี' },
                  ].map(opt => (
                    <button key={opt.val} type="button" onClick={() => setShipping(opt.val)}
                      style={{ flex: 1, padding: '10px 8px', border: `1.5px solid ${shipping === opt.val ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 10, background: shipping === opt.val ? 'var(--primary-light)' : 'white', fontFamily: 'Kanit', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: shipping === opt.val ? 'var(--primary-dark)' : 'var(--ink2)' }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ช่องทางติดต่อ — แสดงทั้งเบอร์ + LINE ถ้ามี */}
              {(user?.phone || user?.line_id) && (
                <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', marginBottom: 13 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>ช่องทางติดต่อ</div>
                  {user?.phone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: user?.line_id ? 6 : 0 }}>
                      <span style={{ fontSize: 14 }}>📞</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{user.phone.length === 10 ? `${user.phone.slice(0,3)}-${user.phone.slice(3,6)}-${user.phone.slice(6)}` : user.phone}</span>
                      {user?.phone_verified_at && <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>ยืนยันแล้ว</span>}
                    </div>
                  )}
                  {user?.line_id && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>💚</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{user.line_id}</span>
                    </div>
                  )}
                </div>
              )}

              <button className="btn" onClick={submit} disabled={submitting} style={{ marginTop: 8 }}>
                {submitting ? <><span className="spin" />กำลังบันทึก...</> : 'ลงประกาศขาย 🎉'}
              </button>
            </>
          )}
        </div>
      </div>
      <BottomNav />
    </>
  )
}
