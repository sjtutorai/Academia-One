import React, { useState } from 'react';
import { Download, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar' | 'compact';
  className?: string;
}

export function PWAInstallButton({
  variant = 'header',
  className = '',
}: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;
  if (!isInstallable && !isIOS) return null;

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  const buttonClasses =
    variant === 'sidebar'
      ? 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-blue-100 bg-blue-800/60 hover:bg-blue-700/80 hover:text-white transition-colors cursor-pointer min-h-[40px]'
      : variant === 'compact'
        ? 'inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer whitespace-nowrap shrink-0 min-h-[36px]'
        : 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer whitespace-nowrap shrink-0 min-h-[38px]';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`${buttonClasses} ${className}`}
        aria-label="Install AcademiaOne app"
      >
        {isIOS && !isInstallable ? (
          <Smartphone className="w-4 h-4 shrink-0" />
        ) : (
          <Download className="w-4 h-4 shrink-0" />
        )}
        <span>{variant === 'compact' ? 'Install' : 'Install App'}</span>
      </button>

      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/55 backdrop-blur-[1px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowIOSGuide(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-title"
        >
          <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-xl bg-white border border-slate-200 p-6 safe-bottom shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="ios-install-title" className="text-base font-bold font-display text-[#0F295C]">
                  Install AcademiaOne on iPhone or iPad
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Add AcademiaOne to your home screen for full-screen access.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close install instructions"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ol className="mt-4 space-y-3 text-sm text-slate-700">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  1
                </span>
                <span>
                  Tap the <strong className="inline-flex items-center gap-1 text-slate-900"><Share className="w-3.5 h-3.5" /> Share</strong> button in Safari&apos;s toolbar.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  2
                </span>
                <span>
                  Scroll down and tap <strong className="text-slate-900">Add to Home Screen</strong>.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  3
                </span>
                <span>
                  Tap <strong className="text-slate-900">Add</strong> in the top-right corner to launch as an app.
                </span>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="mt-5 w-full rounded-lg bg-[#0F295C] py-2.5 text-sm font-medium text-white hover:bg-[#17397A] transition-colors cursor-pointer min-h-[44px]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white shadow-lg border border-slate-700"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span>Offline mode — changes will sync when reconnected.</span>
    </div>
  );
}
