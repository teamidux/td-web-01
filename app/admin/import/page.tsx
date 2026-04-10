'use client'
import { useState, useRef } from 'react'
import { useAuth } from '@/lib/auth'
import { Nav } from '@/components/ui'

type BookRow = { isbn: string; title: string; author: string }

export default function AdminImportPage() {
  const { user, loading } = useAuth()
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<BookRow[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; skipped: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const parseCSV = (text: string): BookRow[] => {
    const lines = text.split('\n').filter(l => l.trim())
    const parsed: BookRow[] = []
    const seen = new Set<string>()

    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',')
      if (parts.length < 4) continue
      const isbn = parts[parts.length - 1].trim()
      const author = parts[parts.length - 2].trim()
      const title = parts.slice(1, -2).join(',').trim()
      if (!isbn || isbn.length < 10 || !title) continue
      if (seen.has(isbn)) continue
      seen.add(isbn)
      parsed.push({ isbn, title, author })
    }
    return parsed
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setError('')
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const parsed = parseCSV(text)
      setRows(parsed)
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  const doImport = async () => {
    if (!source.trim()) { setError('กรุณาใส่ชื่อ source'); return }
    if (rows.length === 0) { setError('ไม่มีข้อมูล'); return }
    setImporting(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/admin/import-books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ books: rows, source: source.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'import failed')
      setResult(body)
    } catch (e: any) {
      setError(e?.message || 'เกิดข้อผิดพลาด')
    } finally {
      setImporting(false)
    }
  }

  if (loading) return <><Nav /><div className="page" style={{ padding: 40, textAlign: 'center' }}>Loading...</div></>
  if (!user) return <><Nav /><div className="page" style={{ padding: 40, textAlign: 'center' }}>กรุณาเข้าสู่ระบบ</div></>

  return (
    <>
      <Nav />
      <div className="page" style={{ padding: '16px 16px 80px' }}>
        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
          Import หนังสือ
        </div>

        {/* Source */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>
            Source (ที่มาข้อมูล)
          </label>
          <input
            className="search-input"
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="เช่น exshop1, naiin, kino"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {/* File upload */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>
            ไฟล์ CSV (columns: Category_ID, Title, Author, ISBN)
          </label>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
          <button
            className="btn"
            onClick={() => fileRef.current?.click()}
            style={{ background: 'var(--surface)', color: 'var(--ink2)', border: '1px solid var(--border)' }}
          >
            {fileName ? `📄 ${fileName}` : '📁 เลือกไฟล์ CSV'}
          </button>
        </div>

        {/* Preview */}
        {rows.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#121212' }}>
              Preview — {rows.length} เล่ม (deduplicated)
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>#</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>ISBN</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Title</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Author</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '6px 10px', color: '#94A3B8' }}>{i + 1}</td>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{r.isbn}</td>
                      <td style={{ padding: '6px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</td>
                      <td style={{ padding: '6px 10px', color: '#64748B' }}>{r.author}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 50 && (
                <div style={{ padding: '8px 10px', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
                  ...แสดง 50 จาก {rows.length} รายการ
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#991B1B' }}>
            {error}
          </div>
        )}

        {/* Import button */}
        {rows.length > 0 && !result && (
          <button
            className="btn"
            onClick={doImport}
            disabled={importing}
            style={{ marginBottom: 14 }}
          >
            {importing ? `กำลัง import... (${rows.length} เล่ม)` : `Import ${rows.length} เล่ม เข้าระบบ`}
          </button>
        )}

        {/* Result */}
        {result && (
          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#15803D', marginBottom: 6 }}>Import สำเร็จ</div>
            <div style={{ fontSize: 14, color: '#166534', lineHeight: 1.8 }}>
              เพิ่มใหม่: <b>{result.inserted}</b> เล่ม<br />
              ข้าม (ISBN ซ้ำ): <b>{result.skipped}</b> เล่ม<br />
              Source: <b>{source}</b>
            </div>
            <button
              className="btn"
              onClick={() => { setRows([]); setResult(null); setFileName(''); setSource('') }}
              style={{ marginTop: 12, background: 'white', color: 'var(--ink2)', border: '1px solid var(--border)' }}
            >
              Import อีกไฟล์
            </button>
          </div>
        )}
      </div>
    </>
  )
}
