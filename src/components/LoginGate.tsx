/**
 * LoginGate — full-screen password overlay shown when the backend returns 401.
 *
 * Inert until the server-side auth gate is configured (no 401s ⇒ never shows).
 * On successful login it stores the token and refetches all queries.
 */
import { useState, useEffect } from 'react'
import { onUnauthorized, login } from '@/lib/auth'
import { queryClient } from '@/lib/queryClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Lock } from 'lucide-react'

export function LoginGate() {
  const [show, setShow] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    onUnauthorized(() => setShow(true))
  }, [])

  if (!show) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await login(password)
    setBusy(false)
    if (r.ok) {
      setShow(false)
      setPassword('')
      queryClient.invalidateQueries() // refetch everything now that we're authed
    } else {
      setError(r.error ?? 'Login failed')
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Knox Exterior Care</h1>
          <p className="text-sm text-muted-foreground">Enter your password to continue</p>
        </div>
        <Input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}
