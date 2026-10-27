import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Badge,
  buttonClass,
  Checkbox,
  cn,
  DataTable,
  EmptyState,
  FormMessage,
  Money,
  SelectField,
  TextField,
  ThemeStyle,
} from './components';

describe('components', () => {
  it('cn skips falsy parts', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('buttonClass composes variant and size', () => {
    expect(buttonClass()).toBe('btn-primary');
    expect(buttonClass('danger', 'sm', 'w-full')).toBe('btn-danger btn-sm w-full');
  });

  it('TextField links label, hint and error', () => {
    const html = renderToStaticMarkup(
      <TextField label="Email" name="email" hint="We send a link" error="Required" />,
    );
    expect(html).toContain('for="f-email"');
    expect(html).toContain('id="f-email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="f-email-hint f-email-error"');
    expect(html).toContain('id="f-email-error"');
  });

  it('TextField without hint or error has no aria-describedby', () => {
    const html = renderToStaticMarkup(<TextField label="Name" name="name" />);
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('aria-invalid');
  });

  it('SelectField renders a placeholder and options', () => {
    const html = renderToStaticMarkup(
      <SelectField
        label="Role"
        name="role"
        placeholder="Choose…"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true },
        ]}
      />,
    );
    expect(html).toContain('<option value="">Choose…</option>');
    expect(html).toContain('<option value="b" disabled="">B</option>');
  });

  it('Checkbox ids are unique per value', () => {
    const html = renderToStaticMarkup(
      <>
        <Checkbox label="A" name="perm" value="a.read" />
        <Checkbox label="B" name="perm" value="b.read" />
      </>,
    );
    expect(html).toContain('id="f-perm-a.read"');
    expect(html).toContain('id="f-perm-b.read"');
  });

  it('DataTable renders caption, scoped headers and row headers', () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="People"
        rows={[{ id: '1', name: 'Ann', total: 5 }]}
        rowKey={(r) => r.id}
        columns={[
          { key: 'name', header: 'Name', cell: (r) => r.name, rowHeader: true },
          { key: 'total', header: 'Total', cell: (r) => r.total, align: 'right' },
        ]}
      />,
    );
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('<th scope="row"');
    expect(html).toContain('Ann');
  });

  it('DataTable shows the empty state when there are no rows', () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="People"
        rows={[]}
        rowKey={() => 'x'}
        columns={[]}
        empty={<EmptyState title="Nobody yet" />}
      />,
    );
    expect(html).toContain('Nobody yet');
    expect(html).not.toContain('<table');
  });

  it('FormMessage uses alert for errors and status for success', () => {
    expect(renderToStaticMarkup(<FormMessage error="Bad" />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<FormMessage success="Saved" />)).toContain('role="status"');
    expect(renderToStaticMarkup(<FormMessage />)).toBe('');
  });

  it('Money formats with the tenant currency', () => {
    const html = renderToStaticMarkup(
      <Money minor={123456} tenant={{ currency: 'KES', locale: 'en-KE' }} />,
    );
    expect(html).toMatch(/1,234\.56/);
  });

  it('Badge and ThemeStyle render', () => {
    expect(renderToStaticMarkup(<Badge tone="success">Active</Badge>)).toContain('Active');
    expect(renderToStaticMarkup(<ThemeStyle theme="plum" />)).toContain('--brand:#a21caf');
  });
});
