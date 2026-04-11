'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

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
  const [saving, setSaving] = useState(false)

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

  return (
    <>
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid #E2E8F0', marginBottom: 8 }}>
        <Link href="/tomga" style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, fontWeight: 700, color: '#2563EB', textDecoration: 'none' }}>
          BookMatch <span style={{ fontSize: 14, color: '#94A3B8', fontWeight: 500 }}>Admin</span>
        </Link>
        <Link href="/tomga" style={{ fontSize: 15, color: '#64748B', textDecoration: 'none', fontFamily: 'Kanit' }}>← Dashboard</Link>
      </nav>

      <div style={{ padding: '24px 0 80px' }}>
        <h1 style={{ fontFamily: "'Kanit', sans-serif", fontSize: 28, fontWeight: 800, color: '#0F172A', margin: 0, marginBottom: 6 }}>
          จัดการข้อมูลหนังสือ
        </h1>
        <p style={{ fontSize: 14, color: '#94A3B8', marginTop: 0, marginBottom: 20 }}>
          แก้ไขชื่อ, ผู้แต่ง, สำนักพิมพ์, รูปปก, รายละเอียด
        </p>

        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="🔍 ค้นหาจากชื่อ / ผู้แต่ง / ISBN"
          style={{ width: '100%', padding: '12px 16px', border: '1px solid #E2E8F0', borderRadius: 10, fontFamily: 'Kanit', fontSize: 15, marginBottom: 16, outline: 'none' }}
        />

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
              <button
                onClick={() => setEditing(b)}
                style={{ background: 'white', border: '1px solid #E2E8F0', color: '#2563EB', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit', flexShrink: 0 }}
              >
                ✏️ แก้ไข
              </button>
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

            {[
              { key: 'title', label: 'ชื่อหนังสือ', type: 'input' },
              { key: 'author', label: 'ผู้แต่ง', type: 'input' },
              { key: 'translator', label: 'ผู้แปล', type: 'input' },
              { key: 'publisher', label: 'สำนักพิมพ์', type: 'input' },
              { key: 'cover_url', label: 'URL รูปปก', type: 'input' },
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

            {editing.cover_url && (
              <div style={{ marginBottom: 14, fontSize: 12, color: '#94A3B8' }}>
                <div style={{ marginBottom: 4 }}>Preview:</div>
                <img src={editing.cover_url} alt="cover preview" style={{ maxWidth: 120, maxHeight: 160, borderRadius: 6, border: '1px solid #E2E8F0' }} />
              </div>
            )}

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
    </>
  )
}
