/** A short message at the bottom of the screen, with an optional action such as Undo. */
export function Toast({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="q-toast toast" role="status">
      <span>{message}</span>
      {action && (
        <button type="button" className="q-btn-link" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
