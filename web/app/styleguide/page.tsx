import type { Metadata } from 'next';
import { PageShell } from '@/components/info/PageShell';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  DataTable,
  EmptyState,
  Field,
  Input,
  LabeledInput,
  Marker,
  Panel,
  PanelBody,
  PanelHeader,
  SectionHeading,
  Select,
  Textarea,
} from '@/components/ui';

export const metadata: Metadata = {
  title: 'Styleguide',
  description: 'Internal reference for the design system: tokens and primitives in every state.',
  robots: { index: false, follow: false },
};

const TOKEN_GROUPS: { name: string; tokens: [string, string][] }[] = [
  {
    name: 'Color',
    tokens: [
      ['--ink', 'Body text'],
      ['--muted', 'Secondary text'],
      ['--muted-2', 'Fixture / emphasis-muted text'],
      ['--line', 'Hairline borders'],
      ['--line-strong', 'Stronger hairline (fixture rule, callout rule)'],
      ['--soft', 'Soft fill (notes, panel headers, hover)'],
      ['--paper', 'Card/panel surface'],
      ['--bg', 'Page background'],
      ['--blue', 'Primary action / links'],
      ['--blue-dark', 'Primary hover'],
      ['--blue-tint', 'Info callout fill'],
      ['--blue-line', 'Info callout / token border'],
      ['--navy', 'Masthead rule, headings-on-dark'],
      ['--green', "'Added' label"],
      ['--amber', "'Redacted' label"],
      ['--red', "'Removed' / error"],
      ['--red-tint', 'Error callout fill'],
    ],
  },
  {
    name: 'Type scale',
    tokens: [
      ['--text-2xs', '10px — derived labels, badges'],
      ['--text-xs', '11px — eyebrow, small'],
      ['--text-sm', '12px — field labels, dense UI'],
      ['--text-md', '13px — nav, tabs'],
      ['--text-base', '14px — body'],
      ['--text-lg', '15px — subtitle, h3'],
      ['--text-xl', '17px — h3-large / limits h2'],
      ['--text-2xl', '20px — section heading'],
      ['--text-3xl', '25px — viewer h1'],
      ['--text-4xl', '36px — page h1'],
    ],
  },
  {
    name: 'Spacing',
    tokens: [
      ['--space-1', '4px'],
      ['--space-2', '8px'],
      ['--space-3', '12px'],
      ['--space-4', '16px'],
      ['--space-5', '20px'],
      ['--space-6', '24px'],
      ['--space-7', '32px'],
      ['--space-8', '40px'],
      ['--space-9', '48px'],
    ],
  },
  {
    name: 'Borders, radii, focus, z-index',
    tokens: [
      ['--border-width', '1px hairline'],
      ['--radius-sm', '2px'],
      ['--radius-md', '3px'],
      ['--focus-ring-width', '2px'],
      ['--focus-ring-color', 'var(--blue)'],
      ['--z-nav', '20'],
      ['--z-peek', '60'],
      ['--z-dialog', '80'],
      ['--z-toast', '100'],
    ],
  },
];

interface Row {
  bates: string;
  folder: string;
  pages: number;
}
const SAMPLE_ROWS: Row[] = [
  { bates: 'NYC-WTC_900058160', folder: 'Liberty St. — air monitoring', pages: 12 },
  { bates: 'NYC-WTC_900061442', folder: 'Cedar St. — inspection log', pages: 4 },
  { bates: 'NYC-WTC_900070118', folder: 'Correspondence — EPA/DEP', pages: 7 },
];

export default function Styleguide() {
  return (
    <PageShell active="/styleguide" prose={false}>
      <div className="page-title">
        <div>
          <div className="eyebrow">Internal reference · noindex</div>
          <h1>Styleguide</h1>
          <p className="subtitle">
            Every primitive in web/components/ui in every state, next to the tokens they read. See{' '}
            <code>web/DESIGN.md</code> for the write-up.
          </p>
        </div>
      </div>

      <section className="stack-lg">
        <SectionHeading eyebrow="Tokens" title="Color, type, spacing, borders" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-6)' }}>
          {TOKEN_GROUPS.map((group) => (
            <div key={group.name}>
              <h3 className="mt-4">{group.name}</h3>
              <div className="table-wrap mt-2">
                <table className="data-table dense">
                  <tbody>
                    {group.tokens.map(([token, note]) => (
                      <tr key={token}>
                        <td className="mono">
                          {group.name === 'Color' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span
                                aria-hidden
                                style={{
                                  display: 'inline-block',
                                  width: 14,
                                  height: 14,
                                  border: '1px solid var(--line)',
                                  background: `var(${token})`,
                                }}
                              />
                              {token}
                            </span>
                          ) : (
                            token
                          )}
                        </td>
                        <td className="small muted">{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack-lg mt-7">
        <SectionHeading eyebrow="Primitive" title="Button" />
        <Panel>
          <PanelBody className="stack">
            <div className="actions">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="quiet">Quiet</Button>
              <Button variant="dark">Dark</Button>
            </div>
            <div className="actions">
              <Button variant="primary" size="small">
                Small
              </Button>
              <Button variant="primary">Default</Button>
              <Button variant="primary" size="large">
                Large
              </Button>
            </div>
            <div className="actions">
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <Button variant="secondary" aria-disabled="true">
                Aria-disabled
              </Button>
              <ButtonLink variant="secondary" href="/search">
                As link →
              </ButtonLink>
            </div>
            <p className="small muted">Tab to a button above to see the focus ring (2px solid var(--blue)).</p>
          </PanelBody>
        </Panel>
      </section>

      <section className="stack-lg mt-7">
        <SectionHeading eyebrow="Primitive" title="Field, Input, Select, Textarea" />
        <Panel>
          <PanelBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-5)' }}>
              <LabeledInput label="Default" placeholder="Type here" />
              <LabeledInput label="With help text" help="Help text explains the expected format." placeholder="NYC-WTC_900000001" />
              <LabeledInput label="With error" error="Enter a valid Bates number." defaultValue="not-a-bates-number" />
              <LabeledInput label="Disabled" placeholder="Disabled" disabled />
              <Field label="Select">
                <Select defaultValue="date">
                  <option value="date">Date</option>
                  <option value="relevance">Relevance</option>
                </Select>
              </Field>
              <Field label="Textarea" help="Resizable, monospace when holding exported data.">
                <Textarea defaultValue={'NYC-WTC_900058160,12,Liberty St.'} />
              </Field>
            </div>
          </PanelBody>
        </Panel>
      </section>

      <section className="stack-lg mt-7">
        <SectionHeading eyebrow="Primitive" title="Panel, PanelHeader, SectionHeading" />
        <Panel>
          <PanelHeader title="Panel header" action={<Button size="small">Action</Button>} />
          <PanelBody>
            <p>Bordered surface, no shadow. Use for grouped content that needs a visible edge — side panels, facet groups, export dialogs' inline previews.</p>
          </PanelBody>
        </Panel>
        <div className="mt-5">
          <SectionHeading eyebrow="Eyebrow" title="Section heading, no action" />
          <p className="small muted">The plain eyebrow + h2 pattern used at the top of most page sections.</p>
        </div>
      </section>

      <section className="stack-lg mt-7">
        <SectionHeading eyebrow="Primitive" title="Badge, Marker" />
        <Panel>
          <PanelBody>
            <div className="actions">
              <Badge>Neutral</Badge>
              <Badge tone="blue">Collection</Badge>
              <Badge tone="green">Added</Badge>
              <Badge tone="red">Removed</Badge>
              <Badge tone="amber">Redacted</Badge>
            </div>
            <p className="mt-4">
              A machine-derived value, e.g. a contaminant reading. <Marker href="/about" />
            </p>
          </PanelBody>
        </Panel>
      </section>

      <section className="stack-lg mt-7">
        <SectionHeading eyebrow="Primitive" title="Callout / Note" />
        <div className="stack">
          <Callout tone="plain" title="Plain">
            <p>Default tone — generalizes astra's .note / .provenance blocks.</p>
          </Callout>
          <Callout tone="info" title="Info">
            <p>Used for coverage/provenance framing, e.g. OCR coverage notes.</p>
          </Callout>
          <Callout tone="error" title="Error" role="status">
            <p>Used when a data source is temporarily unavailable.</p>
          </Callout>
        </div>
      </section>

      <section className="stack-lg mt-7">
        <SectionHeading eyebrow="Primitive" title="DataTable" />
        <DataTable
          columns={[
            { key: 'bates', header: 'Bates', render: (r: Row) => <span className="mono">{r.bates}</span> },
            { key: 'folder', header: 'Folder', render: (r: Row) => r.folder },
            { key: 'pages', header: 'Pages', align: 'right', render: (r: Row) => r.pages },
          ]}
          rows={SAMPLE_ROWS}
          rowKey={(r) => r.bates}
          caption="Fixture rows for the styleguide only."
        />
      </section>

      <section className="stack-lg mt-7">
        <SectionHeading eyebrow="Primitive" title="EmptyState" />
        <EmptyState
          eyebrow="No results"
          title="Nothing matched that search."
          actions={
            <>
              <ButtonLink variant="primary" href="/search">
                New search
              </ButtonLink>
              <ButtonLink variant="secondary" href="/browse">
                Browse instead
              </ButtonLink>
            </>
          }
        >
          <p>Used for empty search results, 404 and 410 (gone) pages.</p>
        </EmptyState>
      </section>

      <section className="stack-lg mt-7">
        <SectionHeading eyebrow="Primitive" title="Dialog, Toast" />
        <p className="small muted">
          Dialog is a native <code>&lt;dialog&gt;</code> — see it live on <a href="/case">/case</a> ("Export exhibit list"). Copy is the primary action, download secondary, per BRIEF.md. Toast is a fixed-position status region — also live on{' '}
          <a href="/case">/case</a> after saving a note.
        </p>
      </section>
    </PageShell>
  );
}
