import { expect, test, type Page } from '@playwright/test';
import { createWorkspace, expectNoSideScroll, uniqueEmail, uniqueSlug } from './helpers';

// Far enough ahead that "now" never gets in the way of free slots.
const DAY = '2030-01-15';

async function addResource(page: Page, home: string, name: string, capacity: string) {
  await page.goto(`${home}/bookings/resources`);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Kind').fill('room');
  await page.getByLabel('Capacity').fill(capacity);
  await page.getByLabel(/^Rate/).fill('4,500');
  await page.getByLabel('Charged').selectOption({ label: 'per night' });
  await page.getByRole('button', { name: 'Add resource' }).click();
  await expect(page.getByText('Resource added.')).toBeVisible();
  return page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;
}

test('booking: resources, free slots, reservations, no double-booking, status flow', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const home = await createWorkspace(
    page,
    uniqueEmail('owner'),
    'Garden Hotel',
    uniqueSlug('garden'),
  );

  // A customer to book for.
  await page.goto(`${home}/customers/new`);
  await page.getByLabel('Name').fill('Otieno Odhiambo');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Customer added.')).toBeVisible();
  const customer = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

  // Nothing bookable yet.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Bookings' })
    .click();
  await expect(page.getByText('Nothing to book yet')).toBeVisible();

  const room = await addResource(page, home, 'Room 101', '2');
  await expect(page.getByText('Open around the clock.')).toBeVisible();
  const roomId = room.split('/').pop()!;

  // Limit the room to 08:00-12:00 on the 15th's weekday (Tuesday), then pick a slot.
  await page.getByLabel('Day').selectOption({ label: 'Tuesday' });
  await page.getByLabel('Opens').fill('08:00');
  await page.getByLabel('Closes').fill('12:00');
  await page.getByRole('button', { name: 'Add hours' }).click();
  await expect(page.getByText('Opening hours added.')).toBeVisible();
  await expect(page.getByText('Tuesday 08:00–12:00')).toBeVisible();

  await page.goto(`${home}/bookings/new?resource=${roomId}&day=${DAY}&duration=60`);
  const slots = page.getByRole('list', { name: 'Free times for Room 101' });
  await expect(slots.getByRole('link')).toHaveText([
    '08:00',
    '08:30',
    '09:00',
    '09:30',
    '10:00',
    '10:30',
    '11:00',
  ]);
  await expectNoSideScroll(page);
  await slots.getByRole('link', { name: '10:00' }).click();
  await expect(page.getByLabel('Starts')).toHaveValue(`${DAY}T10:00`);
  await expect(page.getByLabel('Ends')).toHaveValue(`${DAY}T11:00`);

  await page.getByLabel('Customer').selectOption({ label: 'Otieno Odhiambo' });
  await page.getByLabel('Guests').fill('2');
  await page.getByLabel('Title').fill('Honeymoon');
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('Reservation made.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Room 101 · Honeymoon' })).toBeVisible();
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(page.getByText(/4,500/)).toBeVisible();
  const reservation = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

  // The slot is gone, and booking an overlapping time is refused by the database.
  await page.goto(`${home}/bookings/new?resource=${roomId}&day=${DAY}&duration=60`);
  await expect(slots.getByRole('link', { name: '10:00' })).toHaveCount(0);
  await expect(slots.getByRole('link', { name: '10:30' })).toHaveCount(0);
  await page.getByLabel('Starts').fill(`${DAY}T10:30`);
  await page.getByLabel('Ends').fill(`${DAY}T11:30`);
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('That time is already booked.', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`resource=${roomId}`));

  // Too many guests for the room.
  await page.getByLabel('Starts').fill(`${DAY}T08:00`);
  await page.getByLabel('Ends').fill(`${DAY}T09:00`);
  await page.getByLabel('Guests').evaluate((el) => el.removeAttribute('max'));
  await page.getByLabel('Guests').fill('3');
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('That is more guests than this resource holds.')).toBeVisible();

  // Status flow: confirmed -> checked in -> completed, then no more buttons.
  await page.goto(reservation);
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByText('Reservation updated.')).toBeVisible();
  await expect(page.getByText('Checked in', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel reservation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Status' })).toHaveCount(0);

  // The agenda and the customer's page both show it.
  await page.goto(`${home}/bookings?day=${DAY}`);
  await expect(page.getByRole('link', { name: 'Room 101 · Honeymoon' })).toBeVisible();
  await expectNoSideScroll(page);
  await page.goto(customer);
  await expect(page.getByRole('heading', { name: 'Reservations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Room 101' })).toBeVisible();

  // A booked resource can't be deleted; it can be made inactive.
  await page.goto(room);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete resource' }).click();
  await expect(page.getByText(/has reservations, so it cannot be deleted/)).toBeVisible();
});

test('booking: a weekly series is all-or-nothing, and cancelling frees the slot', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const home = await createWorkspace(page, uniqueEmail('owner'), 'Court Club', uniqueSlug('court'));
  const court = await addResource(page, home, 'Court 1', '4');
  const courtId = court.split('/').pop()!;

  // Book the third Tuesday on its own first.
  await page.goto(`${home}/bookings/new?resource=${courtId}&day=2030-01-29`);
  await page.getByLabel('Starts').fill('2030-01-29T18:00');
  await page.getByLabel('Ends').fill('2030-01-29T19:00');
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('Reservation made.')).toBeVisible();
  const single = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

  // A four-week series starting two weeks earlier clashes with it: nothing is booked.
  const bookSeries = async () => {
    await page.goto(`${home}/bookings/new?resource=${courtId}&day=${DAY}`);
    await page.getByLabel('Starts').fill(`${DAY}T18:00`);
    await page.getByLabel('Ends').fill(`${DAY}T19:00`);
    await page.getByLabel('Repeats').selectOption({ label: 'Every week' });
    await page.getByLabel('Times', { exact: true }).fill('4');
    await page.getByRole('button', { name: 'Book', exact: true }).click();
  };
  await bookSeries();
  await expect(page.getByText('That time is already booked.', { exact: false })).toBeVisible();
  await page.goto(`${home}/bookings?day=${DAY}`);
  await expect(page.getByRole('link', { name: 'Court 1' })).toHaveCount(0);

  // Cancel the single booking; now the series fits.
  await page.goto(single);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Cancel reservation' }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await bookSeries();
  await expect(page.getByText('Recurring reservations made.')).toBeVisible();
  await expect(page.getByText('Part of a recurring booking')).toBeVisible();
  await page.goto(`${home}/bookings?day=${DAY}`);
  await expect(page.getByRole('link', { name: 'Court 1' })).toHaveCount(1);
  await page.goto(`${home}/bookings?day=2030-01-29`);
  // The cancelled one and the series' third week.
  await expect(page.getByRole('link', { name: 'Court 1' })).toHaveCount(2);
});
