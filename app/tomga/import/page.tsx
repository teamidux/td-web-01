'use client'
import { useState, useRef } from 'react'
import { useAuth } from '@/lib/auth'
import { Nav } from '@/components/ui'
import { cleanTitle, cleanAuthor, cleanPublisher } from '@/lib/clean-book'

// Parse CSV line ที่รองรับ quoted fields (comma ข้างใน quotes)
function parseCSVLine(line: string, delim: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delim && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

type BookRow = {
  isbn: string
  title: string
  titleRaw: string   // เก็บของเดิมให้เทียบใน preview
  author: string | null
  authorRaw: string
  publisher: string | null
  category: string | null
  categoryRaw: string | null
}

export default function AdminImportPage() {
  const { user, loading } = useAuth()
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<BookRow[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; skipped: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // ───── Parse CSV/TSV ─────
  // รองรับทั้ง format เดิม (Category_ID, Title, Author, ISBN)
  // และ format ใหม่ (Category_Main, Category_Raw, Title, Author, Publisher, ISBN, Product_ID)
  const parseCSV = (text: string): BookRow[] => {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return []

    // detect delimiter (tab vs comma) + strip BOM
    const header = lines[0].replace(/^\uFEFF/, '')
    const delim = header.includes('\t') ? '\t' : ','
    const cols = parseCSVLine(header, delim).map(c => c.toLowerCase().replace(/['"]/g, ''))

    // map column index
    const idx = {
      isbn: cols.findIndex(c => c === 'isbn'),
      title: cols.findIndex(c => c === 'title'),
      author: cols.findIndex(c => c === 'author'),
      publisher: cols.findIndex(c => c === 'publisher'),
      categoryMain: cols.findIndex(c => c === 'category_main'),
      categoryRaw: cols.findIndex(c => c === 'category_raw'),
    }

    // fallback: format เดิม (Category_ID, Title, Author, ISBN)
    if (idx.isbn === -1 && idx.title === -1) {
      return parseLegacyCSV(text)
    }

    const parsed: BookRow[] = []
    const seen = new Set<string>()

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCSVLine(lines[i], delim)

      const isbnRaw = idx.isbn >= 0 ? parts[idx.isbn] : ''
      const isbn = isbnRaw?.replace(/[^0-9X]/gi, '') || ''
      // ต้องเป็น ISBN-13 (978/979) เท่านั้น — ไม่เอา EAN barcode อื่น
      if (!isbn || isbn.length < 13 || !/^(978|979)/.test(isbn)) continue

      const titleRaw = idx.title >= 0 ? parts[idx.title] || '' : ''
      const title = cleanTitle(titleRaw)
      if (!title) continue

      if (seen.has(isbn)) continue
      seen.add(isbn)

      const authorRaw = idx.author >= 0 ? parts[idx.author] || '' : ''
      const author = cleanAuthor(authorRaw)

      const publisherRaw = idx.publisher >= 0 ? parts[idx.publisher] || '' : ''
      const publisher = cleanPublisher(publisherRaw)

      const catMain = idx.categoryMain >= 0 ? parts[idx.categoryMain] || '' : ''
      const categoryMain = (catMain && catMain !== 'N/A' && catMain !== 'n/a') ? catMain : null
      const catRaw = idx.categoryRaw >= 0 ? parts[idx.categoryRaw] || '' : ''
      const categoryRaw = (catRaw && catRaw !== 'N/A' && catRaw !== 'n/a') ? catRaw : null

      parsed.push({
        isbn,
        title,
        titleRaw,
        author,
        authorRaw,
        publisher,
        category: categoryMain || categoryRaw || null,
        categoryRaw,
      })
    }
    return parsed
  }

  // Legacy format: Category_ID, Title, Author, ISBN
  const parseLegacyCSV = (text: string): BookRow[] => {
    const lines = text.split('\n').filter(l => l.trim())
    const parsed: BookRow[] = []
    const seen = new Set<string>()
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',')
      if (parts.length < 4) continue
      const isbn = parts[parts.length - 1].trim()
      const authorRaw = parts[parts.length - 2].trim()
      const titleRaw = parts.slice(1, -2).join(',').trim()
      if (!isbn || isbn.length < 13 || !/^(978|979)/.test(isbn) || !titleRaw) continue
      if (seen.has(isbn)) continue
      seen.add(isbn)
      parsed.push({
        isbn,
        title: cleanTitle(titleRaw),
        titleRaw,
        author: cleanAuthor(authorRaw),
        authorRaw,
        publisher: null,
        category: null,
        categoryRaw: null,
      })
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
      const res = await fetch('/api/tomga/import-books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          books: rows.map(r => ({
            isbn: r.isbn,
            title: r.title,
            author: r.author || '',
            publisher: r.publisher || null,
            category: r.category || null,
          })),
          source: source.trim(),
        }),
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

  // Stats
  const cleanedCount = rows.filter(r => r.title !== r.titleRaw).length
  const nullAuthorCount = rows.filter(r => !r.author).length
  const nullPublisherCount = rows.filter(r => !r.publisher).length

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
          <label style={{ fontSize: 14, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>
            Source (ที่มาข้อมูล)
          </label>
          <input
            className="search-input"
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="เช่น seed, naiin, kino"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {/* File upload */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 14, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>
            ไฟล์ CSV / TSV
          </label>
          <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 8, lineHeight: 1.6 }}>
            รองรับ: Category_Main, Category_Raw, Title, Author, Publisher, ISBN, Product_ID
          </div>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFile} style={{ display: 'none' }} />
          <button
            className="btn"
            onClick={() => fileRef.current?.click()}
            style={{ background: 'var(--surface)', color: 'var(--ink2)', border: '1px solid var(--border)' }}
          >
            {fileName ? `📄 ${fileName}` : '📁 เลือกไฟล์'}
          </button>
        </div>

        {/* Cleaning stats */}
        {rows.length > 0 && (
          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#15803D', marginBottom: 8 }}>
              ล้างข้อมูลเสร็จ — {rows.length} เล่ม
            </div>
            <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.8 }}>
              ชื่อหนังสือที่ถูกล้าง: <b>{cleanedCount}</b> เล่ม
              <br />ผู้แต่งที่เป็น null (ข้อมูลผิด/ไม่มี): <b>{nullAuthorCount}</b>
              <br />สำนักพิมพ์ที่เป็น null: <b>{nullPublisherCount}</b>
            </div>
          </div>
        )}

        {/* Preview */}
        {rows.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#121212' }}>
              Preview — {rows.length} เล่ม
            </div>
            <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>#</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>ISBN</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Title</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Author</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Publisher</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '6px 10px', color: '#94A3B8' }}>{i + 1}</td>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{r.isbn}</td>
                      <td style={{ padding: '6px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.title !== r.titleRaw ? (
                          <span title={`เดิม: ${r.titleRaw}`} style={{ borderBottom: '1px dashed #16A34A' }}>{r.title}</span>
                        ) : r.title}
                      </td>
                      <td style={{ padding: '6px 10px', color: r.author ? '#64748B' : '#DC2626' }}>
                        {r.author || <span title={`เดิม: ${r.authorRaw}`}>null</span>}
                      </td>
                      <td style={{ padding: '6px 10px', color: r.publisher ? '#64748B' : '#94A3B8' }}>
                        {r.publisher || '—'}
                      </td>
                      <td style={{ padding: '6px 10px', color: '#64748B', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.category || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 50 && (
                <div style={{ padding: '8px 10px', fontSize: 13, color: '#94A3B8', textAlign: 'center' }}>
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
