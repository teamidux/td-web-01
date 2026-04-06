'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase, User } from './supabase'

type AuthCtx = {
  user: User | null
  loading: boolean
  login: (phone: string) => Promise<void>
  logout: () => void
  updateUser: (data: Partial<User>) => Promise<void>
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  updateUser: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('bm_user')
      if (saved) setUser(JSON.parse(saved))
    } catch { }
    setLoading(false)
  }, [])

  const login = async (phone: string) => {
    const cleaned = phone.replace(/\D/g, '')
    let { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('phone', cleaned)
      .maybeSingle()

    if (!existing) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          phone: cleaned,
          display_name: 'นักอ่าน' + cleaned.slice(-4),
          plan: 'free',
          listings_limit: 20,
          sold_count: 0,
          confirmed_count: 0,
          is_verified: false,
          is_pioneer: false,
          pioneer_count: 0,
        })
        .select()
        .single()
      existing = newUser
    }

    if (existing) {
      setUser(existing)
      localStorage.setItem('bm_user', JSON.stringify(existing))
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('bm_user')
  }

  const updateUser = async (data: Partial<User>) => {
    if (!user) return
    await supabase.from('users').update(data).eq('id', user.id)
    const updated = { ...user, ...data }
    setUser(updated)
    localStorage.setItem('bm_user', JSON.stringify(updated))
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
