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
  const router = useRouter()

  const reloadUser = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' })
      const { user } = await r.json()
      setUser(user || null)
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
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
