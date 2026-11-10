import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** What the owner is asked before something that cannot be undone. */
export interface Confirmation {
  /** The question. */
  title: string;
  /** What goes with it. */
  description: string;
  /** The button that goes ahead, such as 'Delete'. */
  action: string;
}

type Ask = (confirmation: Confirmation) => Promise<boolean>;

const ConfirmContext = createContext<Ask>(() => Promise.resolve(false));

/** Asks the owner to confirm; resolves true when they go ahead, false when they cancel or leave. */
export function useConfirm(): Ask {
  return useContext(ConfirmContext);
}

/** Shows the one dialog `useConfirm` asks with, over whatever page is under it. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [asked, setAsked] = useState<Confirmation | null>(null);
  const [open, setOpen] = useState(false);
  const resolve = useRef<(confirmed: boolean) => void>(() => undefined);

  const ask = useCallback<Ask>((confirmation) => {
    // A question still open is answered no by the next one.
    resolve.current(false);
    setAsked(confirmation);
    setOpen(true);
    return new Promise((answer) => {
      resolve.current = answer;
    });
  }, []);

  function answer(confirmed: boolean) {
    resolve.current(confirmed);
    resolve.current = () => undefined;
    setOpen(false);
  }

  return (
    <ConfirmContext value={ask}>
      {children}
      <AlertDialog open={open} onOpenChange={(next) => !next && answer(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{asked?.title}</AlertDialogTitle>
            <AlertDialogDescription>{asked?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => answer(true)}>
              {asked?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext>
  );
}
