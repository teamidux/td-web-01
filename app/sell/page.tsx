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
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setScanning(true)
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      let el = document.getElementById('sell-file-tmp')
      if (!el) { el = document.createElement('div'); el.id = 'sell-file-tmp'; el.style.display = 'none'; document.body.appendChild(el) }
      const scanner = new Html5Qrcode('sell-file-tmp', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13], verbose: false })
      const result = await scanner.scanFile(file, false)
      const raw = result.trim()
      const isbn = correctISBN(raw)
      setIsbn(isbn)
      fetchBook(isbn)
    } catch {
      show('อ่านบาร์โค้ดไม่ได้ ลองถ่ายใหม่ให้เห็นบาร์โค้ดชัดขึ้น')
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

          {!fetchedBook && (
            <label style={{ display: 'block', background: 'var(--surface)', border: '2px dashed #BFDBFE', borderRadius: 14, padding: '24px 20px', textAlign: 'center', marginBottom: 14, cursor: scanning ? 'default' : 'pointer' }}>
              <input type="file" accept="image/*" capture="environment" onChange={scanFromPhoto} style={{ display: 'none' }} disabled={scanning} />
              {scanning ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><span className="spin" style={{ width: 28, height: 28 }} /></div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink2)' }}>กำลังอ่านบาร์โค้ด...</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--primary)' }}>ถ่ายบาร์โค้ด</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>แตะเพื่อเปิดกล้อง</div>
                </>
              )}
            </label>
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
              {manualTitle && <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>🏆 คุณจะได้รับตราผู้บุกเบิก!</div>}
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
