import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  message: string;
  action?: { label: string; onClick: () => void };
}
interface ToastApi {
  success(message: string, action?: Toast['action']): void;
  error(message: string): void;
  info(message: string): void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Kind, message: string, action?: Toast['action']) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, kind, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 7000 : kind === 'error' ? 6000 : 3500);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({ success: (m, a) => push('success', m, a), error: (m) => push('error', m), info: (m) => push('info', m) }),
    [push],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 size={18} /> : t.kind === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
            <span>{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('ToastProvider missing');
  return c;
}
