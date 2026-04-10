'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase, fetchBookByISBN, Book } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, PhoneVerifyModal, InAppBanner, useToast, Toast, ScanErrorSheet, LoginButton } from '@/components/ui'
import { scanBarcode } from '@/lib/scan'

const CONDITIONS = [
  { key: 'brand_new', label: '🆕 มือหนึ่ง', desc: 'ยังไม่ผ่านการใช้งาน ซื้อมาแล้วไม่ได้อ่าน' },
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
  const { user, loginWithLine } = useAuth()
  const { msg, show } = useToast()

  // showLogin removed — login goes directly to LINE OAuth
  const goLogin = () => loginWithLine(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/sell')
  const [showPhoneVerify, setShowPhoneVerify] = useState(false)
  const [isbn, setIsbn] = useState(searchParams.get('isbn') || '')
  const [fetchedBook, setFetchedBook] = useState<Partial<Book> | null>(null)
  // notFoundMode: null=ยังค้นหา | 'has_isbn'=มี ISBN แต่ไม่อยู่ในระบบ | 'no_isbn'=ไม่มีบาร์โค้ด
  const [notFoundMode, setNotFoundMode] = useState<null | 'has_isbn' | 'no_isbn'>(null)
  const [fetching, setFetching] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState(false)
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const [cond, setCond] = useState('good')
  const [price, setPrice] = useState('')
  const [shipping, setShipping] = useState('buyer')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showVerifyPrompt, setShowVerifyPrompt] = useState<{ needsLineId: boolean; needsPhone: boolean; needsId: boolean; isbn: string } | null>(null)
  const [marketPrice, setMarketPrice] = useState<{ min: number; max: number; avg: number } | null>(null)
  const [manualTitle, setManualTitle] = useState('')
  const [manualAuthor, setManualAuthor] = useState('')
  const [manualTranslator, setManualTranslator] = useState('')
  const [notes, setNotes] = useState('')
  const [bmIsbn] = useState(() => 'BM-' + Math.random().toString(36).toUpperCase().slice(2, 7))
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')

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
    const book = await fetchBookByISBN(q)
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
      // ISBN สแกนได้ แต่ไม่อยู่ในระบบ — ให้ผู้ขายกรอกข้อมูลเพิ่ม
      setNotFoundMode('has_isbn')
      setSellSearch('')
      // log missing ISBN — รู้ว่าผู้ขายอยากลงเล่มไหนแต่ระบบไม่มีข้อมูล
      fetch('/api/missing-isbn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn: q, source: 'sell-scan', userId: user?.id }),
      }).catch(() => {})
    }
    setFetching(false)
  }

  const scanFromPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) { goLogin(); return }
    const rawFile = e.target.files?.[0]
    if (!rawFile) return
    e.target.value = ''
    setScanning(true)
    try {
      const result = await scanBarcode(rawFile)
      console.log('[SCAN DEBUG]', result)
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

  const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const compressed = await compressImage(file)
    setCoverFile(compressed)
    if (coverPreview) URL.revokeObjectURL(coverPreview)
    setCoverPreview(URL.createObjectURL(compressed))
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
  }

  const removeCover = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCoverFile(null)
    setCoverPreview('')
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  const submit = async () => {
    if (!user) { goLogin(); return }
    // Phone verify ไม่บังคับแล้ว — เป็น mission item ใน profile
    // ผู้ขาย verified จะได้ badge + ขายไวกว่า (gamified incentive)
    if (!fetchedBook?.title && !manualTitle) { show('กรุณาดึงข้อมูลหนังสือก่อน'); return }
    if (!coverFile) { show('กรุณาใส่รูปหน้าปก'); return }
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) { show('กรุณาใส่ราคาที่ถูกต้อง'); return }
    if (!contact.trim()) { show('กรุณาใส่ช่องทางติดต่อ'); return }

    setSubmitting(true)
    show('กำลังบันทึก...')

    try {
      const currentIsbn = (fetchedBook as any)?.isbn || (notFoundMode === 'no_isbn' ? bmIsbn : isbn)
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
      // เช็คว่าควรแสดง popup เชิญลงทะเบียนไหม
      const needsLineId = !user.line_id
      const needsPhone = !user.phone_verified_at
      const needsId = !user.id_verified_at
      if (needsLineId || needsPhone || needsId) {
        setShowVerifyPrompt({ needsLineId, needsPhone, needsId, isbn: currentIsbn })
      } else {
        setTimeout(() => router.push(`/book/${currentIsbn}`), 1500)
      }
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

      {/* Popup เชิญลงทะเบียน หลังลงขายสำเร็จ */}
      {showVerifyPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '28px 22px', width: '100%', maxWidth: 360, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 6 }}>ลงขายสำเร็จแล้ว!</div>
            <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.7, marginBottom: 20 }}>
              เพิ่มความน่าเชื่อถือเพื่อให้ลูกค้ามั่นใจ<br />และติดต่อคุณได้เร็วขึ้น
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, textAlign: 'left' }}>
              {showVerifyPrompt.needsLineId && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#991B1B', lineHeight: 1.5 }}>
                  <b>⚠️ ยังไม่มี LINE ID</b> — ลูกค้าจะติดต่อคุณไม่ได้เลย
                </div>
              )}
              {showVerifyPrompt.needsPhone && (
                <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#0369A1', lineHeight: 1.5 }}>
                  📱 <b>ยืนยันเบอร์โทร</b> — ได้ป้าย "ลงทะเบียนแล้ว"
                </div>
              )}
              {showVerifyPrompt.needsId && (
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#166534', lineHeight: 1.5 }}>
                  🪪 <b>ยืนยันตัวตน</b> — ได้ป้าย "🛡️ Verified Seller"
                </div>
              )}
            </div>

            <button className="btn" onClick={() => { router.push('/profile') }} style={{ marginBottom: 8 }}>
              ไปลงทะเบียนเลย
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => { setShowVerifyPrompt(null); router.push(`/book/${showVerifyPrompt.isbn}`) }}
            >
              ไว้ทีหลัง
            </button>
          </div>
        </div>
      )}
      {showPhoneVerify && <PhoneVerifyModal onClose={() => setShowPhoneVerify(false)} onDone={() => setShowPhoneVerify(false)} />}

      <div className="page">
        <div style={{ padding: '16px 16px 80px' }}>
          <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 20, marginBottom: 16 }}>ลงขายหนังสือ</div>

          {!user ? (
            <div style={{ background: 'var(--surface)', border: '2px dashed #BFDBFE', borderRadius: 14, padding: '36px 20px', textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>เข้าสู่ระบบก่อนลงขาย</div>
              <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 20 }}>เพื่อให้ผู้ซื้อติดต่อคุณได้</div>
              <LoginButton onClick={goLogin} />
            </div>
          ) : (
            <>
              {scanError && (
                <ScanErrorSheet
                  onRetry={() => { setScanError(false); scanInputRef.current?.click() }}
                  onClose={() => setScanError(false)}
                />
              )}

              {/* ── Search & Scan ── */}
              {!fetchedBook && !notFoundMode && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.8px' }}>ขายหนังสือที่มี Barcode</div>

                  {/* Search input */}
                  <div className="form-group">
                    <div style={{ position: 'relative' }}>
                      <input
                        className="input"
                        value={sellSearch}
                        onChange={e => setSellSearch(e.target.value)}
                        placeholder="ค้นหาชื่อหนังสือ หรือพิมพ์ ISBN..."
                        style={{ paddingRight: (fetching || sellSearching) ? 44 : 14 }}
                      />
                      {(fetching || sellSearching) && (
                        <span className="spin" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16 }} />
                      )}
                    </div>
                  </div>

                  {/* Search results dropdown */}
                  {sellResults.length > 0 && (
                    <div style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                      {sellResults.map((b, i) => (
                        <button key={b.id} onClick={() => selectBook(b)}
                          style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'white', border: 'none', borderBottom: i < sellResults.length - 1 ? '1px solid var(--border-light)' : 'none', padding: '12px 14px', cursor: 'pointer', fontFamily: 'Kanit', textAlign: 'left', width: '100%', minHeight: 64 }}>
                          <BookCover isbn={b.isbn} title={b.title} size={48} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, color: '#121212', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                            {b.author && <div style={{ fontSize: 13, fontWeight: 500, color: '#555555', lineHeight: 1.5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.author}</div>}
                          </div>
                          <span style={{ color: 'var(--primary)', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>เลือก ›</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Scan button */}
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', background: scanning ? 'var(--surface)' : 'var(--primary-light)', border: '1.5px solid var(--primary)', borderRadius: 12, padding: '13px 16px', cursor: scanning ? 'default' : 'pointer', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, color: 'var(--primary)', marginBottom: 14 }}>
                    <input ref={scanInputRef} type="file" accept="image/*" capture="environment" onChange={scanFromPhoto} style={{ display: 'none' }} disabled={scanning} />
                    {scanning ? <><span className="spin" style={{ width: 16, height: 16, borderColor: 'rgba(37,99,235,.2)', borderTopColor: 'var(--primary)' }} /> กำลังอ่าน Barcode...</> : <>📷 ค้นหาด้วย Barcode</>}
                  </label>

                  {/* Not found — shown after search with no results */}
                  {sellSearch.trim().length >= 2 && !sellSearching && !fetching && sellResults.length === 0 && (
                    <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
                      <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 12 }}>ไม่พบ <strong>"{sellSearch}"</strong> ในระบบ — เพิ่มเองได้เลย</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setNotFoundMode('has_isbn')}
                          style={{ flex: 1, background: 'var(--primary-light)', border: '1.5px solid var(--primary)', borderRadius: 10, padding: '11px 8px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, color: 'var(--primary)', cursor: 'pointer' }}>
                          🔖 มี Barcode
                        </button>
                        <button onClick={() => { setNotFoundMode('no_isbn'); setIsbn(bmIsbn) }}
                          style={{ flex: 1, background: '#FFFBEB', border: '1.5px solid #FDE68A', borderRadius: 10, padding: '11px 8px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 13, color: '#92400E', cursor: 'pointer' }}>
                          📖 ไม่มี Barcode
                        </button>
                      </div>
                    </div>
                  )}

                </>
              )}

              {/* ── มี Barcode แต่ไม่อยู่ในระบบ ── */}
              {notFoundMode === 'has_isbn' && !fetchedBook && (
                <>
                  <div style={{ background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 12, padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>🔖</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#713F12' }}>สแกนได้ ISBN แต่ยังไม่มีในระบบ</div>
                      {isbn && <div style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>ISBN: {isbn}</div>}
                    </div>
                    <button onClick={resetSearch} style={{ background: 'none', border: 'none', fontSize: 12, color: '#92400E', cursor: 'pointer', fontFamily: 'Kanit', flexShrink: 0 }}>← กลับ</button>
                  </div>
                  <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>กรอกข้อมูลหนังสือ เพื่อเพิ่มเข้าระบบและลงขาย</div>
                    <div className="form-group">
                      <label className="label">ISBN</label>
                      <input className="input" value={isbn} onChange={e => setIsbn(e.target.value)} placeholder="เช่น 9784088703251" />
                    </div>
                    <div className="form-group">
                      <label className="label">ชื่อหนังสือ <span style={{ color: 'var(--red)' }}>*</span></label>
                      <input className="input" value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="เช่น แฮร์รี่ พอตเตอร์ กับศิลาอาถรรพ์" autoFocus />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="label">ผู้แต่ง <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span></label>
                      <input className="input" value={manualAuthor} onChange={e => setManualAuthor(e.target.value)} placeholder="เช่น J.K. Rowling" />
                    </div>
                  </div>
                </>
              )}

              {/* ── ไม่มี Barcode / หนังสือชุด ── */}
              {notFoundMode === 'no_isbn' && !fetchedBook && (
                <>
                  <div style={{ background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 12, padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>📖</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#713F12' }}>หนังสือไม่มี Barcode</div>
                      <div style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>กรอกชื่อหนังสือเพื่อค้นหาก่อน หรือเพิ่มใหม่</div>
                    </div>
                    <button onClick={resetSearch} style={{ background: 'none', border: 'none', fontSize: 12, color: '#92400E', cursor: 'pointer', fontFamily: 'Kanit', flexShrink: 0 }}>← กลับ</button>
                  </div>
                  <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>กรอกข้อมูลหนังสือ</div>
                    <div className="form-group">
                      <label className="label">ชื่อหนังสือ <span style={{ color: 'var(--red)' }}>*</span></label>
                      <input className="input" value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="เช่น สี่แผ่นดิน / Naruto เล่ม 1 / ชุด Harry Potter" autoFocus />
                    </div>
                    <div className="form-group">
                      <label className="label">ผู้แต่ง <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span></label>
                      <input className="input" value={manualAuthor} onChange={e => setManualAuthor(e.target.value)} placeholder="ผู้แต่ง หรือ ผู้แปล" />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="label">ผู้แปล <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span></label>
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
                <span style={{ fontSize: 12, background: '#E8F5E9', color: '#2E7D32', padding: '4px 10px', borderRadius: 9999, fontWeight: 700, display: 'inline-block', marginTop: 8, letterSpacing: '0.02em' }}>✓ ดึงข้อมูลสำเร็จ</span>
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
                <label className="label">รูปหน้าปก <span style={{ color: 'var(--red)' }}>*</span></label>

                {coverPreview ? (
                  <div style={{ position: 'relative', width: 120, height: 180, borderRadius: 12, overflow: 'hidden', background: 'var(--surface)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                    <img src={coverPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button onClick={removeCover} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.65)', border: 'none', borderRadius: '50%', width: 28, height: 28, color: 'white', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    {/* portrait 2:3 — ขนาดพอดีต่อการใช้งาน ไม่ใหญ่จนกินจอ */}
                    <label onClick={!user ? (e) => { e.preventDefault(); goLogin() } : undefined}
                      style={{ width: 120, height: 180, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--primary-light)', border: '1.5px dashed var(--primary)', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--primary)', flexShrink: 0 }}>
                      {user && <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} onChange={handleCoverChange} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />}
                      <span style={{ fontSize: 28 }}>📷</span>
                      <span>ถ่ายรูป</span>
                    </label>
                    <label onClick={!user ? (e) => { e.preventDefault(); goLogin() } : undefined}
                      style={{ width: 120, height: 180, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--surface)', border: '1.5px dashed var(--border)', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--ink2)', flexShrink: 0 }}>
                      {user && <input type="file" accept="image/*" ref={galleryInputRef} onChange={handleCoverChange} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />}
                      <span style={{ fontSize: 28 }}>🖼️</span>
                      <span>คลังภาพ</span>
                    </label>
                  </div>
                )}
                {!coverPreview && <div style={{ fontSize: 13, color: 'var(--red)', lineHeight: 1.6, marginTop: 8 }}>⚠ กรุณาใส่รูปหน้าปก แนะนำให้ถ่ายแนวตั้งให้เห็นทั้งเล่ม</div>}
              </div>

              <div className="form-group">
                <label className="label">สภาพหนังสือ</label>
                <div style={{ display: 'flex', gap: 7 }}>
                  {CONDITIONS.map(c => (
                    <button key={c.key} onClick={() => setCond(c.key)} style={{ flex: 1, padding: '10px 6px', border: `1.5px solid ${cond === c.key ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 10, background: cond === c.key ? 'var(--primary-light)' : 'white', fontFamily: 'Kanit', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: cond === c.key ? 'var(--primary-dark)' : 'var(--ink2)' }}>
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
