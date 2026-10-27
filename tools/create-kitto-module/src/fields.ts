/**
 * Field specs: "make:text! year:int price:money notes:longtext".
 * A trailing "!" makes the field required.
 */
export const FIELD_TYPES = ['text', 'longtext', 'int', 'numeric', 'money', 'bool', 'date'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface Field {
  /** snake_case form field, schema key and (except money) column name. */
  name: string;
  type: FieldType;
  required: boolean;
  /** Database column: `<name>_minor` for money, else the name. */
  column: string;
  /** "Purchase price" */
  label: string;
}

export const DEFAULT_FIELDS = 'name:text! notes:longtext';

/** Column names every module table already has (or that would confuse PostgREST). */
const RESERVED_COLUMNS = new Set([
  'id',
  'tenant_id',
  'tenant',
  'created_by',
  'created_at',
  'updated_at',
  'select',
  'order',
  'limit',
  'offset',
  'or',
  'and',
  'not',
  'from',
  'to',
  'user',
  'table',
  'group',
  'check',
  'default',
  'q',
  'page',
  'notice',
  'error',
]);

const FIELD_RE = /^([a-z][a-z0-9_]*):([a-z]+)(!?)$/;

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

function parseField(spec: string): Field {
  const m = FIELD_RE.exec(spec);
  if (!m)
    throw new Error(
      `Bad field "${spec}": write name:type or name:type! (required), e.g. make:text! year:int.`,
    );
  const [, name, rawType, bang] = m as unknown as [string, string, string, string];
  if (!(FIELD_TYPES as readonly string[]).includes(rawType))
    throw new Error(`Unknown type "${rawType}" for ${name}: use one of ${FIELD_TYPES.join(', ')}.`);
  if (name.length > 40) throw new Error(`Field name "${name}" is too long (max 40).`);
  if (/__|_$/.test(name)) throw new Error(`Field name "${name}" has a stray underscore.`);
  if (RESERVED_COLUMNS.has(name))
    throw new Error(`"${name}" is reserved; choose another field name.`);
  const type = rawType as FieldType;
  const words = name.split('_');
  return {
    name,
    type,
    // A checkbox is always true or false.
    required: type === 'bool' ? true : bang === '!',
    column: type === 'money' ? `${name}_minor` : name,
    label: cap(words.join(' ')),
  };
}

/** Parse a field list; the first required text field becomes each record's title. */
export function parseFields(input: string = DEFAULT_FIELDS): Field[] {
  const specs = input.split(/[\s,]+/).filter(Boolean);
  if (specs.length === 0) throw new Error('Give at least one field, e.g. --fields "name:text!".');
  if (specs.length > 30) throw new Error('At most 30 fields; split the module up instead.');
  const fields = specs.map(parseField);
  const seen = new Set<string>();
  for (const f of fields) {
    for (const key of [f.name, f.column]) {
      if (seen.has(key)) throw new Error(`Field "${f.name}" clashes with another field.`);
    }
    seen.add(f.name).add(f.column);
  }
  if (!fields.some(isTitleCandidate))
    throw new Error(
      'Include a required text field (e.g. name:text!): it names each record in lists and headings.',
    );
  return fields;
}

const isTitleCandidate = (f: Field) => f.type === 'text' && f.required;

/** The field that names a record. */
export function titleField(fields: readonly Field[]): Field {
  return fields.find(isTitleCandidate)!;
}

/** Maximum length of text columns. */
export const TEXT_MAX = { text: 200, longtext: 2000 } as const;
