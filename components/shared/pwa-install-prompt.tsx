'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const LAST_SHOWN_KEY = 'pwa-install-last-shown';
const INSTALLED_KEY = 'pwa-install-dismissed-permanently';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function todayStr(): string {
  return new Date().toDateString();
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own installed-PWA flag
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function PwaInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(INSTALLED_KEY) === 'true') return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);

      if (localStorage.getItem(LAST_SHOWN_KEY) === todayStr()) return;
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }

    function onAppInstalled() {
      localStorage.setItem(INSTALLED_KEY, 'true');
      setVisible(false);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(LAST_SHOWN_KEY, todayStr());
    setVisible(false);
  }

  async function handleInstall() {
    if (!deferredEvent) return;
    setInstalling(true);
    localStorage.setItem(LAST_SHOWN_KEY, todayStr());
    try {
      await deferredEvent.prompt();
      const { outcome } = await deferredEvent.userChoice;
      if (outcome === 'accepted') localStorage.setItem(INSTALLED_KEY, 'true');
    } finally {
      setInstalling(false);
      setVisible(false);
      setDeferredEvent(null);
    }
  }

  if (!visible || !deferredEvent) return null;

  return (
    <div
      className={cn(
        'fixed bottom-5 right-5 z-[200] w-[320px] animate-fade-in-up rounded-2xl border border-border/60',
        'bg-background/95 p-4 shadow-2xl shadow-black/15 backdrop-blur-sm',
      )}
    >
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground hover:rotate-90"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">Install Counselling CRM</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Install this as an app for faster, full-screen access from your home screen or desktop.
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={dismiss}
          className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
        >
          Not now
        </button>
        <button
          onClick={handleInstall}
          disabled={installing}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:-translate-y-0.5 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Install
        </button>
      </div>
    </div>
  );
}
