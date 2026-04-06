'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase, fetchBookByISBN, Book } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Nav, BottomNav, BookCover, LoginModal, InAppBanner, useToast, Toast } from '@/components/ui'

const CONDITIONS = [
  { key: 'new', label: '✨ ใหม่มาก' },
  { key: 'good', label: '👍 ดี' },
  { key: 'fair', label: '📖 พอใช้' },
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
  const [cond, setCond] = useState('good')
  const [price, setPrice] = useState('')
  const [shipping, setShipping] = useState('buyer')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [marketPrice, setMarketPrice] = useState<{ min: number; max: number; avg: number } | null>(null)
  const [manualTitle, setManualTitle] = useState('')
  const [manualAuthor, setManualAuthor] = useState('')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')

  const scannerRef = useRef<any>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (user?.phone) setContact(user.phone)
    const isbnParam = searchParams.get('isbn')
    if (isbnParam) fetchBook(isbnParam)
  }, [user])

  const isValidISBN = (v: string) => /^(978|979)\d{10}$/.test(v)

  const fetchBook = async (isbnVal?: string) => {
    const q = (isbnVal || isbn).trim()
    if (!q) { show('กรุณากรอก ISBN'); return }
    if (!isValidISBN(q)) { show('ISBN ไม่ถูกต้อง กรุณาตรวจสอบใหม่'); return }
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

  const startScan = async () => {
    if (!user) { setShowLogin(true); return }
    setScanning(true)
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('sell-scanner', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13], verbose: false })
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 100 } },
        (text: string) => { scanner.stop(); setScanning(false); setIsbn(text); fetchBook(text) },
        () => {}
      )
    } catch { setScanning(false); show('ไม่สามารถเปิดกล้องได้ กรุณาเปิดใน Chrome') }
  }

  const stopScan = () => { scannerRef.current?.stop(); setScanning(false) }

  const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const compressed = await compressImage(file)
    setCoverFile(compressed)
    if (coverPreview) URL.revokeObjectURL(coverPreview)
    setCoverPreview(URL.createObjectURL(compressed))
  }

  const removeCover = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCoverFile(null)
    setCoverPreview('')
    if (coverInputRef.current) coverInputRef.current.value = ''
  }

  const submit = async () => {
    if (!user) { setShowLogin(true); return }
    if (!fetchedBook?.title && !manualTitle) { show('กรุณาดึงข้อมูลหนังสือก่อน'); return }
    if (!coverFile) { show('กรุณาใส่รูปหน้าปก'); return }
    if (!price || isNaN(parseFloat(price))) { show('กรุณาใส่ราคา'); return }
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
      if (upErr) throw new Error(upErr.message)
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

          {!user && (
            <div style={{ background: 'var(--primary-light)', border: '1px solid #BFDBFE', borderRadius: 10, padding: '12px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, color: 'var(--primary-dark)' }}>เข้าสู่ระบบเพื่อลงขาย</div>
              <button className="btn btn-sm" style={{ width: 'auto' }} onClick={() => setShowLogin(true)}>เข้าสู่ระบบ</button>
            </div>
          )}

          {scanning ? (
            <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 14, position: 'relative' }}>
              <div id="sell-scanner" />
              <button onClick={stopScan} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 20, padding: '5px 12px', color: 'white', fontFamily: 'Sarabun', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>✕ ปิด</button>
            </div>
          ) : !fetchedBook && (
            <div onClick={startScan} style={{ background: 'var(--surface)', border: '2px dashed #BFDBFE', borderRadius: 14, padding: '24px 20px', textAlign: 'center', marginBottom: 14, cursor: 'pointer' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--primary)' }}>สแกน Barcode</div>
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>แตะเพื่อเปิดกล้อง</div>
            </div>
          )}

          {!fetchedBook && (
            <div className="form-group">
              <label className="label">ISBN</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={isbn} onChange={e => setIsbn(e.target.value)} placeholder="เช่น 9780747532743" onKeyDown={e => e.key === 'Enter' && fetchBook()} />
                <button onClick={() => fetchBook()} disabled={fetching} style={{ background: 'var(--primary)', border: 'none', borderRadius: 10, padding: '0 16px', color: 'white', fontFamily: 'Sarabun', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {fetching ? <span className="spin" /> : 'ดึงข้อมูล'}
                </button>
              </div>
            </div>
          )}

          {notFound && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--ink2)', marginBottom: 12 }}>ไม่พบข้อมูล ISBN นี้ กรอกชื่อหนังสือเองได้เลย 🏆</div>
              <div className="form-group">
                <label className="label">ชื่อหนังสือ *</label>
                <input className="input" value={manualTitle} onChange={e => setManualTitle(e.target.value)} placeholder="ชื่อหนังสือ" />
              </div>
              <div className="form-group">
                <label className="label">ผู้แต่ง</label>
                <input className="input" value={manualAuthor} onChange={e => setManualAuthor(e.target.value)} placeholder="ผู้แต่ง (ไม่บังคับ)" />
              </div>
              {manualTitle && <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>🏆 คุณจะได้รับ Pioneer Badge!</div>}
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
                <input type="file" accept="image/*"
                  ref={coverInputRef}
                  onChange={handleCoverChange}
                  style={{ display: 'none' }} />
                <div className={`photo-slot required ${coverPreview ? 'filled' : ''}`}
                  style={{ width: 90, height: 120 }}
                  onClick={() => { if (!user) { setShowLogin(true); return }; coverInputRef.current?.click() }}>
                  {coverPreview ? (
                    <>
                      <img src={coverPreview} alt="" />
                      <button onClick={removeCover} style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.5)', border: 'none', borderRadius: '50%', width: 18, height: 18, color: 'white', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>✕</button>
                    </>
                  ) : (
                    <><span>📷</span><span className="slot-label">หน้าปก</span></>
                  )}
                </div>
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
