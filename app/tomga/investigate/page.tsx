'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import Link from 'next/link'

type UserResult = {
  user: any
  phone_changes: any[]
  name_changes: any[]
  listings: any[]
  sessions: any[]
  contact_events: any[]
  id_verifications: any[]
  wanted: any[]
  reports_against: any[]
  summary: {
    immutable_ids: { line_user_id: string | null; facebook_id: string | null }
    registration_ip: string | null
    registration_device: string | null
    total_phone_changes: number
    total_name_changes: number
    total_listings: number
    total_reports: number
    unique_ips: string[]
  }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'เมื่อสักครู่'
  if (min < 60) return `${min} นาที`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ชม.`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} วัน`
  return new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function AdminPage() {
  const { user, loading } = useAuth()
  const [searchType, setSearchType] = useState<'phone' | 'name' | 'id'>('phone')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<UserResult | null>(null)
  const [error, setError] = useState('')
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [banning, setBanning] = useState(false)
  const [banReason, setBanReason] = useState('')
  const [viewDoc, setViewDoc] = useState('')

  const searchParams = useSearchParams()

  // เช็ค admin access
  useEffect(() => {
    if (!user) return
    fetch('/api/admin/user?id=__check__').then(r => {
      setIsAdmin(r.status !== 403)
    }).catch(() => setIsAdmin(false))
  }, [user?.id])

  // Auto-search ถ้ามี ?id= ใน URL (มาจากหน้า /tomga/users)
  useEffect(() => {
    const urlId = searchParams.get('id')
    if (urlId && isAdmin) {
      setSearchType('id')
      setQuery(urlId)
      // Auto search
      setSearching(true)
      setError('')
      fetch(`/api/admin/user?id=${encodeURIComponent(urlId)}`)
        .then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d.error || 'not found') }))
        .then(d => setResult(d))
        .catch(e => setError(e.message || 'ไม่พบ user'))
        .finally(() => setSearching(false))
    }
  }, [isAdmin, searchParams])

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError('')
    setResult(null)
    try {
      const param = searchType === 'phone' ? `phone=${encodeURIComponent(query.replace(/\D/g, ''))}`
        : searchType === 'name' ? `name=${encodeURIComponent(query)}`
        : `id=${encodeURIComponent(query)}`
      const r = await fetch(`/api/admin/user?${param}`)
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.error === 'user_not_found' ? 'ไม่พบ user' : d.error || 'เกิดข้อผิดพลาด')
        return
      }
      setResult(await r.json())
    } catch {
      setError('เชื่อมต่อไม่ได้')
    } finally {
      setSearching(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><span className="spin" style={{ width: 28, height: 28 }} /></div>
  if (!user) return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Kanit' }}>กรุณา login ก่อน</div>
  if (isAdmin === false) return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Kanit', color: '#DC2626' }}>ไม่มีสิทธิ์เข้าถึง</div>
  if (isAdmin === null) return <div style={{ padding: 40, textAlign: 'center' }}><span className="spin" style={{ width: 28, height: 28 }} /></div>

  const deleteUser = async (mode: 'hard' | 'soft') => {
    if (!result?.user?.id) return
    setDeleting(true)
    try {
      const r = await fetch('/api/admin/user/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: result.user.id, mode }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.message || d.error || 'ลบไม่สำเร็จ'); setDeleting(false); return }
      setResult(null)
      setConfirmDelete(false)
      setError('')
      alert(mode === 'hard' ? 'ลบ user + ข้อมูลทั้งหมดแล้ว' : 'Soft delete สำเร็จ (หลักฐานยังอยู่)')
    } catch {
      setError('เชื่อมต่อไม่ได้')
    } finally {
      setDeleting(false)
    }
  }

  const banUser = async (action: 'ban' | 'unban') => {
    if (!result?.user?.id) return
    if (action === 'ban' && !banReason.trim()) { setError('กรุณาใส่เหตุผลก่อน ban'); return }
    setBanning(true)
    try {
      const r = await fetch('/api/admin/user/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: result.user.id, action, reason: banReason.trim() }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.message || d.error || `${action} ไม่สำเร็จ`); return }
      // reload user data
      search()
      setBanReason('')
      alert(action === 'ban' ? 'Ban สำเร็จ — user ถูกเตะออกแล้ว' : 'Unban สำเร็จ — user กลับมาใช้งานได้')
    } catch {
      setError('เชื่อมต่อไม่ได้')
    } finally {
      setBanning(false)
    }
  }

  const u = result?.user
  const s = result?.summary

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px 16px 80px', fontFamily: "'Kanit', sans-serif" }}>
      {/* Doc lightbox */}
      {viewDoc && (
        <div onClick={() => setViewDoc('')} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <button onClick={() => setViewDoc('')} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, color: 'white', fontSize: 20, cursor: 'pointer' }}>✕</button>
          <img src={viewDoc} alt="เอกสาร" style={{ maxWidth: '94vw', maxHeight: '90vh', borderRadius: 8, objectFit: 'contain' }} />
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Link href="/tomga" style={{ color: 'var(--ink3)', textDecoration: 'none', fontSize: 14 }}>← Dashboard</Link>
        <div style={{ fontSize: 22, fontWeight: 700 }}>ตรวจสอบ User</div>
      </div>

      {/* Search */}
      <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>ค้นหา User</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {(['phone', 'name', 'id'] as const).map(t => (
            <button key={t} onClick={() => setSearchType(t)} style={{
              flex: 1, padding: '8px 6px', border: `1.5px solid ${searchType === t ? '#2563EB' : '#E2E8F0'}`,
              borderRadius: 8, background: searchType === t ? '#EFF6FF' : 'white',
              fontFamily: 'Kanit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              color: searchType === t ? '#1D4ED8' : '#64748B',
            }}>
              {t === 'phone' ? 'เบอร์โทร' : t === 'name' ? 'ชื่อ' : 'User ID'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder={searchType === 'phone' ? '0812345678' : searchType === 'name' ? 'ชื่อผู้ใช้' : 'UUID'}
            style={{ flex: 1, padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: 10, fontFamily: 'Kanit', fontSize: 14, outline: 'none' }}
          />
          <button onClick={search} disabled={searching} style={{
            background: '#2563EB', color: 'white', border: 'none', borderRadius: 10,
            padding: '10px 20px', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            opacity: searching ? 0.5 : 1,
          }}>
            {searching ? '...' : 'ค้นหา'}
          </button>
        </div>
        {error && <div style={{ color: '#DC2626', fontSize: 13, marginTop: 8 }}>{error}</div>}
      </div>

      {/* Results */}
      {u && s && (
        <>
          {/* User Profile Card */}
          <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, overflow: 'hidden', flexShrink: 0 }}>
                {u.avatar_url ? <img src={u.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{u.display_name}</div>
                <div style={{ fontSize: 13, color: '#64748B', wordBreak: 'break-all' }}>{u.id}</div>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Ban / Unban */}
              {u.banned_at ? (
                <button onClick={() => banUser('unban')} disabled={banning}
                  style={{ padding: '10px 16px', background: '#15803D', border: 'none', borderRadius: 8, fontFamily: 'Kanit', fontSize: 13, fontWeight: 700, color: 'white', cursor: 'pointer', opacity: banning ? 0.5 : 1 }}>
                  {banning ? 'กำลังปลด...' : 'Unban User'}
                </button>
              ) : (
                <div style={{ background: '#FEF9C3', border: '1px solid #FDE68A', borderRadius: 10, padding: 12 }}>
                  <input
                    value={banReason}
                    onChange={e => setBanReason(e.target.value)}
                    placeholder="เหตุผลที่ ban (เช่น หลอกโอนเงิน)"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #FDE68A', borderRadius: 8, fontFamily: 'Kanit', fontSize: 13, marginBottom: 8, outline: 'none' }}
                  />
                  <button onClick={() => banUser('ban')} disabled={banning || !banReason.trim()}
                    style={{ width: '100%', padding: '10px', background: '#DC2626', border: 'none', borderRadius: 8, fontFamily: 'Kanit', fontSize: 13, fontWeight: 700, color: 'white', cursor: 'pointer', opacity: (banning || !banReason.trim()) ? 0.5 : 1 }}>
                    {banning ? 'กำลัง Ban...' : 'Ban User'}
                  </button>
                </div>
              )}

              {/* ลบ User → ไปทำที่ /tomga/users แทน (มี guidance ครบ) */}
              <a href="/tomga/users" style={{ padding: '8px 16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontFamily: 'Kanit', fontSize: 13, fontWeight: 600, color: '#64748B', textDecoration: 'none', textAlign: 'center' }}>
                จัดการเพิ่มเติม → หน้า Users
              </a>
            </div>

            {/* Login methods */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {u.line_user_id && <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: '#F0FFF4', color: '#15803D', border: '1px solid #BBF7D0' }}>LINE Login</span>}
              {u.facebook_id && <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>Facebook</span>}
              {u.phone_verified_at && <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: '#FEF9C3', color: '#92400E', border: '1px solid #FDE68A' }}>Phone OTP</span>}
              {u.id_verified_at && <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' }}>ID Verified</span>}
              {u.banned_at && <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA' }}>BANNED</span>}
              {u.deleted_at && <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0' }}>DELETED</span>}
              {u.is_pioneer && <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>Pioneer</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              <InfoRow label="เบอร์โทร" value={u.phone || '—'} warn={!u.phone} />
              <InfoRow label="เบอร์ verified" value={u.phone_verified_at ? formatDate(u.phone_verified_at) : 'ยังไม่ verify'} warn={!u.phone_verified_at} />
              <InfoRow label="LINE ID" value={u.line_id || '—'} />
              <InfoRow label="สมัครเมื่อ" value={u.created_at ? formatDate(u.created_at) : '—'} />
            </div>
          </div>

          {/* Immutable IDs — สำคัญที่สุดสำหรับตามตัว */}
          <SectionCard title="Immutable IDs + Registration" icon="🔒" color="#DC2626">
            <InfoRow label="LINE user ID" value={s.immutable_ids.line_user_id || 'ไม่มี'} mono />
            <InfoRow label="Facebook ID" value={s.immutable_ids.facebook_id || 'ไม่มี'} mono />
            <InfoRow label="Registration IP" value={s.registration_ip || 'ไม่มีข้อมูล'} mono />
            <InfoRow label="Registration Device" value={s.registration_device || 'ไม่มีข้อมูล'} />
            <InfoRow label="Unique IPs ทั้งหมด" value={s.unique_ips.length > 0 ? s.unique_ips.join(', ') : 'ไม่มีข้อมูล'} mono />
          </SectionCard>

          {/* Risk Indicators */}
          <SectionCard title="Risk Indicators" icon="⚠️" color="#F59E0B">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              <StatBox label="เปลี่ยนเบอร์" value={s.total_phone_changes} warn={s.total_phone_changes > 1} />
              <StatBox label="เปลี่ยนชื่อ" value={s.total_name_changes} warn={s.total_name_changes > 2} />
              <StatBox label="Listings" value={s.total_listings} />
              <StatBox label="ถูกรายงาน" value={s.total_reports} warn={s.total_reports > 0} />
            </div>
          </SectionCard>

          {/* Phone Changes */}
          {result.phone_changes.length > 0 && (
            <SectionCard title={`ประวัติเปลี่ยนเบอร์ (${result.phone_changes.length})`} icon="📞">
              {result.phone_changes.map((c: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: i < result.phone_changes.length - 1 ? '1px solid #F1F5F9' : 'none', fontSize: 13 }}>
                  <span style={{ color: '#DC2626', fontFamily: 'monospace' }}>{c.old_phone || '(ว่าง)'}</span>
                  <span style={{ color: '#94A3B8' }}>→</span>
                  <span style={{ color: '#15803D', fontFamily: 'monospace', fontWeight: 600 }}>{c.new_phone}</span>
                  <span style={{ marginLeft: 'auto', color: '#94A3B8', fontSize: 12 }}>{timeAgo(c.changed_at)}</span>
                </div>
              ))}
            </SectionCard>
          )}

          {/* Name Changes */}
          {result.name_changes.length > 0 && (
            <SectionCard title={`ประวัติเปลี่ยนชื่อ (${result.name_changes.length})`} icon="✏️">
              {result.name_changes.map((c: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: i < result.name_changes.length - 1 ? '1px solid #F1F5F9' : 'none', fontSize: 13 }}>
                  <span style={{ color: '#DC2626' }}>{c.old_name || '(ว่าง)'}</span>
                  <span style={{ color: '#94A3B8' }}>→</span>
                  <span style={{ color: '#15803D', fontWeight: 600 }}>{c.new_name}</span>
                  <span style={{ marginLeft: 'auto', color: '#94A3B8', fontSize: 12 }}>{timeAgo(c.changed_at)}</span>
                </div>
              ))}
            </SectionCard>
          )}

          {/* Listings */}
          {result.listings.length > 0 && (
            <SectionCard title={`ประกาศขาย (${result.listings.length})`} icon="📚">
              {result.listings.map((l: any) => (
                <div key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.books?.title || l.book_id}
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, flexShrink: 0, marginLeft: 8,
                      background: l.status === 'active' ? '#DCFCE7' : l.status === 'sold' ? '#FEE2E2' : '#F1F5F9',
                      color: l.status === 'active' ? '#15803D' : l.status === 'sold' ? '#DC2626' : '#64748B',
                    }}>
                      {l.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, color: '#64748B', marginTop: 4 }}>
                    <span>฿{l.price}</span>
                    <span>contact: <b style={{ fontFamily: 'monospace' }}>{l.contact}</b></span>
                    <span style={{ marginLeft: 'auto' }}>{timeAgo(l.created_at)}</span>
                  </div>
                </div>
              ))}
            </SectionCard>
          )}

          {/* Sessions */}
          {result.sessions.length > 0 && (
            <SectionCard title={`Sessions (${result.sessions.length})`} icon="🌐">
              {result.sessions.map((sess: any) => (
                <div key={sess.id} style={{ padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'monospace', color: '#1D4ED8' }}>{sess.ip || '—'}</span>
                    <span style={{ color: '#94A3B8' }}>{timeAgo(sess.created_at)}</span>
                  </div>
                  {sess.ua && <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sess.ua}</div>}
                </div>
              ))}
            </SectionCard>
          )}

          {/* ID Verifications — เอกสารยืนยันตัวตน + รูปจริง */}
          {result.id_verifications.length > 0 && (
            <SectionCard title={`เอกสารยืนยันตัวตน (${result.id_verifications.length})`} icon="🪪">
              {result.id_verifications.map((v: any) => {
                const idUrl = v.id_image_url || ''
                const selfieUrl = v.selfie_image_url || ''
                return (
                  <div key={v.id} style={{ padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: v.status === 'approved' ? '#DCFCE7' : v.status === 'rejected' ? '#FEE2E2' : '#FEF9C3',
                        color: v.status === 'approved' ? '#15803D' : v.status === 'rejected' ? '#DC2626' : '#92400E',
                      }}>
                        {v.status}
                      </span>
                      <span style={{ fontSize: 12, color: '#94A3B8' }}>{formatDate(v.created_at)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      {idUrl && (
                        <div onClick={() => setViewDoc(idUrl)} style={{ cursor: 'zoom-in' }}>
                          <img src={idUrl} alt="บัตรประชาชน" style={{ width: 140, height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid #E2E8F0' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 3, textAlign: 'center' }}>📇 บัตรประชาชน</div>
                        </div>
                      )}
                      {selfieUrl && (
                        <div onClick={() => setViewDoc(selfieUrl)} style={{ cursor: 'zoom-in' }}>
                          <img src={selfieUrl} alt="Selfie" style={{ width: 140, height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid #E2E8F0' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 3, textAlign: 'center' }}>🤳 Selfie + บัตร</div>
                        </div>
                      )}
                    </div>
                    {v.admin_note && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 4 }}>Note: {v.admin_note}</div>}
                  </div>
                )
              })}
            </SectionCard>
          )}

          {/* Wanted — หนังสือที่ตามหา */}
          {result.wanted.length > 0 && (
            <SectionCard title={`หนังสือที่ตามหา (${result.wanted.length})`} icon="🔔">
              {result.wanted.map((w: any) => (
                <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 13 }}>
                  <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.books?.title || w.isbn}</span>
                  {w.max_price && <span style={{ color: '#64748B', fontSize: 12, flexShrink: 0, marginLeft: 8 }}>max ฿{w.max_price}</span>}
                </div>
              ))}
            </SectionCard>
          )}

          {/* Reports — ถูกรายงาน */}
          {result.reports_against.length > 0 && (
            <SectionCard title={`ถูกรายงาน (${result.reports_against.length})`} icon="🚨" color="#DC2626">
              {result.reports_against.map((r: any) => (
                <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: '#DC2626' }}>{r.reason}</span>
                    <span style={{ fontSize: 12, color: '#94A3B8' }}>{timeAgo(r.created_at)}</span>
                  </div>
                  {r.details && <div style={{ fontSize: 12, color: '#64748B', marginTop: 4, lineHeight: 1.5 }}>{r.details}</div>}
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>by: {r.reporter_user_id ? r.reporter_user_id.slice(0, 8) + '...' : 'anonymous'}</div>
                </div>
              ))}
            </SectionCard>
          )}

          {/* Contact Events */}
          {result.contact_events.length > 0 && (
            <SectionCard title={`คนกดติดต่อ (${result.contact_events.length})`} icon="👤">
              {result.contact_events.map((ce: any) => (
                <div key={ce.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
                  <span style={{ fontFamily: 'monospace', color: '#64748B' }}>{ce.buyer_id ? ce.buyer_id.slice(0, 8) + '...' : 'guest'}</span>
                  <span style={{ color: '#94A3B8' }}>{timeAgo(ce.created_at)}</span>
                </div>
              ))}
            </SectionCard>
          )}
        </>
      )}
    </div>
  )
}

// === Sub-components ===

function InfoRow({ label, value, warn, mono }: { label: string; value: string; warn?: boolean; mono?: boolean }) {
  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ fontSize: 12, color: '#94A3B8' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: warn ? '#DC2626' : '#0F172A', fontFamily: mono ? 'monospace' : 'Kanit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}

function SectionCard({ title, icon, color, children }: { title: string; icon: string; color?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: color || '#0F172A' }}>
        <span>{icon}</span> {title}
      </div>
      {children}
    </div>
  )
}

function StatBox({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ background: warn ? '#FEF2F2' : '#F8FAFC', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#DC2626' : '#0F172A' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#64748B' }}>{label}</div>
    </div>
  )
}
