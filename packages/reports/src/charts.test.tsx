import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BarChart, BarList, DonutChart, LineChart, StackedBar } from './charts';
import { canViewReport, reportsNav, visibleReportSections } from './shared';

const fmt = (n: number) => `KES ${n}`;

describe('charts', () => {
  it('BarChart is a named, described image with a data table fallback', () => {
    const html = renderToStaticMarkup(
      <BarChart
        title="Revenue per day"
        description="Collected KES 30 over 2 days."
        labelHeader="Day"
        labels={['1 Mar', '2 Mar']}
        series={[
          { name: 'Invoiced', values: [10, 0] },
          { name: 'Collected', values: [20, 10] },
        ]}
        format={fmt}
      />,
    );
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-labelledby="[^"]+-title"/);
    expect(html).toContain('<title id=');
    expect(html).toContain('>Revenue per day</title>');
    expect(html).toContain('>Collected KES 30 over 2 days.</desc>');
    expect(html.match(/<rect /g)).toHaveLength(4);
    expect(html).toContain('<title>2 Mar, Collected: KES 10</title>');
    expect(html).toContain('<table class="sr-only"><caption>Revenue per day</caption>');
    expect(html).toContain('<th scope="col">Day</th>');
    expect(html).toContain('<th scope="row">1 Mar</th><td>KES 10</td><td>KES 20</td>');
    expect(html).toContain('var(--brand)');
  });

  it('LineChart draws one path per series', () => {
    const html = renderToStaticMarkup(
      <LineChart
        title="New customers"
        description="3 added."
        labels={['a', 'b', 'c']}
        series={[{ name: 'Customers', values: [0, 1, 2] }]}
      />,
    );
    expect(html.match(/<path /g)).toHaveLength(1);
    expect(html.match(/<circle /g)).toHaveLength(3);
    expect(html).toContain('<th scope="row">c</th><td>2</td>');
  });

  it('DonutChart lists zero slices but only draws the others', () => {
    const html = renderToStaticMarkup(
      <DonutChart
        title="By method"
        description="All M-Pesa."
        slices={[
          { label: 'M-Pesa', value: 5 },
          { label: 'Cash', value: 0 },
        ]}
        centre="1"
      />,
    );
    expect(html).toContain('<title>M-Pesa: 5 (100%)</title>');
    expect(html).toContain('<th scope="row">Cash</th><td>0</td><td>0%</td>');
  });

  it('StackedBar and BarList render', () => {
    const stacked = renderToStaticMarkup(
      <StackedBar
        title="By status"
        description="4 reservations."
        slices={[
          { label: 'Confirmed', value: 3 },
          { label: 'Cancelled', value: 1 },
        ]}
      />,
    );
    expect(stacked).toContain('width="75"');
    expect(stacked).toContain('<title>Cancelled: 1 (25%)</title>');

    const list = renderToStaticMarkup(
      <BarList
        title="Top"
        rows={[
          { label: 'Tea', value: 50 },
          { label: 'Cake', value: 25 },
        ]}
      />,
    );
    expect(list).toContain('<figcaption');
    expect(list).toContain('width="50"');
    expect(list.match(/aria-hidden="true"/g)).toHaveLength(2);
  });
});

describe('permissions', () => {
  const ctx = (perms: string[]) => ({
    can: (p: string) => perms.includes(p),
    path: (p = '') => `/t/acme${p}`,
  });

  it('needs reports.view and the module permission', () => {
    expect(canViewReport(ctx(['reports.view', 'billing.view']), 'billing')).toBe(true);
    expect(canViewReport(ctx(['reports.view']), 'billing')).toBe(false);
    expect(canViewReport(ctx(['billing.view']), 'billing')).toBe(false);
  });

  it('filters sections and nav', () => {
    const c = ctx(['reports.view', 'billing.view', 'inventory.view']);
    expect(visibleReportSections(c)).toEqual(['revenue', 'payments', 'aging', 'stock']);
    expect(visibleReportSections(c, ['stock', 'booking'])).toEqual(['stock']);
    expect(reportsNav(c)).toEqual([{ href: '/t/acme/reports', label: 'Reports' }]);
    expect(reportsNav(ctx([]))).toEqual([]);
  });
});
