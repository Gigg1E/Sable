import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, KeyRound, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { useStore } from '../lib/store';

interface SecurityInfo {
  twoFactor: boolean;
  recoveryLeft: number;
  sessions: number;
}

export function SecuritySection() {
  const toast = useStore((s) => s.toast);
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [step, setStep] = useState<'idle' | 'password' | 'scan' | 'codes' | 'disable'>('idle');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => void api.get<SecurityInfo>('/security').then(setInfo);
  useEffect(load, []);
  const reset = () => (setStep('idle'), setPassword(''), setCode(''), setSetup(null));

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'error' });
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="mb-10">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Two-factor sign-in</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">
          Ask for a 6-digit code from an authenticator app (1Password, Google Authenticator, Authy, iOS Passwords…) in addition to your password. Strongly recommended if Sable is reachable from the internet.
        </p>
        <Card className="mt-4">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
            <span className="flex size-9 items-center justify-center rounded-md border border-line bg-panel-2">
              <Smartphone className="size-4 text-fg-2" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13.5px] font-medium">
                Authenticator app {info && <Badge tone={info.twoFactor ? 'ok' : 'default'}>{info.twoFactor ? 'On' : 'Off'}</Badge>}
              </div>
              <div className="text-[12px] text-fg-3">{info?.twoFactor ? `${info.recoveryLeft} recovery code${info.recoveryLeft === 1 ? '' : 's'} left` : 'Only your password protects sign-in.'}</div>
            </div>
            {step === 'idle' &&
              (info?.twoFactor ? (
                <Button size="sm" variant="ghost" onClick={() => setStep('disable')}>
                  Turn off
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setStep('password')}>
                  <KeyRound className="size-3.5" /> Set up
                </Button>
              ))}
          </div>

          <AnimatePresence initial={false} mode="wait">
            {step !== 'idle' && (
              <motion.div key={step} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <div className="space-y-4 border-t border-line px-4 py-4">
                  {step === 'password' && (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const r = await run(() => api.post<{ secret: string; qr: string }>('/security/2fa/begin', { password }));
                        if (r) (setSetup(r), setStep('scan'));
                      }}
                    >
                      <div className="min-w-[220px] flex-1">
                        <Field label="Confirm your password">
                          <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                        </Field>
                      </div>
                      <Button type="submit" variant="primary" loading={busy} disabled={!password}>
                        Continue
                      </Button>
                      <Button type="button" variant="ghost" onClick={reset}>
                        Cancel
                      </Button>
                    </form>
                  )}

                  {step === 'scan' && setup && (
                    <div className="flex flex-col gap-5 sm:flex-row">
                      <img src={setup.qr} alt="QR code for your authenticator app" className="size-44 shrink-0 rounded-md border border-line bg-white p-2" />
                      <form
                        className="min-w-0 flex-1 space-y-3"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const r = await run(() => api.post<{ recoveryCodes: string[] }>('/security/2fa/confirm', { code }));
                          if (r) (setCodes(r.recoveryCodes), setStep('codes'), load());
                        }}
                      >
                        <p className="text-[13px] leading-relaxed text-fg-2">Scan the code with your authenticator app, or enter this key manually:</p>
                        <code className="block break-all rounded-md border border-line bg-sunken px-2.5 py-1.5 font-mono text-[12px] tracking-wider">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                        <Field label="Enter the 6-digit code it shows">
                          <Input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-[180px] font-mono tracking-widest" />
                        </Field>
                        <div className="flex gap-2">
                          <Button type="submit" variant="primary" loading={busy} disabled={code.replace(/\D/g, '').length !== 6}>
                            Turn on
                          </Button>
                          <Button type="button" variant="ghost" onClick={reset}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}

                  {step === 'codes' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-[13px] font-medium text-ok">
                        <ShieldCheck className="size-4" /> Two-factor sign-in is on
                      </div>
                      <p className="text-[13px] leading-relaxed text-fg-2">Save these recovery codes somewhere safe, like a password manager. Each works once if you lose your phone. They won't be shown again.</p>
                      <div className="grid max-w-md grid-cols-2 gap-1.5 rounded-md border border-line bg-sunken p-3 font-mono text-[13px]">
                        {codes.map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={async () => {
                            await navigator.clipboard?.writeText(codes.join('\n')).catch(() => {});
                            setCopied(true);
                          }}
                        >
                          {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />} Copy codes
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => (reset(), setCodes([]), setCopied(false))}>
                          I saved them
                        </Button>
                      </div>
                    </div>
                  )}

                  {step === 'disable' && (
                    <form
                      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const r = await run(() => api.post('/security/2fa/disable', { password, code }));
                        if (r) (reset(), load(), toast({ title: 'Two-factor sign-in turned off' }));
                      }}
                    >
                      <Field label="Password">
                        <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                      </Field>
                      <Field label="Current code or a recovery code">
                        <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
                      </Field>
                      <div className="flex items-end gap-2">
                        <Button type="submit" variant="danger" loading={busy} disabled={!password || !code}>
                          Turn off
                        </Button>
                        <Button type="button" variant="ghost" onClick={reset}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </section>

      <section className="mb-10">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Signed-in devices</h2>
        <Card className="mt-4 flex flex-wrap items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium">{info ? `${info.sessions} active session${info.sessions === 1 ? '' : 's'}` : '…'}</div>
            <div className="text-[12px] text-fg-3">Sessions last 30 days. Signing out everywhere keeps only this device.</div>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              const r = await run(() => api.post('/security/signout-all'));
              if (r) (load(), toast({ title: 'Signed out of all other devices', tone: 'success' }));
            }}
          >
            <LogOut className="size-3.5" /> Sign out everywhere else
          </Button>
        </Card>
      </section>
    </>
  );
}
