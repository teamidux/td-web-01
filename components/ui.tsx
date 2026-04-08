'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'

// resize รูปก่อนส่ง barcode scan — แก้ปัญหา iPhone (EXIF rotation + ภาพใหญ่เกิน / HEIC)
export function resizeForScan(file: File, maxPx = 1920): Promise<File> {
  return new Promise(resolve => {
    // createImageBitmap รองรับ imageOrientation: 'from-image' บน Chrome/Firefox
    // ซึ่งจะ handle EXIF rotation ของ iPhone ได้อัตโนมัติ
    const drawAndResolve = (source: HTMLImageElement | ImageBitmap, w: number, h: number) => {
      let width = w, height = h
      if (width > maxPx || height > maxPx) {
        if (width > height) { height = Math.round(height * maxPx / width); width = maxPx }
        else { width = Math.round(width * maxPx / height); height = maxPx }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(source as any, 0, 0, width, height)
      canvas.toBlob(blob => {
        resolve(blob ? new File([blob], 'scan.jpg', { type: 'image/jpeg' }) : file)
      }, 'image/jpeg', 0.95)
    }

    createImageBitmap(file, { imageOrientation: 'from-image' } as any)
      .then(bitmap => {
        drawAndResolve(bitmap, bitmap.width, bitmap.height)
        bitmap.close()
      })
      .catch(() => {
        // fallback สำหรับ browser ที่ไม่รองรับ imageOrientation option
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => { URL.revokeObjectURL(url); drawAndResolve(img, img.naturalWidth, img.naturalHeight) }
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
        img.src = url
      })
  })
}

export function Nav() {
  const { user } = useAuth()
  return (
    <nav className="nav">
      <Link href="/" className="nav-logo">Book<span>Match</span></Link>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link href="/sell">
          <button className="btn btn-sm" style={{ width: 'auto' }}>
            {user ? '+ ลงขาย' : 'เข้าสู่ระบบ / ลงขาย'}
          </button>
        </Link>
      </div>
    </nav>
  )
}

export function BottomNav() {
  const pathname = usePathname()
  const tabs = [
    { href: '/', icon: '🏠', label: 'หน้าแรก' },
    { href: '/sell', icon: '📚', label: 'ลงขาย' },
    { href: '/wanted', icon: '🔔', label: 'Wanted' },
    { href: '/profile', icon: '👤', label: 'โปรไฟล์' },
  ]
  return (
    <div className="bottom-nav">
      {tabs.map(t => (
        <Link
          key={t.href}
          href={t.href}
          className={`bnav-item ${pathname === t.href ? 'active' : ''}`}
        >
          <span>{t.icon}</span>
          <span>{t.label}</span>
        </Link>
      ))}
    </div>
  )
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div className="toast">{msg}</div>
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const show = (m: string, ms = 2500) => {
    setMsg(m)
    setTimeout(() => setMsg(null), ms)
  }
  return { msg, show }
}

export function BookCover({
  coverUrl,
  isbn,
  title,
  size = 68,
}: {
  coverUrl?: string
  isbn?: string
  title?: string
  size?: number
}) {
  // ถ้ามี ISBN → ใช้ proxy ของเรา (ซ่อน source + bump quality)
  // ถ้าไม่มี (เช่น รูปจากผู้ขายเอง) → ใช้ coverUrl ตรงๆ
  const src = isbn && /^\d{10,13}$/.test(isbn) ? `/api/cover/${isbn}` : coverUrl
  return (
    <div
      className="book-cover"
      style={{ width: size, height: Math.round(size * 1.5) }}
    >
      {src ? (
        <img
          src={src}
          alt={title}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      ) : (
        <span style={{ fontSize: size * 0.4 }}>📗</span>
      )}
    </div>
  )
}

export function InAppBanner() {
  const [show, setShow] = useState(false)
  const [isLine, setIsLine] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent
    const lineUA = /Line\//.test(ua)
    if (lineUA || /FBAN|FBAV|Instagram/.test(ua)) {
      setShow(true)
      setIsLine(lineUA)
    }
  }, [])

  if (!show) return null

  // LINE มี query param พิเศษ — ถ้าเจอ ?openExternalBrowser=1 จะเปิด URL ในเบราว์เซอร์ของระบบทันที
  const openInExternalBrowser = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('openExternalBrowser', '1')
    window.location.href = url.toString()
  }

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="inapp-banner">
      <span style={{ fontSize: 20 }}>⚠️</span>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
        <strong>{isLine ? 'เปิดในเบราว์เซอร์' : 'เปิดใน Chrome'}</strong>
        <br />
        เพื่อใช้กล้องสแกน ISBN ได้
      </div>
      {isLine ? (
        <button
          onClick={openInExternalBrowser}
          style={{
            background: '#D97706',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            padding: '10px 14px',
            minHeight: 44,
            fontFamily: 'Kanit',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          เปิดเบราว์เซอร์
        </button>
      ) : (
        <button
          onClick={copyLink}
          style={{
            background: '#D97706',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            padding: '10px 14px',
            minHeight: 44,
            fontFamily: 'Kanit',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {copied ? '✓ คัดลอกแล้ว' : 'Copy Link'}
        </button>
      )}
    </div>
  )
}

export function CondBadge({ cond }: { cond: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    brand_new: { cls: 'badge-brand-new', label: '🆕 มือหนึ่ง' },
    new: { cls: 'badge-new', label: '✨ ใหม่มาก' },
    good: { cls: 'badge-good', label: '👍 ดี' },
    fair: { cls: 'badge-fair', label: '📖 พอใช้' },
  }
  const { cls, label } = map[cond] || map.good
  return <span className={`badge ${cls}`}>{label}</span>
}

export function LoginModal({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: () => void
}) {
  const { login } = useAuth()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const { msg, show } = useToast()

  // เบอร์มือถือไทย: 10 หลัก ขึ้นต้น 0, จัดเป็น XXX-XXX-XXXX
  const formatPhone = (raw: string): string => {
    const digits = raw.replace(/\D/g, '').slice(0, 10)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value))
  }

  const handleLogin = async () => {
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length !== 10 || !cleaned.startsWith('0')) {
      show('กรุณากรอกเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0')
      return
    }
    setLoading(true)
    await login(cleaned)
    setLoading(false)
    onDone()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,.6)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: '18px 18px 0 0',
          padding: '24px 20px 40px',
          width: '100%',
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <Toast msg={msg} />
        <div
          style={{
            fontFamily: "'Kanit', sans-serif",
            fontSize: 22,
            fontWeight: 700,
            color: '#121212',
            lineHeight: 1.3,
            letterSpacing: '-0.02em',
            marginBottom: 6,
          }}
        >
          เข้าสู่ระบบ
        </div>
        <div
          style={{ fontSize: 14, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 22 }}
        >
          ใส่เบอร์มือถือเพื่อลงขาย
        </div>
        <div className="form-group">
          <label className="label">เบอร์มือถือ</label>
          <input
            className="input"
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={handlePhoneChange}
            placeholder="081-234-5678"
            maxLength={12}
            autoComplete="tel-national"
            style={{ fontSize: 18, fontWeight: 600, letterSpacing: '0.02em', textAlign: 'center' }}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
        </div>
        <button
          className="btn"
          onClick={handleLogin}
          disabled={loading}
        >
          {loading && <span className="spin" />}
          เข้าสู่ระบบ
        </button>
        <button
          className="btn btn-ghost"
          style={{ marginTop: 8 }}
          onClick={onClose}
        >
          ยกเลิก
        </button>
      </div>
    </div>
  )
}

const SCAN_TIPS = [
  { icon: '📖', text: 'ถ่ายบาร์โค้ดหลังปก ไม่ใช่หน้าปก' },
  { icon: '☀️', text: 'ถ่ายในที่แสงสว่างเพียงพอ' },
  { icon: '🔍', text: 'เข้าใกล้บาร์โค้ดให้พอดี อย่าห่างหรือชิดเกินไป' },
  { icon: '🧹', text: 'เช็ดทำความสะอาดเลนส์กล้องก่อนถ่าย' },
  { icon: '🤚', text: 'ถือมือให้นิ่ง รอให้กล้องโฟกัสก่อนถ่าย' },
]

export function ScanErrorSheet({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, color: '#121212', lineHeight: 1.3, letterSpacing: '-0.02em' }}>อ่านบาร์โค้ดไม่ได้</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1, minWidth: 44, minHeight: 44 }}>✕</button>
        </div>
        <div style={{ fontSize: 14, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 18 }}>ลองตรวจสอบสิ่งเหล่านี้แล้วถ่ายใหม่</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
          {SCAN_TIPS.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', borderRadius: 12, padding: '14px 16px' }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{t.icon}</span>
              <span style={{ fontSize: 15, lineHeight: 1.6 }}>{t.text}</span>
            </div>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', background: 'var(--primary)', border: 'none', borderRadius: 12, minHeight: 48, padding: '14px 16px', color: 'white', fontFamily: 'Kanit', fontWeight: 600, fontSize: 16, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }}
          onClick={onRetry}>
          📷 ถ่ายใหม่อีกครั้ง
        </label>
      </div>
    </div>
  )
}

// Live camera scan modal — ใช้ video stream แทนการถ่ายภาพนิ่ง แม่นยำกว่ามาก
export function LiveScanModal({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const scannerRef = useRef<any>(null)

  useEffect(() => {
    let stopped = false
    const startScanner = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        const scanner = new Html5Qrcode('live-scan-box', {
          formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8],
          verbose: false,
        })
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 120 }, aspectRatio: 1.6 },
          (text) => {
            if (stopped) return
            stopped = true
            scanner.stop().catch(() => {})
            onCode(text)
          },
          () => { /* frame error — ignore, retry next frame */ }
        )
        if (!stopped) setReady(true)
      } catch (e: any) {
        if (!stopped) setError(e?.message?.includes('ermission') ? 'กรุณาอนุญาตกล้อง แล้วลองใหม่' : 'ไม่สามารถเปิดกล้องได้')
      }
    }
    startScanner()
    return () => {
      stopped = true
      scannerRef.current?.stop().catch(() => {})
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ color: 'white', fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>สแกนบาร์โค้ด</div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 10, width: 44, height: 44, color: 'white', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        {error ? (
          <div style={{ background: 'rgba(255,255,255,.1)', borderRadius: 14, padding: '32px 20px', textAlign: 'center', color: 'white' }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>📵</div>
            <div style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 22 }}>{error}</div>
            <button className="btn" onClick={onClose}>ปิด</button>
          </div>
        ) : (
          <>
            <div style={{ borderRadius: 14, overflow: 'hidden', border: '2px solid rgba(255,255,255,.3)', background: '#000', minHeight: 200 }}>
              <div id="live-scan-box" style={{ width: '100%' }} />
            </div>
            {!ready && (
              <div style={{ textAlign: 'center', marginTop: 18, color: 'rgba(255,255,255,.7)', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span className="spin" style={{ width: 18, height: 18, borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} />
                กำลังเปิดกล้อง...
              </div>
            )}
            {ready && (
              <div style={{ textAlign: 'center', marginTop: 14, color: 'rgba(255,255,255,.75)', fontSize: 14, lineHeight: 1.6 }}>
                จ่อบาร์โค้ดหลังปกหนังสือในกรอบ
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Skeleton card — ใช้แทน spinner ตอนโหลดรายการหนังสือ
export function SkeletonCard() {
  return (
    <div className="card">
      <div className="book-card">
        <div className="skeleton" style={{ width: 68, height: 95, borderRadius: 8, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="skeleton" style={{ height: 18, width: '70%' }} />
          <div className="skeleton" style={{ height: 14, width: '45%' }} />
          <div className="skeleton" style={{ height: 22, width: '35%' }} />
        </div>
      </div>
    </div>
  )
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return <>{Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}</>
}

export function PageLoading() {
  return (
    <>
      <div style={{ textAlign: 'center', padding: '32px 0 14px' }}>
        <span className="spin" style={{ width: 24, height: 24 }} />
        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink3)', marginTop: 12 }}>กำลังโหลด...</div>
      </div>
    </>
  )
}
