import { X } from "lucide-react";
import { StudioToast } from "../stores/useStudioStores";

interface ToastStackProps {
  toasts: StudioToast[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((t) => {
        const borderTone =
          t.type === "error"
            ? "border-red-500/60 bg-slate-900/95 text-red-100"
            : t.type === "warning"
            ? "border-amber-500/60 bg-slate-900/95 text-amber-100"
            : t.type === "success"
            ? "border-emerald-500/60 bg-slate-900/95 text-emerald-100"
            : "border-slate-700 bg-slate-900/95 text-slate-100";

        return (
          <div
            key={t.id}
            className={`pointer-events-auto border rounded-md p-3 shadow-lg text-xs ${borderTone}`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="leading-relaxed">{t.message}</p>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                className="text-slate-400 hover:text-slate-100 shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {t.traceback && (
              <details className="mt-2 text-[11px] font-mono text-slate-300">
                <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                  View error details
                </summary>
                <pre className="mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto bg-slate-950 p-2 rounded border border-slate-800">
                  {t.traceback}
                </pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
