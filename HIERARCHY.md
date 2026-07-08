# Hierarchy & Permission Matrix

## Org Structure

```
Super Admin
├── Reports User(s)
├── Operations Group A
│   └── Ops User 1, Ops User 2 ...
├── Operations Group B
│   └── Ops User 3 ...
├── Team Alpha (TL: Rajesh)
│   ├── Agent: Priya
│   ├── Agent: Suresh
│   └── Agent: Meena
└── Team Beta (TL: Anjali)
    ├── Agent: Ravi
    └── Agent: Deepak
```

## Role Hierarchy Rules

| Role | Manager | Manages |
|---|---|---|
| SUPER_ADMIN | — | Everyone |
| REPORTS | SUPER_ADMIN | — |
| OPERATIONS | SUPER_ADMIN | — |
| COUNSELLING_TL | SUPER_ADMIN | COUNSELLING_AGENT (own team) |
| COUNSELLING_AGENT | COUNSELLING_TL | — |

## User Status Lifecycle

```
PENDING_APPROVAL  →  ACTIVE  →  INACTIVE
       ↑ (TL requests)    ↑ (SA approves)  ↑ (SA deactivates)
```

## Feature Permission Matrix

| Feature | SUPER_ADMIN | REPORTS | OPERATIONS | COUNSELLING_TL | COUNSELLING_AGENT |
|---|:---:|:---:|:---:|:---:|:---:|
| VIEW_REPORTS | ✅ | ✅ | ❌ | ❌ | ❌ |
| DOWNLOAD_DATA | ✅ | ✅ | ❌ | ❌ | ❌ |
| MASK_UNMASK_DATA | ✅ | ✅ | ❌ | ❌ | ❌ |
| UPLOAD_LEADS | ✅ | ❌ | ✅ | ❌ | ❌ |
| APPROVE_LEADS | ✅ | ✅ | ❌ | ❌ | ❌ |
| ASSIGN_LEADS | ✅ | ❌ | ❌ | ✅ | ❌ |
| VIEW_LEADS | ✅ | ❌ | ❌ | ✅ | ✅ |
| SUBMIT_FEEDBACK | ✅ | ❌ | ❌ | ❌ | ✅ |

> Super Admin permissions are locked and cannot be toggled.

## API Route Access

| Route | SA | REPORTS | OPS | TL | AGENT |
|---|:---:|:---:|:---:|:---:|:---:|
| GET /api/users/hierarchy | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST /api/users | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST /api/users/bulk-import | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST /api/users/[id]/approve | ✅ | ❌ | ❌ | ❌ | ❌ |
| GET /api/teams | ✅ | ❌ | ❌ | ✅ (own) | ❌ |
| POST /api/teams | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST /api/teams/[id]/agents | ✅ | ❌ | ❌ | ✅ (own team, PENDING) | ❌ |
| PATCH /api/teams/[id]/agents/[id]/transfer | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST /api/leads/bulk-assign | ✅ | ❌ | ❌ | ✅ | ❌ |
| POST /api/leads/auto-assign | ✅ | ❌ | ❌ | ✅ | ❌ |
| GET /api/leads/due-today | ✅ | ❌ | ❌ | ❌ | ✅ |
| GET /api/reports/performance | ✅ | ❌ | ❌ | ✅ (own) | ❌ |
| GET /api/reports/funnel | ✅ | ❌ | ❌ | ✅ (own) | ❌ |
| GET /api/activity-logs | ✅ | ❌ | ❌ | ❌ | ❌ |
| PATCH /api/permissions | ✅ | ❌ | ❌ | ❌ | ❌ |

## Hierarchy Utility Functions (`lib/permissions.ts`)

```ts
canAccessUser(actor, target)   // Can actor view/manage target?
canAssignLead(actor, lead)     // Can actor assign this lead?
isInHierarchy(actor, target)   // Is actor above target in chain?
generateEmployeeCode()         // Returns next EMP-XXX code
logActivity(params)            // Writes to ActivityLog table
```

## Agent Approval Workflow

1. TL calls `POST /api/teams/[id]/agents` → agent created with `status: PENDING_APPROVAL`
2. SA sees pending count badge in Org Tree
3. SA clicks agent node → drawer shows Approve / Reject buttons
4. `POST /api/users/[id]/approve` with `{ action: "APPROVE" | "REJECT" }`
5. On APPROVE: `status → ACTIVE`, `isActive → true`
6. On REJECT: `status → INACTIVE`, `rejectionReason` stored

## Lead Assignment Flow

**Single assign:** TL → Assign button → select agent → `POST /api/leads/[id]/assign`

**Bulk assign:** TL → check multiple leads → select agent from dropdown → `POST /api/leads/bulk-assign`

**Auto-assign (round-robin):** TL → check leads → Auto Assign → `POST /api/leads/auto-assign`
- Sorts agents by current load (fewest first)
- Distributes leads cyclically across agents

## Follow-up Due Today Logic

`GET /api/leads/due-today` returns feedbacks grouped by:
- **overdue** — `followUpDate < today 00:00`
- **today** — `followUpDate >= today 00:00 && < tomorrow 00:00`
- **upcoming** — `followUpDate >= tomorrow`

Sorted: overdue → today → upcoming (shown with colour coding in UI).
