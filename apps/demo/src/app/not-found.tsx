import Link from 'next/link';
import { CenteredPage, buttonClass } from '@kitto/ui';

export default function NotFound() {
  return (
    <CenteredPage>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <p className="mt-6">
        <Link href="/" className={buttonClass('secondary')}>
          Go home
        </Link>
      </p>
    </CenteredPage>
  );
}
