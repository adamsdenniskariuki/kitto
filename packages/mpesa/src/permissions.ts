/** Permission keys used by the M-Pesa module (`mpesa.request` is registered by its migration). */
export const MPESA_PERMISSIONS = {
  request: 'mpesa.request',
  /** Seeing requests on an invoice needs the billing read permission. */
  view: 'billing.view',
} as const;
