import { Mark } from '../components/Icon';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
          <Alert role="status">
            <AlertDescription>Your account and all its data are being deleted.</AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        <Card className="signin-box p-4 shadow-none">
          <a className={cn(buttonVariants(), 'w-full')} href="/auth/google">
            Sign in with Google
          </a>
        </Card>
      </div>
    </main>
  );
}
