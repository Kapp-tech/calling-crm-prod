'use client';

import { useCallback } from 'react';
import { toast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';

const UNDO_WINDOW_MS = 5000;

/**
 * Gmail-style undoable actions, replacing confirm() popups.
 *
 * Flow: the caller optimistically updates the UI (e.g. hides the row), we show
 * a toast with an Undo button, and only after the 5s window closes do we run
 * the real (irreversible) API call. Undo cancels the timer and the caller
 * restores the UI — the server is never touched.
 */
export function useUndoable() {
  return useCallback(
    (opts: {
      title: string;
      description?: string;
      /** The real, irreversible work — runs after the undo window closes. */
      onExecute: () => void;
      /** Restore the optimistic UI change. */
      onUndo?: () => void;
    }) => {
      let undone = false;
      const timer = setTimeout(() => {
        if (!undone) opts.onExecute();
      }, UNDO_WINDOW_MS);

      const t = toast({
        title: opts.title,
        description: opts.description,
        duration: UNDO_WINDOW_MS,
        action: (
          <ToastAction
            altText="Undo"
            onClick={() => {
              undone = true;
              clearTimeout(timer);
              opts.onUndo?.();
              t.dismiss();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    [],
  );
}
