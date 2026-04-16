'use client'
import { createContext, useContext, useEffect, useState, useRef, useMemo, ReactNode, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { User } from './supabase'

type AuthCtx = {
  user: User | null
  loading: boolean
  loginWithLine: (next?: string) => void
  loginWithFacebook: (next?: string) => void
  loginWithPhone: (idToken: string) => Promise<{ ok: boolean; isNewUser?: boolean; error?: string }>
  logout: () => Promise<void>
  reloadUser: () => Promise<void>
  updateUser: (data: Partial<User>) => Promise<void>
  syncUser: (data: Partial<User>) => void
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  loginWithLine: () => {},
  loginWithFacebook: () => {},
  loginWithPhone: async () => ({ ok: false, error: 'no_provider' }),
  logout: async () => {},
  reloadUser: async () => {},
  updateUser: async () => {},
  syncUser: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [banned, setBanned] = useState(false)
  const router = useRouter()

  const reloadUser = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' })
      const data = await r.json()
      setUser(data.user || null)
      setBanned(!!data.banned)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reloadUser()
  }, [reloadUser])

  // เริ่ม LINE OAuth — redirect ไป /api/auth/line/start ซึ่ง redirect ต่อไป LINE
  const loginWithLine = (next?: string) => {
    const qs = next ? `?next=${encodeURIComponent(next)}` : ''
    window.location.href = `/api/auth/line/start${qs}`
  }

  // เริ่ม Facebook OAuth
  const loginWithFacebook = (next?: string) => {
    const qs = next ? `?next=${encodeURIComponent(next)}` : ''
    window.location.href = `/api/auth/facebook/start${qs}`
  }

  // Phone OTP login — รับ Firebase ID token จาก client, ส่ง backend สร้าง session
  const loginWithPhone = async (idToken: string): Promise<{ ok: boolean; isNewUser?: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/auth/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data.error || 'unknown' }
      await reloadUser()
      return { ok: true, isNewUser: data.isNewUser }
    } catch {
      return { ok: false, error: 'network_error' }
    }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    window.location.href = '/'
  }

  // อัปเดต local state เท่านั้น (ใช้หลัง API อื่นเปลี่ยน DB แล้ว)
  // Functional setState กัน stale closure — ไม่ reference `user` ตอน render
  const syncUser = useCallback((data: Partial<User>) => {
    setUser(u => u ? { ...u, ...data } : null)
    router.refresh() // force re-fetch server component data
  }, [router])

  const userRef = useRef(user)
  userRef.current = user

  const updateUser = useCallback(async (data: Partial<User>) => {
    const currentUser = userRef.current
    if (!currentUser) return
    const res = await fetch('/api/user/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id, data }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'บันทึกไม่สำเร็จ')
    }
    setUser(u => u ? { ...u, ...data } : null)
    router.refresh()
  }, [router])

  // Memoize context value — กัน re-render storm ของ consumer ทั้งแอพ
  const value = useMemo(
    () => ({ user, loading, loginWithLine, loginWithFacebook, loginWithPhone, logout, reloadUser, updateUser, syncUser }),
    [user, loading, reloadUser, syncUser, updateUser]
  )

  return (
    <AuthContext.Provider value={value}>
      {banned && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,.85)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: 'white', borderRadius: 18, padding: '32px 24px', maxWidth: 380, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🚫</div>
            <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>
              บัญชีถูกระงับ
            </div>
            <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.8, marginBottom: 20 }}>
              บัญชีของคุณถูกระงับชั่วคราว เนื่องจากตรวจพบการใช้งานที่ผิดเงื่อนไข
            </div>
            <div style={{ background: '#F8FAFC', borderRadius: 12, padding: '14px 16px', marginBottom: 20, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', marginBottom: 6 }}>หากคิดว่าเกิดข้อผิดพลาด</div>
              <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
                กรุณาติดต่อทีมงานเพื่อชี้แจง<br />
                LINE: <b>@bookmatch</b><br />
                หรืออีเมล: <b>support@bookmatch.app</b>
              </div>
            </div>
            <button
              onClick={() => { fetch('/api/auth/logout', { method: 'POST' }).then(() => { window.location.href = '/' }) }}
              style={{ width: '100%', padding: '12px 16px', background: '#F1F5F9', border: 'none', borderRadius: 10, fontFamily: 'Kanit', fontWeight: 600, fontSize: 14, color: '#64748B', cursor: 'pointer' }}
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
