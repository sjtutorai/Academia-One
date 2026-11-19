import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Info,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import {
  getModalBackdropVariants,
  getModalDialogVariants,
  getToastVariants,
} from '../../lib/motion';

// ============================================================================
// Toast Feedback System (Animated Slide/Fade + Longer Error Persistence)
// ============================================================================
interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

const ToastContext = createContext<{
  pushToast: (type: ToastItem['type'], message: string) => void;
}>({ pushToast: () => undefined });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const prefersReducedMotion = useReducedMotion();
  const toastVariants = getToastVariants(prefersReducedMotion);

  const pushToast = useCallback((type: ToastItem['type'], message: string) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    const duration = type === 'error' ? 7500 : type === 'warning' ? 6000 : 4500;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-md w-[calc(100vw-2.5rem)] pointer-events-none"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              variants={toastVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              role={t.type === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex items-start gap-3 bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-3 text-sm text-slate-800"
            >
              {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
              {t.type === 'error' && <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
              {t.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />}
              {t.type === 'info' && <Info className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />}
              <span className="flex-1 leading-snug">{t.message}</span>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded transition-colors cursor-pointer"
                aria-label="Dismiss message"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ============================================================================
// Buttons (Micro-interaction Hover, Press Scale 0.98, Inline Pending Spinner)
// ============================================================================
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'navy' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 ease-out active:scale-[0.98] disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer';
  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary: 'bg-teal-600 text-white hover:bg-teal-700 hover:shadow-sm',
    navy: 'bg-[#101C35] text-white hover:bg-[#172554] hover:shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 hover:shadow-sm',
    ghost: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
  };
  const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
    sm: 'text-xs px-3 py-1.5 min-h-[34px]',
    md: 'text-sm px-4 py-2 min-h-[40px]',
    lg: 'text-sm px-6 py-3 min-h-[44px]',
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
      {children}
    </button>
  );
}

// ============================================================================
// Semantic Status Indicator (Zero-Pill Text Discipline with Explicit Label)
// ============================================================================
export function StatusText({ status }: { status: string }) {
  const normalized = (status || '').toLowerCase();
  let color = 'text-slate-600';
  if (['active', 'published', 'present', 'completed', 'paid_manual', 'converted', 'approved'].includes(normalized)) {
    color = 'text-emerald-700';
  } else if (
    [
      'trial',
      'late',
      'draft',
      'pending',
      'under_review',
      'more_info_required',
      'grace_readonly',
      'needs_correction',
      'maintenance',
      'on_leave',
      'contacted',
      'scheduled',
    ].includes(normalized)
  ) {
    color = 'text-amber-700';
  } else if (
    ['suspended', 'expired', 'absent', 'overdue', 'cancelled', 'withdrawn', 'rejected', 'inactive', 'archived', 'dismissed'].includes(
      normalized,
    )
  ) {
    color = 'text-red-700';
  } else if (['reviewed', 'submitted', 'promoted', 'transferred', 'new'].includes(normalized)) {
    color = 'text-blue-700';
  }

  const label = status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return <span className={`text-xs font-semibold tracking-tight transition-colors duration-200 ${color}`}>{label}</span>;
}

// ============================================================================
// Single-Elevation Metric Card (Subtle Elevation & Border Highlight on Hover)
// ============================================================================
export function StatCard({
  label,
  value,
  subtext,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  subtext?: string;
  tone?: 'default' | 'teal' | 'amber' | 'red';
}) {
  const valColor =
    tone === 'teal'
      ? 'text-teal-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'red'
          ? 'text-red-700'
          : 'text-slate-900';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-2 transition-all duration-200 hover:border-slate-300 hover:shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-2xl font-bold font-display tabular-nums tracking-tight ${valColor}`}>
        {value}
      </p>
      {subtext && <p className="text-xs text-slate-500 truncate">{subtext}</p>}
    </div>
  );
}

// ============================================================================
// Modal & Confirmation Dialog (Backdrop Fade + 0.98->1 Scale + Focus Return)
// ============================================================================
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Move focus into dialog container for keyboard accessibility
    const timer = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 30);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={getModalBackdropVariants(prefersReducedMotion)}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            variants={getModalDialogVariants(prefersReducedMotion)}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`bg-white border border-slate-200 rounded-xl shadow-xl w-full ${maxWidth} max-h-[90vh] flex flex-col focus:outline-none`}
          >
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200">
              <div>
                <h2 id="modal-title" className="text-base font-bold font-display text-slate-900">
                  {title}
                </h2>
                {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1 rounded-lg transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  warning,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  warning?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
      {warning && (
        <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
          {warning}
        </div>
      )}
      <div className="mt-6 flex items-center justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
          {busy ? 'Processing…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ============================================================================
// Loading Skeletons & Empty State
// ============================================================================
export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="h-3 bg-slate-100 rounded w-1/2" />
          <div className="h-7 bg-slate-200/70 rounded w-2/5" />
          <div className="h-3 bg-slate-100 rounded w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden animate-pulse">
      <div className="h-10 bg-slate-50 border-b border-slate-200" />
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="grid gap-4 px-5 py-3.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: cols }).map((__, c) => (
              <div key={c} className="h-4 bg-slate-100 rounded w-3/4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-6 py-12 text-center">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{description}</p>
      {actionLabel && onAction && (
        <div className="mt-5">
          <Button variant="primary" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Pagination Controls
// ============================================================================
export function PaginationBar({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (next: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-4 pt-4 text-xs text-slate-500">
      <span className="tabular-nums">
        Page {page} of {totalPages} · {totalItems} records
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
