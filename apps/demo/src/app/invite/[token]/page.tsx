import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { acceptInvitationAction } from '@kitto/auth/actions';
import { SignOutButton } from '@kitto/auth';
import { requireUser } from '@kitto/auth/server';
import { Alert, CenteredPage, Card } from '@kitto/ui';
import { SubmitButton } from '@kitto/ui/client';

export const metadata: Metadata = { title: 'Invitation' };

const ERRORS: Record<string, string> = {
  wrong_email:
    'This invitation was sent to a different email address. Sign out and open the link from that inbox.',
  invalid: 'This invitation is invalid, has been revoked, or has expired. Ask for a new one.',
};

export default async function InvitePage({ params, searchParams }: PageProps<'/invite/[token]'>) {
  const token = z.uuid().safeParse((await params).token);
  if (!token.success) notFound();
  const { user } = await requireUser(`/invite/${token.data}`);
  const { error } = await searchParams;
  const message = typeof error === 'string' ? ERRORS[error] : undefined;

  return (
    <CenteredPage>
      <h1 className="mb-2 text-2xl font-bold">You&apos;re invited</h1>
      <p className="mb-6 text-muted">
        Accept to join the workspace as <strong className="text-ink">{user.email}</strong>.
      </p>
      {message && (
        <div className="mb-4">
          <Alert tone="danger">{message}</Alert>
        </div>
      )}
      <Card className="space-y-4">
        <form action={acceptInvitationAction}>
          <input type="hidden" name="token" value={token.data} />
          <SubmitButton className="w-full" pendingLabel="Joining…">
            Accept invitation
          </SubmitButton>
        </form>
        <SignOutButton />
      </Card>
    </CenteredPage>
  );
}
