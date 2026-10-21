import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { User, AppSettings } from '@shared/types'

/** Minutos sin actividad antes de cerrar la sesión, si no hay configuración */
const DEFAULT_IDLE_MINUTES = 30
/** Minutos de aviso previo para poder continuar sin perder el trabajo */
const WARN_MINUTES = 2

const WARN_MS = WARN_MINUTES * 60_000

interface AuthCtx {
  user: User | null
  /** true mientras la profesora siga con la contraseña de fábrica */
  mustChangePassword: boolean
  /** Segundos restantes cuando está por cerrarse la sesión; null si no aplica */
  idleCountdown: number | null
  /** Minutos configurados de inactividad, para mostrarlo en el aviso */
  idleMinutes: number
  login: (username: string, password: string) => Promise<string | null>
  logout: (reason?: string) => void
  passwordChanged: () => void
  stayLoggedIn: () => void
}

const AuthContext = createContext<AuthCtx>({} as AuthCtx)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [mustChangePassword, setMustChange] = useState(false)
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null)
  const [idleMinutes, setIdleMinutes] = useState(DEFAULT_IDLE_MINUTES)

  // Los temporizadores viven en refs porque se reinician en cada movimiento
  // del mouse: si vivieran en el estado, cada tecla provocaría un re-render.
  const warnTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const tickTimer = useRef<number | null>(null)

  const clearTimers = useCallback(() => {
    if (warnTimer.current) window.clearTimeout(warnTimer.current)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    if (tickTimer.current) window.clearInterval(tickTimer.current)
    warnTimer.current = closeTimer.current = tickTimer.current = null
  }, [])

  const logout = useCallback((reason?: string) => {
    clearTimers()
    setIdleCountdown(null)
    setMustChange(false)
    setUser(null)
    // Se avisa al proceso principal para dejar constancia en la bitácora
    window.api.logout(reason).catch(() => { /* cerrar sesión nunca debe fallar */ })
  }, [clearTimers])

  const armTimers = useCallback(() => {
    clearTimers()
    setIdleCountdown(null)

    const idleMs = idleMinutes * 60_000
    // Con umbrales cortos el aviso no cabría antes del cierre
    const warnMs = Math.min(WARN_MS, Math.floor(idleMs / 2))

    warnTimer.current = window.setTimeout(() => {
      let left = Math.floor(warnMs / 1000)
      setIdleCountdown(left)
      tickTimer.current = window.setInterval(() => {
        left -= 1
        setIdleCountdown(left > 0 ? left : 0)
      }, 1000)
    }, idleMs - warnMs)

    closeTimer.current = window.setTimeout(() => logout('idle'), idleMs)
  }, [clearTimers, logout, idleMinutes])

  const login = useCallback(async (username: string, password: string) => {
    const res = await window.api.login(username, password)
    if (res.ok && res.data) {
      const u = res.data as any
      setUser(u as User)
      setMustChange(Number(u.must_change_password) === 1)

      // El umbral se lee después de entrar: la configuración vive en la base
      // y no tiene por qué consultarse sin sesión iniciada.
      window.api.getSettings()
        .then(r => { if (r.ok) setIdleMinutes((r.data as AppSettings).idle_minutes) })
        .catch(() => { /* se conserva el valor por omisión */ })

      return null
    }
    return res.error ?? 'Error desconocido'
  }, [])

  const passwordChanged = useCallback(() => setMustChange(false), [])
  const stayLoggedIn = useCallback(() => armTimers(), [armTimers])

  // Vigilar la inactividad solo mientras haya sesión abierta.
  // Durante el aviso ya no se reinicia solo: la profesora debe confirmar
  // que sigue ahí, para que un roce accidental del mouse no lo cancele.
  useEffect(() => {
    if (!user) { clearTimers(); return }

    armTimers()
    const events = ['mousedown', 'keydown', 'wheel', 'touchstart']
    const onActivity = () => {
      if (warnTimer.current !== null && idleCountdown === null) armTimers()
    }
    events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))

    return () => {
      events.forEach(ev => window.removeEventListener(ev, onActivity))
      clearTimers()
    }
  }, [user, idleCountdown, armTimers, clearTimers])

  return (
    <AuthContext.Provider
      value={{
        user, mustChangePassword, idleCountdown, idleMinutes,
        login, logout, passwordChanged, stayLoggedIn,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
