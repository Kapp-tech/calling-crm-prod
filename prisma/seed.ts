import {
  PrismaClient,
  Role,
  Feature,
  UserStatus,
  LeadStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ALL_FEATURES: Feature[] = [
  Feature.VIEW_REPORTS, Feature.DOWNLOAD_DATA, Feature.MASK_UNMASK_DATA,
  Feature.UPLOAD_LEADS, Feature.APPROVE_LEADS, Feature.ASSIGN_LEADS,
  Feature.VIEW_LEADS, Feature.SUBMIT_FEEDBACK,
];

// Mirrors DEFAULT_PERMISSIONS in lib/permissions.ts. MASK_UNMASK_DATA now means
// "this role SEES MASKED data", so it sits on the roles that should be masked —
// not on REPORTS, who read real values. Seeding it the old way round would
// bring a fresh environment up masking the wrong people.
const DEFAULT_PERMISSIONS: Record<Role, Feature[]> = {
  SUPER_ADMIN: ALL_FEATURES,
  REPORTS: [Feature.VIEW_REPORTS, Feature.APPROVE_LEADS, Feature.DOWNLOAD_DATA],
  OPERATIONS: [Feature.UPLOAD_LEADS, Feature.MASK_UNMASK_DATA],
  COUNSELLING_TL: [Feature.VIEW_LEADS, Feature.ASSIGN_LEADS, Feature.MASK_UNMASK_DATA],
  COUNSELLING_AGENT: [Feature.VIEW_LEADS, Feature.SUBMIT_FEEDBACK],
};

let empCounter = 0;
function nextEmpCode() {
  empCounter++;
  return `EMP-${String(empCounter).padStart(3, '0')}`;
}

const HASH = bcrypt.hashSync('Password@123', 12);

const COURSES = ['B.Tech', 'MBA', 'BCA', 'MCA', 'B.Com', 'BA', 'BSc', 'M.Tech'];
const CITIES = ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune', 'Kolkata', 'Ahmedabad'];
const STATES = ['Delhi', 'Maharashtra', 'Karnataka', 'Tamil Nadu', 'Telangana', 'Maharashtra', 'West Bengal', 'Gujarat'];
const CAMPAIGNS = ['Google Ads', 'Facebook', 'LinkedIn', 'Walk-in', 'Referral', 'Email Campaign'];
const ZONES = ['North', 'South', 'East', 'West', 'Central'];
const ORIGINS = ['Online', 'Offline', 'App', 'Website', 'Phone'];

async function main() {
  console.log('🌱 Seeding database...\n');

  // ── Permissions ──────────────────────────────────────────────────────────────
  for (const role of Object.values(Role)) {
    const allowed = DEFAULT_PERMISSIONS[role] ?? [];
    for (const feature of ALL_FEATURES) {
      await prisma.permission.upsert({
        where: { role_feature: { role, feature } },
        update: { canAccess: allowed.includes(feature) },
        create: { role, feature, canAccess: allowed.includes(feature) },
      });
    }
  }
  console.log('✅ Permissions seeded');

  // ── Super Admin ───────────────────────────────────────────────────────────────
  const sa = await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'superadmin@crm.com',
      password: HASH,
      role: Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      isActive: true,
      employeeCode: nextEmpCode(),
      phone: '9000000001',
      joiningDate: new Date('2023-01-01'),
    },
  });

  // ── Reports ───────────────────────────────────────────────────────────────────
  const reports = await prisma.user.create({
    data: {
      name: 'Reports User',
      email: 'reports@crm.com',
      password: HASH,
      role: Role.REPORTS,
      status: UserStatus.ACTIVE,
      isActive: true,
      employeeCode: nextEmpCode(),
      phone: '9000000002',
      joiningDate: new Date('2023-02-01'),
      managerId: sa.id,
    },
  });

  // ── Operations Groups + Users ─────────────────────────────────────────────────
  const ops1 = await prisma.user.create({
    data: {
      name: 'Ops Alpha',
      email: 'ops.alpha@crm.com',
      password: HASH,
      role: Role.OPERATIONS,
      status: UserStatus.ACTIVE,
      isActive: true,
      employeeCode: nextEmpCode(),
      phone: '9000000003',
      joiningDate: new Date('2023-03-01'),
      managerId: sa.id,
    },
  });

  const ops2 = await prisma.user.create({
    data: {
      name: 'Ops Beta',
      email: 'ops.beta@crm.com',
      password: HASH,
      role: Role.OPERATIONS,
      status: UserStatus.ACTIVE,
      isActive: true,
      employeeCode: nextEmpCode(),
      phone: '9000000004',
      joiningDate: new Date('2023-04-01'),
      managerId: sa.id,
    },
  });

  const groupA = await prisma.operationsGroup.create({
    data: {
      name: 'Operations Group A',
      description: 'Primary operations team',
      managerId: sa.id,
      createdById: sa.id,
      members: { connect: [{ id: ops1.id }] },
    },
  });

  const groupB = await prisma.operationsGroup.create({
    data: {
      name: 'Operations Group B',
      description: 'Secondary operations team',
      managerId: sa.id,
      createdById: sa.id,
      members: { connect: [{ id: ops2.id }] },
    },
  });

  await prisma.user.update({ where: { id: ops1.id }, data: { operationsGroupId: groupA.id } });
  await prisma.user.update({ where: { id: ops2.id }, data: { operationsGroupId: groupB.id } });

  // ── TL 1 → Team Alpha ─────────────────────────────────────────────────────────
  const tl1 = await prisma.user.create({
    data: {
      name: 'Rajesh Kumar (TL)',
      email: 'tl.rajesh@crm.com',
      password: HASH,
      role: Role.COUNSELLING_TL,
      status: UserStatus.ACTIVE,
      isActive: true,
      employeeCode: nextEmpCode(),
      phone: '9000000005',
      joiningDate: new Date('2023-05-01'),
      managerId: sa.id,
    },
  });

  const teamAlpha = await prisma.team.create({
    data: {
      name: 'Team Alpha',
      description: 'Primary counselling team',
      teamLeadId: tl1.id,
      createdById: sa.id,
    },
  });

  await prisma.user.update({ where: { id: tl1.id }, data: { teamId: teamAlpha.id } });

  // Agents under TL1
  const agentData1 = [
    { name: 'Priya Sharma', email: 'agent.priya@crm.com', phone: '9000000006' },
    { name: 'Suresh Patel', email: 'agent.suresh@crm.com', phone: '9000000007' },
    { name: 'Meena Nair', email: 'agent.meena@crm.com', phone: '9000000008' },
  ];

  const agents1 = [];
  for (const a of agentData1) {
    const agent = await prisma.user.create({
      data: {
        name: a.name,
        email: a.email,
        password: HASH,
        role: Role.COUNSELLING_AGENT,
        status: UserStatus.ACTIVE,
        isActive: true,
        employeeCode: nextEmpCode(),
        phone: a.phone,
        joiningDate: new Date('2023-06-01'),
        managerId: tl1.id,
        managedById: tl1.id,
        teamId: teamAlpha.id,
      },
    });
    agents1.push(agent);
  }

  // ── TL 2 → Team Beta ──────────────────────────────────────────────────────────
  const tl2 = await prisma.user.create({
    data: {
      name: 'Anjali Singh (TL)',
      email: 'tl.anjali@crm.com',
      password: HASH,
      role: Role.COUNSELLING_TL,
      status: UserStatus.ACTIVE,
      isActive: true,
      employeeCode: nextEmpCode(),
      phone: '9000000009',
      joiningDate: new Date('2023-05-15'),
      managerId: sa.id,
    },
  });

  const teamBeta = await prisma.team.create({
    data: {
      name: 'Team Beta',
      description: 'Secondary counselling team',
      teamLeadId: tl2.id,
      createdById: sa.id,
    },
  });

  await prisma.user.update({ where: { id: tl2.id }, data: { teamId: teamBeta.id } });

  const agentData2 = [
    { name: 'Ravi Verma', email: 'agent.ravi@crm.com', phone: '9000000010' },
    { name: 'Deepak Mehta', email: 'agent.deepak@crm.com', phone: '9000000011' },
  ];

  const agents2 = [];
  for (const a of agentData2) {
    const agent = await prisma.user.create({
      data: {
        name: a.name,
        email: a.email,
        password: HASH,
        role: Role.COUNSELLING_AGENT,
        status: UserStatus.ACTIVE,
        isActive: true,
        employeeCode: nextEmpCode(),
        phone: a.phone,
        joiningDate: new Date('2023-07-01'),
        managerId: tl2.id,
        managedById: tl2.id,
        teamId: teamBeta.id,
      },
    });
    agents2.push(agent);
  }

  console.log('✅ Users, Teams, Groups seeded');

  // ── Upload Batch ──────────────────────────────────────────────────────────────
  const batch = await prisma.uploadBatch.create({
    data: { fileName: 'leads-seed.csv', uploadedById: ops1.id, totalRecords: 50, status: 'COMPLETED' },
  });

  // ── 50 Leads ──────────────────────────────────────────────────────────────────
  const allAgents = [...agents1, ...agents2];
  const leadInserts = [];

  for (let i = 0; i < 50; i++) {
    const isApproved = i < 40;
    const isAssigned = i < 30;
    const agentIdx = i % allAgents.length;
    const agent = allAgents[agentIdx];
    const team = agentIdx < 3 ? teamAlpha : teamBeta;

    leadInserts.push({
      name: `Lead Person ${i + 1}`,
      email: `lead${i + 1}@example.com`,
      phone: `98${String(10000000 + i)}`,
      city: CITIES[i % CITIES.length],
      state: STATES[i % STATES.length],
      course: COURSES[i % COURSES.length],
      college: `College ${(i % 10) + 1}`,
      campaign: CAMPAIGNS[i % CAMPAIGNS.length],
      leadType: i % 2 === 0 ? 'Hot' : 'Cold',
      leadOrigin: ORIGINS[i % ORIGINS.length],
      leadZone: ZONES[i % ZONES.length],
      status: isApproved ? LeadStatus.APPROVED : LeadStatus.PENDING,
      uploadedById: i % 2 === 0 ? ops1.id : ops2.id,
      approvedById: isApproved ? reports.id : null,
      assignedToId: isAssigned ? agent.id : null,
      assignedById: isAssigned ? (agentIdx < 3 ? tl1.id : tl2.id) : null,
      teamId: isAssigned ? team.id : null,
      batchId: batch.id,
    });
  }

  // updatedAt is no longer @updatedAt (see schema.prisma), so seeds must set it.
  await prisma.lead.createMany({ data: leadInserts.map((l) => ({ ...l, updatedAt: new Date() })) });
  const leads = await prisma.lead.findMany({ where: { assignedToId: { not: null } }, take: 20 });

  // ── Feedback Options ──────────────────────────────────────────────────────────
  const feedbackOptionLabels = [
    { label: 'Interested', description: 'Lead expressed interest in enrolling', sortOrder: 1 },
    { label: 'Call Back', description: 'Lead requested a callback at a later time', sortOrder: 2 },
    { label: 'Not Reachable', description: 'Unable to connect with the lead', sortOrder: 3 },
    { label: 'Not Interested', description: 'Lead explicitly not interested', sortOrder: 4 },
    { label: 'Wrong Number', description: 'Phone number is incorrect or not registered', sortOrder: 5 },
  ];

  const feedbackOptions = await Promise.all(
    feedbackOptionLabels.map((opt) =>
      prisma.feedbackOption.create({
        data: { ...opt, createdBy: sa.id },
      })
    )
  );

  console.log('✅ Feedback options seeded');

  // ── 20 Feedbacks ──────────────────────────────────────────────────────────────
  for (let i = 0; i < 20; i++) {
    const lead = leads[i % leads.length];
    const agentId = lead.assignedToId!;
    const existingCount = await prisma.leadFeedback.count({ where: { leadId: lead.id } });
    if (existingCount >= 5) continue;

    const option = feedbackOptions[i % feedbackOptions.length];
    await prisma.leadFeedback.create({
      data: {
        leadId: lead.id,
        agentId,
        feedbackOptionId: option.id,
        remarks: `Follow-up call ${i + 1} — ${option.label.toLowerCase()}`,
        followUpNumber: existingCount + 1,
      },
    });
  }

  console.log('✅ Leads + Feedbacks seeded');

  // ── Activity Logs ─────────────────────────────────────────────────────────────
  await prisma.activityLog.createMany({
    data: [
      { userId: sa.id, action: 'TEAM_CREATED', targetId: teamAlpha.id, targetType: 'Team', description: 'Created Team Alpha' },
      { userId: sa.id, action: 'TEAM_CREATED', targetId: teamBeta.id, targetType: 'Team', description: 'Created Team Beta' },
      { userId: ops1.id, action: 'CSV_UPLOADED', targetId: batch.id, targetType: 'UploadBatch', description: 'Uploaded leads-seed.csv (50 records)' },
    ],
  });

  console.log('✅ Activity logs seeded\n');
  console.log('─'.repeat(55));
  console.log('Login credentials (all use password: Password@123)');
  console.log('─'.repeat(55));
  console.log(`  Super Admin     : superadmin@crm.com`);
  console.log(`  Reports         : reports@crm.com`);
  console.log(`  Operations A    : ops.alpha@crm.com`);
  console.log(`  Operations B    : ops.beta@crm.com`);
  console.log(`  TL (Team Alpha) : tl.rajesh@crm.com`);
  console.log(`  TL (Team Beta)  : tl.anjali@crm.com`);
  console.log(`  Agent (Alpha)   : agent.priya@crm.com / agent.suresh@crm.com / agent.meena@crm.com`);
  console.log(`  Agent (Beta)    : agent.ravi@crm.com / agent.deepak@crm.com`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
