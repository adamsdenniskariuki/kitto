import type { Metadata } from 'next';
import { OnboardingForm } from '@kitto/auth/client';
import { readConfig } from '@kitto/auth';
import { requireUser } from '@kitto/auth/server';
import { CenteredPage, Card } from '@kitto/ui';

export const metadata: Metadata = { title: 'Create a workspace' };

export default async function OnboardingPage() {
  await requireUser('/onboarding');
  const { tenant, siteUrl } = readConfig();
  const address =
    tenant.mode === 'subdomain'
      ? { addressSuffix: `.${tenant.rootDomain}` }
      : { addressPrefix: `${new URL(siteUrl).host}/t/` };
  return (
    <CenteredPage>
      <h1 className="mb-2 text-2xl font-bold">Create a workspace</h1>
      <p className="mb-6 text-muted">
        A workspace holds one business&apos;s data, staff and settings. You&apos;ll be its owner.
      </p>
      <Card>
        <OnboardingForm {...address} />
      </Card>
    </CenteredPage>
  );
}
