import { WifiOff } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-background">
      <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
        <WifiOff className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-bold">You&apos;re offline</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          No internet connection. Check your network and try again.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
