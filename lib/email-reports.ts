import { EmailFrequency, PrismaClient, Prisma, EmailReportType } from '@prisma/client';
import { buildAgentReport, buildFeedbackBreakdown, buildCollegeBreakdown, AgentReportRow } from './reports';
import { kpiScoreboardFor } from './kpi';
import { istDayKey, istShiftDays } from './ist-time';
import { istParts, reportWindowFor } from './email-schedule';
import { DEFAULT_EMAIL_SUBJECTS } from './email-subjects';

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

const BRAND = '#0e4164';
const MUTED = '#667085';
const BORDER = '#e4e7ec';
const HEAD_BG = '#f2f4f7';

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
  footer = REPORT_FOOTER,
  /** Lifts the 820px cap for a report that is a wide data table rather than a
   *  letter — the college breakdown carries a column per outcome and would
   *  otherwise burst out of the card. */
  wide = false,
): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f7f8fa;font-family:Arial,Helvetica,sans-serif;color:#1d2939">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${wide ? '' : 'max-width:820px;'}margin:0 auto;background:#fff;border:1px solid ${BORDER};border-radius:10px">
<tr><td style="padding:20px 24px;border-bottom:1px solid ${BORDER}">
<div style="font-size:18px;font-weight:bold;color:${BRAND}">${esc(title)}</div>
<div style="font-size:13px;color:${MUTED};margin-top:4px">${esc(subtitle)}</div>
</td></tr>
<tr><td style="padding:20px 24px">${inner}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid ${BORDER};font-size:11px;color:${MUTED}">
${esc(footer)}
</td></tr></table></body></html>`;
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
  return `<tr>${COLUMNS.map(
    (h, i) =>
      `<th style="text-align:${i === 0 ? 'left' : 'center'};padding:8px 6px;background:${HEAD_BG};border-bottom:1px solid ${BORDER};color:${MUTED};font-size:10px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap">${esc(h)}</th>`,
  ).join('')}</tr>`;
}

function agentSection(block: AgentBlock, isFirst: boolean): string {
  const meta = [
    block.employeeCode,
    block.tl ? `TL: ${block.tl}` : null,
    block.joiningDate ? `Joined ${block.joiningDate}` : null,
    block.zone,
    block.language,
  ].filter(Boolean).join(' · ');

  // The employee's details head their own section, so the four period rows
  // underneath are unambiguously theirs even when the table runs long.
  const identityRow = `<tr><td colspan="${COLUMNS.length}" style="padding:${isFirst ? '4px' : '18px'} 6px 6px;border-bottom:2px solid ${BRAND}">
<div style="font-size:14px;font-weight:bold;color:${BRAND}">${esc(block.name)}</div>
${meta ? `<div style="font-size:11px;color:${MUTED};margin-top:2px">${esc(meta)}</div>` : ''}
</td></tr>`;

  const rows = block.periods.map((f) => {
    const r = f.row;
    const cells = [
      `<span style="font-weight:bold">${esc(f.window.label)}</span><br><span style="color:${MUTED};font-size:10px">${esc(f.window.from === f.window.to ? f.window.from : `${f.window.from} → ${f.window.to}`)}</span>`,
      num(r?.dialedCalls),
      `<span style="color:#12805c">${num(r?.connectedCalls)}</span>`,
      `<span style="color:#b42318">${num(r?.notConnectedCalls)}</span>`,
      num(r?.applications),
      num(r?.admissions),
      talk(r),
      `<span style="font-weight:bold;color:${BRAND}">${esc(scoreText(f))}</span>`,
    ];
    return `<tr>${cells
      .map(
        (c, i) =>
          `<td style="text-align:${i === 0 ? 'left' : 'center'};padding:7px 6px;border-bottom:1px solid ${BORDER};font-size:13px">${c}</td>`,
      )
      .join('')}</tr>`;
  }).join('');

  return identityRow + headerRow() + rows;
}

export interface BuiltReport {
  subject: string;
  html: string;
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
      : `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
${blocks.map((b, i) => agentSection(b, i === 0)).join('')}
</table>`;

  return {
    // Constant on purpose — see THREADING above.
    subject: DEFAULT_EMAIL_SUBJECTS.TEAM_SUMMARY,
    html: shell('Team performance', `As at ${today}`, inner),
    csv: toCsv(blocks),
    periodLabel: today,
    rows: blocks.map((b) => b.periods[0].row).filter(Boolean) as AgentReportRow[],
  };
}

/** One agent's own numbers, same four periods, addressed to them. */
export function buildAgentEmail(block: AgentBlock, today: string): BuiltReport {
  const inner = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
${agentSection(block, true)}
</table>`;

  return {
    subject: DEFAULT_EMAIL_SUBJECTS.AGENT_PERFORMANCE,
    html: shell(`Hello ${block.name}`, `Your activity as at ${today}`, inner),
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
  return `<a href="${esc(href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:13px;font-weight:bold">${esc(label)}</a>`;
}

/** Login details and the two links a new joiner needs on day one. */
export function buildWelcomeEmail(user: WelcomeRecipient): BuiltReport {
  const crmUrl = process.env.NEXTAUTH_URL || 'http://13.206.157.201';

  const detail = (label: string, value: string) =>
    `<tr>
<td style="padding:8px 10px;border:1px solid ${BORDER};background:${HEAD_BG};font-size:12px;color:${MUTED};white-space:nowrap">${esc(label)}</td>
<td style="padding:8px 10px;border:1px solid ${BORDER};font-size:13px;font-weight:bold">${value}</td>
</tr>`;

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
<a href="${DIALSHREE_AGENT_URL}" style="color:${BRAND}">${DIALSHREE_AGENT_URL}</a>
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
      'Sent automatically by the Counselling CRM when your account was created. If anything here looks wrong, tell your Manager.',
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

/**
 * Zebra + right-aligned numbers, the same treatment the agent tables get.
 *
 * `tight` trims the padding and type for the college table, which now carries a
 * column per outcome and can run to twenty-odd of them. Inline styles only —
 * Gmail and Outlook drop <style> blocks.
 */
function cell(
  v: unknown,
  opts: { bold?: boolean; align?: string; bg?: string; tight?: boolean } = {},
): string {
  const pad = opts.tight ? '5px 6px' : '7px 10px';
  const size = opts.tight ? '11px' : '12px';
  return `<td style="padding:${pad};border-bottom:1px solid ${BORDER};font-size:${size};` +
    `white-space:nowrap;text-align:${opts.align ?? 'left'};${opts.bold ? 'font-weight:bold;' : ''}` +
    `${opts.bg ? `background:${opts.bg};` : ''}">${esc(v)}</td>`;
}

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
    : `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;max-width:420px">
<tr>${cell('University/Institution Count', { bold: true, bg: '#fdf2e3' })}${cell(fb.universities, { bold: true, align: 'right', bg: '#fdf2e3' })}</tr>
${fb.rows.map((r) => `<tr>${cell(r.feedback)}${cell(r.leads, { align: 'right' })}</tr>`).join('\n')}
<tr>${cell('Total', { bold: true, bg: '#fdf2e3' })}${cell(fb.total, { bold: true, align: 'right', bg: '#fdf2e3' })}</tr>
</table>`;

  const csv = [
    ['University/Institution Count', fb.universities],
    ...fb.rows.map((r) => [r.feedback, r.leads]),
    ['Total', fb.total],
  ].map((cells) => cells.map(q).join(',')).join('\n');

  return {
    subject: DEFAULT_EMAIL_SUBJECTS.FEEDBACK_SUMMARY,
    html: shell('Feedback summary', w.label, inner, FEEDBACK_FOOTER),
    csv,
    periodLabel: w.label,
    rows: [],
  };
}

const FEEDBACK_FOOTER =
  'Sent automatically by the Counselling CRM. All dates are IST. Every lead is counted once, ' +
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
  const showOther = cb.totals.other > 0;

  const headers = ['University Name', 'Dialed', 'Connected', 'Connected %', 'Not Connected',
    ...(showOther ? ['Other'] : []), ...outcomes];
  const line = (name: string, r: typeof cb.totals) => [
    name, r.dialed, r.connected, r.connectedPct === null ? '—' : `${r.connectedPct}%`, r.notConnected,
    ...(showOther ? [r.other] : []), ...outcomes.map((o) => r.outcomes[o] ?? 0),
  ];

  const t = (v: unknown, i: number, extra: { bold?: boolean; bg?: string } = {}) =>
    cell(v, { ...extra, tight: true, align: i === 0 ? 'left' : 'right' });

  // Wrapped in an overflow-x container: a client wide enough shows the lot, and
  // a narrow one scrolls rather than squashing every column into unreadability.
  const inner = cb.rows.length === 0
    ? `<p style="font-size:13px;color:${MUTED}">No follow-ups were logged in this period.</p>`
    : `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:100%">
<tr>${line(w.label, cb.totals).map((v, i) => t(v, i, { bold: true, bg: '#fdf2e3' })).join('')}</tr>
<tr>${headers.map((h, i) => t(h, i, { bold: true, bg: HEAD_BG })).join('')}</tr>
${cb.rows.map((r) => `<tr>${line(r.college, r).map((v, i) => t(v, i)).join('')}</tr>`).join('\n')}
</table>
</div>`;

  // Body and attachment now carry the same columns, so the two can no longer
  // disagree about what happened.
  const allOutcomes = outcomes;
  const csvLine = (name: string, r: typeof cb.totals) => [
    name, r.dialed, r.connected, r.connectedPct === null ? '' : `${r.connectedPct}%`, r.notConnected,
    ...(showOther ? [r.other] : []), ...allOutcomes.map((o) => r.outcomes[o] ?? 0),
  ];
  const csv = [
    ['University Name', 'Dialed', 'Connected', 'Connected %', 'Not Connected',
      ...(showOther ? ['Other'] : []), ...allOutcomes],
    csvLine(w.label, cb.totals),
    ...cb.rows.map((r) => csvLine(r.college, r)),
  ].map((cells) => cells.map(q).join(',')).join('\n');

  return {
    subject: DEFAULT_EMAIL_SUBJECTS.COLLEGE_WISE,
    html: shell('University / College wise', w.label, inner, COLLEGE_FOOTER, true),
    csv,
    periodLabel: w.label,
    rows: [],
  };
}

const COLLEGE_FOOTER =
  'Sent automatically by the Counselling CRM. All dates are IST. The same leads as the ' +
  'feedback summary, counted the same way, so Dialed totals to the same number. Every outcome ' +
  'that occurred has a column here and in the attached CSV; scroll sideways if your mail app ' +
  'cannot fit them all.';
