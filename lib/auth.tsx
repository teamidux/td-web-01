'use client'
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import { User } from './supabase'

type AuthCtx = {
  user: User | null
  loading: boolean
  loginWithLine: (next?: string) => void
  logout: () => Promise<void>
  reloadUser: () => Promise<void>
  updateUser: (data: Partial<User>) => Promise<void>
  syncUser: (data: Partial<User>) => void
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  loginWithLine: () => {},
  logout: async () => {},
  reloadUser: async () => {},
  updateUser: async () => {},
  syncUser: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

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

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    window.location.href = '/'
  }

  // อัปเดต local state เท่านั้น (ใช้หลัง API อื่นเปลี่ยน DB แล้ว)
  const syncUser = (data: Partial<User>) => {
    if (!user) return
    setUser({ ...user, ...data })
  }

  const updateUser = async (data: Partial<User>) => {
    if (!user) return
    const res = await fetch('/api/user/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, data }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'บันทึกไม่สำเร็จ')
    }
    setUser({ ...user, ...data })
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginWithLine, logout, reloadUser, updateUser, syncUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
