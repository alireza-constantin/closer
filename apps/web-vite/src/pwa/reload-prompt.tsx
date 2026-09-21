import { useRegisterSW } from "virtual:pwa-register/react";

export function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  if (needRefresh) {
    return (
      <aside aria-live="polite" className="max-w-closer-form fixed inset-x-4 bottom-4 z-50 mx-auto">
        <div className="text-closer-navy border-closer-navy/10 rounded-closer-card flex items-center justify-between gap-4 border bg-white p-4 shadow-lg">
          <p className="text-sm font-semibold">A Closer update is ready.</p>
          <div className="flex shrink-0 items-center gap-3">
            <button
              className="text-sm font-semibold underline underline-offset-4"
              onClick={() => setNeedRefresh(false)}
            >
              Later
            </button>
            <button
              className="bg-closer-coral rounded-full px-4 py-2 text-sm font-bold text-white"
              onClick={() => void updateServiceWorker(true)}
            >
              Reload
            </button>
          </div>
        </div>
      </aside>
    );
  }

  if (offlineReady) {
    return (
      <aside aria-live="polite" className="max-w-closer-form fixed inset-x-4 bottom-4 z-50 mx-auto">
        <div className="text-closer-navy border-closer-navy/10 rounded-closer-card flex items-center justify-between gap-4 border bg-white p-4 shadow-lg">
          <p className="text-sm font-semibold">Closer is ready to open offline.</p>
          <button
            className="text-sm font-semibold underline underline-offset-4"
            onClick={() => setOfflineReady(false)}
          >
            Dismiss
          </button>
        </div>
      </aside>
    );
  }

  return null;
}
