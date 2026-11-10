import { Button } from '@/components/ui/button';
/** A short message at the bottom of the screen, with an optional action such as Undo. */
export function Toast({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {action && (
        <Button type="button" variant="link" className="h-auto p-0" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
