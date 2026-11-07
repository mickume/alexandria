const MESSAGES: Record<string, string> = {
  private: 'This library is private',
  failed: 'Sign-in failed, please try again',
};

/** The sign-in page: one action, and the reason a previous attempt was refused. */
export function SignIn() {
  const error = new URLSearchParams(window.location.search).get('error');
  const message = error ? MESSAGES[error] : undefined;
  return (
    <main className="page signin">
      <h1>Alexandria</h1>
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      <a className="button primary" href="/auth/google">
        Sign in with Google
      </a>
    </main>
  );
}
