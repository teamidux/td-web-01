'use client'
// Sell flow v2: Cover capture + AI extract + dedup + sell form + save
// Save จริงเข้า DB แต่ tag source='vision_test' — filter/ลบทีหลังได้
// เข้าถึง: /test/sell-flow/cover (ไม่ link จากหน้าหลัก)
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

const CONDITIONS = [
  { key: 'brand_new', label: '🆕 มือหนึ่ง', desc: 'ยังไม่ผ่านการใช้งาน' },
  { key: 'new',       label: '✨ ใหม่มาก',  desc: 'ไม่มีรอยใดๆ' },
  { key: 'good',      label: '👍 ดี',      desc: 'มีรอยเล็กน้อย อ่านได้ปกติ' },
  { key: 'fair',      label: '📖 พอใช้',   desc: 'มีรอยชัดเจน แต่เนื้อหาครบ' },
]

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

// Match แน่นอนถ้า: normalized title เหมือนเป๊ะ
// หรือ score ≥ 0.85 AND length ratio ≥ 0.7 (กัน short query match long title)
function isCertainMatch(aiTitle: string, dbTitle: string, score: number): boolean {
  const a = normStrict(aiTitle)
  const b = normStrict(dbTitle)
  if (!a || !b) return false
  if (a === b) return true
  if (score < 0.85) return false
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
  return ratio >= 0.7
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
  const router = useRouter()
  const { user, loading: authLoading, loginWithLine } = useAuth()
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
  const [contact, setContact] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const parsed = resp?.extract?.parsed
  const confidence = parsed?.confidence
  const rawCandidates = resp?.dedup?.candidates ?? []

  // Post-process: เช็คว่าเป็น "match แน่นอน" จริงๆ ไม่ใช่แค่ prefix match
  // เคสปัญหา: AI title "ฮวงจุ้ย" match "ฮวงจุ้ย ศาสตร์..." ได้ 100% ทั้งที่คนละเล่ม
  // แก้: normalize strict + เช็ค length ratio
  const aiTitle = parsed?.title || ''
  const candidates = rawCandidates.map(c => ({
    ...c,
    isCertain: isCertainMatch(aiTitle, c.title, c.score),
  }))
  const hasTopMatch = candidates.length > 0 && candidates[0].isCertain

  // Auto-fill form เมื่อ AI extract สำเร็จ
  const autoFilled = !!parsed
  if (parsed && form.title === '' && form.authors === '') {
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

  async function onPick(file: File | null) {
    if (!file) return
    resetAll()
    setPreview(URL.createObjectURL(file))
    try {
      const b = await fileToBase64(file)
      setBase64(b)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ไม่สามารถอ่านไฟล์ได้')
    }
  }

  function resetAll() {
    setResp(null); setErr(null); setSelectedBookId(null)
    setForm({ title: '', subtitle: '', authors: '', publisher: '', language: 'th', edition: '', isbn: '' })
  }

  function retake() {
    setPreview(null); setBase64(null); resetAll()
    if (cameraRef.current) cameraRef.current.value = ''
    if (uploadRef.current) uploadRef.current.value = ''
  }

  async function analyze() {
    if (!base64) return
    setLoading(true); setErr(null); setResp(null); setSelectedBookId(null)
    try {
      const r = await fetch('/api/test/sell-flow/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64.data,
          mimeType: base64.mimeType,
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

  function useThisBook(cand: Candidate) {
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

  function createNewInstead() {
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
  }

  // Dev mode bypass — บน localhost LINE OAuth ใช้ไม่ได้ → ยอมให้เทสแบบไม่ login
  // server-side จะ fallback ไปใช้ admin user (เฉพาะเมื่อ NODE_ENV=development)
  const isDev = process.env.NODE_ENV === 'development'
  const authBypass = !user && isDev
  const effectiveUser = user || (authBypass ? { id: 'dev' } : null)

  async function submitListing() {
    if (!effectiveUser) { setErr('กรุณา login ก่อนลงขาย'); return }
    if (!base64) { setErr('ไม่พบภาพปก'); return }

    const priceNum = parseFloat(price)
    if (!isFinite(priceNum) || priceNum <= 0) { setErr('กรุณาใส่ราคาที่ถูกต้อง'); return }
    if (!contact.trim()) { setErr('กรุณาใส่ช่องทางติดต่อ'); return }

    setSubmitting(true); setErr(null); setSaveMsg(null)
    try {
      // 1. Upload ภาพไป Supabase Storage (bucket: listing-photos)
      const blob = base64ToBlob(base64.data, base64.mimeType)
      const ts = Date.now()
      const path = `covers/${effectiveUser.id}/${ts}_vision.jpg`
      const { error: upErr } = await supabase.storage
        .from('listing-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (upErr) throw new Error(`Upload: ${upErr.message}`)
      const photoUrl = supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl

      // 2. POST ไป commit endpoint
      const authorsList = form.authors.split(',').map(s => s.trim()).filter(Boolean)
      const r = await fetch('/api/test/sell-flow/commit', {
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
          contact: contact.trim(),
          notes: notes.trim(),
          photos: [photoUrl],
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setSaveMsg(`✅ ลงขายสำเร็จ — book_id: ${j.book_id}${j.is_new_book ? ' (หนังสือใหม่)' : ''}`)
      // เคลียร์ฟอร์มให้เทสเล่มต่อไปได้
      setTimeout(() => {
        retake(); setPrice(''); setContact(''); setNotes(''); setCond('good'); setIncludesShipping(false)
      }, 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    form.title.trim().length > 0 &&
    form.authors.trim().length > 0 &&
    parseFloat(price) > 0 &&
    contact.trim().length > 0

  return (
    <div style={{ padding: 16, paddingBottom: 80 }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>
          <Link href="/test/sell-flow" style={{ color: 'var(--primary)', fontWeight: 600, minHeight: 44, display: 'inline-block', padding: '6px 0' }}>
            ← กลับ
          </Link>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.35, letterSpacing: '-0.02em' }}>
          📖 ถ่ายหน้าปกหนังสือ
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ink3)', marginTop: 6, lineHeight: 1.5 }}>
          ทดสอบ flow ลงขายด้วยการถ่ายหน้าปก (ไม่ save จริง)
        </p>
      </header>

      {/* ─── Capture section ─── */}
      {!preview && (
        <>
          <div style={tipsBox}>
            💡 <strong>เคล็ดลับถ่ายปก</strong>
            <ul style={{ margin: '8px 0 0 20px', fontSize: 14, lineHeight: 1.7 }}>
              <li>ถ่ายหน้าตรง ให้ปกเต็มกรอบ</li>
              <li>ถ้าปกสะท้อนแสง ลองหามุมเอียงใหม่</li>
              <li>ถ่ายในที่สว่างพอ</li>
            </ul>
          </div>

          <input
            ref={cameraRef} type="file" accept="image/*" capture="environment"
            onChange={e => onPick(e.target.files?.[0] ?? null)} style={{ display: 'none' }}
          />
          <input
            ref={uploadRef} type="file" accept="image/*"
            onChange={e => onPick(e.target.files?.[0] ?? null)} style={{ display: 'none' }}
          />
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

      {/* ─── Preview + Analyze ─── */}
      {preview && !resp && (
        <>
          <img
            src={preview} alt="cover"
            style={{ width: '100%', maxHeight: 400, objectFit: 'contain', background: '#f1f5f9', borderRadius: 8, marginBottom: 12 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" onClick={analyze} disabled={loading || !base64}
              style={{ ...btn('primary'), flex: 1, opacity: loading ? 0.6 : 1 }}
            >
              {loading ? '⏳ กำลังอ่านปก...' : '🔍 วิเคราะห์'}
            </button>
            <button type="button" onClick={retake} style={btn('ghost')}>ถ่ายใหม่</button>
          </div>
        </>
      )}

      {/* ─── Error ─── */}
      {err && (
        <div style={errBox}>⚠️ {err}</div>
      )}

      {/* ─── Result: confidence warning + dedup + form ─── */}
      {resp && autoFilled && (
        <>
          {/* Preview thumbnail */}
          {preview && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
              <img src={preview} alt="" style={{ width: 80, height: 110, objectFit: 'cover', borderRadius: 8, background: '#f1f5f9' }} />
              <div style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.7 }}>
                <div>⏱ {resp.extract?.duration_ms}ms</div>
                <div>🧠 {resp.extract?.model}</div>
                <div>📍 {resp.extract?.location}</div>
              </div>
              <button type="button" onClick={retake} className="btn-sm btn-ghost" style={{ marginLeft: 'auto' }}>
                ถ่ายใหม่
              </button>
            </div>
          )}

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

          {/* Dedup section */}
          {candidates.length > 0 && (
            <section style={card}>
              <div style={sectionLabel}>
                {hasTopMatch
                  ? '✅ พบหนังสือนี้ในระบบแล้ว'
                  : '🤔 อาจมีในระบบ — กรุณาตรวจสอบเองก่อนเลือก'}
              </div>
              {candidates.map(cand => (
                <div
                  key={cand.id}
                  style={{
                    display: 'flex', gap: 12, padding: 12, marginBottom: 10,
                    minHeight: 96,
                    border: selectedBookId === cand.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                    borderRadius: 12, background: selectedBookId === cand.id ? 'var(--primary-light)' : 'white',
                    cursor: 'pointer',
                  }}
                  onClick={() => useThisBook(cand)}
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
              ))}
              {selectedBookId && (
                <button type="button" onClick={createNewInstead} style={{ ...btn('ghost'), width: '100%', marginTop: 4 }}>
                  ไม่ใช่ — สร้างเป็นหนังสือใหม่
                </button>
              )}
            </section>
          )}

          {candidates.length === 0 && (
            <div style={{ ...card, background: 'var(--primary-light)', border: '1px solid var(--primary)', color: 'var(--primary-strong)', fontSize: 14, lineHeight: 1.6 }}>
              🆕 <strong>ไม่พบในระบบ</strong> — จะสร้างเป็นหนังสือใหม่
            </div>
          )}

          {/* Form */}
          <section style={card}>
            <div style={sectionLabel}>
              {selectedBookId ? 'ข้อมูลจากระบบ (แก้ไขไม่ได้)' : 'ข้อมูลจาก AI (แก้ไขได้)'}
            </div>
            <FormField
              label="ชื่อหนังสือ *"
              value={form.title}
              onChange={v => setForm(s => ({ ...s, title: v }))}
              required readOnly={!!selectedBookId}
            />
            <FormField
              label="ชื่อรอง"
              value={form.subtitle}
              onChange={v => setForm(s => ({ ...s, subtitle: v }))}
              readOnly={!!selectedBookId}
            />
            <FormField
              label="ผู้แต่ง *"
              value={form.authors}
              onChange={v => setForm(s => ({ ...s, authors: v }))}
              hint="คั่นด้วย comma ถ้ามีหลายคน"
              required readOnly={!!selectedBookId}
            />
            <FormField
              label="สำนักพิมพ์"
              value={form.publisher}
              onChange={v => setForm(s => ({ ...s, publisher: v }))}
              readOnly={!!selectedBookId}
            />
            <FormField
              label="พิมพ์ครั้งที่"
              value={form.edition}
              onChange={v => setForm(s => ({ ...s, edition: v }))}
              readOnly={!!selectedBookId}
            />
            <FormField
              label="ISBN"
              value={form.isbn}
              onChange={v => setForm(s => ({ ...s, isbn: v }))}
              hint="ว่างได้ ถ้าไม่มีบาร์โค้ด"
              readOnly={!!selectedBookId}
            />
          </section>

          {/* Sell fields */}
          <section style={card}>
            <div style={sectionLabel}>💰 รายละเอียดที่ลงขาย</div>

            <div style={{ marginBottom: 14 }}>
              <label className="label">สภาพหนังสือ *</label>
              <div style={{ display: 'grid', gap: 8 }}>
                {CONDITIONS.map(c => (
                  <button
                    key={c.key} type="button"
                    onClick={() => setCond(c.key)}
                    style={{
                      textAlign: 'left', padding: '12px 14px', borderRadius: 12,
                      border: cond === c.key ? '2px solid var(--primary)' : '1px solid var(--border)',
                      background: cond === c.key ? 'var(--primary-light)' : 'white',
                      fontFamily: "'Kanit', sans-serif", cursor: 'pointer', minHeight: 48,
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{c.label}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 2 }}>{c.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="label">ราคา (บาท) *</label>
              <input
                className="input" type="number" inputMode="numeric" min="1"
                value={price} onChange={e => setPrice(e.target.value)}
                placeholder="เช่น 150"
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer', minHeight: 44 }}>
              <input
                type="checkbox" checked={includesShipping}
                onChange={e => setIncludesShipping(e.target.checked)}
                style={{ width: 20, height: 20, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 15 }}>ราคานี้รวมค่าส่งแล้ว</span>
            </label>

            <div style={{ marginBottom: 14 }}>
              <label className="label">ช่องทางติดต่อ *</label>
              <input
                className="input" type="text"
                value={contact} onChange={e => setContact(e.target.value)}
                placeholder="เบอร์โทร / LINE ID"
              />
            </div>

            <div style={{ marginBottom: 4 }}>
              <label className="label">หมายเหตุ (ไม่บังคับ)</label>
              <textarea
                className="input"
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="เช่น มีรอยเล็กน้อยที่มุม"
                rows={3}
                style={{ minHeight: 80, paddingTop: 12, paddingBottom: 12, resize: 'vertical' }}
              />
            </div>
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

          {!canSubmit && (
            <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 8, textAlign: 'center' }}>
              กรุณากรอก: ชื่อหนังสือ, ผู้แต่ง, ราคา, ช่องทางติดต่อ
            </div>
          )}
        </>
      )}
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
