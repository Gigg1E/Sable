import { motion } from 'motion/react';
import { useState } from 'react';
import { Orb } from '../components/Orb';
import { Button, Input } from '../components/ui';
import { api } from '../lib/api';
import { useStore } from '../lib/store';

export function AuthScreen({ mode }: { mode: 'setup' | 'login' }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const boot = useStore((s) => s.boot);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'setup' && password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await api.post(mode === 'setup' ? '/auth/setup' : '/auth/login', { password });
      await boot();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aurora flex min-h-dvh items-center justify-center p-6">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="relative z-10 w-full max-w-sm"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <Orb size={64} />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">{mode === 'setup' ? 'Welcome to Sable' : 'Welcome back'}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {mode === 'setup' ? 'Your personal agent lives on this server. Choose a password to protect it.' : 'Sign in to your agent.'}
          </p>
        </div>
        <div className="space-y-3">
          <Input type="password" autoFocus autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === 'setup' && <Input type="password" autoComplete="new-password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          {error && (
            <motion.p initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} className="text-sm text-danger">
              {error}
            </motion.p>
          )}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {mode === 'setup' ? 'Create password' : 'Sign in'}
          </Button>
        </div>
      </motion.form>
    </div>
  );
}
