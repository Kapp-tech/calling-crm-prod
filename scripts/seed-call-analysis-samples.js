/**
 * Demo data for the Call Analysis page.
 *
 * Attaches a handful of plausible QA verdicts to REAL leads from this
 * database, so the page can be reviewed with realistic names, colleges and
 * agents instead of an empty state. The call logs it creates are synthetic —
 * DialShree never sent them — so every one is tagged `SAMPLE-CA-` in its
 * `uniqueId` and `sample: true` in its payload, which is what --clean matches
 * on. Nothing that arrived from the real dialer can be deleted by this script.
 *
 * The verdicts are written through the same mapping the webhook uses, and
 * deliberately cover the cases the page has to handle:
 *   - a clean excellent call
 *   - a good call with one weak criterion
 *   - an average call that needs review
 *   - a fatal compliance failure with red flags
 *   - a call the analyser only partly scored, with a null (N/A) criterion
 *
 * THIS IS A DEVELOPMENT TOOL. Do not run it against production.
 *
 *   node scripts/seed-call-analysis-samples.js          # report only
 *   node scripts/seed-call-analysis-samples.js --apply  # write
 *   node scripts/seed-call-analysis-samples.js --clean  # remove the samples
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const CLEAN = process.argv.includes('--clean');

const TAG = 'SAMPLE-CA-';

/** Recordings the dialer would have served. Synthetic: playback will 502. */
const REC = (n) => `https://dialer5.elisiontec.com/RECORDINGS/MP3/sample-${n}.mp3`;

const SAMPLES = [
  {
    key: 'excellent',
    minutesAgo: 95,
    talk: 412, ring: 23,
    recording: true,
    verdict: {
      qa_status: 'scored',
      qa_score: 92.4,
      qa_grade: 'Excellent',
      intent: 'Admission Confirmed',
      fatal_error: false,
      needs_review: false,
      red_flags: [],
      summary:
        'Counsellor opened with the approved introduction, confirmed the course and campus, and walked the student through fee structure and the scholarship cut-off accurately. Student agreed to pay the registration amount the same day; counsellor confirmed the payment link and set a callback.',
      qa_scores: {
        fraud: 100, correct_info: 100, questions_answered: 100, script: 95,
        communication: 90, listening: 92, objection_handling: 85,
        engagement: 88, outcome: 100, professional: 96,
      },
    },
  },
  {
    key: 'good',
    minutesAgo: 240,
    talk: 268, ring: 31,
    recording: true,
    verdict: {
      qa_status: 'scored',
      qa_score: 78.6,
      qa_grade: 'Good',
      intent: 'Follow Up Scheduled',
      fatal_error: false,
      needs_review: false,
      red_flags: [],
      summary:
        'Good rapport and accurate information on eligibility. The student raised a placement-record objection that the counsellor answered only in general terms, without quoting the published figures. Follow-up scheduled for Friday.',
      qa_scores: {
        fraud: 100, correct_info: 90, questions_answered: 75, script: 80,
        communication: 82, listening: 78, objection_handling: 55,
        engagement: 70, outcome: 75, professional: 88,
      },
    },
  },
  {
    key: 'average',
    minutesAgo: 1510,
    talk: 142, ring: 48,
    recording: true,
    verdict: {
      qa_status: 'scored',
      qa_score: 61.2,
      qa_grade: 'Average',
      intent: 'Not Interested',
      fatal_error: false,
      needs_review: true,
      red_flags: ['Course preference never confirmed'],
      summary:
        'Counsellor did not confirm which course the student had enquired about and quoted the MBA fee for what appears to be a B.Sc. enquiry. Student disengaged after two minutes. Call closed without a next step.',
      qa_scores: {
        fraud: 100, correct_info: 45, questions_answered: 50, script: 58,
        communication: 72, listening: 48, objection_handling: 40,
        engagement: 42, outcome: 30, professional: 80,
      },
    },
  },
  {
    key: 'fatal',
    minutesAgo: 2950,
    talk: 331, ring: 19,
    recording: true,
    verdict: {
      qa_status: 'scored',
      qa_score: 28.5,
      qa_grade: 'Poor',
      intent: 'Interested',
      fatal_error: true,
      needs_review: true,
      red_flags: [
        'Guaranteed admission promised without an entrance score',
        'Quoted a fee lower than the published structure',
        'Claimed a 100% placement record',
      ],
      summary:
        'Serious compliance failure. Counsellor told the student admission was guaranteed irrespective of the entrance score, quoted a first-year fee roughly 40,000 below the published structure, and claimed a 100% placement record. The student agreed to pay on the strength of those claims.',
      qa_scores: {
        fraud: 0, correct_info: 15, questions_answered: 60, script: 35,
        communication: 68, listening: 55, objection_handling: 30,
        engagement: 62, outcome: 20, professional: 45,
      },
    },
  },
  {
    key: 'partial',
    minutesAgo: 4380,
    recording: false,
    talk: 96, ring: 62,
    verdict: {
      qa_status: 'scored',
      qa_score: 84.1,
      qa_grade: 'Good',
      intent: 'Callback Requested',
      fatal_error: false,
      needs_review: false,
      red_flags: [],
      summary:
        'Short, correct and courteous. Student was driving and asked to be called back in the evening; counsellor confirmed the slot and ended the call. No objection was raised, so objection handling could not be assessed.',
      qa_scores: {
        fraud: 100, correct_info: 95, questions_answered: 88, script: 82,
        communication: 86, listening: 90, objection_handling: null,
        engagement: 74, outcome: 80, professional: 92,
      },
    },
  },
];

/** The webhook's own mapping, so seeded rows are shaped like delivered ones. */
function toRow(callLogId, v) {
  const metrics = v.qa_scores ?? null;
  return {
    callLogId,
    score: v.qa_score ?? null,
    maxScore: 100,
    qaStatus: v.qa_status ?? null,
    qaGrade: v.qa_grade ?? null,
    intent: v.intent ?? null,
    fatalError: Boolean(v.fatal_error),
    needsReview: Boolean(v.needs_review),
    redFlags: v.red_flags ?? [],
    summary: v.summary ?? null,
    metrics,
    scoredAt: v.scored_at ? new Date(v.scored_at) : new Date(),
    raw: v,
  };
}

async function clean() {
  const logs = await prisma.callLog.findMany({
    where: { uniqueId: { startsWith: TAG } },
    select: { id: true, uniqueId: true },
  });
  console.log(`${logs.length} sample call log(s) found.`);
  if (!logs.length) return;
  if (!APPLY && !CLEAN) return;
  const ids = logs.map((l) => l.id);
  const a = await prisma.callAnalysis.deleteMany({ where: { callLogId: { in: ids } } });
  const c = await prisma.callLog.deleteMany({ where: { id: { in: ids } } });
  console.log(`Removed ${a.count} analysis row(s) and ${c.count} call log(s).`);
}

async function main() {
  if (CLEAN) return clean();

  const leads = await prisma.lead.findMany({
    where: { assignedToId: { not: null }, name: { contains: ' ' }, phone: { not: '' } },
    select: {
      id: true, name: true, phone: true, college: true,
      assignedToId: true, assignedTo: { select: { name: true, email: true } },
    },
    orderBy: { id: 'asc' },
    take: SAMPLES.length,
  });

  if (leads.length < SAMPLES.length) {
    console.error(`Need ${SAMPLES.length} assigned leads, found ${leads.length}. Aborting.`);
    process.exitCode = 1;
    return;
  }

  console.log(APPLY ? 'Writing samples:\n' : 'DRY RUN — pass --apply to write:\n');
  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    const lead = leads[i];
    const startedAt = new Date(Date.now() - s.minutesAgo * 60_000);
    const uniqueId = `${TAG}${s.key}`;

    console.log(
      `  ${s.verdict.qa_grade.padEnd(9)} ${String(s.verdict.qa_score).padStart(5)}  ` +
      `${lead.id} ${lead.name} — ${lead.assignedTo?.name}` +
      `${s.verdict.fatal_error ? '  [FATAL]' : ''}${s.verdict.needs_review ? '  [review]' : ''}`,
    );
    if (!APPLY) continue;

    const call = await prisma.callLog.upsert({
      where: { uniqueId },
      update: {},
      create: {
        uniqueId,
        leadId: lead.id,
        agentId: lead.assignedToId,
        phoneNumber: lead.phone,
        agentFullName: lead.assignedTo?.name ?? null,
        agentEmail: lead.assignedTo?.email ?? null,
        callType: 'OUTBOUND',
        campaign: lead.college ?? null,
        startedAt,
        endedAt: new Date(startedAt.getTime() + (s.talk + s.ring) * 1000),
        durationSeconds: s.talk + s.ring,
        talkTimeSeconds: s.talk,
        ringTimeSeconds: s.ring,
        callStatus: 'CONNECTED',
        connected: true,
        recordingUrl: s.recording ? REC(s.key) : null,
        // Marks the row as seeded. --clean matches the uniqueId, but this
        // makes a sample obvious to anyone reading the raw payload too.
        payload: { sample: true, seededBy: 'scripts/seed-call-analysis-samples.js' },
      },
    });

    const verdict = {
      ...s.verdict,
      event_Id: `sample_evt_${s.key}`,
      lead_Id: lead.id,
      recording_Id: `sample_rec_${s.key}`,
      call_Id: call.id,
      call_Unique_Id: uniqueId,
      // Scored a few minutes after the call ended, as the real analyser would.
      scored_at: new Date(startedAt.getTime() + (s.talk + s.ring) * 1000 + 7 * 60_000).toISOString(),
    };
    const row = toRow(call.id, verdict);
    await prisma.callAnalysis.upsert({
      where: { callLogId: call.id },
      update: row,
      create: row,
    });
  }

  if (APPLY) {
    console.log(`\nDone. Remove them again with:  node ${process.argv[1].split('/').slice(-2).join('/')} --clean`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
