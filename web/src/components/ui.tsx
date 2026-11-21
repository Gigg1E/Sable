import { SableCharacter } from './SableCharacter';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AnimatePresence, motion } from 'motion/react';
import { Check as CheckIcon, ChevronDown, Copy as CopyIcon, Loader2, Menu, PanelLeftOpen, X } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/format';

// ───────────────────────── Buttons ─────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'xs' | 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      className={cx(
        'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background,color,border,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
        size === 'xs' && 'h-6 px-2 text-xs',
        size === 'sm' && 'h-7 px-2.5 text-[13px]',
        size === 'md' && 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-fg text-bg shadow-1 hover:bg-fg/90',
        variant === 'secondary' && 'border border-line bg-panel text-fg shadow-1 hover:border-line-strong hover:bg-panel-2',
        variant === 'ghost' && 'text-fg-2 hover:bg-panel-2 hover:text-fg',
        variant === 'danger' && 'border border-danger/25 bg-danger/8 text-danger hover:bg-danger/14',
        variant === 'accent' && 'bg-accent text-bg hover:bg-accent/90',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Tip({ label, children, side = 'top', kbd }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; kbd?: string }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="z-[100] flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1 text-xs text-fg shadow-2 data-[state=delayed-open]:animate-in">
          {label}
          {kbd && <Kbd>{kbd}</Kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function IconButton({ className, label, kbd, children, side, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; kbd?: string; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tip label={label} kbd={kbd} side={side}>
      <button aria-label={label} className={cx('inline-flex size-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-panel-2 hover:text-fg', className)} {...rest}>
        {children}
      </button>
    </Tip>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-panel-2 px-1 font-mono text-[10.5px] font-medium text-fg-3', className)}>{children}</kbd>;
}

// ───────────────────────── Form controls ─────────────────────────

export const inputClass =
  'w-full rounded-md border border-line bg-panel px-2.5 h-8 text-[13px] text-fg shadow-1 placeholder:text-fg-3 outline-none transition-[border,box-shadow] focus:border-line-strong focus:ring-[3px] focus:ring-accent/15';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClass, 'h-auto min-h-[76px] resize-y py-2 leading-relaxed', props.className)} />;
}
export function Select({ children, className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cx('relative', className?.includes('w-auto') ? 'w-auto' : 'w-full')}>
      <select {...props} className={cx(inputClass, 'appearance-none pr-8', className)}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[13px] font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="block text-xs leading-relaxed text-fg-3">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label?: string; size?: 'sm' | 'md' }) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex shrink-0 items-center rounded-full border transition-colors', sm ? 'h-4 w-7' : 'h-5 w-9', checked ? 'border-fg bg-fg' : 'border-line-strong bg-panel-3')}
    >
      <motion.span
        animate={{ x: checked ? (sm ? 12 : 16) : 2 }}
        transition={{ type: 'spring', stiffness: 700, damping: 40 }}
        className={cx('rounded-full shadow-sm', sm ? 'size-2.5' : 'size-3.5', checked ? 'bg-bg' : 'bg-fg-3')}
      />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, id, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; id: string; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={cx('relative rounded-[5px] font-medium transition-colors', size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]', value === o.value ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[5px] border border-line bg-panel shadow-1" transition={{ type: 'spring', stiffness: 600, damping: 42 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Surfaces ─────────────────────────

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & Record<string, unknown>) {
  return (
    <div className={cx('rounded-lg border border-line bg-panel shadow-1', className)} {...rest}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'default', className }: { children: ReactNode; tone?: 'default' | 'accent' | 'ok' | 'danger' | 'info' | 'outline'; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium',
        tone === 'default' && 'bg-panel-3 text-fg-2',
        tone === 'outline' && 'border border-line text-fg-2',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'ok' && 'bg-ok/10 text-ok',
        tone === 'danger' && 'bg-danger/10 text-danger',
        tone === 'info' && 'bg-info/10 text-info',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ state, className }: { state: 'idle' | 'running' | 'waiting' | 'ok' | 'error' | 'off'; className?: string }) {
  const color = { idle: 'bg-fg-3', running: 'bg-info', waiting: 'bg-accent', ok: 'bg-ok', error: 'bg-danger', off: 'bg-panel-3' }[state];
  return (
    <span className={cx('relative inline-flex size-2 shrink-0', className)}>
      {(state === 'running' || state === 'waiting') && <span className={cx('absolute inset-0 animate-ping rounded-full opacity-50', color)} />}
      <span className={cx('relative inline-flex size-2 rounded-full', color)} />
    </span>
  );
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** Terminal-style spinner. */
export function Ticker({ className }: { className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return <span className={cx('inline-block w-[1ch] font-mono', className)}>{FRAMES[i]}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-fg-3', className)} />;
}

export function Progress({ value, tone = 'fg' }: { value: number; tone?: 'fg' | 'ok' | 'accent' }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-panel-3">
      <motion.div
        className={cx('h-full rounded-full', tone === 'ok' ? 'bg-ok' : tone === 'accent' ? 'bg-accent' : 'bg-fg')}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ type: 'spring', stiffness: 90, damping: 22 }}
      />
    </div>
  );
}

// ───────────────────────── Page chrome ─────────────────────────

export const ShellContext = createContext<{ openNav: () => void; openPalette: () => void; navCollapsed?: boolean; toggleNav?: () => void }>({ openNav: () => {}, openPalette: () => {} });

/** The bar at the top of every page: title / breadcrumb on the left, actions on the right. */
export function TopBar({ title, crumbs, actions, children }: { title: ReactNode; crumbs?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  const { openNav, navCollapsed, toggleNav } = useContext(ShellContext);
  return (
    <header className="pt-safe sticky top-0 z-20 shrink-0 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="flex h-12 items-center gap-2 px-3 md:px-5">
        <button onClick={openNav} className="-ml-1 inline-flex size-8 items-center justify-center rounded-md text-fg-2 hover:bg-panel-2 md:hidden" aria-label="Open navigation">
          <Menu className="size-[18px]" />
        </button>
        {navCollapsed && (
          <Tip label="Show sidebar" kbd="Ctrl \\" side="bottom">
            <button onClick={toggleNav} className="-ml-1 hidden size-8 items-center justify-center rounded-md text-fg-2 hover:bg-panel-2 hover:text-fg md:inline-flex" aria-label="Show sidebar">
              <PanelLeftOpen className="size-[17px]" />
            </button>
          </Tip>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
          {crumbs && <span className="hidden shrink-0 text-fg-3 sm:inline">{crumbs}</span>}
          {crumbs && <span className="hidden text-fg-3 sm:inline">/</span>}
          <span className="truncate font-medium text-fg">{title}</span>
          {children}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
    </header>
  );
}

/** Standard scrollable page body. */
export function Page({ children, width = 'md', className }: { children: ReactNode; width?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cx('mx-auto px-4 pb-16 pt-6 md:px-8 md:pt-10', { sm: 'max-w-2xl', md: 'max-w-3xl', lg: 'max-w-5xl', xl: 'max-w-6xl' }[width], className)}>{children}</div>
    </div>
  );
}

export function PageIntro({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-xs font-medium text-fg-3">{children}</h2>
      {right}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-12 text-center">
      {/* Sable sits next to what's missing, holding up the page's icon. */}
      <div className="relative mb-3">
        <SableCharacter size={76} mood="idle" />
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 8 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.25 }}
          className="absolute -right-4 bottom-1 flex size-8 items-center justify-center rounded-md border border-line-strong bg-bg text-fg-2 [&_svg]:size-4"
        >
          {icon}
        </motion.div>
      </div>
      <h3 className="voice text-[17px] font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-fg-3">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}

/** Dialog on desktop, bottom sheet on phones. */
export function Sheet({ open, onClose, title, description, children, wide }: { open: boolean; onClose: () => void; title?: string; description?: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-start md:pt-[12vh]">
          <motion.div className="absolute inset-0 bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className={cx('pb-safe relative flex max-h-[85dvh] w-full flex-col rounded-t-xl border border-line bg-panel shadow-2 md:rounded-xl', wide ? 'md:max-w-2xl' : 'md:max-w-md')}
          >
            {title && (
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div>
                  <h2 className="text-[15px] font-semibold">{title}</h2>
                  {description && <p className="mt-0.5 text-[13px] text-fg-3">{description}</p>}
                </div>
                <button onClick={onClose} className="-mr-1 -mt-0.5 rounded-md p-1 text-fg-3 hover:bg-panel-2 hover:text-fg" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>
            )}
            <div className="overflow-y-auto p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Settings-style row: label and description on the left, control on the right. */
export function SettingRow({ label, description, children, stack }: { label: string; description?: ReactNode; children: ReactNode; stack?: boolean }) {
  return (
    <div className={cx('flex gap-x-8 gap-y-3 px-4 py-3.5', stack ? 'flex-col' : 'flex-col sm:flex-row sm:items-center')}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {description && <div className="mt-0.5 text-xs leading-relaxed text-fg-3">{description}</div>}
      </div>
      <div className={cx(stack ? 'w-full' : 'sm:w-[280px] sm:shrink-0 sm:flex sm:justify-end')}>{children}</div>
    </div>
  );
}

export function Group({ title, description, children, footer }: { title?: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="mb-8">
      {title && <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>}
      {description && <p className="mt-0.5 text-[13px] leading-relaxed text-fg-2">{description}</p>}
      <div className={cx('divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel shadow-1', title && 'mt-3')}>{children}</div>
      {footer && <div className="mt-3">{footer}</div>}
    </section>
  );
}

/** Fade-and-rise for list items. */
export const listItem = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.12 } },
  transition: { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number] },
};

/** Copy text to the clipboard; falls back to a hidden textarea where the Clipboard API isn't available (plain http). */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, className, label = 'Copy', showLabel }: { text: string | (() => string); className?: string; label?: string; showLabel?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(typeof text === 'function' ? text() : text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }
      }}
      className={cx('inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-fg-3 transition-colors hover:bg-panel-2 hover:text-fg', className)}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={copied ? 'y' : 'n'} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.12 }} className="inline-flex">
          {copied ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon className="size-3.5" />}
        </motion.span>
      </AnimatePresence>
      {showLabel && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}
