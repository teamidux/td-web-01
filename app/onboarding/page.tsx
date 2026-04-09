'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { Nav, useToast, Toast } from '@/components/ui'
import { parseLineId } from '@/lib/line-id'

export default function OnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading, updateUser } = useAuth()
  const { msg, show } = useToast()
  const [lineInput, setLineInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const next = searchParams.get('next') || '/'

  // ถ้า user มี line_id อยู่แล้ว (ไม่ใช่ first login) → redirect ออก
  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/')
      return
    }
    if (user.line_id) {
      router.replace(next)
    }
  }, [user, loading, next, router])

  const handleSave = async () => {
    setError('')
    const trimmed = lineInput.trim()
    // ตรวจ trap case: user กรอกเบอร์โทร
    if (/^[\d\s+\-()]{8,}$/.test(trimmed)) {
      setError('นี่คือเบอร์โทร ไม่ใช่ LINE ID — LINE ID เป็นชื่อผู้ใช้ใน LINE app (เช่น somchai_books)')
      return
    }
    const parsed = parseLineId(trimmed)
    if (!parsed) {
      setError('LINE ID ไม่ถูกต้อง — ต้องเป็น 4-20 ตัวอักษร (a-z, 0-9, จุด ขีด ขีดเส้นใต้)')
      return
    }
    setSaving(true)
    try {
      await updateUser({ line_id: parsed.raw } as any)
      show('บันทึกแล้ว ✓')
      setTimeout(() => router.replace(next), 600)
    } catch (e: any) {
      setError(e?.message || 'บันทึกไม่สำเร็จ')
      setSaving(false)
    }
  }

  const handleSkip = () => {
    router.replace(next)
  }

  if (loading || !user) return (
    <>
      <Nav />
      <div style={{ padding: 60, textAlign: 'center' }}>
        <span className="spin" style={{ width: 28, height: 28 }} />
      </div>
    </>
  )

  return (
    <>
      <Nav />
      <Toast msg={msg} />
      <div className="page" style={{ paddingTop: 24 }}>
        <div style={{ maxWidth: 440, margin: '0 auto', padding: '0 20px' }}>
          {/* Hero */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 56, marginBottom: 14 }}>💚</div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 26, fontWeight: 700, color: '#121212', lineHeight: 1.25, marginBottom: 12, letterSpacing: '-0.02em' }}>
              ใส่ LINE ID ของคุณ
            </div>
            <div style={{ fontSize: 16, color: '#475569', lineHeight: 1.65, fontWeight: 500 }}>
              เพื่อให้ผู้ซื้อกดเพิ่มเพื่อน<br />
              <span style={{ color: '#06C755', fontWeight: 700 }}>ติดต่อคุณได้ทันที</span>
            </div>
          </div>

          {/* Why card — ขายเหตุผล */}
          <div style={{ background: '#F0FFF4', border: '1.5px solid #BBF7D0', borderRadius: 14, padding: '16px 18px', marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#15803D', marginBottom: 10 }}>
              ทำไมต้องใส่?
            </div>
            <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.75 }}>
              ✓ ผู้ซื้อกด <b>เพิ่มเพื่อนใน LINE</b> คุณได้ทันที 1 คลิก<br />
              ✓ ไม่ต้องกรอกซ้ำทุกครั้งที่ลงประกาศ<br />
              ✓ ปลอดภัย — เราไม่แสดงเบอร์โทรของคุณ
            </div>
          </div>

          {/* Form */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 14, fontWeight: 700, color: '#121212', display: 'block', marginBottom: 10 }}>
              LINE ID ของคุณ
            </label>
            <input
              className="input"
              type="text"
              value={lineInput}
              onChange={(e) => { setLineInput(e.target.value); setError('') }}
              placeholder="เช่น somchai_books"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 18, padding: '14px 16px', fontWeight: 500 }}
            />

            {/* Where to find */}
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 14px', marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>
                📱 หา LINE ID ของคุณได้ที่
              </div>
              <div style={{ fontSize: 12, color: '#78350F', lineHeight: 1.7 }}>
                LINE app → <b>Home</b> → <b>⚙️ Settings</b> → <b>Profile</b> → <b>ID</b>
              </div>
              <div style={{ fontSize: 11, color: '#78350F', marginTop: 6, lineHeight: 1.6, fontStyle: 'italic' }}>
                ⚠️ <b>ไม่ใช่</b>เบอร์โทร — เป็นชื่อผู้ใช้ที่คุณตั้งใน LINE
              </div>
            </div>

            {error && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 14px', marginTop: 10 }}>
                <div style={{ fontSize: 13, color: '#991B1B', lineHeight: 1.6, fontWeight: 500 }}>
                  ⚠️ {error}
                </div>
              </div>
            )}
          </div>

          <button
            className="btn"
            onClick={handleSave}
            disabled={saving || !lineInput.trim()}
            style={{ marginBottom: 10, fontSize: 16, padding: '16px', minHeight: 56, fontWeight: 700 }}
          >
            {saving ? 'กำลังบันทึก...' : '💚 บันทึก LINE ID'}
          </button>

          <button
            className="btn btn-ghost"
            onClick={handleSkip}
            disabled={saving}
            style={{ fontSize: 14 }}
          >
            ยังไม่ใส่ตอนนี้
          </button>

          <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', marginTop: 18, lineHeight: 1.6 }}>
            เปลี่ยนภายหลังได้ที่หน้า Profile<br />
            (จะต้องยืนยันด้วย LINE อีกครั้งเพื่อความปลอดภัย)
          </div>
        </div>
      </div>
    </>
  )
}
