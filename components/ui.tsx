'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '@/lib/auth'
import { computeTrustScore, TRUST_TIERS, type TrustItemKey, type TrustItem } from '@/lib/trust'

// LINE in-app browser บน Android ไม่รองรับ capture="environment"
// ใช้ hook นี้เพื่อ return "environment" ปกติ หรือ undefined ถ้าเป็น LINE
export function useCapture(): 'environment' | undefined {
  const [cap, setCap] = useState<'environment' | undefined>('environment')
  useEffect(() => {
    if (/Line\//.test(navigator.userAgent)) setCap(undefined)
  }, [])
  return cap
}


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
        canvas.width = 0; canvas.height = 0 // free GPU memory
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
  const [unread, setUnread] = useState(0)

  // Poll unread notifications — ย้ายมาจาก BottomNav
  useEffect(() => {
    if (!user) return
    const fetchUnread = () => {
      fetch('/api/notifications/unread').then(r => r.json()).then(d => setUnread(d.unread || 0)).catch(() => {})
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 60000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchUnread() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('notifications:read', fetchUnread)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('notifications:read', fetchUnread)
    }
  }, [user])

  return (
    <nav className="nav">
      <Link href="/" className="nav-logo">Book<span>Match</span></Link>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {!loading && user && (
          <Link
            href="/notifications"
            aria-label="แจ้งเตือน"
            style={{
              width: 36, height: 36, borderRadius: 999, background: '#F1F5F9',
              display: 'grid', placeItems: 'center', position: 'relative',
              color: '#334155', textDecoration: 'none',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {unread > 0 && (
              <span style={{
                position: 'absolute', top: 5, right: 6, minWidth: 14, height: 14,
                padding: '0 4px', borderRadius: 999, background: '#EF4444', color: 'white',
                fontSize: 9, fontWeight: 800, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid #F1F5F9',
              }}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
        )}
        {!loading && !user && (
          <Link href="/sell">
            <button className="btn btn-sm" style={{ width: 'auto', minWidth: 90 }}>
              เข้าสู่ระบบ
            </button>
          </Link>
        )}
      </div>
    </nav>
  )
}

// SVG line icons (Lucide-style) ตาม design handoff
function NavIconHome({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--primary)' : '#94A3B8'} strokeWidth={active ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  )
}
function NavIconUser({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--primary)' : '#94A3B8'} strokeWidth={active ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
function NavIconPlus() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function BottomNav() {
  const pathname = usePathname()
  const sellActive = pathname === '/sell'
  const homeActive = pathname === '/'
  const profileActive = pathname === '/profile'

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    paddingTop: 10, textDecoration: 'none',
    color: active ? 'var(--primary)' : '#94A3B8',
    fontFamily: 'Kanit', fontSize: 10.5, fontWeight: active ? 600 : 500,
  })

  // iOS dynamic URL bar ทำ position:fixed เด้ง — fix ด้วย:
  //   1. env(safe-area-inset-bottom) = iPhone home indicator padding
  //   2. transform: translateZ(0) = promote to composite layer (กัน reflow)
  //   3. spacer height รวม safe-area ด้วย (กัน content ทับ nav)
  return (
    <>
      <div style={{ height: 'calc(74px + env(safe-area-inset-bottom, 0px))' }} />
      <div style={{
        position: 'fixed', bottom: 0, left: '50%',
        transform: 'translate3d(-50%, 0, 0)', // 3D = composite layer
        width: '100%', maxWidth: 480, background: 'white',
        borderTop: '1px solid #F1F5F9',
        paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        height: 'calc(74px + env(safe-area-inset-bottom, 0px))',
        zIndex: 100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around',
      }}>
        <Link href="/" style={tabStyle(homeActive)}>
          <NavIconHome active={homeActive} />
          <span>หน้าแรก</span>
        </Link>

        {/* Elevated center sell button — circle ลอยขึ้นมาจาก nav */}
        <div style={{ position: 'relative', width: 56, display: 'flex', justifyContent: 'center' }}>
          {sellActive ? (
            <div
              aria-disabled="true"
              style={{
                position: 'absolute', top: -18,
                width: 52, height: 52, borderRadius: 16,
                background: '#94A3B8',
                display: 'grid', placeItems: 'center',
                border: '3px solid white',
                opacity: 0.55, cursor: 'not-allowed', pointerEvents: 'none',
              }}
            >
              <NavIconPlus />
            </div>
          ) : (
            <Link
              href="/sell"
              aria-label="ลงขาย"
              style={{
                position: 'absolute', top: -18,
                width: 52, height: 52, borderRadius: 16,
                background: 'var(--primary)',
                boxShadow: '0 8px 20px rgba(37,99,235,0.45), 0 2px 6px rgba(37,99,235,0.3)',
                display: 'grid', placeItems: 'center',
                border: '3px solid white', textDecoration: 'none',
              }}
            >
              <NavIconPlus />
            </Link>
          )}
        </div>

        <Link href="/profile" style={tabStyle(profileActive)}>
          <NavIconUser active={profileActive} />
          <span>โปรไฟล์</span>
        </Link>
      </div>
    </>
  )
}

// Footer terms link — แสดงเฉพาะหน้า home (ที่อื่นรกสายตา)
export function TermsFooter() {
  const [showFeedback, setShowFeedback] = useState(false)
  return (
    <div style={{ textAlign: 'center', padding: '20px 0 12px', fontSize: 13, color: '#94A3B8' }}>
      <div style={{ marginBottom: 6, color: '#64748B', fontSize: 13, lineHeight: 1.6 }}>
        หนังสือทุกเล่มสมควรมีชีวิตที่สอง<br />
        <Link href="/impact" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
          เรื่องราวของเรา →
        </Link>
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href="/terms" style={{ color: '#94A3B8', textDecoration: 'underline', textUnderlineOffset: 2 }}>ข้อตกลงการใช้บริการ</Link>
        <button
          type="button"
          onClick={() => setShowFeedback(true)}
          style={{ background: 'none', border: 0, padding: 0, fontFamily: 'Kanit', fontSize: 13, color: '#94A3B8', textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer' }}
        >
          แจ้งปัญหา / ข้อเสนอแนะ
        </button>
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </div>
  )
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<'complaint' | 'suggestion' | 'bug' | 'general'>('general')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (sending) return
    const trimmed = message.trim()
    if (!trimmed) { setError('กรุณากรอกข้อความ'); return }
    if (trimmed.length > 2000) { setError('ข้อความยาวเกิน 2000 ตัวอักษร'); return }
    setError('')
    setSending(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, message: trimmed, contact: contact.trim(), website }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 429) setError('ส่งบ่อยเกินไป ลองใหม่อีกครั้งในอีกสักครู่')
        else setError(data?.error === 'missing_message' ? 'กรุณากรอกข้อความ' : 'ส่งไม่สำเร็จ ลองอีกครั้ง')
        return
      }
      setSent(true)
    } catch {
      setError('ส่งไม่สำเร็จ ลองอีกครั้ง')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 16, width: '100%', maxWidth: 440,
          padding: 20, fontFamily: 'Kanit', textAlign: 'left',
          maxHeight: '90vh', overflow: 'auto',
        }}
      >
        {sent ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>ส่งเรียบร้อยแล้ว</div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 16 }}>ขอบคุณที่ช่วยให้เราทำงานได้ดีขึ้น</div>
            <button
              type="button" onClick={onClose}
              style={{ padding: '10px 24px', minHeight: 44, background: 'var(--primary)', color: 'white', border: 0, borderRadius: 10, fontFamily: 'Kanit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              ปิด
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>แจ้งปัญหา / ข้อเสนอแนะ</div>
              <button
                type="button" onClick={onClose}
                style={{ background: 'none', border: 0, fontSize: 22, color: 'var(--ink3)', cursor: 'pointer', lineHeight: 1, padding: 4 }}
                aria-label="ปิด"
              >×</button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>ประเภท</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {([
                  { k: 'complaint', label: 'ร้องเรียน' },
                  { k: 'bug', label: 'บั๊ก/ใช้งานไม่ได้' },
                  { k: 'suggestion', label: 'ข้อเสนอแนะ' },
                  { k: 'general', label: 'อื่นๆ' },
                ] as const).map(o => (
                  <button
                    key={o.k} type="button"
                    onClick={() => setKind(o.k)}
                    style={{
                      padding: '10px 8px', minHeight: 44, borderRadius: 10, fontFamily: 'Kanit',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      background: kind === o.k ? 'var(--primary-light)' : 'white',
                      border: kind === o.k ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                      color: kind === o.k ? 'var(--primary-strong)' : 'var(--ink2)',
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>
                ข้อความ <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                maxLength={2000}
                placeholder="บอกเราหน่อย เจอปัญหาอะไร หรืออยากให้เราปรับตรงไหน"
                style={{
                  width: '100%', minHeight: 120, padding: '10px 12px',
                  borderRadius: 10, border: '1px solid var(--border)',
                  fontFamily: 'Kanit', fontSize: 14, resize: 'vertical', boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--ink3)', textAlign: 'right', marginTop: 2 }}>
                {message.length}/2000
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>
                ช่องทางติดต่อกลับ <span style={{ fontWeight: 400, color: 'var(--ink3)' }}>(ไม่บังคับ)</span>
              </label>
              <input
                type="text" value={contact} onChange={e => setContact(e.target.value)}
                maxLength={200} placeholder="อีเมล หรือ LINE ID"
                style={{
                  width: '100%', minHeight: 44, padding: '10px 12px',
                  borderRadius: 10, border: '1px solid var(--border)',
                  fontFamily: 'Kanit', fontSize: 14, boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Honeypot — ซ่อนจาก user ทั้ง visual + screen reader แต่ bot ที่ fill all fields จะกรอก */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
              <label>Website (leave blank)</label>
              <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
            </div>

            {error && (
              <div style={{ fontSize: 13, color: '#DC2626', marginBottom: 10 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button" onClick={onClose}
                style={{ flex: 1, padding: '10px 12px', minHeight: 44, background: 'white', border: '1px solid var(--border)', borderRadius: 10, fontFamily: 'Kanit', fontSize: 14, fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer' }}
              >
                ยกเลิก
              </button>
              <button
                type="submit" disabled={sending}
                style={{ flex: 1, padding: '10px 12px', minHeight: 44, background: 'var(--primary)', border: 0, borderRadius: 10, fontFamily: 'Kanit', fontSize: 14, fontWeight: 700, color: 'white', cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.7 : 1 }}
              >
                {sending ? 'กำลังส่ง…' : 'ส่ง'}
              </button>
            </div>
          </form>
        )}
      </div>
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
      <div style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
        การ login ถือว่ายอมรับ <Link href="/terms" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>ข้อตกลงการใช้บริการ</Link>
      </div>
    </div>
  )
}

// Multi-auth login — Phone OTP (primary) + LINE + Facebook
export function MultiLoginButton({
  onLoginSuccess,
}: {
  onLoginSuccess?: () => void
}) {
  const { loginWithLine, loginWithFacebook, loginWithPhone } = useAuth()
  const [redirecting, setRedirecting] = useState<'line' | 'facebook' | null>(null)
  const [mode, setMode] = useState<'menu' | 'phone'>('menu')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const { msg, show } = useToast()
  const confirmationRef = useRef<any>(null)
  const recaptchaRef = useRef<any>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  useEffect(() => {
    return () => { try { recaptchaRef.current?.clear() } catch {} }
  }, [])

  // Detect browser ที่ LINE login ใช้ไม่ได้
  const [showLine, setShowLine] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent
    if (/FBAN|FBAV/.test(ua)) { setShowLine(false); return }
    if (/CriOS/.test(ua)) { setShowLine(false); return }
  }, [])

  // OTP input ref
  const otpInputRef = useRef<HTMLInputElement>(null)

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
      const [{ getFirebaseAuth }, { RecaptchaVerifier, signInWithPhoneNumber }] = await Promise.all([
        import('@/lib/firebase-client'),
        import('firebase/auth'),
      ])
      const auth = getFirebaseAuth()
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'bm-login-recaptcha', { size: 'invisible' })
      }
      const e164 = '+66' + cleaned.slice(1)
      const result = await signInWithPhoneNumber(auth, e164, recaptchaRef.current)
      confirmationRef.current = result
      // Reset reCAPTCHA หลังใช้สำเร็จ → ลดโอกาส challenge ครั้งถัดไป
      try { recaptchaRef.current?.clear() } catch {}
      recaptchaRef.current = null
      setStep('code')
      setCooldown(60)
      show('ส่งรหัส OTP แล้ว ตรวจ SMS')
    } catch (e: any) {
      const errCode = e?.code || 'unknown'
      console.warn('[phone-login]', errCode, e?.message?.slice(0, 100))
      if (errCode === 'auth/invalid-phone-number') show('เบอร์ไม่ถูกต้อง')
      else if (errCode === 'auth/too-many-requests') show('ถูก block ชั่วคราว (~30 นาที) เพราะขอ OTP บ่อยเกินไป ลองใหม่หรือใช้เบอร์อื่น')
      else if (errCode === 'auth/quota-exceeded') show('ระบบใช้งานเต็ม ลองใหม่พรุ่งนี้')
      else show('ส่ง OTP ไม่สำเร็จ ลองใหม่อีกครั้ง')
      try { recaptchaRef.current?.clear() } catch {}
      recaptchaRef.current = null
    } finally {
      setLoading(false)
    }
  }

  const confirmOtp = async () => {
    // อ่านค่าจาก DOM ตรงๆ เผื่อ autofill ไม่ sync กับ React state
    const otpVal = otpInputRef.current?.value.replace(/\D/g, '').slice(0, 6) || code
    if (!/^\d{6}$/.test(otpVal)) { show('กรอก OTP 6 หลัก'); return }
    if (!confirmationRef.current) { show('ขอ OTP ใหม่'); setStep('phone'); return }
    setLoading(true)
    try {
      const result = await confirmationRef.current.confirm(otpVal)
      const idToken = await result.user.getIdToken()
      const loginResult = await loginWithPhone(idToken)
      if (!loginResult.ok) {
        show('เข้าสู่ระบบไม่สำเร็จ: ' + (loginResult.error || 'unknown'))
        return
      }
      onLoginSuccess?.()
    } catch (e: any) {
      setCode(''); if (otpInputRef.current) otpInputRef.current.value = ''
      if (e?.code === 'auth/invalid-verification-code') show('รหัสไม่ถูกต้อง กรอกใหม่ได้เลย')
      else if (e?.code === 'auth/code-expired') { show('รหัสหมดอายุ กดส่ง OTP ใหม่'); setStep('phone') }
      else show('ยืนยันไม่สำเร็จ ลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'phone') {
    return (
      <div style={{ maxWidth: 320, margin: '0 auto' }}>
        <Toast msg={msg} />

        {/* Loading overlay — กลางจอ เห็นชัดทุก platform */}
        {loading && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,.6)', zIndex: 9999,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
          }}>
            <div style={{
              width: 48, height: 48,
              border: '4px solid rgba(255,255,255,.3)',
              borderTopColor: 'white',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
            <div style={{ color: 'white', fontSize: 16, fontWeight: 700, textAlign: 'center', lineHeight: 1.7 }}>
              {step === 'phone' ? <>กำลังส่ง OTP...<br />รอสักครู่</> : <>กำลังตรวจสอบ...</>}
            </div>
          </div>
        )}

        {step === 'phone' ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#121212', marginBottom: 12, textAlign: 'center' }}>
              กรอกเบอร์มือถือ
            </div>
            <input
              className="input"
              type="tel"
              inputMode="numeric"
              placeholder="08X-XXX-XXXX"
              autoComplete="tel"
              value={formatPhone(phone)}
              onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 20, padding: '14px 16px', textAlign: 'center', fontWeight: 600, letterSpacing: 1 }}
              autoFocus
            />
            <button
              className="btn"
              onClick={sendOtp}
              disabled={loading || phone.replace(/\D/g, '').length < 10}
              style={{ width: '100%', marginTop: 12, fontSize: 16, padding: '14px', fontWeight: 700 }}
            >
              ส่งรหัส OTP
            </button>
          </>
        ) : (
          <form onSubmit={e => { e.preventDefault(); confirmOtp() }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#121212', marginBottom: 6, textAlign: 'center' }}>
              กรอกรหัส OTP
            </div>
            <div style={{ fontSize: 13, color: '#64748B', textAlign: 'center', marginBottom: 12 }}>
              ส่งไปที่ {formatPhone(phone)}
            </div>
            {/* Fully uncontrolled input — ปล่อย browser autofill ทำงานเอง ไม่มี React interference */}
            <input
              ref={otpInputRef}
              className="input"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              name="otp"
              id="otp"
              placeholder="------"
              autoComplete="one-time-code"
              maxLength={6}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 28, padding: '14px 16px', textAlign: 'center', fontWeight: 700, letterSpacing: 8 }}
            />
            <button
              type="submit"
              className="btn"
              disabled={loading}
              style={{ width: '100%', marginTop: 12, fontSize: 16, padding: '14px', fontWeight: 700 }}
            >
              {loading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={sendOtp}
              disabled={cooldown > 0 || loading}
              style={{ width: '100%', marginTop: 6, fontSize: 14 }}
            >
              {cooldown > 0 ? `ส่ง OTP ใหม่ใน ${cooldown}s` : 'ส่ง OTP ใหม่'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { setStep('phone'); setCode('') }}
              disabled={loading}
              style={{ width: '100%', marginTop: 4, fontSize: 13, color: '#94A3B8' }}
            >
              เปลี่ยนเบอร์
            </button>
          </form>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => { setMode('menu'); setStep('phone'); setPhone(''); setCode('') }}
          style={{ width: '100%', marginTop: 8, fontSize: 14 }}
        >
          กลับ
        </button>
        <div id="bm-login-recaptcha" />
      </div>
    )
  }

  // Menu mode — show all login options
  return (
    <div style={{ maxWidth: 320, margin: '0 auto' }}>
      <Toast msg={msg} />

      {/* Full-screen overlay ตอน redirect ไป LINE/FB — กัน "เหมือนค้าง" */}
      {redirecting && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.75)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '32px 28px', textAlign: 'center', maxWidth: 320, width: '100%' }}>
            <span className="spin" style={{ width: 32, height: 32, marginBottom: 14 }} />
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
              กำลังเชื่อมต่อ {redirecting === 'line' ? 'LINE' : 'Facebook'}...
            </div>
            <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
              จะเปิดหน้า {redirecting === 'line' ? 'LINE' : 'Facebook'} ให้อัตโนมัติ<br />
              กรุณารอสักครู่
            </div>
          </div>
        </div>
      )}

      {/* Phone OTP — primary */}
      <button
        className="btn"
        onClick={() => setMode('phone')}
        style={{
          width: '100%',
          background: '#1E293B',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          fontSize: 16,
          padding: '14px 16px',
          fontWeight: 700,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 20 }}>&#128241;</span>
        เข้าด้วยเบอร์มือถือ
      </button>

      {/* LINE — ซ่อนใน FB browser / iPhone Chrome */}
      {showLine && (
        <button
          className="btn"
          onClick={() => { setRedirecting('line'); loginWithLine() }}
          disabled={!!redirecting}
          style={{
            width: '100%',
            background: '#06C755',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            fontSize: 16,
            padding: '14px 16px',
            fontWeight: 700,
            marginBottom: 10,
            opacity: redirecting ? 0.6 : 1,
          }}
        >
          {redirecting === 'line' ? <><span className="spin" style={{ width: 18, height: 18, borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} /> กำลังเชื่อมต่อ LINE...</> : 'LINE'}
        </button>
      )}

      {/* Facebook */}
      <button
        className="btn"
        onClick={() => { setRedirecting('facebook'); loginWithFacebook(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/') }}
        disabled={!!redirecting}
        style={{
          width: '100%',
          background: '#1877F2',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          fontSize: 16,
          padding: '14px 16px',
          fontWeight: 700,
          marginBottom: 10,
          opacity: redirecting ? 0.6 : 1,
        }}
      >
        {redirecting === 'facebook' ? <><span className="spin" style={{ width: 18, height: 18, borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} /> กำลังเชื่อมต่อ Facebook...</> : 'Facebook'}
      </button>

      <div style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 6, lineHeight: 1.5 }}>
        การ login ถือว่ายอมรับ <Link href="/terms" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>ข้อตกลงการใช้บริการ</Link>
      </div>
      <div id="bm-login-recaptcha" />
    </div>
  )
}

// LoadingOverlay — full-screen loading sheet (ใช้ตอนรอ API โหลด/บันทึก)
// เพิ่ม spin + message ใน card ขาวตรงกลาง บน overlay ดำโปร่งใส
export function LoadingOverlay({ message = 'กำลังโหลด...', sub }: { message?: string; sub?: string }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 18, padding: '32px 28px', textAlign: 'center', maxWidth: 300, width: '100%' }}>
        <span className="spin" style={{ width: 28, height: 28, marginBottom: 12 }} />
        <div style={{ fontFamily: 'Kanit', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{message}</div>
        {sub && <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

// ConfirmModal — dialog ยืนยันก่อน action destructive (ลบ, ยกเลิก, ฯลฯ)
// ใช้ตอน destructive action ที่ undo ไม่ได้
export function ConfirmModal({
  title, message, confirmLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก',
  variant = 'primary', onConfirm, onCancel,
}: {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'primary' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmBg = variant === 'danger' ? '#DC2626' : 'var(--primary)'
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340, fontFamily: 'Kanit' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: message ? 8 : 18, color: 'var(--ink)' }}>{title}</div>
        {message && <div style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.6 }}>{message}</div>}
        <button
          onClick={onConfirm}
          style={{ width: '100%', padding: '12px 16px', minHeight: 48, background: confirmBg, color: 'white', border: 'none', borderRadius: 12, fontFamily: 'Kanit', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}
        >
          {confirmLabel}
        </button>
        <button
          onClick={onCancel}
          style={{ width: '100%', padding: '12px 16px', minHeight: 44, background: 'white', color: 'var(--ink2)', border: '1px solid var(--border)', borderRadius: 12, fontFamily: 'Kanit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          {cancelLabel}
        </button>
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
  // Priority: coverUrl จาก DB (user อัปโหลด) → ISBN proxy (Google/OpenLibrary)
  const src = coverUrl
    ? coverUrl
    : isbn && /^\d{10,13}$/.test(isbn) ? `/api/cover/${isbn}` : undefined
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
    const isInApp = isLine || /FBAN|FBAV|Instagram|Twitter|BytedanceWebview|musical_ly|TikTok/.test(ua)
    // iPhone: detect non-Safari browsers (Chrome, Firefox, etc.) — they all contain "CriOS", "FxiOS", etc.
    const isIPhone = /iPhone/.test(ua)
    const isNotSafari = isIPhone && (/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua))

    if (!isIPhone) return // Android & desktop → LINE Login ใช้ได้ทุก browser ปกติ

    if (!isInApp && !isNotSafari) return // Safari บน iPhone → ไม่ต้องทำอะไร

    // LINE in-app → auto-redirect ด้วย openExternalBrowser=1
    if (isLine) {
      const url = new URL(window.location.href)
      url.searchParams.set('openExternalBrowser', '1')
      window.location.href = url.toString()
      return
    }

    // in-app browser หรือ Chrome/Firefox บน iPhone → แสดง banner ให้ copy link ไปเปิด Safari
    setFallback(true)
  }, [])

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!fallback) return null

  return (
    <div className="inapp-banner" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 20 }}>🧭</span>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: '#166534' }}>
        <strong>Login ง่ายขึ้นบน Safari</strong>
        <br />
        คัดลอกลิงก์แล้ววางใน Safari ได้เลย
      </div>
      <button
        onClick={copyLink}
        style={{
          background: copied ? '#16A34A' : '#15803D',
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
          transition: 'background .2s',
        }}
      >
        {copied ? '✓ คัดลอกแล้ว' : 'คัดลอกลิงก์'}
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

        <InAppBanner />

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

        <div style={{ fontSize: 13, color: 'var(--ink3)', lineHeight: 1.6, textAlign: 'center', marginTop: 16 }}>
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
      // Log full detail server-side, user-facing message ภาษาคน
      console.warn('[firebase phone]', e?.code, e?.message)
      const code = e?.code || 'unknown'
      if (code === 'auth/invalid-phone-number') show('เบอร์ไม่ถูกต้อง')
      else if (code === 'auth/too-many-requests') show('ถูก block ชั่วคราว (~30 นาที) เพราะขอ OTP บ่อยเกินไป ลองใหม่หรือใช้เบอร์อื่น')
      else if (code === 'auth/quota-exceeded') show('ระบบใช้งานเต็ม ลองใหม่พรุ่งนี้')
      else if (code === 'auth/captcha-check-failed') show('ตรวจสอบความปลอดภัยไม่ผ่าน รีเฟรชหน้าแล้วลองใหม่')
      else show('ส่ง OTP ไม่สำเร็จ ลองใหม่อีกครั้ง')
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
        // ใช้ generic message กัน phone enumeration attack
        if (data.error === 'phone_in_use') show('ใช้เบอร์นี้ไม่ได้ หากเป็นเบอร์คุณจริง ติดต่อทีมงาน')
        else if (data.error === 'already_verified') show('บัญชีนี้ยืนยันเบอร์แล้ว')
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
              <div style={{ fontSize: 13, color: 'var(--ink3)', textAlign: 'center', marginTop: 10, lineHeight: 1.6 }}>
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
  { icon: '9️⃣', text: 'ถ่ายบาร์โค้ดที่ขึ้นต้นด้วย 978 หรือ 979 (ISBN) ถ้ามีหลายบาร์โค้ด เลือกอันที่ขึ้นต้น 978' },
  { icon: '📖', text: 'พลิกหลังปก ถ่ายเฉพาะบาร์โค้ด ไม่ใช่หน้าปก' },
  { icon: '🏷️', text: 'ถ้ามีสติ๊กเกอร์ติดทับบาร์โค้ด ลอกออกก่อนถ่าย' },
  { icon: '☀️', text: 'ถ่ายในที่แสงสว่าง เข้าใกล้ให้บาร์โค้ดเต็มจอ' },
]

export function ScanErrorSheet({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px 18px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, color: '#121212', lineHeight: 1.3, letterSpacing: '-0.02em' }}>อ่านบาร์โค้ดไม่ได้</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1, minWidth: 44, minHeight: 44 }} aria-label="ปิด">✕</button>
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
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 10, width: 44, height: 44, color: 'white', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="ปิด">✕</button>
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

// Camera capture modal สำหรับ LINE in-app browser
// เปิดกล้อง → เห็น preview → กดถ่าย 1 รูป → return File
export function CameraCaptureModal({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [isLineBrowser, setIsLineBrowser] = useState<boolean | null>(null)

  // LINE browser → เปิด gallery ทันที ไม่แสดง modal (simpler UX)
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const isLine = /Line\//.test(navigator.userAgent)
    setIsLineBrowser(isLine)
    if (isLine) {
      // Trigger gallery picker ทันที หลัง mount
      let pickerOpen = false
      setTimeout(() => {
        galleryInputRef.current?.click()
        pickerOpen = true
      }, 50)
      // Android LINE browser: onChange ไม่ fire เมื่อ cancel picker
      // ใช้ focus event detect ว่า user กลับมาแล้ว → ถ้าไม่มีไฟล์ = cancel
      const onFocus = () => {
        if (!pickerOpen) return
        setTimeout(() => {
          if (galleryInputRef.current && !galleryInputRef.current.files?.length) {
            onClose()
          }
        }, 300)
      }
      window.addEventListener('focus', onFocus)
      return () => window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    // ถ้าเป็น LINE browser ไม่ต้องเปิดกล้อง (ใช้ gallery แทน)
    if (isLineBrowser) return
    let cancelled = false
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
          setReady(true)
        }
      } catch {
        if (!cancelled) setError('ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตกล้อง')
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [isLineBrowser])

  const takePhoto = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      canvas.width = 0; canvas.height = 0
      if (!blob) return
      streamRef.current?.getTracks().forEach(t => t.stop())
      onCapture(new File([blob], 'scan.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.95)', zIndex: 300, display: isLineBrowser ? 'none' : 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      {/* LINE browser: ซ่อน modal แต่คง gallery input ไว้ให้ trigger ได้ */}
      {isLineBrowser && (
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) onCapture(file)
            else onClose() // user ยกเลิก picker → ปิด modal
          }}
        />
      )}
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ color: 'white', fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700 }}>ถ่ายรูป Barcode</div>
          <button onClick={() => { streamRef.current?.getTracks().forEach(t => t.stop()); onClose() }} style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 10, width: 44, height: 44, color: 'white', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="ปิด">✕</button>
        </div>

        {error ? (
          <div style={{ background: 'rgba(255,255,255,.1)', borderRadius: 14, padding: '28px 20px', textAlign: 'center', color: 'white' }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>📵</div>
            <div style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 22 }}>{error}</div>
            <button className="btn" onClick={() => { streamRef.current?.getTracks().forEach(t => t.stop()); onClose() }}>ปิด</button>
          </div>
        ) : (
          <>
            <div style={{ borderRadius: 14, overflow: 'hidden', border: '2px solid rgba(255,255,255,.3)', background: '#000' }}>
              <video ref={videoRef} playsInline muted style={{ width: '100%', display: 'block' }} />
            </div>
            {!ready && (
              <div style={{ textAlign: 'center', marginTop: 18, color: 'rgba(255,255,255,.7)', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span className="spin" style={{ width: 18, height: 18, borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} />
                กำลังเปิดกล้อง...
              </div>
            )}
            {ready && (
              <>
                <div style={{ textAlign: 'center', marginTop: 14, color: 'rgba(255,255,255,.75)', fontSize: 14, lineHeight: 1.6 }}>
                  จ่อบาร์โค้ดหลังปกหนังสือ แล้วกดถ่าย
                </div>
                <button onClick={takePhoto} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '20px auto 0', width: 70, height: 70, borderRadius: '50%', background: 'white', border: '4px solid rgba(255,255,255,.4)', cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}>
                  <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'white', border: '3px solid #E5E7EB' }} />
                </button>
              </>
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

  // สัญลักษณ์เดียวเมื่อ sm/md, มี text เฉพาะ lg
  const iconOnly = size !== 'lg'
  const pillSize = size === 'lg' ? 28 : size === 'md' ? 24 : 20
  const emojiSize = size === 'lg' ? 14 : size === 'md' ? 13 : 12
  const fontSize = size === 'lg' ? 13 : 12
  const shieldSize = size === 'lg' ? 16 : size === 'md' ? 14 : 12

  const pill = (bg: string, color: string, content: React.ReactNode, title: string, key: string) => (
    <span
      key={key}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: iconOnly ? 0 : 4,
        background: bg,
        color,
        borderRadius: iconOnly ? '50%' : 6,
        width: iconOnly ? pillSize : 'auto',
        height: iconOnly ? pillSize : 'auto',
        padding: iconOnly ? 0 : size === 'lg' ? '6px 12px' : '4px 10px',
        fontSize: iconOnly ? emojiSize : fontSize,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      {content}
    </span>
  )

  const badges: React.ReactNode[] = []

  if (!hasPhone && !hasId) {
    const t = TRUST_TIERS.member
    badges.push(pill(t.bgColor, t.color, iconOnly ? '👤' : t.shortLabel, t.label, 'member'))
  } else {
    if (hasPhone) {
      const t = TRUST_TIERS.phone
      badges.push(pill(t.bgColor, t.color, iconOnly ? '📱' : t.shortLabel, t.label, 'phone'))
    }
    if (hasId) {
      const t = TRUST_TIERS.id
      badges.push(pill(t.bgColor, t.color, iconOnly ? '🪪' : t.shortLabel, t.label, 'id'))
    }
    if (hasBoth) {
      // Verified Seller — แสดงเต็ม ไม่ใช่แค่ icon (badge ระดับสูงสุด ควรเด่น)
      const t = TRUST_TIERS.verified
      badges.push(
        <span
          key="verified"
          title={t.label}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: t.bgColor,
            color: t.color,
            borderRadius: 999,
            padding: size === 'lg' ? '6px 14px' : '4px 12px',
            fontSize: size === 'lg' ? 13 : 12,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            lineHeight: 1,
            height: iconOnly ? pillSize : 'auto',
          }}
        >
          <ShieldIcon size={shieldSize} color={t.color} />
          Verified Seller
        </span>
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
      {/* Title บรรทัดเดียว + badge เป็น row ล่าง */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 16, fontWeight: 700, color: '#121212', letterSpacing: '-0.01em', marginBottom: 4 }}>
          🎯 ภารกิจสร้างความน่าเชื่อถือ
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--ink3)' }}>ทำครบเพื่อขายไวขึ้น</div>
          {count > 0 && (
            <div style={{
              background: tier.bgColor,
              color: tier.color,
              borderRadius: 8,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}>
              {tier.emoji} {tier.label}
            </div>
          )}
        </div>
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

      {/* Footer reward callout — โชว์ badge จริงเป็น preview */}
      {!isComplete && (
        <div style={{
          marginTop: 14,
          padding: '12px 14px',
          background: '#FFFBEB',
          border: '1px solid #FDE68A',
          borderRadius: 10,
          fontSize: 13,
          color: '#78350F',
          lineHeight: 1.6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>🏆</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>ทำครบ</b> รับป้าย{' '}
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              background: TRUST_TIERS.verified.bgColor,
              color: TRUST_TIERS.verified.color,
              borderRadius: 999,
              padding: '3px 10px',
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              verticalAlign: 'middle',
              lineHeight: 1,
            }}>
              <ShieldIcon size={12} color={TRUST_TIERS.verified.color} />
              Verified Seller
            </span>
            {' '}— ลูกค้าเชื่อมั่น ปิดดีลเร็วขึ้น
          </span>
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
          marginBottom: 4,
        }}>
          <span style={{ marginRight: 6 }}>{item.icon}</span>
          {item.title}
        </div>
        <div style={{
          fontSize: 13,
          color: isDone ? '#166534' : isPending ? '#B45309' : 'var(--ink3)',
          lineHeight: 1.7,
        }}>
          {(() => {
            if (isPending) return 'รอตรวจสอบ ~24 ชั่วโมง'
            if (isDone) return item.benefit
            // Render badge pill แทรกหลัง 'รับป้าย ' ในประโยค
            const badge = item.key === 'phone_verified' ? (
              <span key="b" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                background: TRUST_TIERS.phone.bgColor,
                color: TRUST_TIERS.phone.color,
                borderRadius: 999,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                verticalAlign: 'middle',
                margin: '0 4px',
              }}>📱 ลงทะเบียนแล้ว</span>
            ) : item.key === 'id_verified' ? (
              <span key="b" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                background: TRUST_TIERS.id.bgColor,
                color: TRUST_TIERS.id.color,
                borderRadius: 999,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                verticalAlign: 'middle',
                margin: '0 4px',
              }}>🪪 ยืนยันตัวตนแล้ว</span>
            ) : null
            if (!badge) return item.benefit
            // Split ตรง 'รับป้าย' — แทรก badge ไว้ต่อจากคำนี้
            const parts = item.benefit.split('รับป้าย')
            return (
              <>
                {parts[0]}รับป้าย{badge}{parts[1]}
              </>
            )
          })()}
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
  const [isLineBrowser, setIsLineBrowser] = useState(false)
  const idCameraRef = useRef<HTMLInputElement>(null)
  const idGalleryRef = useRef<HTMLInputElement>(null)
  const bankCameraRef = useRef<HTMLInputElement>(null)
  const bankGalleryRef = useRef<HTMLInputElement>(null)
  const { reloadUser } = useAuth()

  useEffect(() => {
    if (typeof navigator !== 'undefined' && /Line\//.test(navigator.userAgent)) {
      setIsLineBrowser(true)
    }
  }, [])

  // Cleanup object URLs ตอน unmount (กัน memory leak)
  const previewsRef = useRef({ id: '', bank: '' })
  useEffect(() => { previewsRef.current = { id: idCardPreview, bank: bankPreview } }, [idCardPreview, bankPreview])
  useEffect(() => {
    return () => {
      if (previewsRef.current.id) URL.revokeObjectURL(previewsRef.current.id)
      if (previewsRef.current.bank) URL.revokeObjectURL(previewsRef.current.bank)
    }
  }, [])

  // ref ของ modal scroll container — scroll ขึ้นบนสุดทุกครั้งที่เปลี่ยน step
  const modalScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (modalScrollRef.current) modalScrollRef.current.scrollTop = 0
  }, [step])

  const handlePhoto = (file: File | null, type: 'id' | 'bank') => {
    if (!file) return
    const url = URL.createObjectURL(file)
    if (type === 'id') {
      setIdCardFile(file)
      setIdCardPreview(prev => { if (prev) URL.revokeObjectURL(prev); return url })
    } else {
      setBankFile(file)
      setBankPreview(prev => { if (prev) URL.revokeObjectURL(prev); return url })
    }
  }

  // Resize รูปให้ไม่เกิน 2000px + บีบอัด → กันเกิน 5MB จาก iPhone
  const resizeImage = async (file: File, maxPx = 2000): Promise<File> => {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        let { width, height } = img
        if (width > maxPx || height > maxPx) {
          if (width > height) { height = Math.round(height * maxPx / width); width = maxPx }
          else { width = Math.round(width * maxPx / height); height = maxPx }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            canvas.width = 0; canvas.height = 0 // free GPU memory
            if (!blob) { resolve(file); return }
            resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
          },
          'image/jpeg',
          0.85
        )
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
      img.src = url
    })
  }

  const submit = async () => {
    if (!idCardFile || !bankFile) {
      setError('กรุณาถ่ายรูปครบทั้ง 2 อย่าง')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      // Resize ทั้ง 2 รูปก่อนส่ง — กันรูป iPhone ใหญ่เกิน 5MB
      const [idResized, bankResized] = await Promise.all([
        resizeImage(idCardFile),
        resizeImage(bankFile),
      ])
      const fd = new FormData()
      fd.append('id_card', idResized)
      fd.append('bank_book', bankResized)
      const r = await fetch('/api/user/identity-verify', { method: 'POST', body: fd })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(body.message || body.error || 'ส่งไม่สำเร็จ')
      }
      // ถ้า server บอก uploadError → แจ้ง user
      if (body.uploadError) {
        throw new Error('อัปโหลดรูปไม่สำเร็จ: ' + body.uploadError)
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }} onClick={submitting ? undefined : onClose}>
      {/* Loading overlay ตอน submit */}
      {submitting && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <div style={{
            width: 48, height: 48,
            border: '4px solid rgba(255,255,255,.3)',
            borderTopColor: 'white',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }} />
          <div style={{ color: 'white', fontSize: 16, fontWeight: 700, textAlign: 'center', lineHeight: 1.7 }}>
            กำลังส่งเอกสาร...<br />รอสักครู่
          </div>
        </div>
      )}
      <div ref={modalScrollRef} onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: '24px 20px 36px', width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any, margin: '0 12px' }}>
        {/* Header + step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 18, fontWeight: 700, color: '#121212' }}>ยืนยันตัวตน</div>
            <div style={{ fontSize: 13, color: 'var(--ink3)', marginTop: 2 }}>ขั้นตอน {step}/2</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--ink3)', lineHeight: 1 }} aria-label="ปิด">✕</button>
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
            <div style={{ fontSize: 13, color: '#0369A1', background: '#E0F2FE', borderRadius: 8, padding: '6px 10px', marginBottom: 14, lineHeight: 1.5 }}>
              🔒 ใช้เพื่อลงทะเบียนผู้ขายกับ BookMatch เท่านั้น — ไม่เผยแพร่หรือใช้เพื่อวัตถุประสงค์อื่น
            </div>

            {/* ID card preview — แสดงเต็มรูป ไม่บังคับ ratio */}
            {idCardPreview ? (
              <div style={{ background: '#0F172A', borderRadius: 12, marginBottom: 14, overflow: 'hidden', maxHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={idCardPreview} alt="ID card" style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }} />
              </div>
            ) : (
              <div style={{ position: 'relative', aspectRatio: '8.6 / 5.4', background: '#0F172A', borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 12, border: '2px dashed rgba(255,255,255,.5)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 32 }}>📇</span>
                  <span style={{ color: 'rgba(255,255,255,.8)', fontSize: 13, fontWeight: 600 }}>ถ่ายรูปบัตรประชาชน</span>
                </div>
              </div>
            )}

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
              {!isLineBrowser && (
                <button
                  className="btn"
                  onClick={() => idCameraRef.current?.click()}
                  style={{ flex: 1, background: idCardFile ? 'var(--surface)' : 'var(--primary)', color: idCardFile ? 'var(--ink2)' : 'white', border: idCardFile ? '1px solid var(--border)' : 'none' }}
                >
                  📷 {idCardFile ? 'ถ่ายใหม่' : 'ถ่ายสด'}
                </button>
              )}
              <button
                className="btn"
                onClick={() => idGalleryRef.current?.click()}
                style={{ flex: 1, background: isLineBrowser && !idCardFile ? 'var(--primary)' : 'var(--surface)', color: isLineBrowser && !idCardFile ? 'white' : 'var(--ink2)', border: isLineBrowser && !idCardFile ? 'none' : '1px solid var(--border)' }}
              >
                🖼️ {idCardFile ? 'เลือกใหม่' : 'เลือกรูปจากอัลบั้ม'}
              </button>
            </div>
            {isLineBrowser && !idCardFile && (
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8, lineHeight: 1.5 }}>
                💡 ถ่ายรูปบัตรด้วย Camera ของมือถือก่อน แล้วค่อยเลือกจากอัลบั้ม
              </div>
            )}

            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#78350F', lineHeight: 1.6 }}>
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

            {bankPreview ? (
              <div style={{ background: '#0F172A', borderRadius: 12, marginBottom: 14, overflow: 'hidden', maxHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={bankPreview} alt="Bank book" style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} />
              </div>
            ) : (
              <div style={{ position: 'relative', aspectRatio: '3 / 4', background: '#0F172A', borderRadius: 12, marginBottom: 14, overflow: 'hidden', maxWidth: 240, margin: '0 auto 14px' }}>
                <div style={{ position: 'absolute', inset: 12, border: '2px dashed rgba(255,255,255,.5)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 32 }}>💰</span>
                  <span style={{ color: 'rgba(255,255,255,.8)', fontSize: 13, fontWeight: 600, textAlign: 'center', padding: '0 12px' }}>ถ่ายหน้าที่มีชื่อบัญชี</span>
                </div>
              </div>
            )}

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
              {!isLineBrowser && (
                <button
                  className="btn"
                  onClick={() => bankCameraRef.current?.click()}
                  style={{ flex: 1, background: bankFile ? 'var(--surface)' : 'var(--primary)', color: bankFile ? 'var(--ink2)' : 'white', border: bankFile ? '1px solid var(--border)' : 'none' }}
                >
                  📷 {bankFile ? 'ถ่ายใหม่' : 'ถ่ายสด'}
                </button>
              )}
              <button
                className="btn"
                onClick={() => bankGalleryRef.current?.click()}
                style={{ flex: 1, background: isLineBrowser && !bankFile ? 'var(--primary)' : 'var(--surface)', color: isLineBrowser && !bankFile ? 'white' : 'var(--ink2)', border: isLineBrowser && !bankFile ? 'none' : '1px solid var(--border)' }}
              >
                🖼️ {bankFile ? 'เลือกใหม่' : 'เลือกรูปจากอัลบั้ม'}
              </button>
            </div>
            {isLineBrowser && !bankFile && (
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8, lineHeight: 1.5 }}>
                💡 ถ่ายรูปสมุดบัญชีด้วย Camera ของมือถือก่อน แล้วค่อยเลือกจากอัลบั้ม
              </div>
            )}

            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#78350F', lineHeight: 1.6 }}>
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

        <div style={{ fontSize: 13, color: 'var(--ink3)', textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
          🔒 ข้อมูลของคุณปลอดภัย เก็บในระบบเข้ารหัส<br />
          ใช้เพื่อลงทะเบียนผู้ขายกับ BookMatch เท่านั้น<br />
          ไม่เผยแพร่หรือส่งต่อบุคคลที่สาม<br />
          แอดมินจะตรวจภายใน 24 ชั่วโมง
        </div>
      </div>
    </div>
  )
}
