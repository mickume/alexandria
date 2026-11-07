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
        <button type="button" className="link-button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
