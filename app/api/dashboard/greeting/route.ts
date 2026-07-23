import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTodaysHoliday } from '@/lib/holidays';

// Powers the "Happy <Holiday>!" banner on the dashboard — available to every
// signed-in role, since it's just a friendly greeting, not sensitive data.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const holiday = await getTodaysHoliday();
  return NextResponse.json({ holiday });
}
