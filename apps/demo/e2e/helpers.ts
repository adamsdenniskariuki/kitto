import { expect, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:55324';

type MailpitSearch = { messages: { ID: string; Created: string }[] };
type MailpitMessage = { HTML: string };

/** Poll Mailpit for the newest email to `to` (sent after `after`) and return its sign-in link. */
export async function magicLinkFor(to: string, after = new Date(0)): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = (await (
          await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
        ).json()) as MailpitSearch;
        const latest = search.messages.find((m) => new Date(m.Created) >= after);
        if (!latest) return undefined;
        const msg = (await (
          await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)
        ).json()) as MailpitMessage;
        link = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML)?.[1]?.replaceAll('&amp;', '&');
        return link;
      },
      { message: `magic link email for ${to}`, timeout: 15_000 },
    )
    .toBeTruthy();
  return link!;
}

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.kitto.test`;
}

export function uniqueSlug(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Request a magic link from /login and follow it. */
export async function signIn(page: Page, email: string, next = '/') {
  const sentAt = new Date(Date.now() - 1000);
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  const sent = page.getByText('Check your inbox');
  const limited = page.getByText('Too many requests');
  // Auth allows one email per address per second (config.toml max_frequency).
  for (let attempt = 0; ; attempt++) {
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(sent.or(limited)).toBeVisible();
    if (await sent.isVisible()) break;
    expect(attempt, `still rate-limited sending a link to ${email}`).toBeLessThan(3);
    await page.waitForTimeout(1_500);
  }
  await page.goto(await magicLinkFor(email, sentAt));
}

/** Sign up a new user and create a workspace they own. Returns the workspace URL path. */
export async function createWorkspace(page: Page, email: string, name: string, slug: string) {
  await signIn(page, email, '/onboarding');
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  await page.getByLabel('Business name').fill(name);
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${slug}$`));
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return `/t/${slug}`;
}

/** Fail if anything (outside its own scroll container) pokes past the viewport. */
export async function expectNoSideScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const overflowing = await page.evaluate(
    (w) =>
      [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > w + 1)
        .filter((el) => {
          for (let a = el.parentElement; a; a = a.parentElement) {
            if (getComputedStyle(a).overflowX !== 'visible') return false;
          }
          return true;
        })
        .filter(
          (el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= w + 1,
        )
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`),
    width,
  );
  expect(overflowing, `elements wider than ${width}px`).toEqual([]);
  // Absolutely positioned descendants can escape a scroll container, so also check the document itself.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    'page scroll width',
  ).toBeLessThanOrEqual(width);
}
