'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { Nav } from '@/components/ui'

type PendingUser = {
  id: string
  display_name: string
  phone: string
  line_id: string
  id_verify_submitted_at: string
  created_at: string
  docs: { name: string; url: string }[]
}

export default function AdminVerifyPage() {
  const { user, loading: authLoading } = useAuth()
  const [pending, setPending] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [viewDoc, setViewDoc] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/tomga/verify')
      const { pending: p } = await res.json()
      setPending(p || [])
    } catch { setPending([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (user) load() }, [user])

  const act = async (userId: string, action: 'approve' | 'reject') => {
    if (!confirm(action === 'approve' ? 'อนุมัติ user นี้?' : 'ปฏิเสธ user นี้? (user จะส่งใหม่ได้)')) return
    setActing(userId)
    try {
      await fetch('/api/tomga/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action }),
      })
      setPending(prev => prev.filter(u => u.id !== userId))
    } finally { setActing(null) }
  }

  const timeSince = (dt: string) => {
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000)
    if (mins < 60) return `${mins} นาทีที่แล้ว`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`
    return `${Math.floor(hrs / 24)} วันที่แล้ว`
  }

  if (authLoading) return <><Nav /><div className="page" style={{ padding: 40, textAlign: 'center' }}>Loading...</div></>
  if (!user) return <><Nav /><div className="page" style={{ padding: 40, textAlign: 'center' }}>กรุณาเข้าสู่ระบบ</div></>

  return (
    <>
      <Nav />

      {/* Lightbox */}
      {viewDoc && (
        <div onClick={() => setViewDoc('')} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <button onClick={() => setViewDoc('')} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, color: 'white', fontSize: 20, cursor: 'pointer' }}>✕</button>
          <img src={viewDoc} alt="เอกสาร" style={{ maxWidth: '94vw', maxHeight: '90vh', borderRadius: 8, objectFit: 'contain' }} />
        </div>
      )}

      <div className="page" style={{ padding: '16px 16px 80px' }}>
        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          ตรวจสอบยืนยันตัวตน
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 20 }}>
          {loading ? 'กำลังโหลด...' : `${pending.length} รายการรอตรวจ`}
        </div>

        {!loading && pending.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#15803D' }}>ไม่มีรายการรอตรวจ</div>
          </div>
        )}

        {pending.map(u => (
          <div key={u.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            {/* User info */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#121212' }}>{u.display_name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
                  {u.phone && `📱 ${u.phone}`}
                  {u.line_id && ` · LINE: ${u.line_id}`}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', textAlign: 'right' }}>
                ส่งเมื่อ<br />{timeSince(u.id_verify_submitted_at)}
              </div>
            </div>

            {/* Docs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {u.docs.length === 0 && (
                <div style={{ fontSize: 12, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px' }}>
                  ไม่พบรูปเอกสาร (อาจ upload ไม่สำเร็จ)
                </div>
              )}
              {u.docs.map((d, i) => (
                <div key={i} onClick={() => setViewDoc(d.url)} style={{ cursor: 'zoom-in', position: 'relative' }}>
                  <img
                    src={d.url}
                    alt={d.name}
                    style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 4, textAlign: 'center', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name.includes('id_card') ? '📇 บัตรประชาชน' : d.name.includes('bank_book') ? '💰 สมุดบัญชี' : d.name}
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => act(u.id, 'approve')}
                disabled={acting === u.id}
                style={{ flex: 1, background: '#22C55E', border: 'none', borderRadius: 10, padding: '10px 14px', color: 'white', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                {acting === u.id ? '...' : '✓ อนุมัติ'}
              </button>
              <button
                onClick={() => act(u.id, 'reject')}
                disabled={acting === u.id}
                style={{ flex: 1, background: 'white', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', color: '#DC2626', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
              >
                ✕ ปฏิเสธ
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
