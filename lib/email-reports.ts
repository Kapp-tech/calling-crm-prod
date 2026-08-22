import { EmailFrequency, EmailReportType, PrismaClient, Prisma } from '@prisma/client';
import { buildAgentReport, summariseAgentRows, AgentReportRow } from './reports';
import { reportWindowFor } from './email-schedule';

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

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(title: string, subtitle: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f7f8fa;font-family:Arial,Helvetica,sans-serif;color:#1d2939">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:760px;margin:0 auto;background:#fff;border:1px solid ${BORDER};border-radius:10px">
<tr><td style="padding:20px 24px;border-bottom:1px solid ${BORDER}">
<div style="font-size:18px;font-weight:bold;color:${BRAND}">${esc(title)}</div>
<div style="font-size:13px;color:${MUTED};margin-top:4px">${esc(subtitle)}</div>
</td></tr>
<tr><td style="padding:20px 24px">${inner}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid ${BORDER};font-size:11px;color:${MUTED}">
Sent automatically by the Counselling CRM. Figures cover the period named above, on IST dates.
</td></tr></table></body></html>`;
}

function statCards(cards: { label: string; value: string }[]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>${cards
    .map(
      (c) => `<td style="padding:0 6px 12px 0;vertical-align:top">
<div style="border:1px solid ${BORDER};border-radius:8px;padding:10px 12px">
<div style="font-size:11px;color:${MUTED}">${esc(c.label)}</div>
<div style="font-size:20px;font-weight:bold;color:${BRAND};margin-top:2px">${esc(c.value)}</div>
</div></td>`,
    )
    .join('')}</tr></table>`;
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return `<p style="font-size:13px;color:${MUTED}">No activity recorded for this period.</p>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:13px">
<tr>${headers
    .map(
      (h, i) =>
        `<th style="text-align:${i === 0 ? 'left' : 'center'};padding:8px 6px;border-bottom:2px solid ${BORDER};color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.04em">${esc(h)}</th>`,
    )
    .join('')}</tr>
${rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (c, i) =>
              `<td style="text-align:${i === 0 ? 'left' : 'center'};padding:8px 6px;border-bottom:1px solid ${BORDER}">${c}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')}</table>`;
}

const talktime = (r: AgentReportRow) => (r.avgTalktimeMin === null ? '—' : String(r.avgTalktimeMin));

export interface BuiltReport {
  subject: string;
  html: string;
  /** Present only when the rule asks for an attachment. */
  csv?: string;
  periodLabel: string;
  /** Empty when nobody in scope did anything worth mailing about. */
  rows: AgentReportRow[];
}

/** The management view: every agent in scope, with a team roll-up on top. */
export async function buildTeamSummary(
  db: PrismaClient,
  scope: Prisma.UserWhereInput,
  frequency: EmailFrequency,
  now: Date,
): Promise<BuiltReport> {
  const w = reportWindowFor(frequency, now);
  const { rows } = await buildAgentReport(db, scope, 'DATEWISE', w.from, w.to, now);
  const s = summariseAgentRows(rows);

  const inner =
    statCards([
      { label: 'Agents', value: String(s.totalAgents) },
      { label: 'Dialed', value: String(s.dialedCalls) },
      { label: 'Connected', value: String(s.connectedCalls) },
      { label: 'Applications', value: String(s.applications) },
      { label: 'Admissions', value: String(s.admissions) },
    ]) +
    table(
      ['Agent', 'Working days', 'Dialed', 'Connected', 'Not connected', 'Applications', 'Admissions', 'Avg talktime'],
      rows.map((r) => [
        `<strong>${esc(r.name)}</strong>${r.employeeCode ? `<br><span style="color:${MUTED};font-size:11px">${esc(r.employeeCode)}</span>` : ''}`,
        String(r.workingDays),
        String(r.dialedCalls),
        `<span style="color:#12805c">${r.connectedCalls}</span>`,
        `<span style="color:#b42318">${r.notConnectedCalls}</span>`,
        String(r.applications),
        String(r.admissions),
        talktime(r),
      ]),
    );

  const head = [
    'Agent', 'Employee Code', 'Working Days', 'Dialed', 'Connected',
    'Not Connected', 'Applications', 'Admissions', 'Avg Talktime (min)',
  ];
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    head.map(q).join(','),
    ...rows.map((r) =>
      [r.name, r.employeeCode ?? '', r.workingDays, r.dialedCalls, r.connectedCalls,
       r.notConnectedCalls, r.applications, r.admissions, r.avgTalktimeMin ?? ''].map(q).join(','),
    ),
  ].join('\n');

  return {
    subject: `Team performance — ${w.label}`,
    html: shell('Team performance', w.label, inner),
    csv,
    periodLabel: w.label,
    rows,
  };
}

/** One agent's own numbers, addressed to them. */
export function buildAgentEmail(row: AgentReportRow, periodLabel: string): BuiltReport {
  const inner =
    statCards([
      { label: 'Dialed', value: String(row.dialedCalls) },
      { label: 'Connected', value: String(row.connectedCalls) },
      { label: 'Applications', value: String(row.applications) },
      { label: 'Admissions', value: String(row.admissions) },
    ]) +
    table(
      ['Measure', 'You'],
      [
        ['Working days', String(row.workingDays)],
        ['Calls dialed', String(row.dialedCalls)],
        ['Connected', String(row.connectedCalls)],
        ['Not connected', String(row.notConnectedCalls)],
        ['Applications', String(row.applications)],
        ['Admissions', String(row.admissions)],
        ['Average talktime (min)', talktime(row)],
      ],
    );

  return {
    subject: `Your performance — ${periodLabel}`,
    html: shell(`Hello ${row.name}`, `Your activity for ${periodLabel}`, inner),
    periodLabel,
    rows: [row],
  };
}

export const REPORT_TYPE_LABEL: Record<EmailReportType, string> = {
  AGENT_PERFORMANCE: 'Agent performance (one email per agent)',
  TEAM_SUMMARY: 'Team summary (one email listing every agent)',
};
