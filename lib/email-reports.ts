import { EmailFrequency, PrismaClient, Prisma, EmailReportType, KpiPeriod } from '@prisma/client';
import {
  buildAgentReport, buildFeedbackBreakdown, buildCollegeBreakdown, AgentReportRow,
  buildOverallCallingReport,
} from './reports';
import { kpiScoreboardFor, computeKpiActual, kpiScore, kpiPeriodRange, KPI_PERIODS } from './kpi';
import { gradeFor, gradeColour } from './kpi-grade';
import { istDayKey, istShiftDays, formatSheetDate } from './ist-time';
import { istParts, reportWindowFor } from './email-schedule';
import { DEFAULT_EMAIL_SUBJECTS, allReportsSubject } from './email-subjects';

/**
 * The HTML the scheduled emails carry.
 *
 * Built from the same `buildAgentReport` the Reports page uses, so a figure in
 * an inbox and the same figure on screen cannot disagree.
 *
 * Written as inline-styled tables on purpose: Gmail and Outlook strip <style>
 * blocks and ignore most modern CSS, so anything cleverer renders as unstyled
 * text for exactly the managers this is meant to impress.
 */

/**
 * The report palette: an amber header, a pale cream every other row, and a thin
 * black rule around every single cell. Deliberately plain — these are read in
 * Gmail and Outlook, forwarded, and pasted into decks, and a plain bordered
 * grid survives all three where a styled card does not.
 */
const LINE = '#000000';     // the rule around every cell
const INK = '#000000';      // all table text
const HEAD_BG = '#e9c46a';  // header row
const STRIPE = '#fdf4e3';   // every other body row
const MUTED = '#555555';    // subtitles and footers only, never table data
const LINK = '#0b4a8f';     // links stay link-coloured; that is usability, not theme
// The Overall Calling Report's own bands, from the sheet it replaces.
const MANDATE_BG = '#ffff66';  // the date / mandate strip
const MATRIX_BG = '#f0a23c';   // the column headers
const TOTAL_BG = '#000000';    // per-block totals, white on black
const ON_DARK = '#ffffff';

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const REPORT_FOOTER =
  'Sent automatically by the Counselling CRM. All dates are IST. Score comes from the ' +
  'targets set on KPI Targets; a dash means no target is set for that period.';

/**
 * THREADING — why every recurring report has a fixed subject.
 *
 * Gmail and Outlook group messages into one conversation by normalised subject
 * plus participants. While the date sat in the subject ("Team performance —
 * 2026-08-25") every send was a new subject, so every day started its own
 * thread and an inbox filled with near-identical mail.
 *
 * The date has not been lost: it is the subtitle under the heading in every one
 * of these, and it is on the EmailLog row, so nothing that identified a send is
 * gone. Only the subject stopped changing.
 *
 * This is subject-based threading, which is what the provider lets us do today.
 * The robust form is the RFC In-Reply-To / References headers pointing at the
 * previous message — that needs GoInfinito to accept custom headers, which
 * their Unified v2 payload we use gives no field for. Worth asking them; until
 * then a fixed subject is what threads the mail.
 */

/** `footer` is a parameter because the report boilerplate about KPI targets is
 *  meaningless on a welcome email — and wrong-sounding to a brand new joiner. */
function shell(
  title: string,
  subtitle: string,
  inner: string,
  opts: {
    footer?: string;
    /** Lifts the 820px cap for a report that is a wide data table rather than a
     *  letter — the college breakdown carries a column per outcome and would
     *  otherwise burst out of the card. */
    wide?: boolean;
    /* NB the wrapper is `margin:0`, not `margin:0 auto`. Centring an 820px
     * block inside Gmail's reading pane pushed the narrow reports a few hundred
     * pixels right of the wide ones, and right of the unsubscribe line the ESP
     * appends underneath — so the same mail looked indented next to its own
     * footer. Flush left is what makes every report line up. */
    /** The salutation the report opens with, above the heading. The welcome
     *  email is itself a greeting and passes none. */
    greeting?: string;
  } = {},
): string {
  const { footer = REPORT_FOOTER, wide = false, greeting = '' } = opts;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:18px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${INK}">
<div style="${wide ? '' : 'max-width:820px;'}margin:0">
${greeting ? `<div style="font-size:13px;color:${INK};margin:0 0 10px">${esc(greeting)}</div>
<div style="font-size:13px;color:${INK};margin:0 0 18px">PFB the report.</div>` : ''}
<div style="font-size:17px;font-weight:bold;color:${INK}">${esc(title)}</div>
<div style="font-size:12px;color:${MUTED};margin:3px 0 14px">${esc(subtitle)}</div>
${inner}
<div style="font-size:11px;color:${MUTED};margin-top:16px">${esc(footer)}</div>
</div></body></html>`;
}

/**
 * One table cell. Every report cell goes through here, so the black rule and
 * the amber header are defined once and cannot drift between reports.
 *
 * `cellBox` takes ready-made HTML; `cell` escapes a plain value. Inline styles
 * only — Gmail and Outlook drop <style> blocks.
 */
function cellBox(
  html: string,
  o: {
    head?: boolean; align?: string; bold?: boolean; bg?: string; tight?: boolean;
    span?: number; rowSpan?: number; fg?: string;
  } = {},
): string {
  // Centred unless a caller says otherwise — the welcome email's label/value
  // list is the only thing here that reads better left-aligned.
  const pad = o.tight ? '4px 6px' : '7px 10px';
  const size = o.tight ? '11px' : '12px';
  const bg = o.head ? HEAD_BG : o.bg;
  const tag = o.head ? 'th' : 'td';
  return `<${tag}${o.span ? ` colspan="${o.span}"` : ''}${o.rowSpan ? ` rowspan="${o.rowSpan}"` : ''}` +
    ` style="border:1px solid ${LINE};padding:${pad};` +
    `font-size:${size};color:${o.fg ?? INK};text-align:${o.align ?? 'center'};` +
    `${o.bold || o.head ? 'font-weight:bold;' : 'font-weight:normal;'}` +
    `${bg ? `background:${bg};` : ''}">${html}</${tag}>`;
}

function cell(v: unknown, o: Parameters<typeof cellBox>[1] = {}): string {
  return cellBox(esc(v), o);
}

// ─── The four windows every report covers ─────────────────────────────────────

export interface PeriodWindow {
  key: 'TODAY' | 'YESTERDAY' | 'WEEK' | 'MONTH';
  label: string;
  from: string;
  to: string;
  /** Which KPI target this period is judged against. */
  kpiPeriod: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  /** The instant that anchors the KPI window — yesterday needs yesterday's. */
  anchor: Date;
}

/**
 * Today, yesterday, this week and this month, in that order.
 *
 * Yesterday is scored against the *daily* target, anchored to yesterday, so the
 * two days are comparable. The month runs from the 1st to today rather than to
 * month-end: a report sent on the 8th should not imply the month is over.
 */
export function reportPeriods(now: Date): PeriodWindow[] {
  const p = istParts(now);
  const today = p.dayKey;
  const yesterday = istShiftDays(today, -1);
  const monday = istShiftDays(today, -(p.weekday - 1));
  const first = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
  const dayBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return [
    { key: 'TODAY', label: 'Today', from: today, to: today, kpiPeriod: 'DAILY', anchor: now },
    { key: 'YESTERDAY', label: 'Yesterday', from: yesterday, to: yesterday, kpiPeriod: 'DAILY', anchor: dayBefore },
    { key: 'WEEK', label: 'This week', from: monday, to: today, kpiPeriod: 'WEEKLY', anchor: now },
    { key: 'MONTH', label: 'This month', from: first, to: today, kpiPeriod: 'MONTHLY', anchor: now },
  ];
}

/** One agent's numbers for one window. */
interface PeriodFigures {
  window: PeriodWindow;
  row: AgentReportRow | null;
  score: number | null;
  maxScore: number;
}

export interface AgentBlock {
  id: string;
  name: string;
  employeeCode: string | null;
  tl: string | null;
  joiningDate: string | null;
  zone: string | null;
  language: string | null;
  periods: PeriodFigures[];
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));
const talk = (r: AgentReportRow | null) =>
  !r || r.avgTalktimeMin === null ? '—' : String(r.avgTalktimeMin);
const scoreText = (f: PeriodFigures) =>
  f.maxScore === 0 || f.score === null ? '—' : `${f.score} / ${f.maxScore}`;

/**
 * Gathers every agent's four windows.
 *
 * The report queries are grouped per window rather than per agent, so this is
 * four rounds of a handful of queries regardless of team size. The KPI scores
 * are the exception — `computeKpiActual` is per agent per KPI — which is why
 * the scoreboard is only computed when targets with points actually exist.
 */
export async function buildAgentBlocks(
  db: PrismaClient,
  scope: Prisma.UserWhereInput,
  now: Date,
): Promise<{ blocks: AgentBlock[]; periods: PeriodWindow[] }> {
  const periods = reportPeriods(now);

  const perWindow = await Promise.all(
    periods.map(async (w) => ({
      window: w,
      rows: (await buildAgentReport(db, scope, 'DATEWISE', w.from, w.to, now)).rows,
    })),
  );

  const defs = await db.kpiDefinition.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { targets: { select: { period: true, target: true, points: true } } },
  });
  const anyPoints = defs.some((d) => d.targets.some((t) => t.points != null));

  // Agent identity comes from the first window, which covers everyone in scope
  // whether or not they did anything today.
  const identity = perWindow[0].rows;
  const blocks: AgentBlock[] = [];

  for (const who of identity) {
    const figures: PeriodFigures[] = [];
    for (const w of perWindow) {
      const row = w.rows.find((r) => r.id === who.id) ?? null;
      const board = anyPoints
        ? await kpiScoreboardFor(db, defs, who.id, w.window.kpiPeriod, w.window.anchor)
        : { score: null, max: 0 };
      figures.push({ window: w.window, row, score: board.score, maxScore: board.max });
    }
    blocks.push({
      id: who.id, name: who.name, employeeCode: who.employeeCode,
      tl: who.tl, joiningDate: who.joiningDate, zone: who.zone, language: who.language,
      periods: figures,
    });
  }

  return { blocks, periods };
}

// ─── Rendering ────────────────────────────────────────────────────────────────

const COLUMNS = ['Period', 'Dialed', 'Connected', 'Not connected', 'Applications', 'Admissions', 'Avg talktime', 'Score'];

function headerRow(): string {
  return `<tr>${COLUMNS.map((h) => cell(h, { head: true })).join('')}</tr>`;
}

function agentSection(block: AgentBlock, isFirst: boolean): string {
  const meta = [
    block.employeeCode,
    block.tl ? `TL: ${block.tl}` : null,
    block.joiningDate ? `Joined ${block.joiningDate}` : null,
    block.zone,
    block.language,
  ].filter(Boolean).join(' · ');

  // Each agent gets their own bordered table under their own name, rather than
  // one long grid with divider rows — with a rule on every cell, a separate
  // table is what reads as a separate person.
  const rows = block.periods.map((f) => {
    const r = f.row;
    const range = f.window.from === f.window.to ? f.window.from : `${f.window.from} → ${f.window.to}`;
    const period = `<span style="font-weight:bold">${esc(f.window.label)}</span>`
      + `<br><span style="font-size:10px;color:${MUTED}">${esc(range)}</span>`;
    return `<tr>${[
      cellBox(period),
      cell(num(r?.dialedCalls)),
      cell(num(r?.connectedCalls)),
      cell(num(r?.notConnectedCalls)),
      cell(num(r?.applications)),
      cell(num(r?.admissions)),
      cell(talk(r)),
      cell(scoreText(f), { bold: true }),
    ].join('')}</tr>`;
  }).join('');

  return `<div style="margin-top:${isFirst ? '0' : '22px'}">
<div style="font-size:14px;font-weight:bold;color:${INK}">${esc(block.name)}</div>
${meta ? `<div style="font-size:11px;color:${MUTED};margin:2px 0 5px">${esc(meta)}</div>` : '<div style="height:5px"></div>'}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
${headerRow()}${rows}
</table>
</div>`;
}

export interface BuiltReport {
  subject: string;
  html: string;
  /**
   * The report's table without the surrounding shell. Present on the reports
   * the "All reports" mail stitches together, so that mail reuses the very same
   * markup rather than a second rendering that could drift from it.
   */
  inner?: string;
  /**
   * The Overall Calling Report's two tables separately, because the combined
   * mail interleaves another report between them.
   */
  parts?: { summary: string; detail: string; summaryCsv: string; detailCsv: string };
  csv?: string;
  periodLabel: string;
  rows: AgentReportRow[];
}

const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** One row per agent per period — long format, so it pivots cleanly in Excel. */
function toCsv(blocks: AgentBlock[]): string {
  const head = [
    'Agent', 'Employee Code', 'TL', 'Joining Date', 'Zone', 'Language',
    'Period', 'From', 'To', 'Dialed', 'Connected', 'Not Connected',
    'Applications', 'Admissions', 'Avg Talktime (min)', 'Score', 'Max Score',
  ];
  const lines = blocks.flatMap((b) =>
    b.periods.map((f) =>
      [
        b.name, b.employeeCode ?? '', b.tl ?? '', b.joiningDate ?? '', b.zone ?? '', b.language ?? '',
        f.window.label, f.window.from, f.window.to,
        f.row?.dialedCalls ?? '', f.row?.connectedCalls ?? '', f.row?.notConnectedCalls ?? '',
        f.row?.applications ?? '', f.row?.admissions ?? '', f.row?.avgTalktimeMin ?? '',
        f.score ?? '', f.maxScore || '',
      ].map(q).join(','),
    ),
  );
  return [head.map(q).join(','), ...lines].join('\n');
}

/** The management view: every agent, each broken into today / yesterday / week / month. */
export async function buildTeamSummary(
  db: PrismaClient,
  scope: Prisma.UserWhereInput,
  _frequency: EmailFrequency,
  now: Date,
): Promise<BuiltReport> {
  const { blocks } = await buildAgentBlocks(db, scope, now);
  const today = istDayKey(now);

  const inner =
    blocks.length === 0
      ? `<p style="font-size:13px;color:${MUTED}">No agents in scope.</p>`
      : blocks.map((b, i) => agentSection(b, i === 0)).join('');

  return {
    // Constant on purpose — see THREADING above.
    subject: DEFAULT_EMAIL_SUBJECTS.TEAM_SUMMARY,
    html: shell('Team performance', `As at ${today}`, inner, { greeting: 'Hi Team,' }),
    csv: toCsv(blocks),
    periodLabel: today,
    rows: blocks.map((b) => b.periods[0].row).filter(Boolean) as AgentReportRow[],
  };
}

/** One agent's own numbers, same four periods, addressed to them. */
export function buildAgentEmail(block: AgentBlock, today: string): BuiltReport {
  const inner = agentSection(block, true);

  return {
    subject: DEFAULT_EMAIL_SUBJECTS.AGENT_PERFORMANCE,
    // Addressed to one agent, so the salutation names them rather than "Team".
    html: shell('Performance report', `Your activity as at ${today}`, inner, {
      greeting: `Hi ${block.name},`,
    }),
    periodLabel: today,
    rows: block.periods.map((f) => f.row).filter(Boolean) as AgentReportRow[],
  };
}


// ─── Welcome email ────────────────────────────────────────────────────────────

/** Where an agent answers calls. Fixed by the provider, not per-tenant. */
const DIALSHREE_AGENT_URL = 'https://dialer5.elisiontec.com/agent/index.php';

export interface WelcomeRecipient {
  name: string;
  employeeCode: string | null;
  email: string;
  /**
   * Only ever present at the moment the account is created — passwords are
   * stored bcrypt-hashed, so there is nothing to retrieve afterwards. A re-sent
   * welcome therefore tells the person to ask their manager instead of quietly
   * omitting the field.
   */
  password?: string | null;
}

function linkButton(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;border:1px solid ${LINE};padding:9px 16px;font-size:13px;font-weight:bold">${esc(label)}</a>`;
}

/** Login details and the two links a new joiner needs on day one. */
export function buildWelcomeEmail(user: WelcomeRecipient): BuiltReport {
  const crmUrl = process.env.NEXTAUTH_URL || 'http://13.206.157.201';

  const detail = (label: string, value: string) =>
    `<tr>${cell(label, { head: true, align: 'left' })}${cellBox(value, { bold: true, align: 'left' })}</tr>`;

  const credentials = user.password
    ? detail('Password', `<code style="font-size:13px">${esc(user.password)}</code>`)
    : detail('Password', `<span style="font-weight:normal;color:${MUTED}">Get your username and password from your Manager.</span>`);

  const inner = `
<p style="font-size:14px;margin:0 0 14px">Welcome aboard. Your Counselling CRM account is ready.</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:18px">
${detail('Name', esc(user.name))}
${detail('Employee ID', esc(user.employeeCode ?? '—'))}
${detail('Username', esc(user.email))}
${credentials}
</table>

<p style="font-size:13px;margin:0 0 10px">${linkButton(crmUrl, 'Open the CRM')}</p>

<p style="font-size:13px;margin:16px 0 6px"><strong>DialShree (for calling)</strong></p>
<p style="font-size:13px;margin:0 0 6px">
Sign in here to take and make calls:<br>
<a href="${DIALSHREE_AGENT_URL}" style="color:${LINK}">${DIALSHREE_AGENT_URL}</a>
</p>
<p style="font-size:12px;color:${MUTED};margin:0 0 16px">
Get your username and password from your Manager.
</p>

<p style="font-size:12px;color:${MUTED};margin:0">
${user.password
    ? 'Please change your password after your first sign-in.'
    : 'If you have not been given your password yet, ask your Manager.'}
</p>`;

  return {
    subject: DEFAULT_EMAIL_SUBJECTS.WELCOME,
    html: shell(
      `Welcome, ${user.name}`,
      'Your account details and where to sign in',
      inner,
      { footer: 'Sent automatically by the Counselling CRM when your account was created. If anything here looks wrong, tell your Manager.' },
    ),
    periodLabel: 'Welcome',
    rows: [],
  };
}

export const REPORT_TYPE_LABEL: Record<EmailReportType, string> = {
  AGENT_PERFORMANCE: 'Agent performance (one email per agent)',
  TEAM_SUMMARY: 'Team summary (one email listing every agent)',
  WELCOME: 'Welcome email (login details and links)',
  FEEDBACK_SUMMARY: 'Feedback summary (leads by outcome)',
  COLLEGE_WISE: 'University / College wise (leads by college)',
  AGENT_WISE: 'Agent wise (KPI scoreboard, every agent in one file)',
  OVERALL_CALLING: 'Overall calling (dialled, connected and talktime vs the daily mandate)',
  ALL_REPORTS: 'All reports (every table above, in one email)',
};

// ─── Feedback summary & College-wise ─────────────────────────────────────────

/**
 * The two Reports-page tables, as email.
 *
 * Both call the very same `buildFeedbackBreakdown` / `buildCollegeBreakdown`
 * the page renders from, so a figure in an inbox and the same figure on screen
 * cannot disagree — which is the whole reason these live here rather than being
 * re-derived with their own queries.
 *
 * The rule's frequency picks the window (see reportWindowFor), because an email
 * has no date pickers to read.
 */

export async function buildFeedbackSummaryEmail(
  db: PrismaClient,
  scope: Prisma.UserWhereInput,
  frequency: EmailFrequency,
  now: Date,
): Promise<BuiltReport> {
  const w = reportWindowFor(frequency, now);
  const fb = await buildFeedbackBreakdown(db, scope, 'DATEWISE', w.from, w.to, now);

  const inner = fb.rows.length === 0
    ? `<p style="font-size:13px;color:${MUTED}">No follow-ups were logged in this period.</p>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:420px">
<tr>${cellBox('Calling Summary Report', { bold: true, bg: MANDATE_BG, span: 2 })}</tr>
<tr>${cell('Total', { bold: true, bg: MATRIX_BG })}${cell(fb.total, { bold: true, bg: MATRIX_BG })}</tr>
<tr>${cell('Count of Team Members', { bold: true, bg: STRIPE })}${cell(fb.teamMembers, { bold: true, bg: STRIPE })}</tr>
<tr>${cell('University/Institution Count', { bold: true, bg: MATRIX_BG })}${cell(fb.universities, { bold: true, bg: MATRIX_BG })}</tr>
${fb.rows.map((r) => `<tr>${cell(r.feedback)}${cell(r.leads)}</tr>`).join('\n')}
</table>`;

  const csv = [
    ['Calling Summary Report', ''],
    ['Total', fb.total],
    ['Count of Team Members', fb.teamMembers],
    ['University/Institution Count', fb.universities],
    ...fb.rows.map((r) => [r.feedback, r.leads]),
  ].map((cells) => cells.map(q).join(',')).join('\n');

  return {
    subject: DEFAULT_EMAIL_SUBJECTS.FEEDBACK_SUMMARY,
    html: shell('Feedback summary', w.label, inner, { footer: FEEDBACK_FOOTER, greeting: 'Hi Team,' }),
    inner,
    csv,
    periodLabel: w.label,
    rows: [],
  };
}

const FEEDBACK_FOOTER =
  'Sent automatically by the Counselling CRM. All dates are IST. Count of Team Members is the ' +
  'agents who logged at least one follow-up in the window, not the size of the roster. ' +
  'Every lead is counted once, ' +
  'under its latest follow-up in the period, so the Total is leads worked rather than ' +
  'follow-ups logged. Outcomes nobody used are not listed.';

export async function buildCollegeWiseEmail(
  db: PrismaClient,
  scope: Prisma.UserWhereInput,
  frequency: EmailFrequency,
  now: Date,
): Promise<BuiltReport> {
  const w = reportWindowFor(frequency, now);
  const cb = await buildCollegeBreakdown(db, scope, 'DATEWISE', w.from, w.to, now);

  /**
   * Every outcome that occurred, not a chosen few.
   *
   * This used to show only the five the page defaults to, on the reasoning that
   * a wide table is painful in Outlook. That was the wrong trade: it meant the
   * body and the attached CSV disagreed about what happened, and the reader had
   * to open the spreadsheet to see the columns the email had quietly dropped.
   * A wide table is a nuisance; a table that hides data is a wrong one.
   *
   * `availableOutcomes` is already ordered most-common first, so the columns
   * that matter are the ones still on screen before any horizontal scrolling.
   */
  const outcomes = cb.availableOutcomes;

  const headers = ['University Name', 'Dialed', 'Connected', 'Connected %', 'Not Connected',
    ...outcomes];
  const line = (name: string, r: typeof cb.totals) => [
    name, r.dialed, r.connected, r.connectedPct === null ? '—' : `${r.connectedPct}%`, r.notConnected,
    ...outcomes.map((o) => r.outcomes[o] ?? 0),
  ];

  const t = (v: unknown, _i: number, extra: { bold?: boolean; bg?: string; head?: boolean } = {}) =>
    cell(v, { ...extra, tight: true });

  // Wrapped in an overflow-x container: a client wide enough shows the lot, and
  // a narrow one scrolls rather than squashing every column into unreadability.
  const inner = cb.rows.length === 0
    ? `<p style="font-size:13px;color:${MUTED}">No follow-ups were logged in this period.</p>`
    : `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:100%">
<tr>${line(formatSheetDate(w.label), cb.totals).map((v, i) => t(v, i, { bold: true, bg: STRIPE })).join('')}</tr>
<tr>${headers.map((h, i) => t(h, i, { head: true })).join('')}</tr>
${cb.rows.map((r) => `<tr>${line(r.college, r).map((v, i) => t(v, i)).join('')}</tr>`).join('\n')}
</table>
</div>`;

  // Body and attachment now carry the same columns, so the two can no longer
  // disagree about what happened.
  const allOutcomes = outcomes;
  const csvLine = (name: string, r: typeof cb.totals) => [
    name, r.dialed, r.connected, r.connectedPct === null ? '' : `${r.connectedPct}%`, r.notConnected,
    ...allOutcomes.map((o) => r.outcomes[o] ?? 0),
  ];
  const csv = [
    csvLine(formatSheetDate(w.label), cb.totals),
    ['University Name', 'Dialed', 'Connected', 'Connected %', 'Not Connected', ...allOutcomes],
    ...cb.rows.map((r) => csvLine(r.college, r)),
  ].map((cells) => cells.map(q).join(',')).join('\n');

  return {
    subject: DEFAULT_EMAIL_SUBJECTS.COLLEGE_WISE,
    html: shell('University / College wise', w.label, inner, {
      footer: collegeFooter(cb.uncategorisedOutcomes), wide: true, greeting: 'Hi Team,',
    }),
    inner,
    csv,
    periodLabel: w.label,
    rows: [],
  };
}

/**
 * The uncategorised warning is part of the footer rather than a separate note
 * because it changes how a number should be read, and a reader who misses it
 * misreads the Connected column.
 */
function collegeFooter(uncategorised: string[]): string {
  const base =
    'Sent automatically by the Counselling CRM. All dates are IST. The same leads as the ' +
    'feedback summary, counted the same way, so Dialed totals to the same number. A lead is ' +
    'Not Connected when its latest feedback is in the Not Connected category, and Connected ' +
    'otherwise, so the two always add back to Dialed. Every outcome that occurred has a column ' +
    'here and in the attached CSV; scroll sideways if your mail app cannot fit them all.';
  if (uncategorised.length === 0) return base;
  return `${base} Note: ${uncategorised.join(', ')} ${uncategorised.length === 1 ? 'has' : 'have'} ` +
    'no feedback category set, so nothing says whether those calls were answered — they are ' +
    'counted as Not Connected. Set a category in Manage Feedbacks to have them counted properly.';
}

// ─── Agent wise ──────────────────────────────────────────────────────────────

/**
 * The Agent wise report — the KPI scoreboard in wide form, one row per agent:
 * achieved / target / % / points earned for every KPI, then Total Score, Max
 * Score, Score % and a grade, under a Total row and a band naming each block.
 *
 * The emailed twin of the KPI Targets page's download, built from the same
 * `computeKpiActual` and `kpiScore` the page reads, so a figure in an inbox and
 * the same figure on screen cannot disagree.
 *
 * EmailFrequency and KpiPeriod carry the same four values, so the rule's
 * cadence *is* the period its agents are judged against: a weekly rule reports
 * against the weekly targets. That is the only sane reading — a weekly email
 * measured against a daily target would call everybody a hero.
 */
export async function buildAgentWiseEmail(
  db: PrismaClient,
  scope: Prisma.UserWhereInput,
  frequency: EmailFrequency,
  now: Date,
): Promise<BuiltReport> {
  const period = frequency as unknown as KpiPeriod;
  const periodLabel = KPI_PERIODS.find((p) => p.key === period)?.label ?? String(period);
  const rangeLabel = kpiPeriodRange(period, now).label;
  const [yy, mm, dd] = istDayKey(now).split('-');
  const dateCell = `${dd}/${mm}/${yy}`;

  const [definitions, agents] = await Promise.all([
    db.kpiDefinition.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { targets: { select: { period: true, target: true, points: true } } },
    }),
    db.user.findMany({ where: scope, select: { id: true, name: true, employeeCode: true }, orderBy: { name: 'asc' } }),
  ]);

  const targetOf = (d: (typeof definitions)[number]) =>
    d.targets.find((t) => t.period === period)?.target ?? null;
  const pointsOf = (d: (typeof definitions)[number]) =>
    d.targets.find((t) => t.period === period)?.points ?? null;
  const maxScore = definitions.reduce((sum, d) => {
    const pts = pointsOf(d);
    return sum + (pts != null && targetOf(d) != null ? pts : 0);
  }, 0);

  /**
   * Agents in series, KPIs in parallel. The page fires the lot at once because
   * somebody is watching it load; this runs on a 9am cron next to every other
   * due rule, on a box with a few hundred MB of headroom, so it caps concurrency
   * at one agent's worth of queries.
   */
  const rows: { name: string; code: string; cells: { actual: number | null; score: number | null }[]; total: number }[] = [];
  for (const a of agents) {
    const cells = await Promise.all(
      definitions.map(async (d) => {
        const actual = await computeKpiActual(db, d, a.id, period, now);
        return { actual, score: kpiScore(actual, targetOf(d), pointsOf(d)) };
      }),
    );
    const total = Math.round(cells.reduce((sum, c) => sum + (c.score ?? 0), 0) * 10) / 10;
    rows.push({ name: a.name, code: a.employeeCode ?? '', cells, total });
  }

  const pct = (a: number | null, t: number | null) => {
    if (a === null || t === null) return '';
    return t <= 0 ? '100%' : `${Math.round((a / t) * 100)}%`;
  };
  /** Null, not zero, when nothing contributed — "no target set" is not "did nothing". */
  const sum = (ns: (number | null)[]) => {
    const real = ns.filter((n): n is number => n !== null);
    return real.length === 0 ? null : Math.round(real.reduce((x, y) => x + y, 0) * 10) / 10;
  };

  const totalScore = sum(rows.map((r) => r.total));
  const teamMax = maxScore > 0 ? maxScore * rows.length : null;

  // Flat 33-column shape, shared by the CSV and the HTML so they cannot differ.
  const totalRow: (string | number)[] = [
    'Total', '', '', '', '',
    ...definitions.flatMap((d, i) => {
      const achieved = sum(rows.map((r) => r.cells[i].actual));
      const one = targetOf(d);
      // Targets are per agent, so the team's is that times the headcount.
      const target = one === null ? null : one * rows.length;
      return [achieved ?? '', target ?? '', pct(achieved, target), sum(rows.map((r) => r.cells[i].score)) ?? ''];
    }),
    totalScore ?? '', teamMax ?? '', pct(totalScore, teamMax), '',
  ];
  const headRow = [
    'Date', 'Agent', 'Employee Code', 'Period', 'Range',
    ...definitions.flatMap((d) => [
      `${d.name} – Achieved`, `${d.name} – Target`, `${d.name} %`, `${d.name} – Points Earned`,
    ]),
    'Total Score', 'Max Score', 'Score %', 'Grade',
  ];
  const bodyRows = rows.map((r) => {
    const scorePct = maxScore > 0 ? Math.round((r.total / maxScore) * 100) : null;
    return {
      scorePct,
      cells: [
        dateCell, r.name, r.code, periodLabel, rangeLabel,
        ...definitions.flatMap((d, i) => [
          r.cells[i].actual ?? '', targetOf(d) ?? '',
          pct(r.cells[i].actual, targetOf(d)), r.cells[i].score ?? '',
        ]),
        r.total, maxScore > 0 ? maxScore : '', scorePct === null ? '' : `${scorePct}%`, gradeFor(scorePct),
      ] as (string | number)[],
    };
  });

  const csv = [
    totalRow,
    ['Employee Details', '', '', '', '',
      ...definitions.flatMap((d) => [`${d.name} Matrix`, '', '', '']), 'Scoring', '', '', ''],
    headRow,
    ...bodyRows.map((r) => r.cells),
  ].map((cells) => cells.map(q).join(',')).join('\n');

  // The band row uses real colspans in HTML rather than the CSV's padding
  // blanks, so each block sits visibly over its four columns.
  const t = (v: unknown, i: number, extra: { bold?: boolean; bg?: string; head?: boolean } = {}) =>
    cell(v, { ...extra, tight: true });
  const inner = rows.length === 0
    ? `<p style="font-size:13px;color:${MUTED}">No agents in scope.</p>`
    : `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:100%">
<tr>${totalRow.map((v, i) => t(v, i, { bold: true, bg: STRIPE })).join('')}</tr>
<tr>${cellBox('Employee Details', { head: true, tight: true, span: 5 })}${
      definitions.map((d) => cellBox(esc(`${d.name} Matrix`), { head: true, tight: true, span: 4 })).join('')
    }${cellBox('Scoring', { head: true, tight: true, span: 4 })}</tr>
<tr>${headRow.map((h, i) => t(h, i, { head: true })).join('')}</tr>
${bodyRows.map(({ cells, scorePct }) => {
      const tint = gradeColour(scorePct);
      /**
       * Unsatisfactory paints the WHOLE row, not just its two score cells.
       * Himanshu's point: a person who needs attention should be findable by
       * scanning down 33 columns, and a tint on the far right of a table that
       * scrolls sideways is exactly what a reader misses. Every other band
       * colours only the score, so the row stays readable.
       */
      const wholeRow = scorePct !== null && scorePct < 30;
      const rowBg = wholeRow ? { bg: tint ?? undefined } : {};
      const last = cells.length - 1;
      return `<tr>${cells
        .map((v, i) =>
          t(v, i, i >= last - 1 && tint ? { ...rowBg, bg: tint, bold: true } : rowBg),
        )
        .join('')}</tr>`;
    }).join('\n')}
</table>
</div>`;

  return {
    subject: DEFAULT_EMAIL_SUBJECTS.AGENT_WISE,
    html: shell('Agent wise report', `${periodLabel} · ${rangeLabel}`, inner, {
      footer: AGENT_WISE_FOOTER, wide: true, greeting: 'Hi Team,',
    }),
    inner,
    csv,
    periodLabel: rangeLabel,
    rows: [],
  };
}

const AGENT_WISE_FOOTER =
  'Sent automatically by the Counselling CRM. All dates are IST. Achieved, target and points ' +
  'come from KPI Targets, judged against the targets for this rule\'s own cadence — a weekly ' +
  'rule reports against the weekly targets. The Total row multiplies each per-agent target by ' +
  'the headcount. A blank means no target is set for that KPI in this period, which is not the ' +
  'same as achieving nothing. Grade is a band on Score %: Excellent 85 and above, Very Good 70, ' +
  'Good 50, Needs Improvement 30, Unsatisfactory below 30 — the higher band takes each boundary. ' +
  'The Score % and Grade cells carry their band colour, and an Unsatisfactory row is shaded end ' +
  'to end so it can be found without reading across every column.';

// ─── Overall Calling Report ──────────────────────────────────────────────────

/**
 * Dialled, Connected and Talktime for every agent across four windows — today,
 * this week so far, this month so far, and all time — each against the daily
 * mandate scaled by the days the window covers.
 *
 * A Wednesday's week-to-date is measured against three days of mandate, not
 * seven. Measuring a partial window against a whole one would report the whole
 * floor as failing every Monday.
 *
 * Overall has no mandate: an unbounded window has no number of days to scale
 * by, so its percentage columns are a dash rather than an invented figure.
 */
export async function buildOverallCallingEmail(
  db: PrismaClient,
  scope: Prisma.UserWhereInput,
  _frequency: EmailFrequency,
  now: Date,
): Promise<BuiltReport> {
  const r = await buildOverallCallingReport(db, scope, now);
  const M = r.mandates;

  /**
   * Achieved against the daily mandate x the days the window covers x the
   * people it covers.
   *
   * The headcount matters and was missing at first: a mandate is per agent per
   * day, so an agent row divides by one person, but a floor total of eleven
   * agents divides by eleven. Without it a full day's work for the whole team
   * read as 1,100% of target.
   *
   * Active people rather than the whole roster, so a day when half the team is
   * on leave is not reported as a collapse — and it is why the summary puts the
   * active count immediately before the figures it explains.
   */
  const pctNum = (
    achieved: number, mandate: number | null, days: number | null, people = 1,
  ): number | null => {
    if (mandate === null || days === null) return null;
    if (mandate === 0) return 100;      // none expected, so none is success
    if (people === 0) return null;      // nobody worked; there is no target to miss
    return Math.round((achieved / (mandate * days * people)) * 100);
  };
  const fmt = (n: number | null) => (n === null ? '—' : `${n}%`);

  /**
   * A row's eight figures, plus the score they average to.
   *
   * Overall Scoring is the mean of the three achievement percentages, exactly
   * as Himanshu specified: (Dialled % + Connected % + Talktime %) / 3. It needs
   * all three to mean anything, so a missing mandate — or the Overall window,
   * which has no day count — leaves it and the Grade blank rather than dividing
   * two numbers by three.
   */
  const line = (
    v: { dialed: number; connected: number; talktimeMin: number },
    days: number | null,
    people = 1,
  ): { cells: (string | number)[]; overall: number | null } => {
    const d = pctNum(v.dialed, M.dialed, days, people);
    const c = pctNum(v.connected, M.connected, days, people);
    const tt = pctNum(v.talktimeMin, M.talktime, days, people);
    const overall = d !== null && c !== null && tt !== null ? Math.round((d + c + tt) / 3) : null;
    return {
      cells: [
        v.dialed, fmt(d), v.connected, fmt(c), v.talktimeMin, fmt(tt),
        fmt(overall), gradeFor(overall),
      ],
      overall,
    };
  };
  const mandateText = (label: string, v: number | null, unit = '') =>
    v === null ? `${label} — not set` : `${label} - ${v}${unit}`;

  const t = (v: unknown, o: Parameters<typeof cellBox>[1] = {}) => cell(v, { ...o, tight: true });

  /**
   * The eight metric cells, with Overall Scoring and Grade filled by their
   * band colour. The tint overrides whatever the row is painted — on the black
   * total rows the band colour wins and the text flips back to dark, because a
   * colour that means "Unsatisfactory" is no use invisible on black.
   */
  const metrics = (
    v: { dialed: number; connected: number; talktimeMin: number },
    days: number | null,
    people = 1,
    row: Parameters<typeof cellBox>[1] = {},
  ) => {
    const { cells, overall } = line(v, days, people);
    const tint = gradeColour(overall);
    return cells
      .map((val, i) =>
        i < 6
          ? t(val, row)
          : t(val, { ...row, bold: true, ...(tint ? { bg: tint, fg: INK } : {}) }),
      )
      .join('');
  };

  const blockRows = r.blocks.map((b) => {
    const body = b.rows.length === 0
      ? `<tr>${cellBox('No agents in scope', { tight: true, span: COLS })}</tr>`
      : b.rows.map((row, i) => `<tr>${
          // The Matrix label spans the whole block, as in the sheet.
          (i === 0 ? cellBox(esc(b.label), { tight: true, bold: true, rowSpan: b.rows.length }) : '')
        }${t(row.name, { align: 'left' })}${metrics(row, b.days)}</tr>`).join('');
    const label = b.letter ? `${b.label} Total ${b.letter}` : `${b.label} Total`;
    const totals = `<tr>${cellBox(esc(label), { tight: true, bold: true, bg: TOTAL_BG, fg: ON_DARK, span: 2 })}${
      metrics(b.totals, b.days, b.activeEmployees, { bold: true, bg: TOTAL_BG, fg: ON_DARK })
    }</tr>`;
    return body + totals;
  }).join('');

  const SUMMARY_COLS = ['Matrix', 'No of Active Employee', 'Dialled Calls', 'Achieved %',
    'Connected Calls', 'Achieved %', 'Talktime', 'Achieved %', 'Overall Scoring', 'Grade'];
  const DETAIL_COLS = ['Matrix', 'Employee Name', 'Dialled Calls', 'Achieved %',
    'Connected Calls', 'Achieved %', 'Talktime', 'Achieved %', 'Overall Scoring', 'Grade'];
  const COLS = SUMMARY_COLS.length; // 10 — the span every banner row needs

  // The roll-up management reads first: one row per window, with the active
  // headcount next to the figures so the percentage explains itself.
  const summary = `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:100%;margin-bottom:22px">
<tr>${cellBox('OVERALL CALLING REPORT SUMMARY', { tight: true, bold: true, bg: STRIPE, span: COLS })}</tr>
<tr>${SUMMARY_COLS.map((h) => cellBox(esc(h), { tight: true, bold: true, bg: MATRIX_BG })).join('')}</tr>
<tr>${cellBox('TOTAL', { tight: true, bold: true, bg: TOTAL_BG, fg: ON_DARK })}${
    cellBox('', { tight: true, bg: TOTAL_BG, fg: ON_DARK, span: COLS - 1 })}</tr>
${r.blocks.map((b) => `<tr>${
    t(b.label, { bold: true })
  }${t(b.activeEmployees)}${metrics(b.totals, b.days, b.activeEmployees)}</tr>`).join('')}
</table>`;

  const detail = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:100%">
<tr>${cellBox('Overall Calling Report', { tight: true, bold: true, bg: STRIPE, span: COLS })}</tr>
<tr>${cellBox('Date', { tight: true, bold: true, bg: MANDATE_BG })}${
    cellBox(esc(r.dateLabel), { tight: true, bold: true, bg: MANDATE_BG })}${
    cellBox(esc(mandateText('Mandate', M.dialed)), { tight: true, bold: true, bg: MANDATE_BG, span: 2 })}${
    cellBox(esc(mandateText('Connected Mandate', M.connected)), { tight: true, bold: true, bg: MANDATE_BG, span: 2 })}${
    cellBox(esc(mandateText('Talktime Mandate', M.talktime, ' Mins')), { tight: true, bold: true, bg: MANDATE_BG, span: 2 })}${
    cellBox('Scoring', { tight: true, bold: true, bg: MANDATE_BG, span: 2 })}</tr>
<tr>${DETAIL_COLS.map((h) => cellBox(esc(h), { tight: true, bold: true, bg: MATRIX_BG })).join('')}</tr>
${blockRows}
</table>
</div>`;
  const inner = `${summary}${detail}`;

  const toCsvText = (rows: unknown[][]) => rows.map((cells) => cells.map(q).join(',')).join('\n');
  // Kept as two blocks so the combined mail can file them under their own
  // headings — its order interleaves another report between them.
  const summaryCsvRows: unknown[][] = [
    SUMMARY_COLS,
    ['TOTAL', ...Array(COLS - 1).fill('')],
    ...r.blocks.map((b) => [b.label, b.activeEmployees, ...line(b.totals, b.days, b.activeEmployees).cells]),
  ];
  const detailCsvRows: unknown[][] = [
    ['Date', r.dateLabel, mandateText('Mandate', M.dialed), '',
      mandateText('Connected Mandate', M.connected), '',
      mandateText('Talktime Mandate', M.talktime, ' Mins'), '', 'Scoring', ''],
    DETAIL_COLS,
    ...r.blocks.flatMap((b) => [
      ...b.rows.map((row) => [b.label, row.name, ...line(row, b.days).cells]),
      [
        b.letter ? `${b.label} Total ${b.letter}` : `${b.label} Total`, '',
        ...line(b.totals, b.days, b.activeEmployees).cells,
      ],
    ]),
  ];
  const summaryCsv = toCsvText(summaryCsvRows);
  const detailCsv = toCsvText(detailCsvRows);
  // The standalone attachment keeps both titles; the combined mail files the
  // same two blocks under its own numbered headings instead.
  const csv = [
    toCsvText([['OVERALL CALLING REPORT SUMMARY']]), summaryCsv, '',
    toCsvText([['Overall Calling Report']]), detailCsv,
  ].join('\n');

  return {
    subject: DEFAULT_EMAIL_SUBJECTS.OVERALL_CALLING,
    html: shell('Overall Calling Report', r.dateLabel, inner, {
      footer: OVERALL_CALLING_FOOTER, wide: true, greeting: 'Hi Team,',
    }),
    inner,
    parts: { summary, detail, summaryCsv, detailCsv },
    csv,
    periodLabel: r.dateLabel,
    rows: [],
  };
}

const OVERALL_CALLING_FOOTER =
  'Sent automatically by the Counselling CRM. All dates are IST. Dialled and Connected count ' +
  'leads worked, once each, under their latest follow-up — the same rule the other reports use. ' +
  'Talktime is the dialer\'s total minutes, the figure the Talktime KPI reports, not the average ' +
  'per call. Mandates are the daily targets set on KPI Targets. An agent row is measured against ' +
  'the mandate times the days the window covers; a floor total is measured against that times the ' +
  'number of active employees, since the mandate is per agent per day. Active means agents who ' +
  'dialled at least one lead in that window, which is the count shown in the summary. Weekly is ' +
  'the whole of LAST week, Monday to Saturday — a settled six-day window, not this week so far — ' +
  'and Monthly is the 1st to today, so a partial window is judged against a ' +
  'partial mandate. Overall has no day count, so its percentages are a dash. Overall Scoring is ' +
  'the mean of the three achievement percentages and needs all three, so it is blank wherever one ' +
  'is missing; Grade bands it — Excellent 85 and above, Very Good 70, Good 50, Needs Improvement ' +
  '30, Unsatisfactory below 30, the higher band taking each boundary.';

// ─── All reports, in one email ───────────────────────────────────────────────

/**
 * The five tables in one mail, in the order Himanshu asked for:
 *
 *   1. Overall Calling Summary   — the calling roll-up by window
 *   2. Summary Report            — the feedback summary, leads by outcome
 *   3. Overall-Report            — the calling detail, per agent per window
 *   4. Caller-wise Report        — the KPI scoreboard, per agent
 *   5. University-Wise Report    — the same leads split by college
 *
 * Every section is the *same* markup its own email sends, reused rather than
 * re-rendered: each builder now returns its table alongside its full email, so
 * a figure here and the same figure in the standalone report cannot disagree.
 *
 * Two scopes, because the reports do not agree on what "everyone" means. The
 * per-agent tables take the agent scope; the feedback and college breakdowns
 * take the wider one, so an org-wide rule counts follow-ups whoever logged
 * them — exactly as those reports behave on their own.
 */
export async function buildAllReportsEmail(
  db: PrismaClient,
  agentScope: Prisma.UserWhereInput,
  breakdownScope: Prisma.UserWhereInput,
  frequency: EmailFrequency,
  now: Date,
): Promise<BuiltReport> {
  // In series: each of these is already several grouped queries, and this runs
  // on the same cron as every other due rule.
  const calling = await buildOverallCallingEmail(db, agentScope, frequency, now);
  const feedback = await buildFeedbackSummaryEmail(db, breakdownScope, frequency, now);
  const agentWise = await buildAgentWiseEmail(db, agentScope, frequency, now);
  const college = await buildCollegeWiseEmail(db, breakdownScope, frequency, now);

  const sections: { title: string; html: string; csv: string }[] = [
    { title: '1. Overall Calling Summary', html: calling.parts?.summary ?? '', csv: calling.parts?.summaryCsv ?? '' },
    { title: '2. Summary Report', html: feedback.inner ?? '', csv: feedback.csv ?? '' },
    { title: '3. Overall-Report', html: calling.parts?.detail ?? '', csv: calling.parts?.detailCsv ?? '' },
    { title: '4. Caller-wise Report', html: agentWise.inner ?? '', csv: agentWise.csv ?? '' },
    { title: '5. University-Wise Report', html: college.inner ?? '', csv: college.csv ?? '' },
  ];

  const heading = (text: string, first: boolean) =>
    `<div style="font-size:15px;font-weight:bold;color:${INK};margin:${first ? '0' : '26px'} 0 8px">${esc(text)}</div>`;
  const inner = sections.map((sec, i) => `${heading(sec.title, i === 0)}${sec.html}`).join('');

  // One attachment carrying every table, each under its own heading so the
  // sheet is readable rather than five files to open.
  const csv = sections
    .filter((sec) => sec.csv)
    .map((sec) => `"${sec.title}"\n${sec.csv}`)
    .join('\n\n');

  return {
    subject: allReportsSubject(now),
    html: shell('Overall Call Centre — Calling Summary', calling.periodLabel, inner, {
      footer: ALL_REPORTS_FOOTER, wide: true, greeting: 'Hi Team,',
    }),
    csv,
    periodLabel: calling.periodLabel,
    rows: [],
  };
}

const ALL_REPORTS_FOOTER =
  'Sent automatically by the Counselling CRM. All dates are IST. Each section is the same table ' +
  'its own report sends, so the figures here and there cannot differ. Leads are counted once ' +
  'under their latest follow-up; a lead is Not Connected when that feedback is in the Not ' +
  'Connected category and Connected otherwise. Calling mandates and KPI targets both come from ' +
  'the KPI Targets page. The subject names the month, so each month starts its own mail thread.';
