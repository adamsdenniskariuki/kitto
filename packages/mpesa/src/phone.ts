/**
 * Kenyan mobile numbers in Daraja's format, 2547XXXXXXXX / 2541XXXXXXXX.
 * Accepts what people type: 0712 345 678, 712345678, +254-712-345678,
 * 254712345678. Anything else (landlines, other countries) is null, because
 * only Safaricom mobiles can receive an STK prompt.
 */
export function toDarajaPhone(input: string): string | null {
  const digits = input.trim().replace(/[\s().-]/g, '');
  const m = /^(?:\+?254|0)?([17]\d{8})$/.exec(digits);
  return m ? `254${m[1]}` : null;
}

/** "254712345678" -> "+254 712 345 678", for showing a stored number. */
export function formatDarajaPhone(phone: string): string {
  const m = /^254(\d{3})(\d{3})(\d{3})$/.exec(phone);
  return m ? `+254 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

/** "254712345678" -> "+254 7•• ••• 678": enough for staff to recognise, not to copy. */
export function maskDarajaPhone(phone: string): string {
  const m = /^254(\d)\d{5}(\d{3})$/.exec(phone);
  return m ? `+254 ${m[1]}•• ••• ${m[2]}` : '•••';
}
