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
        <Mark size={40} />
        <h1>Alexandria</h1>
        <p className="lead">
          Your links, <span className="soft">kept and found again.</span>
        </p>
        {deleted && <p role="status">Your account and all its data are being deleted.</p>}
        {message && (
          <p className="notice" role="alert">
            {message}
          </p>
        )}
        <a className="button primary" href="/auth/google">
          Sign in with Google
        </a>
      </div>
    </main>
  );
}
