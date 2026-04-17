'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'

type Report = {
  id: string
  book_id: string | null
  isbn: string | null
  field: string
  current_value: string | null
  suggested_value: string
  reporter_id: string | null
  status: string
  admin_notes: string | null
  resolved_at: string | null
  created_at: string
  reporter: { id: string; display_name: string; avatar_url: string | null } | null
  book: { id: string; isbn: string; title: string; author: string | null; cover_url: string | null } | null
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'เมื่อสักครู่'
  if (min < 60) return `${min} นาที`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ชม.`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} วัน`
  return `${Math.floor(day / 7)} สัปดาห์`
}

export default function AdminReportsPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [items, setItems] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  const load = async (status: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/tomga/reports?status=${status}`)
      const d = await r.json()
      setItems(d.items || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (user) load(tab) }, [user, tab])

  const approve = async (id: string) => {
    if (!confirm('อนุมัติ: จะอัปเดตชื่อในระบบและแจ้งผู้รายงาน')) return
    setActing(id)
    try {
      await fetch('/api/tomga/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: id, action: 'approve' }),
      })
      setItems(prev => prev.filter(r => r.id !== id))
    } finally { setActing(null) }
  }

  const reject = async () => {
    if (!rejectTarget) return
    setActing(rejectTarget)
    try {
      await fetch('/api/tomga/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: rejectTarget, action: 'reject', adminNotes: rejectNote.trim() || null }),
      })
      setItems(prev => prev.filter(r => r.id !== rejectTarget))
      setRejectTarget(null)
      setRejectNote('')
    } finally { setActing(null) }
  }

  return (
    <div style={{ padding: '24px 0 80px' }}>
      <h1 style={{ fontFamily: "'Kanit', sans-serif", fontSize: 28, fontWeight: 800, color: '#0F172A', margin: 0, marginBottom: 6 }}>
        รายงานข้อมูลหนังสือ
      </h1>
      <p style={{ fontSize: 14, color: '#94A3B8', marginTop: 0, marginBottom: 20 }}>
        user รายงานว่าข้อมูลหนังสือผิด — อนุมัติจะอัปเดตให้อัตโนมัติ
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #E2E8F0' }}>
        {(['pending', 'approved', 'rejected'] as const).map(s => (
          <button
            key={s}
            onClick={() => setTab(s)}
            style={{
              padding: '10px 18px', fontSize: 14, fontWeight: 700,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === s ? '#2563EB' : '#64748B',
              borderBottom: tab === s ? '2px solid #2563EB' : '2px solid transparent',
              marginBottom: -1, fontFamily: 'Kanit',
            }}
          >
            {s === 'pending' ? 'รอตรวจ' : s === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธ'}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>Loading...</div>}

      {!loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94A3B8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 15 }}>ไม่มีรายงาน{tab === 'pending' ? 'ค้าง' : ''}</div>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(r => (
            <div key={r.id} style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 }}>
              {/* Book info */}
              <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
                {r.book?.cover_url ? (
                  <img src={r.book.cover_url} alt="" style={{ width: 56, height: 80, objectFit: 'cover', borderRadius: 6, flexShrink: 0, background: '#F1F5F9' }} />
                ) : (
                  <div style={{ width: 56, height: 80, borderRadius: 6, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>📖</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 2 }}>ISBN: {r.isbn || '-'}</div>
                  <div style={{ fontSize: 14, color: '#DC2626', textDecoration: 'line-through', fontWeight: 500, marginBottom: 4 }}>
                    {r.current_value || '(ไม่มีข้อมูลเดิม)'}
                  </div>
                  <div style={{ fontSize: 16, color: '#16A34A', fontWeight: 700, lineHeight: 1.4 }}>
                    → {r.suggested_value}
                  </div>
                  {r.book?.author && (
                    <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>ผู้แต่ง: {r.book.author}</div>
                  )}
                </div>
              </div>

              {/* Meta */}
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#64748B', marginBottom: 14, flexWrap: 'wrap' }}>
                <span>👤 {r.reporter?.display_name || 'user ถูกลบ'}</span>
                <span>·</span>
                <span>{timeAgo(r.created_at)}</span>
                {r.book && (
                  <>
                    <span>·</span>
                    <Link href={`/book/${r.book.isbn}`} target="_blank" style={{ color: '#2563EB', textDecoration: 'none' }}>
                      ดูหน้าหนังสือ ↗
                    </Link>
                  </>
                )}
              </div>

              {/* Actions */}
              {tab === 'pending' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => approve(r.id)}
                    disabled={acting === r.id}
                    style={{
                      flex: 1, padding: '10px 16px', fontSize: 14, fontWeight: 700,
                      background: '#16A34A', color: 'white', border: 'none', borderRadius: 8,
                      cursor: acting === r.id ? 'wait' : 'pointer', fontFamily: 'Kanit',
                      opacity: acting === r.id ? 0.6 : 1,
                    }}
                  >
                    ✓ อนุมัติ — อัปเดตชื่อ
                  </button>
                  <button
                    onClick={() => setRejectTarget(r.id)}
                    disabled={acting === r.id}
                    style={{
                      padding: '10px 16px', fontSize: 14, fontWeight: 700,
                      background: 'white', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: 8,
                      cursor: 'pointer', fontFamily: 'Kanit',
                    }}
                  >
                    ✕ ปฏิเสธ
                  </button>
                </div>
              )}

              {tab !== 'pending' && r.admin_notes && (
                <div style={{ fontSize: 13, color: '#64748B', background: '#F8FAFC', padding: '8px 12px', borderRadius: 6 }}>
                  หมายเหตุ: {r.admin_notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectTarget && (
        <div
          onClick={() => { setRejectTarget(null); setRejectNote('') }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 14, padding: 24, maxWidth: 440, width: '100%' }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, fontFamily: 'Kanit' }}>ปฏิเสธรายงาน</div>
            <div style={{ fontSize: 13, color: '#64748B', marginBottom: 14 }}>
              เหตุผลจะถูกส่งไปที่ผู้รายงาน (ไม่ใส่ได้)
            </div>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="เช่น: ชื่อที่แนะนำไม่ถูกต้อง..."
              rows={3}
              style={{ width: '100%', padding: 10, fontSize: 14, border: '1px solid #E2E8F0', borderRadius: 8, fontFamily: 'Kanit', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => { setRejectTarget(null); setRejectNote('') }}
                style={{ flex: 1, padding: '10px 16px', fontSize: 14, fontWeight: 600, background: 'white', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: 8, cursor: 'pointer', fontFamily: 'Kanit' }}
              >
                ยกเลิก
              </button>
              <button
                onClick={reject}
                disabled={acting === rejectTarget}
                style={{ flex: 1, padding: '10px 16px', fontSize: 14, fontWeight: 700, background: '#DC2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'Kanit', opacity: acting === rejectTarget ? 0.6 : 1 }}
              >
                ปฏิเสธ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
