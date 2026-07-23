import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// Shows a "Happy <Holiday>!" banner on the dashboard for everyone on days
// that are a public holiday/observance in India, sourced from Calendarific.
//
// Calendarific's free tier caps at 500 calls/month, but a single call
// returns EVERY holiday for the whole country+year at once — so this only
// ever calls the API once per year (the first time someone loads the
// dashboard after Jan 1st with no cache yet for that year), and every other
// request for the rest of the year is a plain DB lookup. The year itself is
// derived from the current date, so it rolls over automatically every
// January without any code/config change.
const COUNTRY = 'IN';
const API_BASE = 'https://calendarific.com/api/v2/holidays';
const FETCH_TIMEOUT_MS = 10_000;

interface CalendarificHoliday {
  name: string;
  description?: string;
  date: { iso: string };
  type: string[];
}

export interface TodaysHoliday {
  name: string;
  description?: string;
  type: string[];
}

// Preference order when more than one holiday falls on the same day (e.g. a
// national holiday alongside a minor observance) — pick the most significant.
const TYPE_PRIORITY = [
  'National holiday',
  'Gazetted holiday',
  'Restricted holiday',
  'Local holiday',
  'Common local holiday',
  'Observance',
];

function pickBest(holidays: CalendarificHoliday[]): CalendarificHoliday | null {
  if (holidays.length === 0) return null;
  let best = holidays[0];
  let bestRank = Infinity;
  for (const h of holidays) {
    for (const t of h.type ?? []) {
      const rank = TYPE_PRIORITY.indexOf(t);
      if (rank !== -1 && rank < bestRank) {
        bestRank = rank;
        best = h;
      }
    }
  }
  return best;
}

/** Today's date/year in India Standard Time, independent of the server's own timezone. */
function getISTParts(): { year: number; dateStr: string } {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // en-CA locale → "YYYY-MM-DD", matching Calendarific's date.iso format
  return { year: parseInt(dateStr.slice(0, 4), 10), dateStr };
}

async function fetchAndCacheYear(year: number): Promise<CalendarificHoliday[]> {
  const apiKey = process.env.CALENDARIFIC_API_KEY;
  if (!apiKey) throw new Error('CALENDARIFIC_API_KEY is not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let holidays: CalendarificHoliday[];
  try {
    const res = await fetch(`${API_BASE}?api_key=${apiKey}&country=${COUNTRY}&year=${year}`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Calendarific API request failed: HTTP ${res.status}`);
    const json = await res.json();
    holidays = json?.response?.holidays ?? [];
  } finally {
    clearTimeout(timeout);
  }

  const jsonData = holidays as unknown as Prisma.InputJsonValue;
  await prisma.holidayCache.upsert({
    where: { country_year: { country: COUNTRY, year } },
    create: { country: COUNTRY, year, data: jsonData },
    update: { data: jsonData, fetchedAt: new Date() },
  });

  return holidays;
}

/** Returns today's holiday (India), if any — null on any weekday/non-holiday
 * or if the Calendarific API is unreachable (never throws). */
export async function getTodaysHoliday(): Promise<TodaysHoliday | null> {
  try {
    const { year, dateStr } = getISTParts();

    const cached = await prisma.holidayCache.findUnique({ where: { country_year: { country: COUNTRY, year } } });
    const holidays = cached ? (cached.data as unknown as CalendarificHoliday[]) : await fetchAndCacheYear(year);

    const best = pickBest(holidays.filter((h) => h.date?.iso === dateStr));
    if (!best) return null;
    return { name: best.name, description: best.description, type: best.type };
  } catch (err) {
    console.error('[holidays] getTodaysHoliday failed', err);
    return null;
  }
}
