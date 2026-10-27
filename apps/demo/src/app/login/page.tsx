import type { Metadata } from 'next';
import { LoginForm } from '@kitto/auth/client';
import { Alert, CenteredPage, Card } from '@kitto/ui';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next, error } = await searchParams;
  return (
    <CenteredPage>
      <h1 className="mb-2 text-2xl font-bold">Sign in</h1>
      <p className="mb-6 text-muted">
        We&apos;ll email you a link. No password needed; new here? The link creates your account.
      </p>
      {error === 'link' && (
        <div className="mb-4">
          <Alert tone="danger">
            That sign-in link is invalid or has expired. Request a new one.
          </Alert>
        </div>
      )}
      <Card>
        <LoginForm {...(typeof next === 'string' ? { next } : {})} />
      </Card>
    </CenteredPage>
  );
}
