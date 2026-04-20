'use client'
// Spike: ทดสอบ Gemini Vision อ่านหน้าปก — ไม่มี DB, ไม่มี history
// เข้าถึงด้วย URL ตรงเท่านั้น ไม่ link จากหน้าหลัก
import { useState, useRef, useEffect } from 'react'

type Parsed = {
  title?: string | null
  subtitle?: string | null
  authors?: string[] | null
  publisher?: string | null
  language?: 'th' | 'en' | 'other' | null
  edition?: string | null
  confidence?: 'high' | 'medium' | 'low'
  notes?: string | null
}

type ApiResp = {
  model?: string
  duration_ms?: number
  raw?: string
  parsed?: Parsed | null
  parseError?: string | null
  error?: string
}

// resize → JPEG base64 ≤ ~500KB — ไม่ต้องฉลาดเท่า sell page
// คงความละเอียด 1280px เพราะ vision ต้องอ่านตัวอักษรไทย
async function fileToBase64(file: File, maxEdge = 1280, quality = 0.85): Promise<{ data: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bitmap) {
    // fallback: ส่งไฟล์ตรงๆ
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
  // chunk เพื่อกัน stack overflow ถ้าไฟล์ใหญ่
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
  }
  return { data: btoa(bin), mimeType: 'image/jpeg' }
}

// ราคา / 1M tokens (input, output) — Google pricing ณ Apr 2026, อาจเปลี่ยน
const MODEL_OPTIONS: { id: string; label: string; inPrice: number; outPrice: number }[] = [
  { id: 'gemini-2.5-flash-lite', label: '2.5 Flash-Lite (ถูก+ฉลาดพอ)', inPrice: 0.10, outPrice: 0.40 },
  { id: 'gemini-2.5-flash',      label: '2.5 Flash (balanced)',       inPrice: 0.30, outPrice: 2.50 },
  { id: 'gemini-2.5-pro',        label: '2.5 Pro (แม่นสุด แต่ช้า+แพง)', inPrice: 1.25, outPrice: 10.0 },
]

// สมมติ input image = 258 tokens, output JSON ~200 tokens
function estimateCostUSD(modelId: string): number {
  const m = MODEL_OPTIONS.find(x => x.id === modelId) ?? MODEL_OPTIONS[0]
  return (258 * m.inPrice + 200 * m.outPrice) / 1_000_000
}

export default function CoverScanTestPage() {
  const [preview, setPreview] = useState<string | null>(null)
  const [base64, setBase64] = useState<{ data: string; mimeType: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [resp, setResp] = useState<ApiResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [modelId, setModelId] = useState<string>('gemini-2.5-flash-lite')
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  // Cleanup preview ตอน unmount — ref pattern กัน stale closure
  const previewRef = useRef<string | null>(null)
  useEffect(() => { previewRef.current = preview }, [preview])
  useEffect(() => {
    return () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }
  }, [])

  async function onPick(file: File | null) {
    if (!file) return
    setResp(null); setErr(null)
    // Revoke อันเก่า + ใส่ใหม่ — กัน memory leak ถ้า user เลือกหลายรูปต่อกัน
    setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    try {
      const b = await fileToBase64(file)
      setBase64(b)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ไม่สามารถอ่านไฟล์ได้')
    }
  }

  async function analyze() {
    if (!base64) return
    setLoading(true); setErr(null); setResp(null)
    try {
      const r = await fetch('/api/test/cover-scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64.data,
          mimeType: base64.mimeType,
          model: modelId,
        }),
      })
      const j: ApiResp = await r.json()
      if (!r.ok) setErr(j.error || `HTTP ${r.status}`)
      setResp(j)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'request_failed')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setPreview(null); setBase64(null); setResp(null); setErr(null)
    if (inputRef.current) inputRef.current.value = ''
    if (cameraRef.current) cameraRef.current.value = ''
  }

  const p = resp?.parsed ?? null

  return (
    <div style={{ padding: 16, paddingBottom: 48 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>🧪 Cover Scan Test</h1>
        <p style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4 }}>
          ทดสอบ Gemini Vision อ่านหน้าปก — ไม่บันทึกข้อมูล
        </p>
      </header>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', marginBottom: 4, fontWeight: 600 }}>
          Model
        </label>
        <select
          value={modelId}
          onChange={e => setModelId(e.target.value)}
          style={{
            width: '100%', minHeight: 44, padding: '0 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'white',
            fontFamily: 'inherit', fontSize: 14,
          }}
        >
          {MODEL_OPTIONS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        <input
          ref={cameraRef} type="file" accept="image/*" capture="environment"
          onChange={e => onPick(e.target.files?.[0] ?? null)} style={{ display: 'none' }}
        />
        <input
          ref={inputRef} type="file" accept="image/*"
          onChange={e => onPick(e.target.files?.[0] ?? null)} style={{ display: 'none' }}
        />
        <button
          type="button" onClick={() => cameraRef.current?.click()}
          style={btn('primary')}
        >📷 ถ่ายรูปปก</button>
        <button
          type="button" onClick={() => inputRef.current?.click()}
          style={btn('secondary')}
        >🖼️ อัปโหลดภาพ</button>
      </div>

      {preview && (
        <div style={{ marginBottom: 16 }}>
          <img
            src={preview} alt="preview"
            style={{ width: '100%', maxHeight: 360, objectFit: 'contain', background: '#f1f5f9', borderRadius: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button" onClick={analyze} disabled={loading || !base64}
              style={{ ...btn('primary'), flex: 1, opacity: loading ? 0.6 : 1 }}
            >{loading ? '⏳ กำลังวิเคราะห์…' : '🔍 วิเคราะห์'}</button>
            <button type="button" onClick={reset} style={btn('ghost')}>ล้าง</button>
          </div>
        </div>
      )}

      {err && (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 13, marginBottom: 12 }}>
          ⚠️ {err}
        </div>
      )}

      {resp && (
        <>
          <section style={card}>
            <div style={sectionLabel}>Metadata</div>
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              <div>Model: <code>{resp.model}</code></div>
              <div>Duration: <strong>{resp.duration_ms} ms</strong></div>
              <div>Confidence: <strong>{p?.confidence ?? '—'}</strong></div>
              <div>Est. cost: ≈ ${estimateCostUSD(resp.model ?? modelId).toFixed(6)} / ภาพ</div>
              {resp.parseError && <div style={{ color: '#dc2626' }}>Parse error: {resp.parseError}</div>}
            </div>
          </section>

          {p && (
            <section style={card}>
              <div style={sectionLabel}>Form (pre-filled)</div>
              <Field label="Title" value={p.title} />
              <Field label="Subtitle" value={p.subtitle} />
              <Field label="Authors" value={Array.isArray(p.authors) ? p.authors.join(', ') : p.authors} />
              <Field label="Publisher" value={p.publisher} />
              <Field label="Language" value={p.language} />
              <Field label="Edition" value={p.edition} />
              <Field label="Notes" value={p.notes} />
            </section>
          )}

          <section style={card}>
            <div style={sectionLabel}>Raw response</div>
            <pre style={{ fontSize: 11, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 6, lineHeight: 1.5 }}>
              {resp.raw ?? JSON.stringify(resp, null, 2)}
            </pre>
          </section>
        </>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '6px 0', fontSize: 14, borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ width: 90, color: 'var(--ink3)', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, color: value ? 'var(--ink)' : 'var(--ink3)', fontStyle: value ? 'normal' : 'italic' }}>
        {value || '—'}
      </div>
    </div>
  )
}

const card: React.CSSProperties = {
  padding: 12, background: 'white', border: '1px solid var(--border)',
  borderRadius: 8, marginBottom: 12,
}
const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--ink3)',
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
}
function btn(v: 'primary' | 'secondary' | 'ghost'): React.CSSProperties {
  const base: React.CSSProperties = {
    minHeight: 44, padding: '0 16px', borderRadius: 8,
    fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer',
    border: '1px solid transparent',
  }
  if (v === 'primary') return { ...base, background: 'var(--primary)', color: 'white' }
  if (v === 'secondary') return { ...base, background: 'white', color: 'var(--ink)', borderColor: 'var(--border)' }
  return { ...base, background: 'transparent', color: 'var(--ink3)', borderColor: 'var(--border)' }
}
