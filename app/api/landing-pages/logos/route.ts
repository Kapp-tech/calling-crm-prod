import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { searchLmsColleges } from '@/lib/lms-api';

/**
 * College logos for the Landing Page list, keyed by KAPP College ID.
 *
 * Split out from /api/landing-pages on purpose. The links themselves come
 * straight from our own database and must appear instantly; logos come from the
 * LMS over the network. Fetching them in the same request would put a
 * third-party API on the critical path of a page counsellors open all day, and
 * a slow LMS would look like a slow CRM.
 *
 * The LMS has no lookup-by-id, so each college is found by searching its name
 * and matching on `college_id`. Matching on the id and not the name is what
 * makes this safe: a name search for "Sushant University" returns four
 * colleges, and picking the first would show the wrong badge.
 */

/** Small enough not to hammer the LMS, large enough to finish quickly. */
const CONCURRENCY = 5;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const colleges = await prisma.dropdownOption.findMany({
      where: {
        type: 'COLLEGE',
        isActive: true,
        landingPageUrl: { not: null },
        kappCollegeId: { not: null },
      },
      select: { value: true, kappCollegeId: true },
    });

    const logos: Record<string, string> = {};

    for (let i = 0; i < colleges.length; i += CONCURRENCY) {
      await Promise.all(
        colleges.slice(i, i + CONCURRENCY).map(async (c) => {
          const wanted = Number(c.kappCollegeId);
          if (!Number.isFinite(wanted)) return;
          try {
            // Cached for an hour inside lib/lms-api, so a full floor opening
            // this page costs one round of upstream calls, not one per view.
            const { data } = await searchLmsColleges({ search: c.value, page: 1, limit: 20 });
            const hit = data.find((r) => r.college_id === wanted);
            if (hit?.logo_img) logos[String(c.kappCollegeId)] = hit.logo_img;
          } catch {
            // A missing logo is cosmetic — the card falls back to a monogram.
            // Never let it fail the whole response.
          }
        }),
      );
    }

    return NextResponse.json({ logos });
  } catch (err) {
    console.error('[landing-pages logos GET]', err);
    return NextResponse.json({ logos: {} });
  }
}
