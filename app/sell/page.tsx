'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase, fetchBookByISBN, Book } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, LoginModal, InAppBanner, useToast, Toast, ScanErrorSheet, resizeForScan } from '@/components/ui'

const CONDITIONS = [
  { key: 'new', label: '✨ ใหม่มาก', desc: 'ไม่มีรอยใดๆ เหมือนซื้อจากร้าน' },
  { key: 'good', label: '👍 ดี', desc: 'มีรอยการใช้งานเล็กน้อย อ่านได้ปกติ' },
  { key: 'fair', label: '📖 พอใช้', desc: 'มีรอยชัดเจน แต่เนื้อหาครบถ้วน' },
]

function compressImage(file: File, maxKB = 300): Promise<File> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      let { width, height } = img
      const MAX = 1200
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX }
        else { width = Math.round(width * MAX / height); height = MAX }
      }
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      const tryQ = (q: number) => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return }
          if (blob.size <= maxKB * 1024 || q <= 0.1) {
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
  const { user } = useAuth()
  const { msg, show } = useToast()

  const [showLogin, setShowLogin] = useState(false)
  const [isbn, setIsbn] = useState(searchParams.get('isbn') || '')
  const [fetchedBook, setFetchedBook] = useState<Partial<Book> | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState(false)
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const [cond, setCond] = useState('good')
  const [price, setPrice] = useState('')
  const [shipping, setShipping] = useState('buyer')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [marketPrice, setMarketPrice] = useState<{ min: number; max: number; avg: number } | null>(null)
  const [manualTitle, setManualTitle] = useState('')
  const [manualAuthor, setManualAuthor] = useState('')
  const [manualTranslator, setManualTranslator] = useState('')
  const [notes, setNotes] = useState('')
  const [bmIsbn] = useState(() => 'BM-' + Math.random().toString(36).toUpperCase().slice(2, 7))
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')

  // Section 2: old book / no ISBN
  const [oldBookMode, setOldBookMode] = useState(false)
  const [titleQuery, setTitleQuery] = useState('')
  const [titleResults, setTitleResults] = useState<any[]>([])
  const [searchingTitle, setSearchingTitle] = useState(false)
  const [titleSearchDone, setTitleSearchDone] = useState(false)

  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (user?.phone) setContact(user.phone)
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
    setNotFound(false)
    const book = await fetchBookByISBN(q)
    if (book?.title) {
      setFetchedBook(book)
      if ((book as any).id) {
        const { data: ls } = await supabase.from('listings').select('price').eq('book_id', (book as any).id).eq('status', 'active')
        if (ls?.length) {
          const prices = ls.map((l: any) => l.price)
          setMarketPrice({ min: Math.min(...prices), max: Math.max(...prices), avg: Math.round(prices.reduce((a: number, b: number) => a + b) / prices.length) })
        }
      }
    } else {
      setNotFound(true)
    }
    setFetching(false)
  }

  const scanFromPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) { setShowLogin(true); return }
    const rawFile = e.target.files?.[0]
    if (!rawFile) return
    e.target.value = ''
    setScanning(true)
    try {
      let scanned: string | null = null

      // 1. native BarcodeDetector — Chrome / Android (ไม่รองรับบน iPhone Safari)
      if ('BarcodeDetector' in window) {
        try {
          const detector = new (window as any).BarcodeDetector({ formats: ['ean_13', 'ean_8'] })
          const bitmap = await createImageBitmap(rawFile, { imageOrientation: 'from-image' } as any)
          const codes = await detector.detect(bitmap)
          bitmap.close()
          if (codes.length > 0) scanned = codes[0].rawValue
        } catch { /* fallthrough */ }
      }

      // 2. ZXing โดยตรงพร้อม TRY_HARDER — แม่นยำกว่า html5-qrcode มาก
      //    ลองไฟล์ original ก่อน (resolution สูงช่วย EAN-13) แล้ว fallback resize
      if (!scanned) {
        try {
          const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import('@zxing/library')
          const hints = new Map<any, any>([
            [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8]],
            [DecodeHintType.TRY_HARDER, true],
          ])
          const reader = new BrowserMultiFormatReader(hints)
          // ลองไฟล์ original (high-res) ก่อน
          const urls: string[] = []
          try {
            const u1 = URL.createObjectURL(rawFile)
            urls.push(u1)
            const r1 = await reader.decodeFromImageUrl(u1)
            scanned = r1.getText()
          } catch {
            // ถ้า original ไม่ได้ ลอง resize แล้วสแกนใหม่
            const resized = await resizeForScan(rawFile, 1920)
            const u2 = URL.createObjectURL(resized)
            urls.push(u2)
            const r2 = await reader.decodeFromImageUrl(u2)
            scanned = r2.getText()
          } finally {
            urls.forEach(u => URL.revokeObjectURL(u))
          }
        } catch { /* fallthrough */ }
      }

      // 3. Last resort: html5-qrcode (fallback เดิม)
      if (!scanned) {
        const file = await resizeForScan(rawFile, 1920)
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        let el = document.getElementById('sell-file-tmp')
        if (!el) { el = document.createElement('div'); el.id = 'sell-file-tmp'; el.style.display = 'none'; document.body.appendChild(el) }
        const scanner = new Html5Qrcode('sell-file-tmp', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13], verbose: false })
        scanned = await scanner.scanFile(file, false)
      }

      const corrected = correctISBN(scanned!.trim())
      setIsbn(corrected)
      fetchBook(corrected)
    } catch {
      const shown = localStorage.getItem('scan_tips_shown')
      if (shown) {
        show('อ่านบาร์โค้ดไม่ได้ ลองถ่ายใหม่ให้ชัดขึ้น')
      } else {
        setScanError(true)
        localStorage.setItem('scan_tips_shown', '1')
      }
    } finally {
      setScanning(false)
    }
  }

  const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const compressed = await compressImage(file)
    setCoverFile(compressed)
    if (coverPreview) URL.revokeObjectURL(coverPreview)
    setCoverPreview(URL.createObjectURL(compressed))
  }

  const searchByTitle = async () => {
    const q = titleQuery.trim()
    if (!q) return
    setSearchingTitle(true)
    setTitleSearchDone(false)
    setTitleResults([])
    const { data } = await supabase
      .from('books')
      .select('id, isbn, title, author, cover_url')
      .or(`title.ilike.%${q}%,author.ilike.%${q}%`)
      .limit(6)
    setTitleResults(data || [])
    setTitleSearchDone(true)
    setSearchingTitle(false)
  }

  const selectTitleBook = async (book: any) => {
    setFetchedBook(book)
    setIsbn(book.isbn)
    setOldBookMode(false)
    const { data: ls } = await supabase.from('listings').select('price').eq('book_id', book.id).eq('status', 'active')
    if (ls?.length) {
      const prices = ls.map((l: any) => l.price)
      setMarketPrice({ min: Math.min(...prices), max: Math.max(...prices), avg: Math.round(prices.reduce((a: number, b: number) => a + b) / prices.length) })
    }
  }

  const removeCover = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCoverFile(null)
    setCoverPreview('')
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  const submit = async () => {
    if (!user) { setShowLogin(true); return }
    if (!fetchedBook?.title && !manualTitle) { show('กรุณาดึงข้อมูลหนังสือก่อน'); return }
    if (!coverFile) { show('กรุณาใส่รูปหน้าปก'); return }
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) { show('กรุณาใส่ราคาที่ถูกต้อง'); return }
    if (!contact.trim()) { show('กรุณาใส่ช่องทางติดต่อ'); return }

    setSubmitting(true)
    show('กำลังบันทึก...')

    try {
      const currentIsbn = (fetchedBook as any)?.isbn || isbn
      let bookId = (fetchedBook as any)?.id
      let existingCoverUrl = fetchedBook?.cover_url || ''

      if (!bookId) {
        const { data: existing } = await supabase.from('books').select('id, cover_url').eq('isbn', currentIsbn).maybeSingle()
        if (existing?.id) {
          bookId = existing.id
          existingCoverUrl = existing.cover_url || ''
        } else {
          const { data: newBook, error: bookErr } = await supabase.from('books').insert({
            isbn: currentIsbn,
            title: fetchedBook?.title || manualTitle,
            author: fetchedBook?.author || manualAuthor || '',
            translator: manualTranslator || '',
            cover_url: fetchedBook?.cover_url || '',
            language: fetchedBook?.language || 'th',
            first_contributor_id: user.id,
            source: 'community',
          }).select().single()
          if (bookErr) throw new Error(bookErr.message)
          bookId = newBook.id
        }
      }

      // Upload รูปหน้าปกไปยัง Supabase Storage
      const uploadPath = `covers/${user.id}/${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('listing-photos')
        .upload(uploadPath, coverFile, { contentType: 'image/jpeg', upsert: false })
      if (upErr) {
        if (upErr.message.toLowerCase().includes('bucket')) {
          throw new Error('กรุณาสร้าง bucket "listing-photos" ใน Supabase Storage ก่อน (ดูวิธีด้านล่าง)')
        }
        throw new Error(upErr.message)
      }
      const { data: { publicUrl } } = supabase.storage.from('listing-photos').getPublicUrl(uploadPath)

      // Update cover_url ในตาราง books ถ้ายังไม่มีรูป
      if (!existingCoverUrl && bookId) {
        await supabase.from('books').update({ cover_url: publicUrl }).eq('id', bookId)
      }

      const { error: listErr } = await supabase.from('listings').insert({
        book_id: bookId,
        seller_id: user.id,
        condition: cond,
        price: parseFloat(price),
        price_includes_shipping: shipping === 'free',
        contact: contact.trim(),
        notes: notes.trim() || null,
        photos: [publicUrl],
        status: 'active',
      })
      if (listErr) throw new Error(listErr.message)

      show('ลงขายเรียบร้อยแล้ว 🎉')
      setTimeout(() => router.push(`/book/${currentIsbn}`), 1500)
    } catch (e: any) {
      show('❌ ' + (e.message || 'เกิดข้อผิดพลาด'))
    }
    setSubmitting(false)
  }

  return (
    <>
      <Nav />
      <InAppBanner />
      <Toast msg={msg} />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} onDone={() => setShowLogin(false)} />}

      <div className="page">
        <div style={{ padding: '16px 16px 80px' }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, marginBottom: 16 }}>ลงขายหนังสือ</div>

          {!user ? (
            <div style={{ background: 'var(--surface)', border: '2px dashed #BFDBFE', borderRadius: 14, padding: '36px 20px', textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>เข้าสู่ระบบก่อนลงขาย</div>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 20 }}>เพื่อให้ผู้ซื้อติดต่อคุณได้</div>
              <button className="btn" style={{ maxWidth: 180, margin: '0 auto', display: 'block' }} onClick={() => setShowLogin(true)}>เข้าสู่ระบบ</button>
            </div>
          ) : (
            <>
              {scanError && (
                <ScanErrorSheet
                  onRetry={() => { setScanError(false); scanInputRef.current?.click() }}
                  onClose={() => setScanError(false)}
                />
              )}

              {/* ── Section 1: สแกน/ISBN ── */}
              {!fetchedBook && !notFound && !oldBookMode && (
                <>
                  {/* Photo capture — primary method, works on iPhone */}
                  <label style={{ display: 'block', background: 'var(--surface)', border: '2px dashed #BFDBFE', borderRadius: 14, padding: '24px 20px', textAlign: 'center', marginBottom: 10, cursor: scanning ? 'default' : 'pointer' }}>
                    <input ref={scanInputRef} type="file" accept="image/*" capture="environment" onChange={scanFromPhoto} style={{ display: 'none' }} disabled={scanning} />
                    {scanning ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><span className="spin" style={{ width: 28, height: 28 }} /></div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink2)' }}>กำลังอ่านบาร์โค้ด...</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--primary)' }}>ถ่ายรูปบาร์โค้ด</div>
                        <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>แตะเพื่อถ่ายภาพหรือเลือกจากคลัง</div>
                      </>
                    )}
                  </label>

                  <div className="form-group">
                    <label className="label">ISBN</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input className="input" value={isbn} onChange={e => setIsbn(e.target.value)} placeholder="เช่น 9780747532743" onKeyDown={e => e.key === 'Enter' && fetchBook()} />
                      <button onClick={() => fetchBook()} disabled={fetching} style={{ background: 'var(--primary)', border: 'none', borderRadius: 10, padding: '0 16px', color: 'white', fontFamily: 'Sarabun', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {fetching ? <span className="spin" /> : 'ดึงข้อมูล'}
                      </button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 14px' }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <span style={{ fontSize: 12, color: 'var(--ink3)', fontWeight: 600 }}>หรือ</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>

                  {/* ── Section 2: หนังสือเก่า/ไม่มี ISBN ── */}
                  <button
                    onClick={() => setOldBookMode(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: '#FFFBEB', border: '1.5px solid #FDE68A', borderRadius: 14, padding: '16px 18px', cursor: 'pointer', fontFamily: 'Sarabun', textAlign: 'left' }}
                  >
                    <span style={{ fontSize: 28, flexShrink: 0 }}>📖</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E' }}>หนังสือเก่า / ไม่มี ISBN / ลงเป็นชุด</div>
                      <div style={{ fontSize: 12, color: '#B45309', marginTop: 2 }}>ค้นหาชื่อหนังสือในระบบ หรือกรอกข้อมูลเอง</div>
                    </div>
                    <span style={{ marginLeft: 'auto', color: '#B45309', fontSize: 18 }}>›</span>
                  </button>
                </>
              )}

              {/* ── Section 2 expanded: ค้นหาชื่อ ── */}
              {!fetchedBook && !notFound && oldBookMode && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <button
                      onClick={() => { setOldBookMode(false); setTitleQuery(''); setTitleResults([]); setTitleSearchDone(false) }}
                      style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: 'var(--ink3)', cursor: 'pointer', fontFamily: 'Sarabun', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      ← กลับ
                    </button>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16 }}>หนังสือเก่า / ไม่มี ISBN</div>
                  </div>

                  <div style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A', borderRadius: 14, padding: 16, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#92400E', marginBottom: 10 }}>🔍 ค้นหาชื่อในระบบก่อน</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        className="input"
                        value={titleQuery}
                        onChange={e => setTitleQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && searchByTitle()}
                        placeholder="ชื่อหนังสือ หรือผู้แต่ง..."
                      />
                      <button
                        onClick={searchByTitle}
                        disabled={searchingTitle || !titleQuery.trim()}
                        style={{ background: '#D97706', border: 'none', borderRadius: 10, padding: '0 16px', color: 'white', fontFamily: 'Sarabun', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        {searchingTitle ? <span className="spin" /> : 'ค้นหา'}
                      </button>
                    </div>

                    {/* ผลการค้นหา */}
                    {titleResults.length > 0 && (
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {titleResults.map(b => (
                          <button
                            key={b.id}
                            onClick={() => selectTitleBook(b)}
                            style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'white', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontFamily: 'Sarabun', textAlign: 'left', width: '100%' }}
                          >
                            <BookCover coverUrl={b.cover_url} title={b.title} size={40} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                              {b.author && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{b.author}</div>}
                            </div>
                            <span style={{ color: 'var(--primary)', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>เลือก</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {titleSearchDone && titleResults.length === 0 && (
                      <div style={{ marginTop: 10, fontSize: 13, color: '#92400E' }}>ไม่พบในระบบ — กรอกข้อมูลเองด้านล่างได้เลย</div>
                    )}
                  </div>

                  {/* ปุ่มกรอกเอง */}
                  <button
                    onClick={() => { setNotFound(true); setIsbn(bmIsbn) }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', background: 'var(--surface)', border: '1.5px dashed var(--border)', borderRadius: 12, padding: '13px 16px', cursor: 'pointer', fontFamily: 'Sarabun', fontSize: 14, fontWeight: 600, color: 'var(--ink2)' }}
                  >
                    ✏️ กรอกข้อมูลหนังสือเอง
                    <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink3)' }}>(ได้รับ 🏆 ตราผู้บุกเบิก)</span>
                  </button>
                </div>
              )}
            </>
          )}

          {notFound && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <button
                  onClick={() => { setNotFound(false); setOldBookMode(true); setManualTitle(''); setManualAuthor(''); setManualTranslator('') }}
                  style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--ink3)', cursor: 'pointer', fontFamily: 'Sarabun' }}
                >← กลับ</button>
                <div style={{ fontSize: 13, color: 'var(--ink2)', fontWeight: 600 }}>กรอกข้อมูลหนังสือเองได้เลย 🏆</div>
              </div>
              <div className="form-group">
                <label className="label">ชื่อหนังสือ *</label>
                <input className="input" value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="เช่น สี่แผ่นดิน / การ์ตูน Naruto เล่ม 1-10 / ชุด Harry Potter ครบชุด" />
              </div>
              <div className="form-group">
                <label className="label">ผู้แต่ง / ผู้แปล</label>
                <input className="input" value={manualAuthor} onChange={e => setManualAuthor(e.target.value)} placeholder="ผู้แต่ง หรือ ผู้แปล (ไม่บังคับ)" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="label">ผู้แปล (ถ้ามี)</label>
                <input className="input" value={manualTranslator} onChange={e => setManualTranslator(e.target.value)} placeholder="ชื่อผู้แปล (ไม่บังคับ)" />
              </div>
              {manualTitle && <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, marginTop: 10 }}>🏆 คุณจะได้รับตราผู้บุกเบิก!</div>}
            </div>
          )}

          {fetchedBook?.title && (
            <div style={{ background: 'var(--green-bg)', border: '1px solid #BBF7D0', borderLeft: '3px solid var(--green)', borderRadius: 12, padding: 13, display: 'flex', gap: 12, marginBottom: 14 }}>
              <BookCover coverUrl={fetchedBook.cover_url} title={fetchedBook.title} size={44} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{fetchedBook.title}</div>
                {fetchedBook.author && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>{fetchedBook.author}</div>}
                <span style={{ fontSize: 11, background: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 20, fontWeight: 700, display: 'inline-block', marginTop: 5 }}>✓ ดึงข้อมูลสำเร็จ</span>
              </div>
            </div>
          )}

          {(fetchedBook?.title || (notFound && manualTitle)) && (
            <>
              <div className="form-group">
                <label className="label">รูปหน้าปก <span style={{ color: 'var(--red)' }}>*</span></label>

                {coverPreview ? (
                  <div style={{ position: 'relative', width: 90, height: 120, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <img src={coverPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button onClick={removeCover} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,.55)', border: 'none', borderRadius: '50%', width: 22, height: 22, color: 'white', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    {/* label ครอบ input โดยตรง — วิธีที่เชื่อถือได้ที่สุดบน iOS/Android */}
                    <label onClick={!user ? (e) => { e.preventDefault(); setShowLogin(true) } : undefined}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '16px 8px', background: 'var(--primary-light)', border: '1.5px dashed var(--primary)', borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>
                      {user && <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} onChange={handleCoverChange} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />}
                      <span style={{ fontSize: 22 }}>📷</span>ถ่ายรูป
                    </label>
                    <label onClick={!user ? (e) => { e.preventDefault(); setShowLogin(true) } : undefined}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '16px 8px', background: 'var(--surface)', border: '1.5px dashed var(--border)', borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>
                      {user && <input type="file" accept="image/*" ref={galleryInputRef} onChange={handleCoverChange} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />}
                      <span style={{ fontSize: 22 }}>🖼️</span>คลังภาพ
                    </label>
                  </div>
                )}
                {!coverPreview && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>⚠ กรุณาใส่รูปหน้าปก</div>}
              </div>

              <div className="form-group">
                <label className="label">สภาพหนังสือ</label>
                <div style={{ display: 'flex', gap: 7 }}>
                  {CONDITIONS.map(c => (
                    <button key={c.key} onClick={() => setCond(c.key)} style={{ flex: 1, padding: '10px 6px', border: `1.5px solid ${cond === c.key ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 10, background: cond === c.key ? 'var(--primary-light)' : 'white', fontFamily: 'Sarabun', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: cond === c.key ? 'var(--primary-dark)' : 'var(--ink2)' }}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
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
                    <div style={{ fontSize: 12, color: 'var(--ink3)' }}>ราคากลางในระบบ</div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>฿{marketPrice.min}–฿{marketPrice.max}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)' }}>แนะนำ ฿{marketPrice.avg}</div>
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
                <select className="input" value={shipping} onChange={e => setShipping(e.target.value)}>
                  <option value="buyer">ผู้ซื้อจ่ายค่าส่ง</option>
                  <option value="free">ส่งฟรี (รวมในราคา)</option>
                  <option value="negotiate">ตกลงกันเอง</option>
                </select>
              </div>

              <div className="form-group">
                <label className="label">ช่องทางติดต่อ</label>
                <input className="input" value={contact} onChange={e => setContact(e.target.value)} placeholder="เบอร์โทร หรือ Line ID" />
              </div>

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
