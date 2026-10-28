const root = document.documentElement;
const STORAGE_KEY = 'kitto-theme';
type Theme = 'light' | 'dark';

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const toggle = document.getElementById('theme-toggle');

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  if (root.dataset.theme !== theme) {
    root.dataset.theme = theme;
    document.dispatchEvent(new CustomEvent('kitto:theme', { detail: theme }));
  }
  toggle?.setAttribute('aria-pressed', String(theme === 'dark'));
}

apply(stored() ?? (systemDark.matches ? 'dark' : 'light'));

toggle?.addEventListener('click', () => {
  const next: Theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  apply(next);
});

systemDark.addEventListener('change', (event) => {
  if (!stored()) apply(event.matches ? 'dark' : 'light');
});

// Small screens: the primary nav collapses behind a menu button.
const menu = document.getElementById('menu-toggle');
const nav = document.getElementById('site-nav');
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  nav?.classList.toggle('open', open);
});
nav?.addEventListener('click', (event) => {
  if (
    (event.target as HTMLElement).closest('a') &&
    menu?.getAttribute('aria-expanded') === 'true'
  ) {
    menu.setAttribute('aria-expanded', 'false');
    nav.classList.remove('open');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    menu.setAttribute('aria-expanded', 'false');
    nav?.classList.remove('open');
    menu.focus();
  }
});

// Docs: "On this page" starts open where there is room for it.
const toc = document.querySelector<HTMLDetailsElement>('details.toc');
if (toc && matchMedia('(min-width: 64rem)').matches) toc.open = true;
