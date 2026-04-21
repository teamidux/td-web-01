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

// Note templates — auto-fill ใน "หมายเหตุ" ตาม condition (sync กับ /sell/cover)
const NOTE_TEMPLATES: Record<string, string> = {
  brand_new: 'หนังสือมือหนึ่งจากร้าน/สำนักพิมพ์ ยังไม่แกะ/ไม่ผ่านการใช้งาน',
  new: 'หนังสือสภาพใหม่มาก อ่านน้อยหรือไม่ได้อ่าน ไม่มีตำหนิ',
  good: 'มีรอยตามการใช้งานเล็กน้อย เนื้อหาครบถ้วน อ่านได้ปกติ',
  fair: 'มีรอยชัดเจนตามการใช้งาน (รายละเอียดตามภาพ) แต่เนื้อหาครบถ้วน',
}

import { compressBookPhoto as compressImage } from '@/lib/image'

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
  // has_isbn: แสดง inline form แก้ไข title/author (เปิดเฉพาะตอน user กด "แก้ไข")
  const [editingBookInfo, setEditingBookInfo] = useState(false)
  // Snapshot ค่าก่อนเปิด edit — กด ยกเลิก แล้วย้อนได้
  const editSnapshotRef = useRef<{ title: string; author: string } | null>(null)
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
  // track ว่า notes ถูก user แก้หรือยัง — ถ้ายัง → auto-fill เมื่อเปลี่ยน condition
  const [notesAutoFilled, setNotesAutoFilled] = useState(true)
  const [bmIsbn] = useState(() => 'BM-' + Math.random().toString(36).toUpperCase().slice(2, 7))
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [compressing, setCompressing] = useState(false)
  // AI cover extract (has_isbn mode): flag กันยิงซ้ำต่อ session เดียวกัน
  const [aiExtractedIsbn, setAiExtractedIsbn] = useState<string | null>(null)
  // AI status — แสดง card state ต่างกันตามสถานะ
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle')
  // Retake count — หลังถ่ายซ้ำ 3 ครั้งไม่สำเร็จ → โผล่ escape hatch ให้พิมพ์เอง
  const [retakeCount, setRetakeCount] = useState(0)
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
      // ISBN สแกนได้ แต่ไม่อยู่ใน DB → ใช้ has_isbn mode ใน /sell เดิม
      // มี AI auto-extract เมื่อ user อัพรูปปก → เติม title/author ให้อัตโนมัติ (silent)
      // user อยู่หน้าเดียว ไม่ redirect ไปไหน — flow ต่อเนื่อง
      setNotFoundMode('has_isbn')
      setSellSearch('')
    }
    setFetching(false)
  }

  const processScanPhoto = async (rawFile: File) => {
    setScanning(true)
    // force paint overlay ก่อนเริ่ม heavy scan (กัน perceived hang 5-7s)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
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
    } catch (err) {
      // กัน unhandled error ที่ทำให้ overlay ค้าง (user ต้อง reload page)
      console.error('[scan] error:', err)
      setScanError(true)
    } finally {
      setScanning(false)
    }
  }

  const scanFromPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) { goLogin(); return }
    const rawFile = e.target.files?.[0]
    // reset value ก่อน — กัน iOS bug: pick ไฟล์เดิม 2 ครั้ง onChange ไม่ fire
    e.target.value = ''
    if (!rawFile) return
    processScanPhoto(rawFile)
  }

  // ถ่ายปกใหม่ — ลบรูปแรก + reset AI state + เปิดกล้อง
  const retakeCover = () => {
    if (photoFiles.length > 0 && photoPreviews[0]) {
      URL.revokeObjectURL(photoPreviews[0])
      setPhotoFiles(prev => prev.slice(1))
      setPhotoPreviews(prev => prev.slice(1))
    }
    setAiStatus('idle')
    setAiExtractedIsbn(null)
    setRetakeCount(c => c + 1)
    cameraInputRef.current?.click()
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
        setAiStatus('running')
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
            if (!parsed || !parsed.title) {
              setAiStatus('failed')
              return
            }
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
            if (filled) {
              setAiStatus('success')
              show('✨ อ่านข้อมูลจากปกให้แล้ว — ตรวจสอบก่อนลงขายได้')
            } else {
              setAiStatus('failed')
            }
          } catch {
            setAiStatus('failed')
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
    setEditingBookInfo(false)
    setAiStatus('idle')
    setRetakeCount(0)
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
    // แสดง loading ทันที — compressImage บนมือถือใช้เวลา 1-2s
    // ต้องรอ double RAF เพื่อบังคับให้ browser paint overlay ก่อนจะรัน heavy work
    // (ถ้าไม่ยิ่ง React batch render + compress block main thread = user รู้สึกค้าง 5-7s)
    setCompressing(true)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    // reset input value ทันที กัน onChange ไม่ fire ถ้า user pick ไฟล์เดิม (iOS bug)
    e.target.value = ''
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
      router.push('/sell/cover')
    } catch {
      setCompressing(false)
      show('อ่านรูปไม่ได้ ลองใหม่อีกที')
    }
    // ไม่ setCompressing(false) ตอน success — ปล่อยให้ navigation เกิดขึ้นก่อน
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

    if (!fetchedBook?.title && !manualTitle) {
      // has_isbn mode: title ว่าง → เปิด edit form ให้ user กรอก + prompt
      if (notFoundMode === 'has_isbn') {
        setEditingBookInfo(true)
        show('กรุณาใส่ชื่อหนังสือ')
      } else {
        show('กรุณาดึงข้อมูลหนังสือก่อน')
      }
      return
    }
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
      if (!createRes.ok) throw new Error(createData.message || createData.error || 'สร้าง listing ไม่สำเร็จ')
      const bookId = createData.book_id

      // แจ้งเตือนคนที่ตามหาเล่มนี้ (fire-and-forget ไม่ block UX)
      fetch('/api/notify/wanted-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId, seller_id: user.id, price: parseFloat(price), isbn: currentIsbn }),
      }).catch(e => console.warn('[sell] notify-match failed:', e))

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

      {/* Cover scan compress overlay — แสดงทันทีตอน user ถ่ายปก (กันรู้สึกค้าง 1-2s) */}
      {compressing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.85)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <span className="spin" style={{ width: 36, height: 36, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: 'white' }} />
          <div style={{ color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'Kanit' }}>กำลังเตรียมรูป...</div>
        </div>
      )}

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
        <div style={{ padding: '12px 16px 80px' }}>
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

              {/* ── Entry: BookmatchSellEntry design (2 big cards + tip) ── */}
              {!fetchedBook && !notFoundMode && (
                <>
                  <input ref={scanInputRef} type="file" accept="image/*" capture={capture} onChange={scanFromPhoto} style={{ display: 'none' }} disabled={scanning} />
                  <input
                    ref={coverCaptureRef} type="file" accept="image/*" capture="environment"
                    style={{ display: 'none' }}
                    onChange={e => handleCoverPick(e, 'camera')}
                  />
                  {showCamera && (
                    <CameraCaptureModal
                      onCapture={(file) => { setShowCamera(false); processScanPhoto(file) }}
                      onClose={() => setShowCamera(false)}
                    />
                  )}

                  {/* Hero compact — fit-on-screen */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                      เริ่มลงขายเล่มใหม่
                    </div>
                    <div style={{ fontSize: 13, color: '#64748B', marginTop: 4, lineHeight: 1.5 }}>
                      เลือกวิธีที่เหมาะ · ระบบกรอกให้อัตโนมัติ
                    </div>
                  </div>

                  {/* Option 1 — Barcode (blue illustration + แนะนำ pill) */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!user) { goLogin(); return }
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
                      width: '100%', padding: 14, border: 'none', cursor: scanning ? 'wait' : 'pointer',
                      background: 'white', borderRadius: 18, textAlign: 'left', display: 'block',
                      boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)',
                      marginBottom: 10, position: 'relative', overflow: 'hidden',
                      fontFamily: 'Kanit',
                    }}
                  >
                    <div style={{ position: 'absolute', top: 10, right: 10, padding: '3px 8px', borderRadius: 999, background: '#0F172A', fontSize: 10, fontWeight: 600, color: 'white', letterSpacing: 0.3, zIndex: 2 }}>
                      แนะนำ
                    </div>

                    {/* Blue illustration area with barcode card */}
                    <div style={{ height: 88, borderRadius: 12, marginBottom: 10, background: 'linear-gradient(135deg, var(--primary) 0%, #1D4ED8 100%)', position: 'relative', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                      <div style={{ position: 'absolute', top: -40, right: -30, width: 140, height: 140, borderRadius: 999, background: 'rgba(255,255,255,0.09)' }} />
                      <div style={{ position: 'absolute', bottom: -50, left: -20, width: 120, height: 120, borderRadius: 999, background: 'rgba(255,255,255,0.07)' }} />
                      <div style={{ width: 124, height: 60, borderRadius: 8, background: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, boxShadow: '0 10px 24px rgba(0,0,0,0.22)', position: 'relative', zIndex: 1 }}>
                        <svg width="90" height="28" viewBox="0 0 110 36">
                          {[3,7,11,14,18,22,25,30,34,38,43,47,51,56,60,64,69,73,77,82,86,90,95,99,103].map((x, i) => {
                            const w = [1.2, 2.4, 1, 2, 1.4, 2.6, 1, 1.8, 2.2, 1, 2, 1.4, 2.4, 1.2, 1, 2.6, 1.4, 2, 1, 1.8, 2.4, 1.2, 2, 1, 1.6][i]
                            return <rect key={i} x={x} y="0" width={w} height="36" fill="#0F172A" />
                          })}
                        </svg>
                        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 8, color: '#0F172A', letterSpacing: 1.5 }}>
                          9 786165 987654
                        </div>
                        <div style={{ position: 'absolute', left: 8, right: 8, top: '50%', height: 2, background: '#EF4444', boxShadow: '0 0 8px rgba(239,68,68,0.6)', borderRadius: 2 }} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em', lineHeight: 1.25 }}>
                          สแกนบาร์โค้ด
                        </div>
                        <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, lineHeight: 1.4 }}>
                          เร็วที่สุด · ได้ข้อมูลครบ
                        </div>
                      </div>
                      <div style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                      </div>
                    </div>
                  </button>

                  {/* Option 2 — Cover photo (yellow illustration + 2 books stack) */}
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
                      width: '100%', padding: 14, border: 'none', cursor: 'pointer',
                      background: 'white', borderRadius: 18, textAlign: 'left', display: 'block',
                      boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)',
                      position: 'relative', overflow: 'hidden', fontFamily: 'Kanit',
                    }}
                  >
                    <div style={{ height: 88, borderRadius: 12, marginBottom: 10, background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)', position: 'relative', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                      <div style={{ position: 'absolute', top: -40, right: -30, width: 140, height: 140, borderRadius: 999, background: 'rgba(255,255,255,0.35)' }} />
                      <div style={{ position: 'absolute', bottom: -50, left: -20, width: 120, height: 120, borderRadius: 999, background: 'rgba(180,83,9,0.08)' }} />
                      <div style={{ position: 'relative', width: 80, height: 68 }}>
                        <div style={{ position: 'absolute', top: 0, left: 6, width: 46, height: 62, borderRadius: 3, background: '#DC2626', transform: 'rotate(-8deg)', boxShadow: '0 6px 14px rgba(0,0,0,0.18)' }}>
                          <div style={{ height: 10, background: 'rgba(255,255,255,0.35)', margin: '10px 5px 0' }} />
                          <div style={{ height: 3, background: 'rgba(255,255,255,0.55)', margin: '5px 8px 0' }} />
                          <div style={{ height: 3, background: 'rgba(255,255,255,0.55)', margin: '3px 11px 0' }} />
                        </div>
                        <div style={{ position: 'absolute', top: 2, left: 30, width: 46, height: 62, borderRadius: 3, background: '#0F172A', transform: 'rotate(6deg)', boxShadow: '0 8px 18px rgba(0,0,0,0.25)', padding: '9px 6px' }}>
                          <div style={{ height: 3, background: '#FBBF24', width: '50%', marginBottom: 8 }} />
                          <div style={{ height: 4, background: 'white', marginBottom: 3 }} />
                          <div style={{ height: 4, background: 'white', width: '80%', marginBottom: 10 }} />
                          <div style={{ height: 2.5, background: 'rgba(255,255,255,0.5)', width: '60%' }} />
                          <div style={{ height: 2.5, background: 'rgba(255,255,255,0.5)', width: '40%', marginTop: 3 }} />
                        </div>
                        <div style={{ position: 'absolute', top: -6, right: -8, width: 82, height: 92, pointerEvents: 'none' }}>
                          {([[0,0,'tl'],[1,0,'tr'],[0,1,'bl'],[1,1,'br']] as const).map(([x,y,k]) => (
                            <div key={k} style={{
                              position: 'absolute',
                              ...(x === 0 ? { left: 0 } : { right: 0 }),
                              ...(y === 0 ? { top: 0 } : { bottom: 0 }),
                              width: 14, height: 14,
                              borderTop: y === 0 ? '2.5px solid #0F172A' : 'none',
                              borderBottom: y === 1 ? '2.5px solid #0F172A' : 'none',
                              borderLeft: x === 0 ? '2.5px solid #0F172A' : 'none',
                              borderRight: x === 1 ? '2.5px solid #0F172A' : 'none',
                              borderRadius: 2,
                            }} />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em', lineHeight: 1.25 }}>
                          ถ่ายหน้าปก
                        </div>
                        <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, lineHeight: 1.4 }}>
                          หนังสือที่ไม่มีบาร์โค้ด · อ่านชื่อ-ผู้แต่งให้
                        </div>
                      </div>
                      <div style={{ width: 30, height: 30, borderRadius: 999, background: '#0F172A', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                      </div>
                    </div>
                  </button>

                  {/* Tip footer compact */}
                  <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 10, textAlign: 'center', lineHeight: 1.4 }}>
                    💡 ถ่ายให้ชัด ไม่เบลอ ไม่สะท้อนแสง
                  </div>
                </>
              )}

              {/* ── มี Barcode แต่ไม่อยู่ในระบบ ── */}
              {/* has_isbn: ไม่มี block form custom — ใช้ green card pattern เหมือน fetchedBook (render ด้านล่าง) */}

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

          {/* has_isbn: 3 states — empty (ยังไม่มีรูป) / success (AI ดึงได้) / failed (AI อ่านไม่ออก) */}
          {notFoundMode === 'has_isbn' && !fetchedBook && !editingBookInfo && aiStatus !== 'failed' && (
            manualTitle ? (
              // State 2: AI success — green card (confirmed) + ปุ่มแก้เล็กๆ
              <div style={{ background: 'var(--green-bg)', border: '1px solid #BBF7D0', borderLeft: '4px solid var(--green)', borderRadius: 14, padding: 14, display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
                <BookCover isbn={isbn} coverUrl={photoPreviews[0] || null} title={manualTitle} size={68} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, color: '#121212', letterSpacing: '-0.01em', marginBottom: 4 }}>{manualTitle}</div>
                  {manualAuthor && (
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginBottom: 2 }}>
                      <span style={{ color: 'var(--ink3)' }}>ผู้เขียน </span>{manualAuthor}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>ISBN: {isbn}</div>
                  <span style={{ fontSize: 13, background: '#E8F5E9', color: '#2E7D32', padding: '4px 10px', borderRadius: 9999, fontWeight: 700, display: 'inline-block', marginTop: 8, letterSpacing: '0.02em' }}>✓ ดึงข้อมูลสำเร็จ</span>
                </div>
                <button
                  onClick={() => setEditingBookInfo(true)}
                  title="แก้ไข" aria-label="แก้ไข"
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', minHeight: 32, fontSize: 14, color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'Kanit', flexShrink: 0 }}
                >
                  ✏️
                </button>
              </div>
            ) : (
              // State 1: empty — neutral card (ไม่เขียว เพราะยังไม่สมบูรณ์)
              <div style={{ background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', gap: 14, marginBottom: 16, alignItems: 'center' }}>
                <BookCover isbn={isbn} coverUrl={null} title="" size={68} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 700, marginBottom: 4 }}>
                    ✓ สแกน ISBN แล้ว
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 8 }}>
                    {isbn}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink2)', fontWeight: 500 }}>
                    ถ่ายรูปปกได้เลย
                  </div>
                </div>
              </div>
            )
          )}

          {/* State 3: AI failed — "อ่านไม่ชัด ถ่ายใหม่" (ไม่มีให้พิมพ์เอง จนกว่าจะถ่ายซ้ำ 3 ครั้ง) */}
          {notFoundMode === 'has_isbn' && !fetchedBook && !editingBookInfo && aiStatus === 'failed' && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderLeft: '4px solid #F59E0B', borderRadius: 14, padding: 14, display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
              <BookCover isbn={isbn} coverUrl={photoPreviews[0] || null} title="" size={68} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>⚠️ อ่านปกไม่ชัด</div>
                <div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.5, marginBottom: 10 }}>
                  {retakeCount === 0 && 'ลองถ่ายใหม่หามุมที่ชัดกว่านะ'}
                  {retakeCount === 1 && 'ลองอีกครั้ง — ถ่ายในที่สว่างพอ ไม่เอียง'}
                  {retakeCount >= 2 && 'ถ้าถ่ายยังไม่ได้ ลองเข้าใกล้ปกหรือปิดแสงสะท้อน'}
                </div>
                <div style={{ fontSize: 11, color: '#B45309' }}>ISBN: {isbn}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={retakeCover}
                    style={{ padding: '8px 14px', background: 'var(--primary)', border: 0, borderRadius: 10, fontFamily: 'Kanit', fontSize: 14, fontWeight: 700, color: 'white', cursor: 'pointer', minHeight: 40 }}
                  >
                    📷 ถ่ายใหม่
                  </button>
                  {/* Escape hatch: หลังถ่ายซ้ำ ≥3 ครั้งยังไม่ได้ → โผล่ "พิมพ์เอง" */}
                  {retakeCount >= 3 && (
                    <button
                      onClick={() => setEditingBookInfo(true)}
                      style={{ padding: '8px 14px', background: 'none', border: 0, fontFamily: 'Kanit', fontSize: 13, color: '#92400E', textDecoration: 'underline', cursor: 'pointer', minHeight: 40 }}
                    >
                      พิมพ์ชื่อเอง
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* has_isbn edit mode: inline form (title/author inputs) + cancel/save */}
          {notFoundMode === 'has_isbn' && !fetchedBook && editingBookInfo && (() => {
            // Snapshot ครั้งแรกที่เปิด edit — กดยกเลิกย้อนกลับ
            if (!editSnapshotRef.current) {
              editSnapshotRef.current = { title: manualTitle, author: manualAuthor }
            }
            return (
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>ข้อมูลหนังสือ</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)' }}>ISBN: {isbn}</div>
                </div>
                <div className="form-group">
                  <label className="label">ชื่อหนังสือ <span style={{ color: 'var(--red)' }}>*</span></label>
                  <input className="input" value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="เช่น แฮร์รี่ พอตเตอร์ กับศิลาอาถรรพ์" autoFocus />
                </div>
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="label">ผู้แต่ง <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span></label>
                  <input className="input" value={manualAuthor} onChange={e => setManualAuthor(e.target.value)} placeholder="เช่น J.K. Rowling" />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      if (editSnapshotRef.current) {
                        setManualTitle(editSnapshotRef.current.title)
                        setManualAuthor(editSnapshotRef.current.author)
                      }
                      editSnapshotRef.current = null
                      setEditingBookInfo(false)
                    }}
                    style={{ flex: 1, padding: '10px 12px', minHeight: 44, background: 'white', border: '1px solid var(--border)', borderRadius: 10, fontFamily: 'Kanit', fontSize: 14, fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer' }}
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={() => {
                      editSnapshotRef.current = null
                      setEditingBookInfo(false)
                    }}
                    style={{ flex: 1, padding: '10px 12px', minHeight: 44, background: 'var(--primary)', border: 0, borderRadius: 10, fontFamily: 'Kanit', fontSize: 14, fontWeight: 700, color: 'white', cursor: 'pointer' }}
                  >
                    เสร็จ
                  </button>
                </div>
              </div>
            )
          })()}

          {(fetchedBook?.title || notFoundMode === 'has_isbn' || (notFoundMode === 'no_isbn' && manualTitle)) && (
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

                {/* กล้อง camera-only — ถ่ายทีละรูป กันรูปจาก internet + screenshot
                    ถ้าผู้ใช้อยู่ใน LINE IAB เราจะ redirect ไป external browser (ดู LineIabBanner) */}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={cameraInputRef}
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

                  {/* ปุ่มเพิ่มรูป → เปิดกล้องตรงๆ (camera-only กันรูปจาก internet) */}
                  {photoFiles.length < MAX_PHOTOS && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!user) { goLogin(); return }
                        cameraInputRef.current?.click()
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

              {/* ─── Condition: 2x2 grid color-coded (design spec) ─── */}
              <div className="form-group">
                <label className="label">สภาพหนังสือ</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {CONDITIONS.map(c => {
                    // color map per condition: new/brand_new = green, good = yellow, fair = red
                    const palette = (c.key === 'brand_new' || c.key === 'new')
                      ? { color: '#166534', bg: '#DCFCE7' }
                      : c.key === 'good'
                      ? { color: '#CA8A04', bg: '#FEF9C3' }
                      : { color: '#B91C1C', bg: '#FEE2E2' }
                    const active = cond === c.key
                    return (
                      <button
                        key={c.key}
                        onClick={() => {
                          setCond(c.key)
                          // ถ้า notes ยังเป็น auto-fill → เปลี่ยนเป็น template ของ condition ใหม่
                          if (notesAutoFilled) setNotes(NOTE_TEMPLATES[c.key] || '')
                        }}
                        style={{
                          padding: '12px 12px', borderRadius: 12, cursor: 'pointer',
                          background: active ? palette.bg : 'white',
                          border: active ? `1.5px solid ${palette.color}` : '1px solid #E5E7EB',
                          fontFamily: 'Kanit', fontSize: 13.5, fontWeight: 700,
                          color: active ? palette.color : '#475569',
                          textAlign: 'left',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}
                      >
                        <span>{c.label}</span>
                        {active && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={palette.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                    )
                  })}
                </div>
                {/* desc ตัดออก — แสดงใน notes แทน */}
              </div>

              {/* ─── Notes: with char count ─── */}
              <div className="form-group">
                <label className="label">หมายเหตุเพิ่มเติม <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span></label>
                <div style={{ background: 'white', borderRadius: 12, border: '1px solid #E5E7EB', padding: 14 }}>
                  <textarea
                    value={notes}
                    onChange={e => { setNotes(e.target.value.slice(0, 300)); setNotesAutoFilled(false) }}
                    placeholder="เช่น มีรอยขีดดินสอบางหน้า / ปกมีรอยพับ / หน้า 45 มีรอยน้ำเล็กน้อย"
                    rows={3}
                    style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontFamily: 'Kanit', fontSize: 14, color: '#0F172A', lineHeight: 1.5 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6, borderTop: '1px solid #F1F5F9', marginTop: 6 }}>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{notes.length}/300</div>
                  </div>
                </div>
              </div>

              {/* ─── Price: big input + quick buttons + "ราคาดี" badge (ถ้าในช่วง market) ─── */}
              <div className="form-group">
                <label className="label">ราคาขาย (บาท) <span style={{ color: 'var(--red)' }}>*</span>
                  {marketPrice && (
                    <span style={{ fontWeight: 400, color: 'var(--ink3)', marginLeft: 6, fontSize: 12 }}>
                      ราคาในระบบ ฿{marketPrice.min}–฿{marketPrice.max} · เฉลี่ย ฿{marketPrice.avg}
                    </span>
                  )}
                </label>
                {(() => {
                  const priceNum = parseFloat(price) || 0
                  const isGoodPrice = marketPrice && priceNum > 0 && priceNum >= marketPrice.min && priceNum <= marketPrice.max
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 12, padding: '12px 16px', border: `1.5px solid ${price ? 'var(--primary)' : '#E5E7EB'}`, boxShadow: price ? '0 0 0 3px rgba(37,99,235,0.1)' : 'none' }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: '#64748B' }}>฿</div>
                        <input
                          type="number" inputMode="numeric"
                          value={price} onChange={e => setPrice(e.target.value)}
                          placeholder="ราคาที่อยากขาย"
                          style={{ flex: 1, border: 'none', outline: 'none', fontFamily: 'Kanit', fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', minWidth: 0, background: 'transparent' }}
                        />
                        {isGoodPrice && (
                          <div style={{ padding: '5px 10px', borderRadius: 999, background: '#DCFCE7', fontSize: 11, fontWeight: 700, color: '#166534' }}>
                            ราคาดี
                          </div>
                        )}
                      </div>
                      {/* Quick price suggestions — ใช้ marketPrice min/avg/max ถ้ามี */}
                      {marketPrice && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          {[marketPrice.min, marketPrice.avg, marketPrice.max].filter((p, i, arr) => arr.indexOf(p) === i).map(p => (
                            <button
                              key={p} type="button" onClick={() => setPrice(String(p))}
                              style={{
                                flex: 1, padding: '8px 0', border: 'none',
                                background: price === String(p) ? '#0F172A' : '#F1F5F9',
                                color: price === String(p) ? 'white' : '#475569',
                                borderRadius: 10, fontFamily: 'Kanit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                              }}
                            >
                              ฿{p}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>

              {/* ─── Shipping: toggle cards with subtitle ─── */}
              <div className="form-group">
                <label className="label">ค่าส่ง</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { val: 'free', label: 'ส่งฟรี', sub: 'ราคานี้รวมค่าส่งแล้ว' },
                    { val: 'buyer', label: '+ ค่าส่ง', sub: 'คิดค่าส่งแยก' },
                  ].map(opt => {
                    const active = shipping === opt.val
                    return (
                      <button
                        key={opt.val} type="button" onClick={() => setShipping(opt.val)}
                        style={{
                          flex: 1, padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                          background: active ? '#EEF2FF' : 'white',
                          border: active ? '1.5px solid #2563EB' : '1px solid #E5E7EB',
                          borderRadius: 12, fontFamily: 'Kanit',
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 700, color: active ? '#1D4ED8' : '#0F172A' }}>{opt.label}</div>
                        <div style={{ fontSize: 11, color: active ? '#4338CA' : '#64748B', marginTop: 2 }}>{opt.sub}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ช่องทางติดต่อ — แสดงทั้งเบอร์ + LINE ถ้ามี */}
              {(user?.phone || user?.line_id) && (
                <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', marginBottom: 13 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>ช่องทางติดต่อ</div>
                  {user?.phone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: user?.line_id ? 6 : 0 }}>
                      <span style={{ fontSize: 14 }}>📞</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{user.phone?.length === 10 ? `${user.phone.slice(0,3)}-${user.phone.slice(3,6)}-${user.phone.slice(6)}` : user.phone}</span>
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

              {(() => {
                // Block ปุ่มระหว่าง AI ดึงข้อมูลจากปก (has_isbn mode)
                // กัน user กดเร็วกว่า AI → ไม่โดนเด้งเข้า edit form งงๆ
                const aiPending = aiStatus === 'running' && notFoundMode === 'has_isbn' && !manualTitle && !fetchedBook
                return (
                  <button className="btn" onClick={submit} disabled={submitting || aiPending} style={{ marginTop: 8 }}>
                    {submitting ? <><span className="spin" />กำลังบันทึก...</>
                      : aiPending ? <><span className="spin" />กำลังอ่านข้อมูลจากปก...</>
                      : 'ลงประกาศขาย 🎉'}
                  </button>
                )
              })()}
            </>
          )}
        </div>
      </div>
      <BottomNav />
    </>
  )
}
