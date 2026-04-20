'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// Resize book cover: max 800px (รองรับ retina), jpg quality ปรับอัตโนมัติจน ≤ 300KB
function compressCover(file: File, maxKB = 300): Promise<File> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      let { width, height } = img
      const MAX = 800
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX }
        else { width = Math.round(width * MAX / height); height = MAX }
      }
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      const tryQ = (q: number) => {
        canvas.toBlob(blob => {
          if (!blob) { canvas.width = 0; canvas.height = 0; resolve(file); return }
          if (blob.size <= maxKB * 1024 || q <= 0.1) {
            canvas.width = 0; canvas.height = 0
            resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
          } else {
            tryQ(Math.round((q - 0.1) * 10) / 10)
          }
        }, 'image/jpeg', q)
      }
      tryQ(0.85)
    }
    img.onerror = () => resolve(file)
    img.src = url
  })
}

type Book = {
  id: string
  isbn: string
  title: string
  author: string
  translator: string | null
  publisher: string | null
  description: string | null
  cover_url: string | null
  language: string
  active_listings_count: number
  wanted_count: number
  created_at: string
}

export default function AdminBooksPage() {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Book | null>(null)
  const [creating, setCreating] = useState<Partial<Book> | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const createFileInputRef = useRef<HTMLInputElement>(null)

  const deleteBook = async (b: Book) => {
    const warning = (b.active_listings_count > 0 || b.wanted_count > 0)
      ? `\n\n⚠️ หนังสือนี้มี ${b.active_listings_count} listing และ ${b.wanted_count} คนตามหา — ลบแล้วจะหายหมด`
      : ''
    if (!confirm(`ลบหนังสือ "${b.title}"?${warning}\n\nทำแล้ว undo ไม่ได้`)) return
    setDeletingId(b.id)
    try {
      const res = await fetch('/api/tomga/books', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: b.id }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { alert('ลบไม่สำเร็จ: ' + (d.error || 'unknown')); return }
      setBooks(prev => prev.filter(x => x.id !== b.id))
    } finally {
      setDeletingId(null)
    }
  }

  const pickCover = async (file: File) => {
    if (!editing) return
    if (!file.type.startsWith('image/')) { alert('เลือกไฟล์รูปภาพเท่านั้น'); return }
    setUploading(true)
    try {
      const compressed = await compressCover(file)
      const path = `book-covers/${editing.isbn || editing.id}/${Date.now()}.jpg`
      const { error } = await supabase.storage
        .from('listing-photos')
        .upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
      if (error) { alert('อัปโหลดไม่สำเร็จ: ' + error.message); return }
      const { data: { publicUrl } } = supabase.storage.from('listing-photos').getPublicUrl(path)
      setEditing(e => e ? { ...e, cover_url: publicUrl } : e)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q })
      const res = await fetch('/api/tomga/books?' + params)
      const d = await res.json()
      setBooks(d.books || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [q])

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const res = await fetch('/api/tomga/books', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          title: editing.title,
          author: editing.author,
          translator: editing.translator,
          publisher: editing.publisher,
          description: editing.description,
          cover_url: editing.cover_url,
          language: editing.language,
        }),
      })
      const d = await res.json()
      if (!res.ok) { alert('บันทึกไม่สำเร็จ: ' + (d.error || 'unknown')); return }
      setEditing(null)
      await load()
    } finally { setSaving(false) }
  }

  const createBook = async () => {
    if (!creating) return
    if (!creating.isbn?.trim()) { alert('ใส่ ISBN ก่อน'); return }
    if (!creating.title?.trim()) { alert('ใส่ชื่อหนังสือก่อน'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/tomga/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creating),
      })
      const d = await res.json()
      if (!res.ok) {
        if (res.status === 409 && d.existing_id) {
          if (confirm(`${d.error}\nเปิดแก้ไขแทนไหม?`)) {
            setCreating(null)
            // หา book ใน list ถ้าเจอเปิด modal edit
            const existing = books.find(b => b.id === d.existing_id)
            if (existing) setEditing(existing)
            else { setQ(creating.isbn || ''); setCreating(null) }
          }
        } else {
          alert('สร้างไม่สำเร็จ: ' + (d.error || 'unknown'))
        }
        return
      }
      setCreating(null)
      await load()
    } finally { setSaving(false) }
  }

  const pickCreateCover = async (file: File) => {
    if (!creating) return
    if (!file.type.startsWith('image/')) { alert('เลือกไฟล์รูปภาพเท่านั้น'); return }
    const isbn = creating.isbn?.replace(/[^0-9X]/gi, '') || ''
    if (!isbn) { alert('ใส่ ISBN ก่อนอัปโหลดรูป'); return }
    setUploading(true)
    try {
      const compressed = await compressCover(file)
      const path = `book-covers/${isbn}/${Date.now()}.jpg`
      const { error } = await supabase.storage
        .from('listing-photos')
        .upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
      if (error) { alert('อัปโหลดไม่สำเร็จ: ' + error.message); return }
      const { data: { publicUrl } } = supabase.storage.from('listing-photos').getPublicUrl(path)
      setCreating(c => c ? { ...c, cover_url: publicUrl } : c)
    } finally {
      setUploading(false)
      if (createFileInputRef.current) createFileInputRef.current.value = ''
    }
  }

  return (
    <>
      <div style={{ padding: '24px 0 80px' }}>
        <h1 style={{ fontFamily: "'Kanit', sans-serif", fontSize: 28, fontWeight: 800, color: '#0F172A', margin: 0, marginBottom: 6 }}>
          จัดการข้อมูลหนังสือ
        </h1>
        <p style={{ fontSize: 14, color: '#94A3B8', marginTop: 0, marginBottom: 20 }}>
          แก้ไขชื่อ, ผู้แต่ง, สำนักพิมพ์, รูปปก, รายละเอียด
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="🔍 ค้นหาจากชื่อ / ผู้แต่ง / ISBN"
            style={{ flex: 1, minWidth: 200, padding: '12px 16px', border: '1px solid #E2E8F0', borderRadius: 10, fontFamily: 'Kanit', fontSize: 15, outline: 'none' }}
          />
          <button
            onClick={() => setCreating({ isbn: '', title: '', author: '', translator: '', publisher: '', description: '', cover_url: '', language: 'th', id: '', active_listings_count: 0, wanted_count: 0, created_at: '' })}
            style={{ background: '#16A34A', color: 'white', border: 'none', borderRadius: 10, padding: '12px 18px', minHeight: 44, fontSize: 14, fontWeight: 700, fontFamily: 'Kanit', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ➕ เพิ่มหนังสือ
          </button>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>Loading...</div>}
        {!loading && books.length === 0 && <div style={{ textAlign: 'center', padding: 60, color: '#CBD5E1' }}>ไม่พบหนังสือ</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {books.map(b => (
            <div key={b.id} style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 48, height: 66, borderRadius: 6, background: b.cover_url ? `url(${b.cover_url}) center/cover` : '#F1F5F9', flexShrink: 0, border: '1px solid #E2E8F0' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.title || <span style={{ color: '#CBD5E1' }}>(ไม่มีชื่อ)</span>}
                </div>
                <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
                  {b.author || '—'} {b.publisher && `· ${b.publisher}`}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 3 }}>
                  ISBN: {b.isbn} · {b.active_listings_count} ลงขาย · {b.wanted_count} ตามหา
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => setEditing(b)}
                  style={{ background: 'white', border: '1px solid #E2E8F0', color: '#2563EB', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit', minHeight: 32 }}
                >
                  ✏️ แก้ไข
                </button>
                <button
                  onClick={() => deleteBook(b)}
                  disabled={deletingId === b.id}
                  style={{ background: 'white', border: '1px solid #FECACA', color: '#DC2626', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: deletingId === b.id ? 'wait' : 'pointer', fontFamily: 'Kanit', minHeight: 32, opacity: deletingId === b.id ? 0.5 : 1 }}
                >
                  {deletingId === b.id ? '...' : '🗑️ ลบ'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div onClick={() => setEditing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.7)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: '24px 26px', width: '100%', maxWidth: 560 }}>
            <div style={{ fontFamily: 'Kanit', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>แก้ไขข้อมูลหนังสือ</div>
            <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 18 }}>ISBN: {editing.isbn}</div>

            {/* Cover upload */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>รูปปก</label>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {editing.cover_url ? (
                  <img src={editing.cover_url} alt="cover" style={{ width: 90, height: 130, objectFit: 'cover', borderRadius: 6, border: '1px solid #E2E8F0', background: '#F1F5F9', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 90, height: 130, borderRadius: 6, background: '#F1F5F9', border: '1px dashed #CBD5E1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>📖</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={e => { const f = e.target.files?.[0]; if (f) pickCover(f) }}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={{ background: '#2563EB', color: 'white', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: uploading ? 'wait' : 'pointer', fontFamily: 'Kanit', opacity: uploading ? 0.6 : 1, marginBottom: 8 }}
                  >
                    {uploading ? 'กำลังอัปโหลด...' : editing.cover_url ? '📷 เปลี่ยนรูปปก' : '📷 อัปโหลดรูปปก'}
                  </button>
                  {editing.cover_url && (
                    <button
                      type="button"
                      onClick={() => setEditing(e => e ? { ...e, cover_url: '' } : e)}
                      style={{ background: 'white', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit', marginLeft: 8, marginBottom: 8 }}
                    >
                      ลบ
                    </button>
                  )}
                  <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.5, marginBottom: 6 }}>
                    ระบบย่อเหลือ 800px / ≤300KB ให้อัตโนมัติ
                  </div>
                  <input
                    placeholder="หรือวาง URL รูปปก"
                    value={editing.cover_url || ''}
                    onChange={e => setEditing({ ...editing, cover_url: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 6, fontFamily: 'Kanit', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            {[
              { key: 'title', label: 'ชื่อหนังสือ', type: 'input' },
              { key: 'author', label: 'ผู้แต่ง', type: 'input' },
              { key: 'translator', label: 'ผู้แปล', type: 'input' },
              { key: 'publisher', label: 'สำนักพิมพ์', type: 'input' },
              { key: 'language', label: 'ภาษา (th, en)', type: 'input' },
              { key: 'description', label: 'รายละเอียด', type: 'textarea' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>{f.label}</label>
                {f.type === 'textarea' ? (
                  <textarea
                    value={(editing as any)[f.key] || ''}
                    onChange={e => setEditing({ ...editing, [f.key]: e.target.value } as Book)}
                    rows={4}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontFamily: 'Kanit', fontSize: 14, outline: 'none', resize: 'vertical' }}
                  />
                ) : (
                  <input
                    value={(editing as any)[f.key] || ''}
                    onChange={e => setEditing({ ...editing, [f.key]: e.target.value } as Book)}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontFamily: 'Kanit', fontSize: 14, outline: 'none' }}
                  />
                )}
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button
                onClick={() => setEditing(null)}
                style={{ flex: 1, background: 'white', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px', fontFamily: 'Kanit', fontWeight: 600, color: '#64748B', cursor: 'pointer', fontSize: 14 }}
              >
                ยกเลิก
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{ flex: 2, background: '#2563EB', border: 'none', borderRadius: 10, padding: '12px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, cursor: 'pointer', fontSize: 14, opacity: saving ? 0.5 : 1 }}
              >
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create modal — เพิ่มหนังสือใหม่ */}
      {creating && (
        <div onClick={() => setCreating(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.7)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: '24px 26px', width: '100%', maxWidth: 560 }}>
            <div style={{ fontFamily: 'Kanit', fontSize: 19, fontWeight: 700, marginBottom: 4 }}>➕ เพิ่มหนังสือใหม่</div>
            <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 18 }}>กรอก ISBN และชื่อหนังสืออย่างน้อย</div>

            {/* ISBN — required */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                ISBN <span style={{ color: '#DC2626' }}>*</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: '#94A3B8', marginLeft: 6 }}>13 หลัก ขึ้นต้น 978/979</span>
              </label>
              <input
                value={creating.isbn || ''}
                onChange={e => setCreating({ ...creating, isbn: e.target.value.replace(/[^0-9X]/gi, '') })}
                placeholder="9786160123456"
                maxLength={13}
                inputMode="numeric"
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontFamily: 'monospace', fontSize: 15, outline: 'none', letterSpacing: 1 }}
              />
            </div>

            {/* Cover upload */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>รูปปก</label>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {creating.cover_url ? (
                  <img src={creating.cover_url} alt="cover" style={{ width: 90, height: 130, objectFit: 'cover', borderRadius: 6, border: '1px solid #E2E8F0', background: '#F1F5F9', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 90, height: 130, borderRadius: 6, background: '#F1F5F9', border: '1px dashed #CBD5E1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>📖</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input ref={createFileInputRef} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) pickCreateCover(f) }} style={{ display: 'none' }} />
                  <button
                    type="button"
                    onClick={() => createFileInputRef.current?.click()}
                    disabled={uploading}
                    style={{ background: '#2563EB', color: 'white', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: uploading ? 'wait' : 'pointer', fontFamily: 'Kanit', opacity: uploading ? 0.6 : 1, marginBottom: 8 }}
                  >
                    {uploading ? 'กำลังอัปโหลด...' : creating.cover_url ? '📷 เปลี่ยนรูปปก' : '📷 อัปโหลดรูปปก'}
                  </button>
                  <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.5, marginBottom: 6 }}>
                    ระบบย่อเหลือ 800px / ≤300KB ให้อัตโนมัติ
                  </div>
                  <input
                    placeholder="หรือวาง URL รูปปก"
                    value={creating.cover_url || ''}
                    onChange={e => setCreating({ ...creating, cover_url: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 6, fontFamily: 'Kanit', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>

            {[
              { key: 'title', label: 'ชื่อหนังสือ *', type: 'input', placeholder: 'ระบุชื่อหนังสือ' },
              { key: 'author', label: 'ผู้แต่ง', type: 'input', placeholder: '' },
              { key: 'translator', label: 'ผู้แปล', type: 'input', placeholder: '' },
              { key: 'publisher', label: 'สำนักพิมพ์', type: 'input', placeholder: '' },
              { key: 'language', label: 'ภาษา', type: 'input', placeholder: 'th / en' },
              { key: 'description', label: 'รายละเอียด', type: 'textarea', placeholder: '' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>{f.label}</label>
                {f.type === 'textarea' ? (
                  <textarea
                    value={(creating as any)[f.key] || ''}
                    onChange={e => setCreating({ ...creating, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    rows={4}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontFamily: 'Kanit', fontSize: 14, outline: 'none', resize: 'vertical' }}
                  />
                ) : (
                  <input
                    value={(creating as any)[f.key] || ''}
                    onChange={e => setCreating({ ...creating, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontFamily: 'Kanit', fontSize: 14, outline: 'none' }}
                  />
                )}
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button
                onClick={() => setCreating(null)}
                style={{ flex: 1, background: 'white', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px', fontFamily: 'Kanit', fontWeight: 600, color: '#64748B', cursor: 'pointer', fontSize: 14 }}
              >
                ยกเลิก
              </button>
              <button
                onClick={createBook}
                disabled={saving}
                style={{ flex: 2, background: '#16A34A', border: 'none', borderRadius: 10, padding: '12px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, cursor: 'pointer', fontSize: 14, opacity: saving ? 0.5 : 1 }}
              >
                {saving ? 'กำลังสร้าง...' : '➕ เพิ่มหนังสือ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
