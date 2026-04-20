'use client'
// Production: ลงขายด้วยการถ่ายหน้าปก (AI extract + dedup + save)
// Route: /sell/cover (link จาก /sell)
import { useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { BookCover } from '@/components/ui'

const CONDITIONS = [
  { key: 'brand_new', label: '🆕 มือหนึ่ง', desc: 'ยังไม่ผ่านการใช้งาน ซื้อมาแล้วไม่ได้อ่าน' },
  { key: 'new',       label: '✨ ใหม่มาก',  desc: 'ไม่มีรอยใดๆ เหมือนซื้อจากร้าน' },
  { key: 'good',      label: '👍 ดี',      desc: 'มีรอยการใช้งานเล็กน้อย อ่านได้ปกติ' },
  { key: 'fair',      label: '📖 พอใช้',   desc: 'มีรอยชัดเจน แต่เนื้อหาครบถ้วน' },
]
// Note templates — auto-fill เมื่อเลือกสภาพ
const NOTE_TEMPLATES: Record<string, string> = {
  brand_new: 'หนังสือมือหนึ่งจากร้าน/สำนักพิมพ์ ยังไม่แกะ/ไม่ผ่านการใช้งาน',
  new:       'หนังสือสภาพใหม่มาก อ่านน้อยหรือไม่ได้อ่าน ไม่มีตำหนิ',
  good:      'มีรอยตามการใช้งานเล็กน้อย เนื้อหาครบถ้วน อ่านได้ปกติ',
  fair:      'มีรอยชัดเจนตามการใช้งาน (รายละเอียดตามภาพ) แต่เนื้อหาครบถ้วน',
}

type Extract = {
  model: string
  location: string
  duration_ms: number
  raw: string
  parsed: {
    title: string | null
    subtitle: string | null
    authors: string[] | null
    publisher: string | null
    language: 'th' | 'en' | 'other' | null
    edition: string | null
    confidence: 'high' | 'medium' | 'low'
    notes: string | null
  } | null
  parseError: string | null
}

type Candidate = {
  id: string
  isbn: string | null
  title: string
  author: string | null
  cover_url: string | null
  score: number
}
type EnrichedCandidate = Candidate & { isCertain: boolean }

type ScanResp = {
  extract?: Extract
  dedup?: {
    candidates: Candidate[]
    topMatch: boolean
    searched_by: 'isbn' | 'title' | 'none'
    threshold: number
    dedup_duration_ms: number
  }
  error?: string
}

type FormData = {
  title: string
  subtitle: string
  authors: string
  publisher: string
  language: string
  edition: string
  isbn: string
}

// Aggressive normalize: lower + strip whitespace + strip punctuation
// ใช้เทียบ AI title กับ DB title — strict กว่า title_norm ใน DB
// (title_norm ใน DB strip แค่ whitespace)
function normStrict(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,!?;:()[\]{}"'…\-–—/\\]/g, '')
    .trim()
}

// Author compatibility: ถ้าทั้ง 2 ข้างมี author → substring check (ลบ whitespace)
// ถ้าข้างใดข้างหนึ่งว่าง → unknown ยอมผ่าน (ใช้ title เป็นหลัก)
// ป้องกันเคส AI title สั้น prefix-match DB ของเล่มต่างเรื่อง (แต่ผู้เขียนคนละคน)
function authorsCompatible(aiAuthors: string[] | null | undefined, dbAuthor: string | null | undefined): boolean {
  if (!aiAuthors || aiAuthors.length === 0) return true
  if (!dbAuthor || !dbAuthor.trim()) return true
  const dbNorm = normStrict(dbAuthor)
  if (!dbNorm) return true
  for (const a of aiAuthors) {
    const aNorm = normStrict(a)
    if (!aNorm) continue
    if (dbNorm.includes(aNorm) || aNorm.includes(dbNorm)) return true
  }
  return false
}

// Match แน่นอนถ้า:
//   1) normalized title เหมือนเป๊ะ (+ author ไม่ขัด)
//   2) score ≥ 0.85 AND author compatible AND (gap ≥ 0.4 OR ratio ≥ 0.7)
//      → author check กัน prefix-match ของเล่มคนละเรื่อง
function isCertainMatch(
  aiTitle: string, dbTitle: string, score: number,
  aiAuthors: string[] | null, dbAuthor: string | null,
  secondScore?: number,
): boolean {
  const a = normStrict(aiTitle)
  const b = normStrict(dbTitle)
  if (!a || !b) return false
  const authorOk = authorsCompatible(aiAuthors, dbAuthor)
  if (a === b) return authorOk
  if (score < 0.85) return false
  if (!authorOk) return false
  if (secondScore !== undefined && (score - secondScore) >= 0.4) return true
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
  return ratio >= 0.7
}

// Merge title + subtitle → one string
// Heuristic: subtitle ยาวเกิน 60 chars = น่าจะไม่ใช่ subtitle จริง (description/junk) → ทิ้ง
function mergeTitleSubtitle(title: string | null | undefined, subtitle: string | null | undefined): string {
  const t = (title || '').trim()
  const s = (subtitle || '').trim()
  if (!s || s.length > 60) return t
  return t ? `${t} ${s}` : s
}

// base64 (no prefix) → Blob — ใช้ตอน upload ขึ้น Supabase Storage
function base64ToBlob(b64: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return new Blob([bytes], { type: mimeType })
}

async function fileToBase64(file: File, maxEdge = 1600, quality = 0.85): Promise<{ data: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bitmap) {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
    }
    return { data: btoa(bin), mimeType: file.type || 'image/jpeg' }
  }
  let { width, height } = bitmap
  if (width > maxEdge || height > maxEdge) {
    if (width > height) { height = Math.round(height * maxEdge / width); width = maxEdge }
    else { width = Math.round(width * maxEdge / height); height = maxEdge }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/jpeg', quality))
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
  }
  return { data: btoa(bin), mimeType: 'image/jpeg' }
}

export default function SellFlowCoverPage() {
  if (process.env.NEXT_PUBLIC_ENABLE_COVER_SCAN !== '1') {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink3)' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16 }}>ฟีเจอร์นี้ยังไม่เปิดให้บริการ</div>
      </div>
    )
  }
  // useSearchParams ต้องอยู่ใน Suspense ใน Next.js 14 app router
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>⏳</div>}>
      <SellFlowCoverPageInner />
    </Suspense>
  )
}

function SellFlowCoverPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const incomingIsbn = searchParams.get('isbn') || ''
  // Silent mode = มาจาก barcode miss (/sell → redirect) — ซ่อน UI cover-scan ทั้งหมด
  // user ไม่ควรรู้ว่ามี cover scan step เกิดขึ้น ให้เหมือน sell flow ปกติ
  const silentMode = !!incomingIsbn
  const { user, loading: authLoading, loginWithLine, reloadUser } = useAuth()
  const [preview, setPreview] = useState<string | null>(null)
  const [base64, setBase64] = useState<{ data: string; mimeType: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [resp, setResp] = useState<ScanResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>({
    title: '', subtitle: '', authors: '', publisher: '', language: 'th', edition: '', isbn: '',
  })
  // Sell fields
  const [cond, setCond] = useState('good')
  const [price, setPrice] = useState('')
  const [includesShipping, setIncludesShipping] = useState(false)
  // contact: auto จาก user.phone/line_id (ไม่มีช่อง manual)
  const [notes, setNotes] = useState(NOTE_TEMPLATES['good'])
  // track ว่า notes ถูก auto-fill จาก condition หรือเปล่า (ถ้า user แก้แล้วจะไม่ overwrite)
  const [notesAutoFilled, setNotesAutoFilled] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  // Pioneer: popup ตอนเพิ่มหนังสือใหม่เข้าระบบ
  const [pioneerBook, setPioneerBook] = useState<{ title: string; isbn: string; coverUrl: string } | null>(null)
  // Phone guard — บังคับเบอร์โทรก่อนลงขาย (match pattern กับ /sell เดิม)
  const [showPhoneGuard, setShowPhoneGuard] = useState(false)
  const [guardPhoneInput, setGuardPhoneInput] = useState('')
  const [phoneGuardError, setPhoneGuardError] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const savedPhoneRef = useRef('')
  // user กด "ไม่ใช่" บน candidate question → ซ่อนไป (ไม่ถามอีก)
  const [dismissedCandidates, setDismissedCandidates] = useState(false)
  // เปิด form แก้ไขข้อมูลหนังสือ (default ซ่อน — green card แสดงพอ)
  const [showEditForm, setShowEditForm] = useState(false)
  // Snapshot ค่า form ก่อนกดแก้ไข → กด "ยกเลิก" แล้วย้อนกลับได้
  const formSnapshotRef = useRef<FormData | null>(null)
  // Extra photos (เพิ่มเติมจากรูปปกที่สแกน) — max 4 extra (+1 cover = 5 total)
  const [extraFiles, setExtraFiles] = useState<File[]>([])
  const [extraPreviews, setExtraPreviews] = useState<string[]>([])
  const extraInputRef = useRef<HTMLInputElement>(null)

  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const pickedFromStorageRef = useRef(false)

  // Cleanup object URLs ตอน unmount — ใช้ ref pattern กัน stale closure
  // (empty deps + access state ใน cleanup = เห็นแค่ค่าตอน mount → รูปที่เพิ่มหลังจากนั้นไม่ถูก revoke)
  const previewRef = useRef<string | null>(null)
  const extraPreviewsRef = useRef<string[]>([])
  useEffect(() => { previewRef.current = preview }, [preview])
  useEffect(() => { extraPreviewsRef.current = extraPreviews }, [extraPreviews])
  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
      extraPreviewsRef.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  // เช็ค sessionStorage: ถ้ามีรูปที่ถ่ายมาจาก /sell แล้ว → ใช้เลย ข้ามขั้นตอน capture
  // หรือ: ถ้ามาจาก barcode redirect (มี ?isbn= แต่ไม่มีรูป) → auto-open camera
  useEffect(() => {
    if (pickedFromStorageRef.current) return
    pickedFromStorageRef.current = true
    try {
      const raw = sessionStorage.getItem('bm_cover_scan')
      if (raw) {
        sessionStorage.removeItem('bm_cover_scan') // ใช้ครั้งเดียว
        const parsed = JSON.parse(raw) as { data: string; mimeType: string; ts: number }
        if (parsed?.data) {
          const bytes = Uint8Array.from(atob(parsed.data), c => c.charCodeAt(0))
          const blob = new Blob([bytes], { type: parsed.mimeType || 'image/jpeg' })
          const file = new File([blob], 'cover.jpg', { type: blob.type })
          onPick(file)
          return
        }
      }
      // ถ้ามาจาก barcode redirect (มี ISBN แต่ไม่มีรูป) → auto-open camera ทันที
      if (incomingIsbn) {
        setTimeout(() => cameraRef.current?.click(), 200)
      }
    } catch {
      // ignore — fallback ปุ่ม capture บน page
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const parsed = resp?.extract?.parsed
  const confidence = parsed?.confidence
  const rawCandidates = resp?.dedup?.candidates ?? []

  // Post-process:
  // 1) ตัด candidate ที่ score < 30% ทิ้ง (ต่ำเกินไป = น่าจะไม่เกี่ยวกัน ไม่ต้องโชว์)
  // 2) mark isCertain ด้วย normalize strict + length ratio
  const aiTitle = parsed?.title || ''
  const aiAuthors = parsed?.authors || null
  const filtered = rawCandidates
    .filter(c => c.score >= 0.30)
    // ตัดเล่มที่ author ขัดกันชัด (ทั้ง 2 ข้างมี author + substring ไม่ตรง)
    // → กัน prefix-match ของเล่มคนละเรื่อง (101 วิธี..., ดูนก...)
    .filter(c => authorsCompatible(aiAuthors, c.author))
  const candidates = filtered.map((c, i) => ({
    ...c,
    isCertain: isCertainMatch(
      aiTitle, c.title, c.score, aiAuthors, c.author,
      i === 0 ? filtered[1]?.score : undefined,
    ),
  }))
  const hasTopMatch = candidates.length > 0 && candidates[0].isCertain

  const autoFilled = !!parsed

  // Auto-fill form + auto-select เมื่อ scan เสร็จ
  // - ถ้าเจอ certain match → เลือกเล่มนั้นอัตโนมัติ + fill ด้วย DB data
  // - ถ้าไม่เจอ certain → สร้างใหม่ fill ด้วย AI data
  // ทำแค่ครั้งเดียวต่อ scan (dep = resp) — ถ้า user toggle ทีหลังไม่ re-trigger
  useEffect(() => {
    if (!parsed) return
    setDismissedCandidates(false)
    setShowEditForm(false)
    if (candidates.length > 0 && candidates[0].isCertain) {
      const top = candidates[0]
      setSelectedBookId(top.id)
      setForm({
        title: top.title, subtitle: '',
        authors: top.author || '', publisher: '',
        language: 'th', edition: '',
        isbn: top.isbn || '',
      })
    } else {
      setSelectedBookId(null)
      // รวม subtitle → title ทันที (กัน AI เอาข้อความยาวมาใส่ subtitle แล้วสับสน)
      setForm({
        title: mergeTitleSubtitle(parsed.title, parsed.subtitle),
        subtitle: '', // ซ่อน subtitle ฟิลด์ — รวมเข้า title แล้ว
        authors: parsed.authors?.join(', ') || '',
        publisher: parsed.publisher || '',
        language: parsed.language || 'th',
        edition: parsed.edition || '',
        isbn: incomingIsbn || '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp])

  async function onPick(file: File | null) {
    if (!file) return
    resetAll()
    // cleanup preview เก่า (กัน memory leak)
    setPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    try {
      const b = await fileToBase64(file)
      setBase64(b)
      // auto-analyze ทันทีหลังถ่าย/upload — ไม่ต้องกดปุ่ม
      await analyze(b)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ไม่สามารถอ่านไฟล์ได้')
    }
  }

  function resetAll() {
    setResp(null); setErr(null); setSelectedBookId(null)
    setForm({ title: '', subtitle: '', authors: '', publisher: '', language: 'th', edition: '', isbn: '' })
    // Clear extra photos (object URLs)
    extraPreviews.forEach(url => URL.revokeObjectURL(url))
    setExtraFiles([]); setExtraPreviews([])
  }

  function retake() {
    setPreview(null); setBase64(null); resetAll()
    if (cameraRef.current) cameraRef.current.value = ''
    if (uploadRef.current) uploadRef.current.value = ''
  }

  async function analyze(inputBase64?: { data: string; mimeType: string }) {
    const target = inputBase64 || base64
    if (!target) return
    setLoading(true); setErr(null); setResp(null); setSelectedBookId(null)
    try {
      const r = await fetch('/api/sell-flow/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imageBase64: target.data,
          mimeType: target.mimeType,
          isbn: incomingIsbn || undefined,
        }),
      })
      const j: ScanResp = await r.json()
      if (!r.ok) setErr(j.error || `HTTP ${r.status}`)
      setResp(j)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'request_failed')
    } finally {
      setLoading(false)
    }
  }

  // Toggle select: กดเล่มเดิมซ้ำ = ยกเลิก (กลับไปใช้ข้อมูล AI สร้างใหม่)
  function toggleBook(cand: Candidate) {
    if (selectedBookId === cand.id) {
      // deselect → กลับไปใช้ข้อมูล AI
      setSelectedBookId(null)
      if (parsed) {
        setForm({
          title: parsed.title || '',
          subtitle: parsed.subtitle || '',
          authors: parsed.authors?.join(', ') || '',
          publisher: parsed.publisher || '',
          language: parsed.language || 'th',
          edition: parsed.edition || '',
          isbn: '',
        })
      }
      return
    }
    // select → ใช้ข้อมูล DB
    setSelectedBookId(cand.id)
    setForm({
      title: cand.title,
      subtitle: '',
      authors: cand.author || '',
      publisher: '',
      language: 'th',
      edition: '',
      isbn: cand.isbn || '',
    })
  }

  // Dev mode bypass — บน localhost LINE OAuth ใช้ไม่ได้ → ยอมให้เทสแบบไม่ login
  // server-side จะ fallback ไปใช้ admin user (เฉพาะเมื่อ NODE_ENV=development)
  const isDev = process.env.NODE_ENV === 'development'
  const authBypass = !user && isDev
  const effectiveUser = user || (authBypass ? { id: 'dev' } : null)

  // Save phone จาก guard → reload user → retry submit อัตโนมัติ
  async function savePhoneAndContinue() {
    if (!user) return
    const cleaned = guardPhoneInput.replace(/\D/g, '')
    if (!/^0\d{9}$/.test(cleaned)) { setPhoneGuardError('กรุณากรอกเบอร์โทร 10 หลัก ขึ้นต้น 0'); return }
    setSavingPhone(true); setPhoneGuardError('')
    try {
      const res = await fetch('/api/user/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, data: { phone: cleaned } }),
      })
      const d = await res.json()
      if (!res.ok) { setPhoneGuardError(d.message || 'บันทึกไม่สำเร็จ ลองใหม่'); return }
      savedPhoneRef.current = cleaned
      await reloadUser()
      setShowPhoneGuard(false)
      setTimeout(() => submitListing(), 150)
    } catch {
      setPhoneGuardError('เกิดข้อผิดพลาด ลองใหม่')
    } finally {
      setSavingPhone(false)
    }
  }

  async function submitListing() {
    if (!effectiveUser) { setErr('กรุณา login ก่อนลงขาย'); return }
    if (!base64) { setErr('ไม่พบภาพปก'); return }

    // Guard: บังคับเบอร์โทรก่อน (เหมือน /sell เดิม)
    const phone = user?.phone || savedPhoneRef.current
    if (!phone && !user?.line_id) {
      setGuardPhoneInput(''); setPhoneGuardError('')
      setShowPhoneGuard(true)
      return
    }

    const priceNum = parseFloat(price)
    if (!isFinite(priceNum) || priceNum <= 0) { setErr('กรุณาใส่ราคาที่ถูกต้อง'); return }
    const autoContact = phone || (user?.line_id ? 'LINE' : '')

    setSubmitting(true); setErr(null); setSaveMsg(null)
    try {
      // 1. Upload ทุกภาพไป Supabase Storage — รูปปก (index 0) + extras
      const ts = Date.now()
      const coverBlob = base64ToBlob(base64.data, base64.mimeType)
      const uploads = [
        { blob: coverBlob, suffix: 'cover' },
        ...extraFiles.map((f, i) => ({ blob: f, suffix: `x${i}` })),
      ]
      const photoUrls: string[] = []
      for (let i = 0; i < uploads.length; i++) {
        const { blob, suffix } = uploads[i]
        const path = `covers/${effectiveUser.id}/${ts}_${suffix}.jpg`
        const { error: upErr } = await supabase.storage
          .from('listing-photos')
          .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
        if (upErr) throw new Error(`Upload ${i + 1}: ${upErr.message}`)
        photoUrls.push(supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl)
      }

      // 2. POST ไป commit endpoint
      const authorsList = form.authors.split(',').map(s => s.trim()).filter(Boolean)
      const r = await fetch('/api/sell-flow/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          existing_book_id: selectedBookId,
          title: form.title,
          subtitle: form.subtitle,
          author: authorsList.join(', '),
          publisher: form.publisher,
          edition: form.edition,
          isbn: form.isbn,
          language: form.language,
          ai_confidence: confidence,
          condition: cond,
          price: priceNum,
          price_includes_shipping: includesShipping,
          contact: autoContact,
          notes: notes.trim(),
          photos: photoUrls,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      // Pioneer: ถ้าเป็นหนังสือใหม่ → แสดง popup ก่อน redirect
      if (j.is_new_book) {
        setPioneerBook({
          title: j.title || form.title,
          isbn: j.isbn || form.isbn || '',
          coverUrl: j.cover_url || (preview || ''),
        })
      } else {
        setSaveMsg('✅ ลงขายสำเร็จ — กำลังพาไปหน้าหนังสือ...')
        setTimeout(() => {
          router.push(`/book/${encodeURIComponent(j.isbn || form.isbn || j.book_id)}`)
        }, 1200)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setSubmitting(false)
    }
  }

  // canSubmit: ไม่ block ที่ contact — ถ้าไม่มี guard modal จะเด้งตอนกดลงขาย
  const canSubmit =
    form.title.trim().length > 0 &&
    form.authors.trim().length > 0 &&
    parseFloat(price) > 0

  return (
    <div style={{ padding: 16, paddingBottom: 80 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.35, letterSpacing: '-0.02em' }}>
          ลงขายหนังสือ
        </h1>
        {incomingIsbn && !preview && !silentMode && (
          <div style={{ marginTop: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#1E40AF', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>📷</span>
            <div>
              <div style={{ fontWeight: 600 }}>ถ่ายหน้าปกเพื่อเพิ่มเข้าระบบ</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>ISBN: {incomingIsbn}</div>
            </div>
          </div>
        )}
      </header>

      {/* ─── Capture section ─── */}
      {!preview && (
        <>
          {/* Inputs ต้อง mount เสมอ — auto-click camera ใน silentMode ต้องใช้ ref */}
          <input
            ref={cameraRef} type="file" accept="image/*" capture="environment"
            onChange={e => onPick(e.target.files?.[0] ?? null)} style={{ display: 'none' }}
          />
          <input
            ref={uploadRef} type="file" accept="image/*"
            onChange={e => onPick(e.target.files?.[0] ?? null)} style={{ display: 'none' }}
          />
          {silentMode ? (
            // Silent mode: ปุ่มเดียว ไม่มี tips/banner — user tap ครั้งเดียว
            // (browser block programmatic click ถ้าไม่มี user gesture)
            <div style={{ display: 'grid', gap: 8 }}>
              <button type="button" onClick={() => cameraRef.current?.click()} style={btn('primary')}>
                📷 ถ่ายรูปหนังสือ
              </button>
            </div>
          ) : (
            <>
              <div style={tipsBox}>
                💡 <strong>เคล็ดลับถ่ายปก</strong>
                <ul style={{ margin: '8px 0 0 20px', fontSize: 14, lineHeight: 1.7 }}>
                  <li>ถ่ายหน้าตรง ให้ปกเต็มกรอบ</li>
                  <li>ถ้าปกสะท้อนแสง ลองหามุมเอียงใหม่</li>
                  <li>ถ่ายในที่สว่างพอ</li>
                </ul>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <button type="button" onClick={() => cameraRef.current?.click()} style={btn('primary')}>
                  📷 ถ่ายรูปปก
                </button>
                <button type="button" onClick={() => uploadRef.current?.click()} style={btn('secondary')}>
                  🖼️ อัปโหลดจากคลัง
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ─── Loading: silent mode = inline เล็กๆ / ปกติ = full-screen overlay ─── */}
      {loading && preview && !silentMode && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.92)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20,
        }}>
          <img src={preview} alt="" style={{ width: 120, height: 160, objectFit: 'cover', borderRadius: 10, marginBottom: 20, opacity: 0.9 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'white', fontSize: 16, fontWeight: 600 }}>
            <span className="spin" style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: 'white' }} />
            กำลังอ่านหน้าปก...
          </div>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 8 }}>
            ประมาณ 3–5 วินาที
          </div>
        </div>
      )}
      {/* Silent mode: แสดงแค่ preview + small spinner (ดูเหมือนอัปโหลดรูปปกติ) */}
      {loading && preview && silentMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: 14,
          background: 'white', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12,
        }}>
          <img src={preview} alt="" style={{ width: 56, height: 80, objectFit: 'cover', borderRadius: 6 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink2)', fontSize: 14, fontWeight: 500 }}>
            <span className="spin" style={{ width: 16, height: 16 }} />
            กำลังประมวลผล...
          </div>
        </div>
      )}

      {/* ─── Error ─── */}
      {err && (
        <div style={errBox}>⚠️ {err}</div>
      )}

      {/* ─── Result: confidence warning + dedup + form ─── */}
      {resp && autoFilled && (
        <>
          {/* Debug info removed — keep minimal UI */}

          {/* Confidence warning */}
          {confidence === 'low' && (
            <div style={{ ...errBox, background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}>
              ⚠️ <strong>AI อ่านได้ไม่ชัดเจน</strong> — ภาพอาจเบลอ/มืด/เอียง แนะนำ
              <button type="button" onClick={retake} style={{ color: '#92400e', textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', padding: 0, margin: '0 4px', fontWeight: 600 }}>
                ถ่ายใหม่
              </button>
              หรือแก้ฟอร์มเองด้านล่าง
            </div>
          )}

          {/* ─── Dedup: แสดงเฉพาะตอน "ไม่แน่ใจ" — ถามใช่/ไม่ใช่ ─── */}
          {/* เจอแน่ (hasTopMatch) → silent auto-select ไม่ต้องถาม */}
          {/* ไม่เจอเลย → silent, form จาก AI */}
          {/* มี candidates แต่ไม่ certain AND user ยังไม่ตอบ → ถาม */}
          {!hasTopMatch && candidates.length > 0 && !dismissedCandidates && !selectedBookId && (
            <section style={{ ...card, background: '#fef9c3', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#713f12', marginBottom: 10 }}>
                📚 ใช่หนังสือเล่มเดียวกันไหม?
              </div>
              <CandidateCard
                cand={candidates[0]}
                selected={false}
                onClick={() => toggleBook(candidates[0])}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => toggleBook(candidates[0])}
                  style={{ ...btn('primary'), flex: 1 }}
                >
                  ใช่ — ใช้ข้อมูลร่วม
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedCandidates(true)}
                  style={{ ...btn('ghost'), flex: 1 }}
                >
                  ไม่ใช่ — เพิ่มใหม่
                </button>
              </div>
              {candidates.length > 1 && (
                <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', marginTop: 10 }}>
                  (มีเล่มคล้ายอีก {candidates.length - 1} เล่ม — ถ้าไม่ใช่กดไม่ใช่ แล้วลองใหม่ได้)
                </div>
              )}
            </section>
          )}

          {/* Case A (ตรงเป๊ะ): green card สไตล์ /sell เดิม — ไม่ต้องมี book info form */}
          {selectedBookId && candidates.find(c => c.id === selectedBookId) && (() => {
            const cand = candidates.find(c => c.id === selectedBookId)!
            return (
              <div style={{
                background: 'var(--green-bg)', border: '1px solid #BBF7D0',
                borderLeft: '4px solid var(--green)', borderRadius: 14, padding: 14,
                display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start',
              }}>
                <BookCover isbn={cand.isbn || undefined} coverUrl={cand.cover_url || undefined} title={cand.title} size={68} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, color: '#121212', letterSpacing: '-0.01em', marginBottom: 4 }}>
                    {cand.title}
                  </div>
                  {cand.author && (
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginBottom: 2 }}>
                      <span style={{ color: 'var(--ink3)' }}>ผู้เขียน </span>{cand.author}
                    </div>
                  )}
                  <span style={{ fontSize: 13, background: '#E8F5E9', color: '#2E7D32', padding: '4px 10px', borderRadius: 9999, fontWeight: 700, display: 'inline-block', marginTop: 8, letterSpacing: '0.02em' }}>
                    ✓ ดึงข้อมูลสำเร็จ
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBookId(null)
                    setDismissedCandidates(true)
                    if (parsed) {
                      setForm({
                        title: parsed.title || '',
                        subtitle: parsed.subtitle || '',
                        authors: parsed.authors?.join(', ') || '',
                        publisher: parsed.publisher || '',
                        language: parsed.language || 'th',
                        edition: parsed.edition || '',
                        isbn: '',
                      })
                    }
                  }}
                  style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '8px 12px', minHeight: 36, fontSize: 13, fontWeight: 600,
                    color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'Kanit', flexShrink: 0,
                  }}
                >
                  เปลี่ยน
                </button>
              </div>
            )
          })()}

          {/* Case C / B-dismissed: green card แสดงข้อมูลจาก AI — เตรียมลงขายเลย */}
          {!selectedBookId && (dismissedCandidates || candidates.length === 0) && !showEditForm && (
            <div style={{
              background: 'var(--green-bg)', border: '1px solid #BBF7D0',
              borderLeft: '4px solid var(--green)', borderRadius: 14, padding: 14,
              display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start',
            }}>
              {preview && (
                <img src={preview} alt="" style={{ width: 68, height: 102, objectFit: 'cover', borderRadius: 6, background: '#e2e8f0', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, color: '#121212', letterSpacing: '-0.01em', marginBottom: 4 }}>
                  {form.title || '(ไม่มีชื่อ)'}
                </div>
                {form.authors && (
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginBottom: 2 }}>
                    <span style={{ color: 'var(--ink3)' }}>ผู้เขียน </span>{form.authors}
                  </div>
                )}
                {form.publisher && (
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginBottom: 2 }}>
                    <span style={{ color: 'var(--ink3)' }}>สำนักพิมพ์ </span>{form.publisher}
                  </div>
                )}
                <span style={{ fontSize: 13, background: '#E8F5E9', color: '#2E7D32', padding: '4px 10px', borderRadius: 9999, fontWeight: 700, display: 'inline-block', marginTop: 8, letterSpacing: '0.02em' }}>
                  ✓ {silentMode ? 'ดึงข้อมูลสำเร็จ' : 'อ่านปกสำเร็จ'}
                </span>
              </div>
              {/* ปุ่ม "แก้ไข" แสดงเฉพาะเมื่อไม่มี ISBN (หนังสือไม่มี barcode — AI ดึง title เท่านั้น)
                  ถ้ามี ISBN → ข้อมูลน่าเชื่อถือ ไม่ต้องให้ user แก้ (ลด surface แก้ผิด) */}
              {!form.isbn && (
                <button
                  type="button"
                  onClick={() => {
                    formSnapshotRef.current = { ...form }
                    setShowEditForm(true)
                  }}
                  style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '8px 12px', minHeight: 36, fontSize: 13, fontWeight: 600,
                    color: 'var(--ink2)', cursor: 'pointer', fontFamily: 'Kanit', flexShrink: 0,
                  }}
                >
                  แก้ไข
                </button>
              )}
            </div>
          )}

          {/* Photos section: cover (ถ่ายแล้ว) + เพิ่มรูปอื่นๆ ได้ถึง 5 */}
          {(selectedBookId || dismissedCandidates || candidates.length === 0) && (
            <section style={card}>
              <div style={sectionLabel}>📸 รูปหนังสือของคุณ</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: -4, marginBottom: 8 }}>ใส่เพิ่มได้สูงสุด 5 รูป</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {/* รูปปก (locked) */}
                {preview && (
                  <div style={{ position: 'relative', width: 80, height: 108 }}>
                    <img src={preview} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '2px solid var(--primary)' }} />
                    <span style={{ position: 'absolute', bottom: 4, left: 4, background: 'var(--primary)', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>ปก</span>
                  </div>
                )}
                {/* Extra photos */}
                {extraPreviews.map((url, i) => (
                  <div key={i} style={{ position: 'relative', width: 80, height: 108 }}>
                    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, background: '#f1f5f9' }} />
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(extraPreviews[i])
                        setExtraFiles(prev => prev.filter((_, idx) => idx !== i))
                        setExtraPreviews(prev => prev.filter((_, idx) => idx !== i))
                      }}
                      style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: 'white', border: 0, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    >×</button>
                  </div>
                ))}
                {/* Add button */}
                {extraFiles.length < 4 && (
                  <>
                    <input
                      ref={extraInputRef} type="file" accept="image/*" capture="environment"
                      style={{ display: 'none' }}
                      onChange={async e => {
                        const files = Array.from(e.target.files || [])
                        const remaining = 4 - extraFiles.length
                        const accepted = files.filter(f => f.type.startsWith('image/') && f.size <= 15 * 1024 * 1024).slice(0, remaining)
                        const newPreviews = accepted.map(f => URL.createObjectURL(f))
                        setExtraFiles(prev => [...prev, ...accepted])
                        setExtraPreviews(prev => [...prev, ...newPreviews])
                        if (extraInputRef.current) extraInputRef.current.value = ''
                      }}
                    />
                    <button
                      type="button" onClick={() => extraInputRef.current?.click()}
                      style={{ width: 80, height: 108, borderRadius: 8, border: '2px dashed var(--border)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'Kanit', fontSize: 12, color: 'var(--ink3)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      <span style={{ fontSize: 24 }}>+</span>
                      <span>เพิ่มรูป</span>
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          {/* Book info form — แสดงเฉพาะเมื่อ user กด "แก้ไข" เท่านั้น
              ถ้ายังตอบ question อยู่ → ไม่ต้องแสดง (กดใช่/ไม่ใช่ก่อน) */}
          {!selectedBookId && showEditForm && (
          <section style={card}>
            <div style={sectionLabel}>
              📖 ข้อมูลหนังสือ
              <span style={{ fontWeight: 400, color: 'var(--ink3)', marginLeft: 6, fontSize: 12 }}>
                (จาก AI — แก้ไขได้)
              </span>
            </div>
            <FormField
              label="ชื่อหนังสือ *"
              value={form.title}
              onChange={v => setForm(s => ({ ...s, title: v }))}
              required
            />
            <FormField
              label="ผู้แต่ง"
              value={form.authors}
              onChange={v => setForm(s => ({ ...s, authors: v }))}
              hint="คั่นด้วย comma ถ้ามีหลายคน (ไม่บังคับ)"
            />
            <FormField
              label="สำนักพิมพ์"
              value={form.publisher}
              onChange={v => setForm(s => ({ ...s, publisher: v }))}
              hint="ไม่บังคับ"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  if (formSnapshotRef.current) setForm(formSnapshotRef.current)
                  formSnapshotRef.current = null
                  setShowEditForm(false)
                }}
                style={{
                  flex: 1, padding: '10px 12px', minHeight: 44,
                  background: 'white', border: '1px solid var(--border)', borderRadius: 10,
                  fontFamily: 'Kanit', fontSize: 14, fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer',
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  formSnapshotRef.current = null
                  setShowEditForm(false)
                }}
                style={{
                  flex: 1, padding: '10px 12px', minHeight: 44,
                  background: 'var(--primary)', border: 'none', borderRadius: 10,
                  fontFamily: 'Kanit', fontSize: 14, fontWeight: 700, color: 'white', cursor: 'pointer',
                }}
              >
                บันทึก
              </button>
            </div>
          </section>
          )}

          {/* Sell fields — สไตล์เดียวกับ /sell เดิม */}
          <section style={card}>
            <div style={sectionLabel}>💰 รายละเอียดที่ลงขาย</div>

            {/* ─── Condition: 2x2 grid color-coded (sync กับ /sell) ─── */}
            <div className="form-group">
              <label className="label">สภาพหนังสือ</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {CONDITIONS.map(c => {
                  const palette = (c.key === 'brand_new' || c.key === 'new')
                    ? { color: '#166534', bg: '#DCFCE7' }
                    : c.key === 'good'
                    ? { color: '#CA8A04', bg: '#FEF9C3' }
                    : { color: '#B91C1C', bg: '#FEE2E2' }
                  const active = cond === c.key
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => {
                        setCond(c.key)
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
              <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 8, lineHeight: 1.4 }}>
                {CONDITIONS.find(c => c.key === cond)?.desc}
              </div>
            </div>

            {/* ─── Notes: card + char count (sync กับ /sell) ─── */}
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

            {/* ─── Price: big bordered input (sync กับ /sell) ─── */}
            <div className="form-group">
              <label className="label">ราคาขาย (บาท) <span style={{ color: 'var(--red)' }}>*</span></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 12, padding: '12px 16px', border: `1.5px solid ${price ? 'var(--primary)' : '#E5E7EB'}`, boxShadow: price ? '0 0 0 3px rgba(37,99,235,0.1)' : 'none' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#64748B' }}>฿</div>
                <input
                  type="number" inputMode="numeric" min="1"
                  value={price} onChange={e => setPrice(e.target.value)}
                  placeholder="150"
                  style={{ flex: 1, border: 'none', outline: 'none', fontFamily: 'Kanit', fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', minWidth: 0, background: 'transparent' }}
                />
              </div>
            </div>

            {/* ─── Shipping: toggle cards with subtitle (sync กับ /sell) ─── */}
            <div className="form-group">
              <label className="label">ค่าส่ง</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { val: true,  label: 'ส่งฟรี', sub: 'ราคานี้รวมค่าส่งแล้ว' },
                  { val: false, label: '+ ค่าส่ง', sub: 'คิดค่าส่งแยก' },
                ].map(opt => {
                  const active = includesShipping === opt.val
                  return (
                    <button
                      key={String(opt.val)} type="button" onClick={() => setIncludesShipping(opt.val)}
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

            {/* ช่องทางติดต่อ — auto จากโปรไฟล์ ถ้าไม่มี phone guard จะเด้งตอน submit */}
            {(user?.phone || user?.line_id) && (
              <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginBottom: 8 }}>ช่องทางติดต่อ</div>
                {user?.phone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: user?.line_id ? 6 : 0, fontSize: 14 }}>
                    <span>📞</span>
                    <span style={{ fontWeight: 600 }}>{user.phone?.length === 10 ? `${user.phone.slice(0,3)}-${user.phone.slice(3,6)}-${user.phone.slice(6)}` : user.phone}</span>
                  </div>
                )}
                {user?.line_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                    <span>💚</span>
                    <span style={{ fontWeight: 600 }}>{user.line_id}</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {saveMsg && (
            <div style={{ padding: 14, marginBottom: 12, background: '#dcfce7', border: '1px solid #86efac', borderRadius: 12, color: '#166534', fontSize: 14 }}>
              {saveMsg}
            </div>
          )}

          {/* Auth guard */}
          {!authLoading && !user && !authBypass && (
            <div style={{ ...errBox, background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', marginBottom: 12 }}>
              กรุณา login ก่อนลงขาย
              <button
                type="button"
                onClick={() => loginWithLine(typeof window !== 'undefined' ? window.location.pathname : '/test/sell-flow/cover')}
                style={{ ...btn('primary'), marginTop: 10, width: '100%' }}
              >
                เข้าสู่ระบบด้วย LINE
              </button>
            </div>
          )}

          {/* Dev mode banner */}
          {authBypass && (
            <div style={{ padding: 10, marginBottom: 12, background: '#fef3c7', border: '1px dashed #fcd34d', borderRadius: 10, fontSize: 13, color: '#92400e' }}>
              🧪 Dev mode — ใช้ admin user เป็น seller (production ต้อง login จริง)
            </div>
          )}

          {/* Action */}
          <button
            type="button" onClick={submitListing}
            disabled={!canSubmit || submitting || !effectiveUser}
            style={{ ...btn('primary'), width: '100%', marginTop: 8, opacity: (canSubmit && !submitting && effectiveUser) ? 1 : 0.5 }}
          >
            {submitting ? '⏳ กำลังบันทึก...' : '🚀 ลงขาย'}
          </button>

        </>
      )}

      {/* Phone guard — บังคับเบอร์โทรก่อนลงขาย (match /sell เดิม) */}
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
              type="tel" inputMode="numeric"
              value={guardPhoneInput}
              onChange={e => { setGuardPhoneInput(e.target.value); if (phoneGuardError) setPhoneGuardError('') }}
              onKeyDown={e => { if (e.key === 'Enter' && !savingPhone) savePhoneAndContinue() }}
              placeholder="08X-XXX-XXXX" autoFocus
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
              className="btn btn-ghost" disabled={savingPhone}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* Pioneer popup — ผู้บุกเบิกหนังสือใหม่ */}
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
              <b>&quot;{pioneerBook.title}&quot;</b>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.7, marginBottom: 16 }}>
              ถูกเพิ่มเข้า BookMatch เป็นครั้งแรกโดยคุณ
            </div>
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 18, fontSize: 13, color: '#92400E', lineHeight: 1.6, textAlign: 'left' }}>
              • ประกาศของคุณจะติดป้าย 🏆 ผู้บุกเบิก<br/>
              • listing ขึ้นอันดับแรกของเล่มนี้<br/>
              • รูปที่อัปโหลดจะเป็นปกประจำเล่ม
            </div>
            <button
              className="btn"
              onClick={() => {
                const isbn = pioneerBook.isbn
                setPioneerBook(null)
                router.push(`/book/${encodeURIComponent(isbn)}`)
              }}
            >
              ดูหนังสือของฉัน
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CandidateCard({
  cand, selected, onClick,
}: {
  cand: EnrichedCandidate
  selected: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', gap: 12, padding: 12, marginBottom: 8,
        minHeight: 96,
        border: selected ? '2px solid var(--primary)' : '1px solid var(--border)',
        borderRadius: 12, background: selected ? 'var(--primary-light)' : 'white',
        cursor: 'pointer',
      }}
    >
      <div style={{ width: 56, height: 76, background: '#e2e8f0', borderRadius: 6, flexShrink: 0, overflow: 'hidden' }}>
        {cand.cover_url && <img src={cand.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {cand.title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4, lineHeight: 1.4 }}>
          {cand.author || '—'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 6, lineHeight: 1.4 }}>
          {cand.isCertain
            ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓ ตรงกันแน่นอน</span>
            : <>ความคล้าย: <strong style={{ color: 'var(--accent-dark)' }}>{Math.round(cand.score * 100)}%</strong></>
          }
          {cand.isbn && ` · ISBN ${cand.isbn}`}
        </div>
      </div>
    </div>
  )
}

function FormField({
  label, value, onChange, hint, required, readOnly,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
  required?: boolean
  readOnly?: boolean
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="label">{label}</label>
      <input
        className="input" type="text" value={value}
        onChange={e => onChange(e.target.value)}
        readOnly={readOnly}
        style={{
          background: readOnly ? 'var(--surface)' : 'white',
          color: readOnly ? 'var(--ink2)' : 'var(--ink)',
        }}
      />
      {hint && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>{hint}</div>}
      {required && !value && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>จำเป็น</div>}
    </div>
  )
}

const card: React.CSSProperties = {
  padding: 16, background: 'white', border: '1px solid var(--border-light)',
  borderRadius: 14, marginBottom: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
}
const sectionLabel: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--ink2)',
  marginBottom: 10, letterSpacing: '0.02em',
}
const tipsBox: React.CSSProperties = {
  padding: 14, marginBottom: 14, background: '#fef9c3', border: '1px solid #fde68a',
  borderRadius: 12, fontSize: 14, color: '#713f12', lineHeight: 1.6,
}
const errBox: React.CSSProperties = {
  padding: 14, marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 12, fontSize: 14, color: '#991b1b', lineHeight: 1.5,
}
// Button สอดคล้อง design system: min-height 48px + Kanit + 16px
function btn(v: 'primary' | 'secondary' | 'ghost'): React.CSSProperties {
  const base: React.CSSProperties = {
    minHeight: 48, padding: '12px 16px', borderRadius: 12,
    fontFamily: "'Kanit', sans-serif", fontSize: 16, fontWeight: 600, cursor: 'pointer',
    border: '1px solid transparent', lineHeight: 1.4,
    boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  }
  if (v === 'primary') return { ...base, background: 'var(--primary)', color: 'white' }
  if (v === 'secondary') return { ...base, background: 'white', color: 'var(--ink)', borderColor: 'var(--border)' }
  return { ...base, background: '#E5E7EB', color: 'var(--ink)', boxShadow: 'none' }
}
