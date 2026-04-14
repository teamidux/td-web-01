'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

type U = {
  id: string
  display_name: string
  phone: string | null
  line_id: string | null
  avatar_url: string | null
  created_at: string
  id_verified_at: string | null
  id_verify_submitted_at: string | null
  phone_verified_at: string | null
  banned_at: string | null
  banned_reason: string | null
  deleted_at: string | null
  deleted_reason: string | null
  flags: string[]
  listings_count: number
  reports_count: number
}

type Stats = { all: number; suspicious: number; banned: number }

const FLAG_META: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  bot: { icon: '🤖', label: 'Bot-like (≥20 listings/ชม.)', color: '#B91C1C', bg: '#FEE2E2' },
  duplicate: { icon: '👥', label: 'เบอร์/LINE ซ้ำกับ user อื่น', color: '#B45309', bg: '#FEF3C7' },
  reported: { icon: '⚠️', label: 'ถูกรายงาน', color: '#BE185D', bg: '#FCE7F3' },
}

export default function AdminUsersPageWrapper() {
  return (
    <Suspense fallback={<div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}>Loading...</div>}>
      <AdminUsersPage />
    </Suspense>
  )
}

function AdminUsersPage() {
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as 'all' | 'suspicious' | 'banned' | 'deleted') || 'all'
  const [tab, setTab] = useState<'all' | 'suspicious' | 'banned' | 'deleted'>(initialTab)
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<U[]>([])
  const [stats, setStats] = useState<Stats>({ all: 0, suspicious: 0, banned: 0 })
  const [loading, setLoading] = useState(true)
  const [showGuide, setShowGuide] = useState(true)
  const [actionTarget, setActionTarget] = useState<{ user: U; type: 'ban' | 'soft_delete' } | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [acting, setActing] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tab, q })
      const res = await fetch('/api/tomga/users?' + params)
      const d = await res.json()
      setUsers(d.users || [])
      setStats(d.stats || { all: 0, suspicious: 0, banned: 0 })
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [tab])
  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [q])

  const doAction = async (userId: string, action: string, reason?: string, extra?: Record<string, any>) => {
    setActing(userId)
    try {
      const res = await fetch('/api/tomga/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, reason, ...extra }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert('ไม่สำเร็จ: ' + (d.error || `HTTP ${res.status}`))
        return
      }
      setActionTarget(null)
      setActionReason('')
      await load()
    } finally { setActing(null) }
  }

  const fmtDate = (dt: string) => new Date(dt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

  return (
    <>
      <div style={{ padding: '24px 0 80px' }}>
        <h1 style={{ fontFamily: "'Kanit', sans-serif", fontSize: 28, fontWeight: 800, color: '#0F172A', margin: 0, marginBottom: 6 }}>
          จัดการ User
        </h1>
        <p style={{ fontSize: 14, color: '#94A3B8', marginTop: 0, marginBottom: 20 }}>
          ตรวจสอบ, ban, soft delete + ระบบ detect พฤติกรรมน่าสงสัยอัตโนมัติ
        </p>

        {/* PDPA + Fraud Guidance */}
        <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
          <button
            onClick={() => setShowGuide(!showGuide)}
            style={{ background: 'none', border: 'none', fontFamily: 'Kanit', fontSize: 15, fontWeight: 700, color: '#0C4A6E', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            📘 Guidance: ใช้ action ไหนเมื่อไหร่ {showGuide ? '▼' : '▶'}
          </button>
          {showGuide && (
            <div style={{ marginTop: 14, fontSize: 14, color: '#0C4A6E', lineHeight: 1.7 }}>
              <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
                <div style={{ background: 'white', borderRadius: 10, padding: '12px 14px', borderLeft: '4px solid #2563EB' }}>
                  <b>🔵 Soft Delete — ใช้เมื่อ user ขอเลิกใช้ / PDPA request ปกติ</b><br />
                  <span style={{ fontSize: 13 }}>
                    ข้อมูลส่วนตัว (ชื่อ/เบอร์/LINE/avatar) ถูก null ทิ้ง → comply PDPA ม.33<br />
                    Row ยังอยู่ เพื่อ marketplace integrity: คนที่เคยซื้อขายกับ user นี้ ยังเห็น history ครบ<br />
                    Listings → removed, wanted/sessions ลบจริง, <b>กู้คืนไม่ได้</b>
                  </span>
                </div>
                <div style={{ background: 'white', borderRadius: 10, padding: '12px 14px', borderLeft: '4px solid #DC2626' }}>
                  <b>🛑 Ban — ใช้เมื่อตรวจพบ/สงสัยฉ้อโกง</b><br />
                  <span style={{ fontSize: 13 }}>
                    <b>เก็บ data ทั้งหมดเป็นหลักฐาน</b> (ชื่อ/เบอร์/บัตรประชาชน/สมุดบัญชี) — ห้าม delete ในขั้นนี้<br />
                    Listings → paused (reversible), เตะออก session, login ใหม่ไม่ได้<br />
                    ถ้า user ขอ PDPA delete ช่วงนี้: <b>ปฏิเสธได้</b> ภายใต้ legitimate interest (ม.24)<br />
                    ให้บันทึกเหตุผลการปฏิเสธ + แจ้ง user เป็นลายลักษณ์อักษร
                  </span>
                </div>
                <div style={{ background: 'white', borderRadius: 10, padding: '12px 14px', borderLeft: '4px solid #7C3AED' }}>
                  <b>🟣 Ban → Soft Delete (หลังคดีปิด)</b><br />
                  <span style={{ fontSize: 13 }}>
                    Ban user ที่ยืนยันว่าโกงแล้ว รอ 2 ปี (หรือจนคดีจบ) ไม่มี dispute<br />
                    ค่อย soft delete ด้วย reason = <code>post-fraud closed</code> เพื่อ comply PDPA ระยะยาว
                  </span>
                </div>
              </div>
              <div style={{ background: '#FEF3C7', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#78350F' }}>
                ⚖️ <b>กฎเหล็ก</b>: ถ้าสงสัยว่าโกง <b>Ban ก่อน อย่า delete</b> — ลบแล้วหลักฐานหายกู้ไม่ได้
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid #E2E8F0', paddingBottom: 0 }}>
          {[
            { id: 'all', label: 'ทั้งหมด', count: stats.all },
            { id: 'suspicious', label: '🚩 น่าสงสัย', count: stats.suspicious },
            { id: 'banned', label: '🛑 Banned', count: stats.banned },
            { id: 'deleted', label: '🗑 Deleted', count: null },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: tab === t.id ? '3px solid #2563EB' : '3px solid transparent',
                padding: '10px 16px',
                fontFamily: 'Kanit',
                fontSize: 15,
                fontWeight: tab === t.id ? 700 : 500,
                color: tab === t.id ? '#2563EB' : '#64748B',
                cursor: 'pointer',
              }}
            >
              {t.label}
              {t.count !== null && t.count !== undefined && (
                <span style={{ marginLeft: 8, background: tab === t.id ? '#DBEAFE' : '#F1F5F9', borderRadius: 10, padding: '2px 8px', fontSize: 12 }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="🔍 ค้นหาชื่อ / เบอร์ / LINE ID"
          style={{
            width: '100%',
            padding: '12px 16px',
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            fontFamily: 'Kanit',
            fontSize: 15,
            marginBottom: 16,
            outline: 'none',
          }}
        />

        {loading && <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>Loading...</div>}

        {!loading && users.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#CBD5E1', fontSize: 15 }}>ไม่พบ user</div>
        )}

        {/* User list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map(u => (
            <div key={u.id} style={{
              background: 'white',
              border: `1px solid ${u.banned_at ? '#FECACA' : u.deleted_at ? '#E2E8F0' : u.flags.length ? '#FDE68A' : '#E2E8F0'}`,
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              opacity: u.deleted_at ? 0.6 : 1,
            }}>
              {/* Avatar */}
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: u.avatar_url ? `url(${u.avatar_url}) center/cover` : '#F1F5F9',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, color: '#94A3B8', flexShrink: 0,
              }}>
                {!u.avatar_url && (u.display_name?.[0] || '?')}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                    {u.display_name || '—'}
                  </span>
                  {u.id_verified_at && <span title="ยืนยันตัวตนแล้ว" style={{ fontSize: 14 }}>🛡️</span>}
                  {u.banned_at && <span style={{ background: '#FEE2E2', color: '#B91C1C', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>BANNED</span>}
                  {u.deleted_at && <span style={{ background: '#F1F5F9', color: '#64748B', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>DELETED</span>}
                  {u.flags.map(f => (
                    <span key={f} title={FLAG_META[f]?.label} style={{ background: FLAG_META[f]?.bg, color: FLAG_META[f]?.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                      {FLAG_META[f]?.icon} {f}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 3 }}>
                  {u.phone && <>📱 {u.phone} · </>}
                  {u.line_id && <>LINE: {u.line_id} · </>}
                  สมัคร {fmtDate(u.created_at)} · {u.listings_count} listings
                  {u.reports_count > 0 && <> · <span style={{ color: '#DC2626' }}>{u.reports_count} รายงาน</span></>}
                </div>
                {u.banned_at && u.banned_reason && (
                  <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 4 }}>
                    Ban: {u.banned_reason}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {!u.deleted_at && !u.banned_at && (
                  <button
                    onClick={() => {
                      const name = prompt(`แก้ชื่อ "${u.display_name}" เป็น:`, u.display_name)
                      if (name && name !== u.display_name) doAction(u.id, 'edit_name', undefined, { name })
                    }}
                    disabled={acting === u.id}
                    style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', color: '#0369A1', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit' }}
                  >
                    ✏️ ชื่อ
                  </button>
                )}
                {!u.deleted_at && !u.banned_at && (
                  <button
                    onClick={() => {
                      const phone = prompt(`แก้เบอร์ "${u.display_name}"\nเบอร์ปัจจุบัน: ${u.phone || 'ไม่มี'}\n\nใส่เบอร์ใหม่ (0xxxxxxxxx):`, u.phone || '')
                      if (phone && /^0\d{9}$/.test(phone)) doAction(u.id, 'edit_phone', undefined, { phone })
                      else if (phone) alert('เบอร์ไม่ถูกต้อง (0xxxxxxxxx)')
                    }}
                    disabled={acting === u.id}
                    style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', color: '#0369A1', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit' }}
                  >
                    📞 เบอร์
                  </button>
                )}
                {!u.deleted_at && !u.banned_at && u.phone_verified_at && (
                  <button
                    onClick={() => { if (confirm(`Reset เบอร์โทร "${u.display_name}"?\n\nจะลบเบอร์ + สถานะ verify เบอร์\n→ user ต้อง verify เบอร์ใหม่`)) doAction(u.id, 'reset_phone') }}
                    disabled={acting === u.id}
                    style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#B45309', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit' }}
                  >
                    🔄 Reset เบอร์
                  </button>
                )}
                {!u.deleted_at && !u.banned_at && (u.id_verified_at || u.id_verify_submitted_at) && (
                  <button
                    onClick={() => { if (confirm(`Reset ยืนยันตัวตน "${u.display_name}"?\n\nจะลบสถานะ ${u.id_verified_at ? 'verify' : 'submitted'} บัตร+บัญชี\n→ user ต้อง verify ใหม่`)) doAction(u.id, 'reset_id_verify') }}
                    disabled={acting === u.id}
                    style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#B45309', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit' }}
                  >
                    🔄 Reset บัตร {u.id_verify_submitted_at && !u.id_verified_at && '(pending)'}
                  </button>
                )}
                {!u.deleted_at && !u.banned_at && u.avatar_url && (
                  <button
                    onClick={() => { if (confirm(`ลบรูป profile ของ "${u.display_name}"?\n\nรูปจะถูก reset เป็น default → user ต้องอัปโหลดใหม่เอง\nใช้กรณีรูปไม่เหมาะสม`)) doAction(u.id, 'delete_avatar') }}
                    disabled={acting === u.id}
                    title="ลบรูป profile (รูปไม่เหมาะสม)"
                    style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#B45309', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit' }}
                  >
                    🖼️ ลบรูป
                  </button>
                )}
                {/* ปุ่มลบทิ้ง (test) — ลบ user + ข้อมูลทั้งหมด เพื่อทดสอบลงทะเบียนใหม่ */}
                {!u.deleted_at && (
                  <button
                    onClick={() => { if (confirm(`⚠️ ลบ "${u.display_name}" ออกจากระบบถาวร?\n\nเบอร์: ${u.phone || '-'}\nFacebook: ${(u as any).facebook_id ? 'มี' : '-'}\nLINE: ${(u as any).line_user_id ? 'มี' : '-'}\n\nข้อมูลทั้งหมดจะหายไป ใช้สำหรับ test เท่านั้น!`)) doAction(u.id, 'hard_delete') }}
                    disabled={acting === u.id}
                    style={{ background: '#4C1D95', border: 'none', color: 'white', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit' }}
                  >
                    🧪 ลบทิ้ง (test)
                  </button>
                )}
                {!u.deleted_at && !u.banned_at && (
                  <>
                    <button
                      onClick={() => { setActionTarget({ user: u, type: 'ban' }); setActionReason('') }}
                      disabled={acting === u.id}
                      style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit' }}
                    >
                      🛑 Ban
                    </button>
                    <button
                      onClick={() => { setActionTarget({ user: u, type: 'soft_delete' }); setActionReason('') }}
                      disabled={acting === u.id}
                      style={{ background: 'white', border: '1px solid #E2E8F0', color: '#64748B', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit' }}
                    >
                      🗑 Delete
                    </button>
                  </>
                )}
                {u.banned_at && (
                  <button
                    onClick={() => { if (confirm(`ยกเลิก ban user "${u.display_name}"?\n\nLine_id, เบอร์, listings จะกลับมาใช้งานได้ (listings ต้องเปิด manual)`)) doAction(u.id, 'unban') }}
                    disabled={acting === u.id}
                    style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#15803D', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Kanit' }}
                  >
                    ↩ Unban
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action confirm modal */}
      {actionTarget && (
        <div onClick={() => setActionTarget(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: '24px 24px 20px', width: '100%', maxWidth: 480 }}>
            <div style={{ fontFamily: 'Kanit', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              {actionTarget.type === 'ban' ? '🛑 Ban user' : '🗑 Soft delete user'}
            </div>
            <div style={{ fontSize: 14, color: '#64748B', marginBottom: 14 }}>
              <b style={{ color: '#0F172A' }}>{actionTarget.user.display_name}</b>
              {actionTarget.user.phone && <> · {actionTarget.user.phone}</>}
            </div>

            {actionTarget.type === 'ban' ? (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#7F1D1D', lineHeight: 1.7, marginBottom: 14 }}>
                <b>จะเกิดอะไรขึ้น:</b><br />
                • User ใช้งานไม่ได้ (เตะออก session ทันที)<br />
                • Listings ทั้งหมด → paused (ซ่อน)<br />
                • <b>ข้อมูลทุกอย่างคงเดิม</b> (ชื่อ, เบอร์, บัตร, สมุดบัญชี) เป็นหลักฐาน<br />
                • <b>Reversible</b> — unban ได้ถ้าตรวจสอบแล้วไม่ผิด
              </div>
            ) : (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#78350F', lineHeight: 1.7, marginBottom: 14 }}>
                <b>⚠️ จะเกิดอะไรขึ้น (กู้คืนไม่ได้):</b><br />
                • ชื่อ/เบอร์/LINE/avatar ถูก null ทิ้ง<br />
                • Listings → removed, wanted/sessions ลบจริง<br />
                • Row ยังอยู่ (history คนที่ซื้อขายด้วยไม่หาย)<br /><br />
                <b>ห้ามใช้กับเคสโกง!</b> ถ้าสงสัยโกง ให้ Ban แทน
              </div>
            )}

            <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>
              เหตุผล {actionTarget.type === 'ban' ? '(บันทึกในระบบ)' : '(optional)'}
            </label>
            <textarea
              value={actionReason}
              onChange={e => setActionReason(e.target.value)}
              placeholder={actionTarget.type === 'ban' ? 'เช่น: รายงานโกง 3 ครั้ง, listings ราคาต่ำผิดปกติ + หายไปหลังได้เงิน' : 'เช่น: user ขอเลิกใช้ / PDPA request'}
              rows={3}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontFamily: 'Kanit', fontSize: 14, outline: 'none', resize: 'vertical', marginBottom: 14 }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setActionTarget(null)}
                style={{ flex: 1, background: 'white', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px', fontFamily: 'Kanit', fontWeight: 600, color: '#64748B', cursor: 'pointer', fontSize: 14 }}
              >
                ยกเลิก
              </button>
              <button
                onClick={() => doAction(actionTarget.user.id, actionTarget.type, actionReason)}
                disabled={actionTarget.type === 'ban' && !actionReason.trim() || acting === actionTarget.user.id}
                style={{
                  flex: 2,
                  background: actionTarget.type === 'ban' ? '#DC2626' : '#D97706',
                  border: 'none',
                  borderRadius: 10,
                  padding: '12px',
                  color: 'white',
                  fontFamily: 'Kanit',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: 14,
                  opacity: (actionTarget.type === 'ban' && !actionReason.trim()) || acting === actionTarget.user.id ? 0.5 : 1,
                }}
              >
                {acting === actionTarget.user.id ? 'กำลังดำเนินการ...' : actionTarget.type === 'ban' ? 'Ban user นี้' : 'Soft delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
