import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { agentTagFor, hasAgentToken, resolveLandingPageUrl } from '@/lib/landing-page';

/**
 * The landing links a counsellor can share, already personalised.
 *
 * Open to every signed-in role: this is a list of the colleges' own public
 * application pages, not lead data. The only per-user part is the agent ID
 * stitched into each URL, and that is taken from the session — never from the
 * request — so nobody can pull a link tagged as somebody else.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [me, colleges] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { employeeCode: true },
      }),
      prisma.dropdownOption.findMany({
        where: { type: 'COLLEGE', isActive: true, landingPageUrl: { not: null } },
        orderBy: [{ value: 'asc' }],
        select: {
          id: true,
          value: true,
          kappCollegeId: true,
          collegeZone: true,
          collegeDealType: true,
          landingPageUrl: true,
        },
      }),
    ]);

    const agentTag = agentTagFor(me?.employeeCode);

    return NextResponse.json({
      agentTag,
      employeeCode: me?.employeeCode ?? null,
      items: colleges.map((c) => {
        const template = c.landingPageUrl ?? '';
        const personalised = hasAgentToken(template);
        return {
          id: c.id,
          college: c.value,
          kappCollegeId: c.kappCollegeId,
          zone: c.collegeZone,
          dealType: c.collegeDealType,
          personalised,
          // Left as the raw template when we have no ID to substitute, so the
          // UI can show exactly what is wrong instead of handing over a link
          // with a broken tag in it.
          url: resolveLandingPageUrl(template, agentTag),
          // A link with no token is complete for everyone; only a tokened link
          // is unusable without an employee code.
          blocked: personalised && !agentTag,
        };
      }),
    });
  } catch (err) {
    console.error('[landing-pages GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
