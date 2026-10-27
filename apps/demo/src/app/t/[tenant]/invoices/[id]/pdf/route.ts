import { createInvoicePdfRoute } from '@kitto/billing/pdf';

// Membership, billing.view and RLS are checked per request.
export const dynamic = 'force-dynamic';

export const { GET } = createInvoicePdfRoute();
