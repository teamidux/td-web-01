'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { computeTrustScore, TRUST_TIERS, type TrustItemKey, type TrustItem } from '@/lib/trust'

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
  const { user, loading } = useAuth()
  return (
    <nav className="nav">
      <Link href="/" className="nav-logo">Book<span>Match</span></Link>
      {/* ปุ่มลงขายบน Nav — เอาออกแล้ว user ใช้ FAB/BottomNav แทน
          ถ้ายังไม่ login โชว์เฉพาะปุ่ม login */}
      {!loading && !user && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/sell">
            <button className="btn btn-sm" style={{ width: 'auto', minWidth: 90 }}>
              เข้าสู่ระบบ
            </button>
          </Link>
        </div>
      )}
    </nav>
  )
}

export function BottomNav() {
  const pathname = usePathname()
  // 4 tabs ใน nav strip — "ลงขาย" อยู่ขวาสุด มี styling เด่นกว่าตัวอื่น
  // (ไม่ใช้ FAB ลอยเพราะบัง content)
  const tabs = [
    { href: '/', icon: '🏠', label: 'หน้าแรก' },
    { href: '/wanted', icon: '🔔', label: 'ตามหา' },
    { href: '/profile', icon: '👤', label: 'โปรไฟล์' },
  ]
  const sellActive = pathname === '/sell'
  return (
    <>
      <div style={{ height: 70 }} />
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
        {/* ลงขาย — เด่นกว่าตัวอื่น (primary action ของ marketplace) */}
        <Link
          href="/sell"
          className={`bnav-item ${sellActive ? 'active' : ''}`}
          style={{
            background: sellActive
              ? 'linear-gradient(135deg, #15803D 0%, #14532D 100%)'
              : 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)',
            color: 'white',
            margin: '4px 6px 4px 2px',
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(22,163,74,.3)',
          }}
        >
          <span>📖</span>
          <span>ลงขาย</span>
        </Link>
      </div>
    </>
  )
}

// Footer terms link — แสดงเฉพาะหน้า home (ที่อื่นรกสายตา)
export function TermsFooter() {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0 12px', fontSize: 11, color: '#94A3B8' }}>
      <Link href="/terms" style={{ color: '#94A3B8', textDecoration: 'underline', textUnderlineOffset: 2 }}>ข้อตกลงการใช้บริการ</Link>
    </div>
  )
}

export function LoginButton({ onClick }: { onClick: () => void }) {
  // Clickwrap consent — ไม่มี checkbox แล้ว
  // user คลิกปุ่ม login = ยอมรับเงื่อนไขโดยอัตโนมัติ (legally binding ตาม PDPA)
  return (
    <div style={{ maxWidth: 280, margin: '0 auto' }}>
      <button
        className="btn"
        onClick={onClick}
        style={{ width: '100%', background: '#06C755', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
      >
        💚 เข้าสู่ระบบด้วย LINE
      </button>
      <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
        การ login ถือว่ายอมรับ <Link href="/terms" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>ข้อตกลงการใช้บริการ</Link>
      </div>
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
      style={{
        width: size,
        height: Math.round(size * 1.5),
        background: '#E2E8F0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <img
          src={src || '/nocover.webp'}
          alt={title || 'ไม่มีภาพปก'}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => {
            // ถ้าโหลด cover ไม่สำเร็จ → fallback ไป nocover.webp
            const img = e.target as HTMLImageElement
            if (!img.src.endsWith('/nocover.webp')) img.src = '/nocover.webp'
          }}
        />
        {!src && size >= 80 && (
          <div style={{
            position: 'absolute',
            top: 6,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: Math.max(9, size * 0.09),
            fontWeight: 600,
            color: '#64748B',
            background: 'rgba(255,255,255,0.7)',
            padding: '2px 4px',
          }}>
            ไม่มีภาพปก
          </div>
        )}
      </div>
    </div>
  )
}

export function InAppBanner() {
  const [fallback, setFallback] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent
    const isLine = /Line\//.test(ua)
    const isInApp = isLine || /FBAN|FBAV|Instagram/.test(ua)
    // iPhone: detect non-Safari browsers (Chrome, Firefox, etc.) — they all contain "CriOS", "FxiOS", etc.
    const isIPhone = /iPhone/.test(ua)
    const isNotSafari = isIPhone && (/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua))

    if (!isInApp && !isNotSafari) return // Safari บน iPhone หรือ desktop — ไม่ต้องทำอะไร

    // LINE in-app → auto-redirect ด้วย openExternalBrowser=1
    if (isLine) {
      const url = new URL(window.location.href)
      url.searchParams.set('openExternalBrowser', '1')
      window.location.href = url.toString()
      return
    }

    // FB/IG in-app → ลอง intent scheme เปิด Safari
    if (isInApp && isIPhone) {
      window.location.href = `x-safari-${window.location.href}`
      // fallback ถ้า intent ไม่ทำงาน
      setTimeout(() => setFallback(true), 1500)
      return
    }

    // Chrome/Firefox บน iPhone → แสดง fallback banner ให้ copy link ไปเปิด Safari
    setFallback(true)
  }, [])

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!fallback) return null

  return (
    <div className="inapp-banner">
      <span style={{ fontSize: 20 }}>⚠️</span>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
        <strong>เปิดใน Safari</strong>
        <br />
        เพื่อใช้งานกล้องและ Login ได้สมบูรณ์
      </div>
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
  onDone?: () => void
}) {
  const { loginWithLine } = useAuth()

  const handleLineLogin = () => {
    // เก็บ pathname ปัจจุบันเพื่อให้ callback redirect กลับมาที่หน้าเดิม
    const next = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'
    loginWithLine(next)
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
          padding: '28px 20px 40px',
          width: '100%',
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <div
          style={{
            fontFamily: "'Kanit', sans-serif",
            fontSize: 24,
            fontWeight: 700,
            color: '#121212',
            lineHeight: 1.3,
            letterSpacing: '-0.02em',
            marginBottom: 8,
            textAlign: 'center',
          }}
        >
          เข้าสู่ระบบ BookMatch
        </div>
        <div
          style={{ fontSize: 14, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 28, textAlign: 'center' }}
        >
          ใช้บัญชี LINE ของคุณ — ปลอดภัย ฟรี ไม่ต้องสร้างรหัสใหม่
        </div>

        <button
          onClick={handleLineLogin}
          style={{
            width: '100%',
            background: '#06C755',
            color: 'white',
            border: 'none',
            borderRadius: 12,
            minHeight: 56,
            padding: '14px 16px',
            fontFamily: 'Kanit',
            fontWeight: 700,
            fontSize: 17,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            boxShadow: '0 2px 8px rgba(6,199,85,.25)',
          }}
        >
          <span style={{ fontSize: 22 }}>💚</span>
          เข้าสู่ระบบด้วย LINE
        </button>

        <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.6, textAlign: 'center', marginTop: 16 }}>
          การเข้าสู่ระบบหมายความว่าคุณยอมรับเงื่อนไขการใช้งาน
        </div>

        <button
          className="btn btn-ghost"
          style={{ marginTop: 16 }}
          onClick={onClose}
        >
          ยกเลิก
        </button>
      </div>
    </div>
  )
}

// Phone OTP verification modal — Firebase Phone Auth flow
// 1. signInWithPhoneNumber(recaptcha) → Google ส่ง SMS
// 2. user ใส่ code → confirmationResult.confirm(code) → ได้ Firebase user
// 3. getIdToken() → ส่งไป /api/verify/phone/firebase-confirm → server update DB
export function PhoneVerifyModal({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: () => void
}) {
  const [step, setStep] = useState<'phone' | 'code' | 'success'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const { msg, show } = useToast()
  const { reloadUser, syncUser } = useAuth()
  const router = useRouter()
  const confirmationRef = useRef<any>(null)
  const recaptchaRef = useRef<any>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  // Cleanup reCAPTCHA on unmount
  useEffect(() => {
    return () => {
      try { recaptchaRef.current?.clear() } catch {}
    }
  }, [])

  const formatPhone = (raw: string): string => {
    const digits = raw.replace(/\D/g, '').slice(0, 10)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  const sendOtp = async () => {
    const cleaned = phone.replace(/\D/g, '')
    if (!/^0\d{9}$/.test(cleaned)) { show('กรุณากรอกเบอร์ 10 หลัก ขึ้นต้น 0'); return }
    setLoading(true)
    try {
      // Dynamic import — firebase SDK เฉพาะ client
      const [{ getFirebaseAuth }, { RecaptchaVerifier, signInWithPhoneNumber }] = await Promise.all([
        import('@/lib/firebase-client'),
        import('firebase/auth'),
      ])
      const auth = getFirebaseAuth()

      // Reuse reCAPTCHA หรือสร้างใหม่ถ้าไม่มี
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'bm-recaptcha-container', {
          size: 'invisible',
        })
      }

      // E.164 format: 08xxxxxxxx → +66xxxxxxxxx
      const e164 = '+66' + cleaned.slice(1)
      const result = await signInWithPhoneNumber(auth, e164, recaptchaRef.current)
      confirmationRef.current = result

      setStep('code')
      setCooldown(60)
      show('ส่งรหัส OTP แล้ว ตรวจ SMS')
    } catch (e: any) {
      console.warn('[firebase phone]', e?.code, e?.message)
      // Show exact error code บนจอ เพื่อ debug ง่ายขึ้น
      const code = e?.code || 'unknown'
      if (code === 'auth/invalid-phone-number') show('เบอร์ไม่ถูกต้อง')
      else if (code === 'auth/too-many-requests') show('ขอ OTP บ่อยเกินไป โปรดลองใหม่ภายหลัง')
      else if (code === 'auth/quota-exceeded') show('ระบบใช้งานเต็ม ลองใหม่พรุ่งนี้')
      else if (code === 'auth/unauthorized-domain') show('❌ Domain ไม่ได้ authorize ใน Firebase Console')
      else if (code === 'auth/billing-not-enabled') show('❌ Firebase ต้อง upgrade เป็น Blaze plan')
      else if (code === 'auth/captcha-check-failed') show('❌ reCAPTCHA fail — refresh หน้าแล้วลองใหม่')
      else if (code === 'auth/operation-not-allowed') show('❌ Phone provider ไม่ได้เปิด ใน Firebase Authentication')
      else show(`❌ ${code}: ${(e?.message || '').slice(0, 80)}`)
      // Reset reCAPTCHA หลัง error
      try { recaptchaRef.current?.clear() } catch {}
      recaptchaRef.current = null
    } finally {
      setLoading(false)
    }
  }

  const confirmOtp = async () => {
    if (!/^\d{6}$/.test(code)) { show('กรอก OTP 6 หลัก'); return }
    if (!confirmationRef.current) { show('ขอ OTP ใหม่'); setStep('phone'); return }
    setLoading(true)
    try {
      // Confirm OTP ผ่าน Firebase
      const result = await confirmationRef.current.confirm(code)
      const idToken = await result.user.getIdToken()

      // ส่ง ID token ไป backend verify + บันทึก DB
      const r = await fetch('/api/verify/phone/firebase-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const data = await r.json()
      if (!r.ok) {
        if (data.error === 'phone_in_use') show('เบอร์นี้ถูกใช้แล้วโดยบัญชีอื่น')
        else if (data.error === 'already_verified') show('เบอร์นี้ยืนยันแล้ว')
        else show('บันทึกไม่สำเร็จ: ' + (data.error || 'unknown'))
        return
      }

      // Sync context ทันทีจาก response (กัน race condition ของ reloadUser)
      if (data.phone_verified_at) {
        syncUser({ phone: data.phone, phone_verified_at: data.phone_verified_at })
      }
      // Await reloadUser + router.refresh — force ทุกอย่าง re-fetch จาก DB
      await reloadUser()
      router.refresh()

      // เข้าสู่ success state — โชว์ celebration effect
      setStep('success')
      // ปิด modal หลังจาก user ดู celebration 2.5 วิ
      setTimeout(() => onDone(), 2500)
    } catch (e: any) {
      console.warn('[firebase confirm]', e?.code, e?.message)
      if (e?.code === 'auth/invalid-verification-code') show('รหัสไม่ถูกต้อง')
      else if (e?.code === 'auth/code-expired') show('รหัสหมดอายุ ขอใหม่')
      else show('ยืนยันไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '28px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
        <Toast msg={msg} />

        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, color: '#121212', lineHeight: 1.3, letterSpacing: '-0.02em', marginBottom: 6 }}>
          📱 ยืนยันเบอร์มือถือ <span style={{ fontSize: 14, fontWeight: 600, color: '#16A34A' }}>(ทำครั้งเดียว จบตลอดไป)</span>
        </div>
        <div style={{ fontSize: 14, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 22 }}>
          สร้างความมั่นใจให้ลูกค้า เพิ่มโอกาสปิดการขาย
        </div>

        {step === 'phone' && (
          <>
            <div className="form-group">
              <label className="label">เบอร์มือถือ</label>
              <input
                className="input"
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
                placeholder="081-234-5678"
                maxLength={12}
                autoComplete="tel-national"
                disabled={loading}
                style={{ fontSize: 18, fontWeight: 600, letterSpacing: '0.02em', textAlign: 'center' }}
              />
            </div>
            <button className="btn" onClick={sendOtp} disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
              {loading ? (
                <><span className="spin" style={{ marginRight: 8 }} />กำลังส่ง OTP กรุณารอสักครู่...</>
              ) : 'รับรหัส OTP'}
            </button>
            {loading && (
              <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', marginTop: 10, lineHeight: 1.6 }}>
                กำลังตรวจสอบ reCAPTCHA และส่ง SMS<br />
                อาจใช้เวลา 5-15 วินาที
              </div>
            )}
          </>
        )}

        {step === 'success' && (
          <div style={{ textAlign: 'center', padding: '20px 0 10px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 88,
              height: 88,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)',
              fontSize: 48,
              marginBottom: 18,
              animation: 'bm-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
              boxShadow: '0 10px 30px rgba(22,163,74,.35)',
            }}>
              ✓
            </div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 800, color: '#0F172A', marginBottom: 8 }}>
              ยืนยันเบอร์สำเร็จ! 🎉
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 16 }}>
              คุณได้รับป้าย <b style={{ color: '#0891B2' }}>📱 ลงทะเบียนมือถือแล้ว</b><br />
              ลูกค้าจะเห็นและมั่นใจในตัวคุณมากขึ้น
            </div>
            <style>{`
              @keyframes bm-pop {
                0% { transform: scale(0); opacity: 0; }
                60% { transform: scale(1.15); opacity: 1; }
                100% { transform: scale(1); opacity: 1; }
              }
            `}</style>
          </div>
        )}

        {step === 'code' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--ink3)', textAlign: 'center', marginBottom: 12, lineHeight: 1.6 }}>
              ส่ง OTP ไปที่ <strong style={{ color: 'var(--ink)' }}>{phone}</strong>
            </div>
            <div className="form-group">
              <label className="label">รหัส OTP (6 หลัก)</label>
              <input
                className="input"
                type="tel"
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                autoComplete="one-time-code"
                style={{ fontSize: 24, fontWeight: 700, letterSpacing: '0.3em', textAlign: 'center' }}
              />
            </div>
            <button className="btn" onClick={confirmOtp} disabled={loading || code.length < 6}>
              {loading ? <><span className="spin" />กำลังยืนยัน...</> : 'ยืนยัน'}
            </button>
            <button
              className="btn btn-ghost"
              style={{ marginTop: 8 }}
              onClick={sendOtp}
              disabled={cooldown > 0 || loading}
            >
              {cooldown > 0 ? `ส่งใหม่ใน ${cooldown}s` : 'ส่ง OTP ใหม่'}
            </button>
          </>
        )}

        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>
          ยกเลิก
        </button>

        {/* reCAPTCHA container — invisible, Firebase ต้องมี element นี้แม้จะไม่เห็น */}
        <div id="bm-recaptcha-container" />
      </div>
    </div>
  )
}

// ID + Selfie verification modal
export function IdVerifyModal({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: () => void
}) {
  const [idFile, setIdFile] = useState<File | null>(null)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { msg, show } = useToast()
  const { reloadUser } = useAuth()

  const submit = async () => {
    if (!idFile || !selfieFile) { show('กรุณาอัปโหลดทั้ง 2 รูป'); return }
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('id', idFile)
      fd.append('selfie', selfieFile)
      const r = await fetch('/api/verify/id', { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) {
        show(data.error || 'ส่งไม่สำเร็จ')
      } else {
        show('ส่งรายการตรวจสอบแล้ว — รอ admin ภายใน 24 ชั่วโมง')
        await reloadUser()
        setTimeout(() => onDone(), 800)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '28px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '90vh', overflowY: 'auto' }}>
        <Toast msg={msg} />
        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, color: '#121212', letterSpacing: '-0.02em', marginBottom: 6 }}>
          🪪 ยืนยันตัวตนด้วยบัตรประชาชน
        </div>
        <div style={{ fontSize: 14, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 22 }}>
          เพิ่มความน่าเชื่อถือให้บัญชีผู้ขาย — ผู้ซื้อจะเห็น Badge "ยืนยันตัวตน" และไว้ใจมากขึ้น
        </div>

        <div className="form-group">
          <label className="label">รูปบัตรประชาชน</label>
          <label style={{ display: 'block', cursor: 'pointer' }}>
            <input type="file" accept="image/*" onChange={e => setIdFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
            <div style={{ padding: '20px 16px', border: `2px dashed ${idFile ? 'var(--green)' : 'var(--border)'}`, borderRadius: 12, background: idFile ? 'var(--green-bg)' : 'var(--surface)', textAlign: 'center', fontSize: 14, fontWeight: 600, color: idFile ? 'var(--green)' : 'var(--ink2)' }}>
              {idFile ? `✓ ${idFile.name}` : '📷 เลือก/ถ่ายรูปบัตรประชาชน'}
            </div>
          </label>
        </div>

        <div className="form-group">
          <label className="label">รูป selfie ถือบัตรประชาชน</label>
          <label style={{ display: 'block', cursor: 'pointer' }}>
            <input type="file" accept="image/*" capture="user" onChange={e => setSelfieFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
            <div style={{ padding: '20px 16px', border: `2px dashed ${selfieFile ? 'var(--green)' : 'var(--border)'}`, borderRadius: 12, background: selfieFile ? 'var(--green-bg)' : 'var(--surface)', textAlign: 'center', fontSize: 14, fontWeight: 600, color: selfieFile ? 'var(--green)' : 'var(--ink2)' }}>
              {selfieFile ? `✓ ${selfieFile.name}` : '🤳 ถ่าย selfie ถือบัตรประชาชน'}
            </div>
          </label>
        </div>

        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#92400E', lineHeight: 1.6, marginBottom: 18 }}>
          🔒 ข้อมูลของคุณถูกเก็บอย่างปลอดภัย ใช้สำหรับ verify ตัวตนเท่านั้น ไม่เผยแพร่
        </div>

        <button className="btn" onClick={submit} disabled={submitting || !idFile || !selfieFile}>
          {submitting ? <><span className="spin" />กำลังส่ง...</> : 'ส่งตรวจสอบ'}
        </button>
        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>
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

// ─────────────────────────────────────────────────────────────────────────
// Trust Mission card — gamified profile completeness
// (computeTrustScore + types imported at top of file)
// ─────────────────────────────────────────────────────────────────────────

function ShieldIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill={color} opacity={0.15} />
      <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke={color} strokeWidth={1.5} fill="none" />
      <path d="M9.5 12l2 2 3.5-4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

export function TrustBadge({ user, size = 'sm' }: { user: any; size?: 'sm' | 'md' | 'lg' }) {
  if (!user) return null
  const hasPhone = !!user.phone_verified_at
  const hasId = !!user.id_verified_at
  const hasBoth = hasPhone && hasId

  const fontSize = size === 'lg' ? 13 : size === 'md' ? 12 : 11
  const padding = size === 'lg' ? '6px 12px' : size === 'md' ? '5px 10px' : '3px 8px'
  const iconSize = size === 'lg' ? 16 : size === 'md' ? 14 : 12

  const pill = (bg: string, color: string, content: React.ReactNode, key: string) => (
    <span
      key={key}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: bg,
        color,
        borderRadius: 6,
        padding,
        fontSize,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {content}
    </span>
  )

  const badges: React.ReactNode[] = []

  // ไม่มีอะไรเลย → "สมาชิก"
  if (!hasPhone && !hasId) {
    const t = TRUST_TIERS.member
    badges.push(pill(t.bgColor, t.color, t.shortLabel, 'member'))
  } else {
    // โชว์ badge แยกตามสิ่งที่ได้จริง
    if (hasPhone) {
      const t = TRUST_TIERS.phone
      badges.push(pill(t.bgColor, t.color, t.shortLabel, 'phone'))
    }
    if (hasId) {
      const t = TRUST_TIERS.id
      badges.push(pill(t.bgColor, t.color, t.shortLabel, 'id'))
    }
    // ครบทั้งคู่ → เพิ่ม Verified Seller (shield SVG) ตัวสุดท้าย
    if (hasBoth) {
      const t = TRUST_TIERS.verified
      badges.push(
        pill(
          t.bgColor,
          t.color,
          <>
            <ShieldIcon size={iconSize} color={t.color} />
            Verified Seller
          </>,
          'verified'
        )
      )
    }
  }

  return <>{badges}</>
}

export function TrustMission({
  user,
  onAction,
}: {
  user: any
  onAction: (key: TrustItemKey) => void
}) {
  const { count, total, percent, tier, items } = computeTrustScore(user)
  const isComplete = count === total

  // ครบทุกข้อแล้ว → ซ่อน mission card ทั้งหมด (badge บน profile header โชว์ status แทน)
  if (isComplete) return null

  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: '18px 16px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Header: title + tier */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 16, fontWeight: 700, color: '#121212', letterSpacing: '-0.01em' }}>
            🎯 ภารกิจสร้างความน่าเชื่อถือ
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
            ทำครบเพื่อขายไวขึ้น
          </div>
        </div>
        {count > 0 && (
          <div style={{
            background: tier.bgColor,
            color: tier.color,
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}>
            {tier.emoji} {tier.label}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>{count}/{total}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: tier.color }}>{percent}%</span>
        </div>
        <div style={{
          width: '100%',
          height: 8,
          background: '#F1F5F9',
          borderRadius: 999,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${percent}%`,
            height: '100%',
            background: isComplete ? '#22C55E' : `linear-gradient(90deg, ${tier.color}aa, ${tier.color})`,
            borderRadius: 999,
            transition: 'width .4s ease',
          }} />
        </div>
      </div>

      {/* Items list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item) => (
          <TrustItemRow key={item.key} item={item} onClick={() => onAction(item.key)} />
        ))}
      </div>

      {/* Footer reward callout */}
      {!isComplete && (
        <div style={{
          marginTop: 14,
          padding: '10px 12px',
          background: '#FFFBEB',
          border: '1px solid #FDE68A',
          borderRadius: 10,
          fontSize: 12,
          color: '#78350F',
          lineHeight: 1.6,
        }}>
          🏆 <b>ทำครบ</b> รับป้าย <b>🛡️ Verified Seller</b> — ลูกค้าเชื่อมั่น ปิดดีลเร็วขึ้น
        </div>
      )}
      {isComplete && (
        <div style={{
          marginTop: 14,
          padding: '12px',
          background: '#DCFCE7',
          border: '1px solid #86EFAC',
          borderRadius: 10,
          fontSize: 13,
          color: '#15803D',
          fontWeight: 600,
          textAlign: 'center',
        }}>
          🎉 ยินดีด้วย! คุณเป็น Verified Seller แล้ว 🛡️
        </div>
      )}
    </div>
  )
}

function TrustItemRow({ item, onClick }: { item: TrustItem; onClick: () => void }) {
  const isDone = item.status === 'done'
  const isPending = item.status === 'pending'
  const clickable = !isDone && !isPending

  return (
    <div
      onClick={clickable ? onClick : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: isDone ? '#F0FDF4' : isPending ? '#FFFBEB' : '#FAFAFA',
        border: `1px solid ${isDone ? '#BBF7D0' : isPending ? '#FDE68A' : 'var(--border-light)'}`,
        borderRadius: 12,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'all .15s',
      }}
      onMouseOver={(e) => { if (clickable) (e.currentTarget as HTMLElement).style.background = '#F0F9FF' }}
      onMouseOut={(e) => { if (clickable) (e.currentTarget as HTMLElement).style.background = '#FAFAFA' }}
    >
      {/* Status icon */}
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: isDone ? '#22C55E' : isPending ? '#F59E0B' : 'white',
        border: isDone ? 'none' : `2px solid ${isPending ? '#F59E0B' : '#CBD5E1'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: isDone || isPending ? 'white' : 'transparent',
        fontSize: 16,
        fontWeight: 700,
      }}>
        {isDone ? '✓' : isPending ? '⏳' : ''}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14,
          fontWeight: 700,
          color: isDone ? '#15803D' : isPending ? '#92400E' : '#121212',
          lineHeight: 1.4,
          marginBottom: 2,
        }}>
          <span style={{ marginRight: 6 }}>{item.icon}</span>
          {item.title}
        </div>
        <div style={{
          fontSize: 12,
          color: isDone ? '#166534' : isPending ? '#B45309' : 'var(--ink3)',
          lineHeight: 1.5,
        }}>
          {isPending ? 'รอตรวจสอบ ~24 ชั่วโมง' : item.benefit}
        </div>
      </div>

      {/* Action indicator */}
      {clickable && (
        <span style={{ fontSize: 13, fontWeight: 700, color: '#3B82F6', flexShrink: 0 }}>
          ทำเลย →
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// IdentityVerifyWizard — 2-step photo capture (ID card + bank book)
// ─────────────────────────────────────────────────────────────────────────

export function IdentityVerifyWizard({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone?: () => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [idCardFile, setIdCardFile] = useState<File | null>(null)
  const [idCardPreview, setIdCardPreview] = useState<string>('')
  const [bankFile, setBankFile] = useState<File | null>(null)
  const [bankPreview, setBankPreview] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const idCameraRef = useRef<HTMLInputElement>(null)
  const idGalleryRef = useRef<HTMLInputElement>(null)
  const bankCameraRef = useRef<HTMLInputElement>(null)
  const bankGalleryRef = useRef<HTMLInputElement>(null)
  const { reloadUser } = useAuth()

  const handlePhoto = (file: File | null, type: 'id' | 'bank') => {
    if (!file) return
    const url = URL.createObjectURL(file)
    if (type === 'id') {
      setIdCardFile(file)
      setIdCardPreview(url)
    } else {
      setBankFile(file)
      setBankPreview(url)
    }
  }

  const submit = async () => {
    if (!idCardFile || !bankFile) {
      setError('กรุณาถ่ายรูปครบทั้ง 2 อย่าง')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('id_card', idCardFile)
      fd.append('bank_book', bankFile)
      const r = await fetch('/api/user/identity-verify', { method: 'POST', body: fd })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.message || body.error || 'ส่งไม่สำเร็จ')
      }
      await reloadUser()
      onDone?.()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'ส่งไม่สำเร็จ')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.72)', zIndex: 200, display: 'flex', alignItems: 'flex-end', overflowY: 'auto' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', width: '100%', maxWidth: 480, margin: '20px auto 0' }}>
        {/* Header + step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, fontWeight: 700, color: '#121212' }}>ยืนยันตัวตน</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>ขั้นตอน {step}/2</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1 }}>✕</button>
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#1D4ED8' }} />
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: step === 2 ? '#1D4ED8' : '#E2E8F0' }} />
        </div>

        {step === 1 ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#121212', marginBottom: 4 }}>📇 ถ่ายบัตรประชาชน</div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 8 }}>
              วางบัตรในกรอบ — ถ่ายให้เห็นชัดทั้ง 4 มุม
            </div>
            <div style={{ fontSize: 11, color: '#0369A1', background: '#E0F2FE', borderRadius: 8, padding: '6px 10px', marginBottom: 14, lineHeight: 1.5 }}>
              🔒 ใช้เพื่อลงทะเบียนผู้ขายกับ BookMatch เท่านั้น — ไม่เผยแพร่หรือใช้เพื่อวัตถุประสงค์อื่น
            </div>

            {/* ID card preview / capture area — landscape ratio */}
            <div style={{ position: 'relative', aspectRatio: '8.6 / 5.4', background: '#0F172A', borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
              {idCardPreview ? (
                <img src={idCardPreview} alt="ID card" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ position: 'absolute', inset: 12, border: '2px dashed rgba(255,255,255,.5)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 32 }}>📇</span>
                  <span style={{ color: 'rgba(255,255,255,.8)', fontSize: 13, fontWeight: 600 }}>วางบัตรในกรอบนี้</span>
                </div>
              )}
            </div>

            <input
              ref={idCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => { handlePhoto(e.target.files?.[0] || null, 'id'); e.target.value = '' }}
              style={{ display: 'none' }}
            />
            <input
              ref={idGalleryRef}
              type="file"
              accept="image/*"
              onChange={(e) => { handlePhoto(e.target.files?.[0] || null, 'id'); e.target.value = '' }}
              style={{ display: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                className="btn"
                onClick={() => idCameraRef.current?.click()}
                style={{ flex: 1, background: idCardFile ? 'var(--surface)' : 'var(--primary)', color: idCardFile ? 'var(--ink2)' : 'white', border: idCardFile ? '1px solid var(--border)' : 'none' }}
              >
                📷 {idCardFile ? 'ถ่ายใหม่' : 'ถ่ายสด'}
              </button>
              <button
                className="btn"
                onClick={() => idGalleryRef.current?.click()}
                style={{ flex: 1, background: 'var(--surface)', color: 'var(--ink2)', border: '1px solid var(--border)' }}
              >
                🖼️ เลือกจากอัลบั้ม
              </button>
            </div>

            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#78350F', lineHeight: 1.6 }}>
              💡 <b>เคล็ดลับ:</b> ถ่ายในที่สว่าง · ไม่สะท้อนแสง · เห็นตัวอักษรชัด
            </div>

            <button
              className="btn"
              onClick={() => setStep(2)}
              disabled={!idCardFile}
              style={{ marginBottom: 8 }}
            >
              ขั้นต่อไป →
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#121212', marginBottom: 4 }}>💰 ถ่ายหน้าสมุดบัญชี</div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6, marginBottom: 16 }}>
              ถ่ายหน้าที่มี <b>ชื่อบัญชี</b> ตรงกับบัตรประชาชน
            </div>

            <div style={{ position: 'relative', aspectRatio: '3 / 4', background: '#0F172A', borderRadius: 12, marginBottom: 14, overflow: 'hidden', maxWidth: 280, margin: '0 auto 14px' }}>
              {bankPreview ? (
                <img src={bankPreview} alt="Bank book" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ position: 'absolute', inset: 12, border: '2px dashed rgba(255,255,255,.5)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 32 }}>💰</span>
                  <span style={{ color: 'rgba(255,255,255,.8)', fontSize: 13, fontWeight: 600, textAlign: 'center', padding: '0 12px' }}>ถ่ายหน้าที่มีชื่อบัญชี</span>
                </div>
              )}
            </div>

            <input
              ref={bankCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => { handlePhoto(e.target.files?.[0] || null, 'bank'); e.target.value = '' }}
              style={{ display: 'none' }}
            />
            <input
              ref={bankGalleryRef}
              type="file"
              accept="image/*"
              onChange={(e) => { handlePhoto(e.target.files?.[0] || null, 'bank'); e.target.value = '' }}
              style={{ display: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                className="btn"
                onClick={() => bankCameraRef.current?.click()}
                style={{ flex: 1, background: bankFile ? 'var(--surface)' : 'var(--primary)', color: bankFile ? 'var(--ink2)' : 'white', border: bankFile ? '1px solid var(--border)' : 'none' }}
              >
                📷 {bankFile ? 'ถ่ายใหม่' : 'ถ่ายสด'}
              </button>
              <button
                className="btn"
                onClick={() => bankGalleryRef.current?.click()}
                style={{ flex: 1, background: 'var(--surface)', color: 'var(--ink2)', border: '1px solid var(--border)' }}
              >
                🖼️ เลือกจากอัลบั้ม
              </button>
            </div>

            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#78350F', lineHeight: 1.6 }}>
              💡 ปิดเลขบัญชีได้ ขอแค่ <b>ชื่อ</b>เห็นชัด — ตรงกับบัตรประชาชน
            </div>

            {error && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: '#991B1B' }}>
                ⚠️ {error}
              </div>
            )}

            <button className="btn" onClick={submit} disabled={!bankFile || submitting} style={{ marginBottom: 8 }}>
              {submitting ? 'กำลังส่ง...' : '✓ ส่งให้ตรวจสอบ'}
            </button>
            <button className="btn btn-ghost" onClick={() => setStep(1)} disabled={submitting}>
              ← ย้อนกลับ
            </button>
          </>
        )}

        <div style={{ fontSize: 11, color: 'var(--ink3)', textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
          🔒 ข้อมูลของคุณปลอดภัย เก็บในระบบเข้ารหัส<br />
          ใช้เพื่อลงทะเบียนผู้ขายกับ BookMatch เท่านั้น<br />
          ไม่เผยแพร่หรือส่งต่อบุคคลที่สาม<br />
          แอดมินจะตรวจภายใน 24 ชั่วโมง
        </div>
      </div>
    </div>
  )
}
