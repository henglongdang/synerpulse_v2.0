import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Lock, RefreshCw, Users, X } from 'lucide-react';
import { centsToDecimalString, parseMoneyToCents } from '@synerpulse/shared/client';
import { ApiError } from '../lib/api';
import { avatarColor, initials, money } from '../lib/format';

// ------------------------------------------------------------------ buttons
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'accent';
  size?: 'sm' | 'md';
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'secondary', size = 'md', loading, block, icon, children, className = '', disabled, type = 'button', ...rest },
  ref,
) {
  const v = variant === 'secondary' ? '' : `btn-${variant}`;
  return (
    <button
      ref={ref}
      type={type}
      className={`btn ${v} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, children, small, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; small?: boolean }) {
  return (
    <button type="button" className={`icon-btn ${small ? 'icon-btn-sm' : ''} ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ fields
export function Field({ label, hint, error, children, optional }: { label: string; hint?: ReactNode; error?: string; children: ReactElement; optional?: boolean }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined,
      })
    : children;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {optional && <span className="muted" style={{ fontWeight: 400 }}> (optional)</span>}
      </label>
      {child}
      {hint && !error && (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      )}
      {error && (
        <div className="field-error" id={errId} role="alert">
          <AlertCircle size={12} aria-hidden /> {error}
        </div>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...p }, ref) {
  return <input ref={ref} className={`input ${className}`} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...p }, ref) {
  return <select ref={ref} className={`select ${className}`} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...p }, ref) {
  return <textarea ref={ref} className={`textarea ${className}`} {...p} />;
});

/**
 * Money input: the user types a decimal string; the value handed to the app is integer cents
 * (null while empty/invalid). Parsing uses the shared exact-decimal parser (no float maths).
 */
export function MoneyInput({
  value,
  onChange,
  allowNegative,
  currencySymbol = '$',
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | null;
  onChange: (cents: number | null) => void;
  allowNegative?: boolean;
  currencySymbol?: string;
}) {
  const [text, setText] = useState(value == null ? '' : centsToDecimalString(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(value == null ? '' : centsToDecimalString(value));
      last.current = value;
    }
  }, [value]);
  return (
    <div className="input-money">
      <span className="prefix" aria-hidden>
        {currencySymbol}
      </span>
      <input
        {...rest}
        className="input"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,()+-]/g, '');
          setText(t);
          let cents: number | null = null;
          try {
            cents = t.trim() ? parseMoneyToCents(t) : null;
            if (cents != null && !allowNegative && cents < 0) cents = null;
          } catch {
            cents = null;
          }
          last.current = cents;
          onChange(cents);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ overlays
function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])') ?? []);
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[1] ?? focusables()[0];
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab') {
        const list = focusables();
        if (!list.length) return;
        const [a, b] = [list[0], list[list.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  drawer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  drawer?: boolean;
}) {
  const ref = useFocusTrap(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className={`backdrop ${drawer ? 'drawer-backdrop' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''} ${drawer ? 'drawer' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close" onClick={onClose} small>
            <X size={18} />
          </IconButton>
        </div>
        <div className="dialog-body" style={drawer ? { flex: 1 } : undefined}>
          {children}
        </div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger-solid' : 'primary'} loading={loading} onClick={onConfirm} data-autofocus>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="small" style={{ color: 'var(--ink-700)' }}>
        {body}
      </div>
    </Dialog>
  );
}

export function Menu({ trigger, children, align = 'right', width }: { trigger: (p: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div className="menu" role="menu" style={{ [align]: 0, top: 'calc(100% + 6px)', width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ feedback
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function PageLoading() {
  return (
    <div className="page-loading">
      <Spinner />
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden />;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'Something went wrong loading this.';
  return (
    <div className="empty" role="alert">
      <div className="empty-icon" style={{ background: 'var(--crit-100)', color: 'var(--crit-600)' }}>
        <AlertTriangle size={22} />
      </div>
      <h3>Couldn’t load this</h3>
      <p>{msg}</p>
      {onRetry && (
        <Button size="sm" icon={<RefreshCw size={14} />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
  return (
    <div className="form-banner error" role="alert">
      <AlertCircle size={16} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
      <span>{msg}</span>
    </div>
  );
}

// ------------------------------------------------------------------ data display
export function Avatar({ id, name, size }: { id: string; name: string; size?: 'lg' }) {
  return (
    <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`} style={{ background: avatarColor(id) }} title={name} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Amount({ cents, currency, signed, className = '' }: { cents: number; currency: string; signed?: boolean; className?: string }) {
  return <span className={`num ${cents > 0 && signed ? 'amount-in' : 'amount-out'} ${className}`}>{money(cents, currency, { signed })}</span>;
}

export function VisibilityBadge({ visibility }: { visibility: 'shared' | 'private' }) {
  return visibility === 'private' ? (
    <span className="badge badge-private" title="Only you can see this">
      <Lock aria-hidden /> Private
    </span>
  ) : (
    <span className="badge badge-shared" title="Visible to everyone in the household">
      <Users aria-hidden /> Shared
    </span>
  );
}

export function StatusBadge({ status }: { status: 'ok' | 'warning' | 'over' | 'unbudgeted' }) {
  if (status === 'over')
    return (
      <span className="badge badge-crit">
        <AlertCircle aria-hidden /> Over
      </span>
    );
  if (status === 'warning')
    return (
      <span className="badge badge-warn">
        <AlertTriangle aria-hidden /> Near limit
      </span>
    );
  if (status === 'unbudgeted') return <span className="badge badge-outline">No budget</span>;
  return (
    <span className="badge badge-good">
      <CheckCircle2 aria-hidden /> On track
    </span>
  );
}

export function Meter({ valueBp, status, paceBp, label }: { valueBp: number; status?: 'ok' | 'warning' | 'over' | 'unbudgeted'; paceBp?: number; label: string }) {
  const cls = status === 'over' ? 'over' : status === 'warning' ? 'warn' : '';
  return (
    <div className={`meter ${cls}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(valueBp / 100)}>
      <div className="meter-fill" style={{ width: `${Math.min(100, valueBp / 100)}%` }} />
      {paceBp != null && paceBp > 0 && paceBp < 10_000 && <div className="meter-pace" style={{ left: `calc(${paceBp / 100}% - 1px)` }} title="Today" />}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" type="button" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
