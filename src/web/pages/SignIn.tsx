import { Mark } from '../components/Icon';

const MESSAGES: Record<string, string> = {
  private: 'This library is private',
  failed: 'Sign-in failed, please try again',
  deleting: 'Your account is being deleted, try again in a few minutes',
};

/** The sign-in page: one action, and the reason a previous attempt was refused. */
export function SignIn() {
  const query = new URLSearchParams(window.location.search);
  const error = query.get('error');
  const message = error ? MESSAGES[error] : undefined;
  const deleted = query.get('deleted') === '1';
  return (
    <main className="signin">
      <div className="signin-card">
        <Mark size={48} />
        <h1>Alexandria</h1>
        <p className="lead">Your links, kept and found again.</p>
        {deleted && (
          <p className="q-flash" role="status">
            Your account and all its data are being deleted.
          </p>
        )}
        {message && (
          <p className="notice q-flash q-flash--danger" role="alert">
            {message}
          </p>
        )}
        <div className="signin-box q-box q-box-body">
          <a className="q-btn q-btn--primary q-btn--block" href="/auth/google">
            Sign in with Google
          </a>
        </div>
      </div>
    </main>
  );
}
