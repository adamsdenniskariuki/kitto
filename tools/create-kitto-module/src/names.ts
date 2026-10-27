/**
 * Names for a new module, derived from one kebab- or snake-case word such as
 * "vehicles", "ci-widgets" or "fleet_vehicles":
 *
 *   package   @kitto/ci-widgets         (packages/ci-widgets)
 *   table     public.ci_widgets          permission keys ci_widgets.view, ...
 *   route     /t/<tenant>/ci-widgets
 *   code      CI_WIDGET_PERMISSIONS, CiWidgetsPage, getCiWidget, ciWidgetsNav, ...
 */
export interface ModuleNames {
  /** As typed, normalised to kebab case: package folder and URL segment. */
  kebab: string;
  /** Table name, permission prefix and SQL identifiers. */
  snake: string;
  /** Singular snake case (record id column names, test helpers). */
  singularSnake: string;
  /** "ciWidgets" */
  camel: string;
  /** "CiWidgets" */
  pascal: string;
  /** "ciWidget" */
  singularCamel: string;
  /** "CiWidget" */
  singularPascal: string;
  /** "CI_WIDGET" */
  singularConst: string;
  /** "Ci widgets" (headings, nav) */
  title: string;
  /** "ci widgets" (sentences) */
  lower: string;
  /** "Ci widget" */
  singularTitle: string;
  /** "ci widget" */
  singularLower: string;
}

const NAME_RE = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
export const MAX_NAME_LENGTH = 40;

/**
 * Names that would clash with Kitto packages, demo routes, core tables or SQL
 * keywords. Existing packages, tables and routes are checked separately.
 */
export const RESERVED_NAMES = new Set([
  // packages and tools
  'core',
  'auth',
  'ui',
  'admin',
  'reports',
  'customers',
  'booking',
  'bookings',
  'billing',
  'invoices',
  'payments',
  'mpesa',
  'inventory',
  'orders',
  'demo',
  'kitto',
  'create-kitto-module',
  // core tables and routes
  'tenants',
  'tenant',
  'tenant-members',
  'members',
  'roles',
  'permissions',
  'role-permissions',
  'invitations',
  'audit',
  'audit-log',
  'users',
  'user',
  'staff',
  'settings',
  'onboarding',
  'login',
  'logout',
  'auth-callback',
  'api',
  'new',
  't',
  // Postgres reserved words and schemas
  'all',
  'analyse',
  'analyze',
  'and',
  'any',
  'array',
  'as',
  'asc',
  'check',
  'column',
  'constraint',
  'create',
  'default',
  'desc',
  'distinct',
  'do',
  'else',
  'end',
  'except',
  'false',
  'fetch',
  'for',
  'foreign',
  'from',
  'grant',
  'group',
  'having',
  'in',
  'into',
  'is',
  'limit',
  'not',
  'null',
  'offset',
  'on',
  'only',
  'or',
  'order',
  'primary',
  'references',
  'returning',
  'select',
  'some',
  'table',
  'then',
  'to',
  'true',
  'union',
  'unique',
  'using',
  'when',
  'where',
  'window',
  'with',
  'public',
  'private',
  'extensions',
  'storage',
  'realtime',
  'graphql',
  'tests',
]);

/** Throws a readable error unless `input` is a usable module name. */
export function validateModuleName(input: string): string {
  const name = input.trim().toLowerCase();
  if (!NAME_RE.test(name))
    throw new Error(
      `"${input}" is not a valid module name: use lower-case words separated by "-" or "_", ` +
        'starting with a letter (e.g. vehicles, fleet-vehicles).',
    );
  if (name.length > MAX_NAME_LENGTH)
    throw new Error(`"${input}" is too long: keep module names to ${MAX_NAME_LENGTH} characters.`);
  const kebab = name.replace(/_/g, '-');
  if (RESERVED_NAMES.has(kebab) || RESERVED_NAMES.has(kebab.replace(/-/g, '_')))
    throw new Error(`"${input}" is reserved (a Kitto package, core table, route or SQL keyword).`);
  return kebab;
}

/** English singular of the last word: vehicles -> vehicle, categories -> category. */
export function singularize(word: string): string {
  if (/(?:ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && word.length > 1) return word.slice(0, -1);
  return word;
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * Every spelling of a module name the templates need. `singular` overrides
 * the guessed singular (e.g. --singular person for "people").
 */
export function moduleNames(input: string, singular?: string): ModuleNames {
  const kebab = validateModuleName(input);
  const words = kebab.split('-');
  const singularWords = singular
    ? validateModuleName(singular).split('-')
    : [...words.slice(0, -1), singularize(words.at(-1)!)];
  if (singularWords.join('-') === kebab)
    throw new Error(
      `"${input}" has no distinct singular; pass a plural name (e.g. "${kebab}s") or --singular.`,
    );
  const camel = (ws: string[]) => ws[0]! + ws.slice(1).map(cap).join('');
  const sentence = (ws: string[]) => ws.join(' ');
  return {
    kebab,
    snake: words.join('_'),
    singularSnake: singularWords.join('_'),
    camel: camel(words),
    pascal: words.map(cap).join(''),
    singularCamel: camel(singularWords),
    singularPascal: singularWords.map(cap).join(''),
    singularConst: singularWords.join('_').toUpperCase(),
    title: cap(sentence(words)),
    lower: sentence(words),
    singularTitle: cap(sentence(singularWords)),
    singularLower: sentence(singularWords),
  };
}
