import { prisma } from '@/lib/prisma';
import type { Attendance, AttendanceBreak, BreakType } from '@prisma/client';

// All shift/break/idle bookkeeping is keyed to this timezone regardless of
// where the server process happens to run, so "today" always means the
// counselling team's actual calendar day.
const ATTENDANCE_TIMEZONE = 'Asia/Kolkata';

// Zero mouse/keyboard activity for this long counts as Idle time.
export const IDLE_THRESHOLD_SECONDS = 60;

// How often the client is expected to report in while punched in.
export const HEARTBEAT_INTERVAL_SECONDS = 20;

export function getAttendanceDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ATTENDANCE_TIMEZONE }).format(d);
}

export type AttendanceWithBreaks = Attendance & { breaks: AttendanceBreak[] };

export type AttendanceStatus = 'NOT_PUNCHED_IN' | 'WORKING' | 'ON_BREAK' | 'PUNCHED_OUT';

// A break recorded before break categorization existed (or any future data
// gap) has a null type — bucketed as "OTHER" rather than guessed into one of
// the three real categories.
export type BreakCategory = BreakType | 'OTHER';

export type BreakSecondsByType = Record<BreakCategory, number>;

function emptyBreakSecondsByType(): BreakSecondsByType {
  return { LUNCH: 0, BIO: 0, TEA: 0, OTHER: 0 };
}

export interface AttendanceSummary {
  status: AttendanceStatus;
  punchInAt: string | null;
  punchOutAt: string | null;
  breakSeconds: number;
  breakSecondsByType: BreakSecondsByType;
  idleSeconds: number;
  activeSeconds: number;
  autoClosed: boolean;
  currentBreakStartAt: string | null;
  currentBreakType: BreakCategory | null;
}

function breakSecondsOf(breaks: AttendanceBreak[], now: Date): number {
  return breaks.reduce((sum, b) => {
    const end = b.endAt ?? now;
    return sum + Math.max(0, Math.floor((end.getTime() - b.startAt.getTime()) / 1000));
  }, 0);
}

function breakSecondsByTypeOf(breaks: AttendanceBreak[], now: Date): BreakSecondsByType {
  const totals = emptyBreakSecondsByType();
  for (const b of breaks) {
    const end = b.endAt ?? now;
    const seconds = Math.max(0, Math.floor((end.getTime() - b.startAt.getTime()) / 1000));
    const category: BreakCategory = b.type ?? 'OTHER';
    totals[category] += seconds;
  }
  return totals;
}

export function summarizeAttendance(record: AttendanceWithBreaks | null, now: Date = new Date()): AttendanceSummary {
  if (!record) {
    return {
      status: 'NOT_PUNCHED_IN', punchInAt: null, punchOutAt: null,
      breakSeconds: 0, breakSecondsByType: emptyBreakSecondsByType(), idleSeconds: 0, activeSeconds: 0,
      autoClosed: false, currentBreakStartAt: null, currentBreakType: null,
    };
  }

  const openBreak = record.breaks.find((b) => !b.endAt) ?? null;
  const breakSeconds = breakSecondsOf(record.breaks, now);

  const status: AttendanceStatus = record.punchOutAt
    ? 'PUNCHED_OUT'
    : openBreak
    ? 'ON_BREAK'
    : 'WORKING';

  return {
    status,
    punchInAt: record.punchInAt.toISOString(),
    punchOutAt: record.punchOutAt?.toISOString() ?? null,
    breakSeconds,
    breakSecondsByType: breakSecondsByTypeOf(record.breaks, now),
    idleSeconds: record.idleSeconds,
    // Active time is never derived from (punchOut - punchIn) — it's the raw
    // accumulator, only ever incremented by the heartbeat route based on
    // what the client's own Page-Visibility-gated tracking reports. See
    // MAX_HEARTBEAT_WINDOW_SECONDS below.
    activeSeconds: record.activeSeconds,
    autoClosed: record.autoClosed,
    currentBreakStartAt: openBreak?.startAt.toISOString() ?? null,
    currentBreakType: openBreak ? (openBreak.type ?? 'OTHER') : null,
  };
}

// Generous ceiling on how much (active + idle) one heartbeat call may ever
// report — purely a sanity backstop against a buggy/malicious client, NOT a
// way of estimating "real" elapsed time server-side.
//
// Earlier this used to clamp each call to HEARTBEAT_INTERVAL_SECONDS based
// on the gap since the previous heartbeat. That was wrong: browsers throttle
// timers in tabs that are open but not focused/visible (often to once a
// minute or slower), so a perfectly legitimate, still-open tab would have
// its heartbeat gap exceed one interval routinely — and capping it there
// silently under-counted real active time.
//
// The fix is to stop guessing from timing entirely. The client now tracks
// active/idle seconds itself, gated on document.visibilityState — it simply
// never increments either counter while the tab is hidden or closed, so
// there's nothing to "catch up" on when a heartbeat eventually arrives. The
// server's only remaining job is to trust that client-reported split, capped
// here just so a single call can never report something absurd.
export const MAX_HEARTBEAT_WINDOW_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 4;

// Closes out any shift(s) left open from a previous calendar day — covers
// the case where an agent's browser/laptop closed without an explicit punch
// out. The inferred punch-out time is the last heartbeat we ever recorded
// for that shift (falling back to the punch-in time itself if no heartbeat
// arrived at all), and any still-open break on that shift is closed at the
// same moment. Mirrors the lazy, request-triggered pattern already used by
// lib/scheduled-call-notifications.ts rather than a real cron job.
export async function closeStaleAttendanceRecords(opts: { userId?: string } = {}): Promise<void> {
  const today = getAttendanceDateString();

  const stale = await prisma.attendance.findMany({
    where: {
      punchOutAt: null,
      date: { not: today },
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    include: { breaks: true },
  });

  for (const record of stale) {
    const inferredCloseAt = record.lastHeartbeatAt ?? record.punchInAt;

    await prisma.$transaction([
      prisma.attendanceBreak.updateMany({
        where: { attendanceId: record.id, endAt: null },
        data: { endAt: inferredCloseAt },
      }),
      prisma.attendance.update({
        where: { id: record.id },
        data: { punchOutAt: inferredCloseAt, autoClosed: true },
      }),
    ]);
  }
}
