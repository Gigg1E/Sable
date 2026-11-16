import { motion } from 'motion/react';
import { ArrowRight, Lock } from 'lucide-react';
import { useState } from 'react';
import { Logo } from '../components/Logo';
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
    <div className="relative flex min-h-dvh items-center justify-center bg-bg p-6">
      <div className="canvas-grid pointer-events-none absolute inset-x-0 top-0 h-[60vh]" />
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }} className="relative w-full max-w-[360px]">
        <Logo size={32} />
        <h1 className="mt-6 text-[22px] font-semibold tracking-[-0.02em]">{mode === 'setup' ? 'Set up Sable' : 'Sign in to Sable'}</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">
          {mode === 'setup' ? 'Your agent runs on this server. Choose a password to protect it. You’ll use it on every device.' : 'Enter the password for this server.'}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-2.5">
          <Input type="password" autoFocus autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} placeholder={mode === 'setup' ? 'Password (8+ characters)' : 'Password'} value={password} onChange={(e) => setPassword(e.target.value)} className="h-9" />
          {mode === 'setup' && <Input type="password" autoComplete="new-password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-9" />}
          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1, x: [0, -4, 4, -2, 0] }} className="text-[13px] text-danger">
              {error}
            </motion.p>
          )}
          <Button type="submit" variant="primary" className="h-9 w-full" loading={busy}>
            {mode === 'setup' ? 'Create password' : 'Continue'} {!busy && <ArrowRight className="size-3.5" />}
          </Button>
        </form>
        <p className="mt-6 flex items-center gap-1.5 text-xs text-fg-3">
          <Lock className="size-3" /> Self-hosted. Your data stays on this machine.
        </p>
      </motion.div>
    </div>
  );
}
