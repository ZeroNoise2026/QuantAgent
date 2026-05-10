import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    try {
      const data = await signUp(email.trim(), password)
      // If email confirmation is OFF (dev), session is set immediately.
      // If ON, the user must click the link in their email first.
      if (data.session) {
        navigate('/briefing', { replace: true })
      } else {
        setInfo('Account created. Check your inbox to confirm your email, then sign in.')
      }
    } catch (err) {
      setError(err.message || 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.shell}>
      <form onSubmit={onSubmit} style={styles.card}>
        <h1 style={styles.title}>QuantAgent</h1>
        <p style={styles.subtitle}>Create an account</p>

        {error && <div style={styles.error}>{error}</div>}
        {info && <div style={styles.info}>{info}</div>}

        <label style={styles.label}>Email</label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
        />

        <label style={styles.label}>Password (min 6 chars)</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
        />

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? 'Creating…' : 'Sign up'}
        </button>

        <p style={styles.footer}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  )
}

const styles = {
  shell: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f1117',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    background: '#18181b',
    border: '1px solid #27272a',
    borderRadius: 12,
    padding: 28,
    display: 'flex',
    flexDirection: 'column',
  },
  title: { color: '#3b82f6', fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 },
  subtitle: { color: '#a1a1aa', fontSize: '0.875rem', marginBottom: 20 },
  label: { color: '#d4d4d8', fontSize: '0.8rem', marginTop: 12, marginBottom: 6 },
  input: {
    background: '#0f1117',
    border: '1px solid #3f3f46',
    color: '#e4e4e7',
    borderRadius: 8,
    padding: '9px 12px',
    fontSize: '0.875rem',
  },
  button: {
    marginTop: 20,
    background: '#3b82f6',
    color: '#fff',
    padding: '10px 16px',
    fontWeight: 600,
  },
  footer: { color: '#a1a1aa', fontSize: '0.8rem', marginTop: 16, textAlign: 'center' },
  error: {
    background: '#7f1d1d',
    color: '#fecaca',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: '0.8rem',
    marginBottom: 8,
  },
  info: {
    background: '#1e3a8a',
    color: '#bfdbfe',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: '0.8rem',
    marginBottom: 8,
  },
}
