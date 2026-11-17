import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowUp, Paperclip, Square, X } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { cx } from '../lib/format';
import { prepareImage, uploadFile, uploadImage } from '../lib/images';
import { FileGlyph, fmtBytes } from './Cards';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { Kbd, Spinner, Tip } from './ui';

const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const MAX_FILES = 8;
const MAX_BYTES = 25 * 1024 * 1024;

export interface ComposerHandle {
  setText: (t: string) => void;
  focus: () => void;
}

interface Attachment {
  key: string;
  /** Object URL for images; empty for other files. */
  preview: string;
  name: string;
  size: number;
  image: boolean;
  status: 'uploading' | 'ready' | 'error';
  id?: string;
  error?: string;
}

export const Composer = forwardRef<
  ComposerHandle,
  { onSend: (text: string, attachments: string[]) => Promise<void> | void; onStop?: () => void; running?: boolean; autoFocus?: boolean; placeholder?: string; minRows?: number }
>(function Composer({ onSend, onStop, running, autoFocus, placeholder, minRows = 1 }, handle) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);
  const provider = settings?.providers.find((p) => p.id === settings.main.providerId);

  useImperativeHandle(handle, () => ({
    setText: (t) => {
      setText(t);
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.setSelectionRange(t.length, t.length);
      });
    },
    focus: () => ref.current?.focus(),
  }));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(Math.max(el.scrollHeight, minRows * 24 + 20), 260) + 'px';
  }, [text, minRows]);
  useEffect(() => {
    if (autoFocus && !coarse) ref.current?.focus();
  }, [autoFocus]);
  // Free preview memory when attachments go away.
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(list: FileList | File[]) {
    const all = [...list];
    const tooBig = all.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) toast({ title: `${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over 25 MB`, tone: 'error' });
    const accepted = all.filter((f) => f.size <= MAX_BYTES && f.size > 0);
    const room = MAX_FILES - files.length;
    if (accepted.length > room) toast({ title: `Up to ${MAX_FILES} files per message` });
    for (const file of accepted.slice(0, Math.max(0, room))) {
      const key = Math.random().toString(36).slice(2);
      // Photos are resized and converted (HEIC → JPEG) so every model can see them; everything else is sent as is.
      const image = /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.type) || /\.(heic|heif)$/i.test(file.name);
      setFiles((fs) => [...fs, { key, preview: image ? URL.createObjectURL(file) : '', name: file.name, size: file.size, image, status: 'uploading' }]);
      void (async () => {
        try {
          if (!image) {
            const up = await uploadFile(file);
            setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, status: 'ready', id: up.id } : f)));
            return;
          }
          const { blob, width, height } = await prepareImage(file);
          const up = await uploadImage(blob, width, height, file.name);
          setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, status: 'ready', id: up.id } : f)));
        } catch (err) {
          setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, status: 'error', error: (err as Error).message } : f)));
        }
      })();
    }
  }

  function remove(key: string) {
    setFiles((fs) => {
      const f = fs.find((x) => x.key === key);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return fs.filter((x) => x.key !== key);
    });
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  const uploading = files.some((f) => f.status === 'uploading');
  const ready = files.filter((f) => f.status === 'ready' && f.id).map((f) => f.id!);
  const canSend = !running && !uploading && (text.trim().length > 0 || ready.length > 0);

  async function send() {
    if (!canSend) return;
    const t = text.trim();
    setText('');
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setFiles([]);
    await onSend(t, ready);
  }

  return (
    <div
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setDragging(false)}
      onDrop={onDrop}
      className={cx('relative rounded-xl border bg-panel shadow-2 transition-colors', dragging ? 'border-accent/60' : 'border-line focus-within:border-line-strong')}
    >
      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-panel/90 text-[13px] text-fg-2">
            <Paperclip className="mr-2 size-4 text-accent" /> Drop files to attach
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {files.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="flex gap-2 overflow-x-auto px-3 pt-3">
              <AnimatePresence initial={false}>
                {files.map((f) => (
                  <motion.div key={f.key} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.15 }} className={cx('group relative h-16 shrink-0', f.image ? 'w-16' : 'w-52')}>
                    {f.image ? (
                      <img src={f.preview} alt="" className={cx('size-16 rounded-md border border-line object-cover', f.status !== 'ready' && 'opacity-50')} />
                    ) : (
                      <div className={cx('flex h-16 items-center gap-2.5 rounded-md border border-line bg-panel-2 px-2.5', f.status !== 'ready' && 'opacity-60')}>
                        <FileGlyph name={f.name} />
                        <div className="min-w-0">
                          <div className="truncate text-[12.5px] font-medium">{f.name}</div>
                          <div className="font-mono text-[11px] text-fg-3">{fmtBytes(f.size)}</div>
                        </div>
                      </div>
                    )}
                    {f.status === 'uploading' && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Spinner className="text-fg" />
                      </span>
                    )}
                    {f.status === 'error' && (
                      <Tip label={f.error ?? 'Upload failed'}>
                        <span className="absolute inset-0 flex items-center justify-center rounded-md bg-danger/20 text-danger">
                          <AlertCircle className="size-5" />
                        </span>
                      </Tip>
                    )}
                    <button onClick={() => remove(f.key)} aria-label={`Remove ${f.name}`} className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-line bg-panel text-fg-2 shadow-1 hover:text-fg">
                      <X className="size-3" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <textarea
        ref={ref}
        value={text}
        rows={minRows}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder ?? `Describe a task for ${settings?.persona.name ?? 'Sable'}…`}
        className="block w-full resize-none bg-transparent px-3.5 pt-3 text-[14.5px] leading-6 outline-none placeholder:text-fg-3"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        <Tip label="Attach files or photos" kbd={coarse ? undefined : 'paste or drop'}>
          <button onClick={() => picker.current?.click()} aria-label="Attach files" className="flex size-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-panel-2 hover:text-fg">
            <Paperclip className="size-4" />
          </button>
        </Tip>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <Tip label="Change model">
          <button onClick={() => navigate('/settings/models')} className="flex h-6 max-w-[50%] items-center gap-1.5 rounded-md border border-line px-2 font-mono text-[11px] text-fg-3 transition-colors hover:border-line-strong hover:text-fg-2">
            <span className="size-1.5 shrink-0 rounded-full bg-ok" />
            <span className="truncate">{settings?.main.model || 'auto'}</span>
            <span className="hidden text-fg-3/70 sm:inline">· {provider?.name}</span>
          </button>
        </Tip>
        <span className="flex-1" />
        {!coarse && !running && (
          <span className="hidden items-center gap-1 text-[11px] text-fg-3 lg:flex">
            <Kbd>↵</Kbd> send <Kbd className="ml-1">⇧↵</Kbd> new line
          </span>
        )}
        <button
          onClick={() => (running ? onStop?.() : void send())}
          aria-label={running ? 'Stop' : 'Send'}
          disabled={!running && !canSend}
          className={cx(
            'flex size-7 items-center justify-center rounded-md transition-all active:scale-95',
            running ? 'border border-line-strong bg-panel-2 text-fg hover:bg-panel-3' : canSend ? 'bg-fg text-bg' : 'bg-panel-3 text-fg-3',
          )}
        >
          {running ? <Square className="size-3 fill-current" /> : uploading ? <Spinner className="size-3.5" /> : <ArrowUp className="size-4" strokeWidth={2.2} />}
        </button>
      </div>
    </div>
  );
});
