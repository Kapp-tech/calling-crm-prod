# Counselling CRM

A full-stack Lead Management System built with Next.js 14 (App Router), PostgreSQL, Prisma, NextAuth.js, and Tailwind CSS.

---

## Prerequisites

- **Node.js** 18+ and **npm**
- **PostgreSQL** 14+ running locally (or a hosted instance)
- **Git** (optional)

---

## Quick Start

### 1. Clone / navigate to the project

```bash
cd "Counselling CRM"
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in your values:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/counselling_crm?schema=public"
NEXTAUTH_SECRET="<run: openssl rand -base64 32>"
NEXTAUTH_URL="http://localhost:3000"
```

### 4. Create the database

```sql
-- In psql or pgAdmin:
CREATE DATABASE counselling_crm;
```

### 5. Run Prisma migrations

```bash
npx prisma migrate dev --name init
```

### 6. Seed the database

```bash
npx prisma db seed
```

### 7. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Seed Credentials

All seed users share the password: **`Password@123`**

| Role               | Email                  | Password       |
|--------------------|------------------------|----------------|
| Super Admin        | superadmin@crm.com     | Password@123   |
| Reports            | reports@crm.com        | Password@123   |
| Operations         | operations@crm.com     | Password@123   |
| Counselling TL     | tl@crm.com             | Password@123   |
| Counselling Agent  | agent@crm.com          | Password@123   |

---

## Available npm Scripts

| Script              | Description                          |
|---------------------|--------------------------------------|
| `npm run dev`       | Start development server             |
| `npm run build`     | Build for production                 |
| `npm run start`     | Start production server              |
| `npm run lint`      | Run ESLint                           |
| `npm run db:generate` | Regenerate Prisma client           |
| `npm run db:migrate` | Run database migrations             |
| `npm run db:push`   | Push schema without migrations       |
| `npm run db:seed`   | Seed database with test data         |
| `npm run db:studio` | Open Prisma Studio (DB GUI)          |

---

## User Roles & Features

### SUPER_ADMIN
- Full access to all features
- Create, edit, deactivate users and assign roles
- Permission matrix: toggle feature access per role
- View all leads across all stages

### REPORTS
- View all leads (PENDING, APPROVED, DISAPPROVED)
- Approve or Disapprove individual leads or entire batches (bulk select)
- Delete disapproved leads
- Export leads as CSV
- Mask/Unmask phone & email (if permission granted)

### OPERATIONS
- Upload lead CSV files (drag & drop or click to browse)
- Preview CSV before submission
- View upload history

### COUNSELLING_TL
- View all APPROVED unassigned leads
- Assign leads to agents in their team
- View all leads assigned by them
- See agent performance summary

### COUNSELLING_AGENT
- View leads assigned to them
- Submit call feedback (up to 5 follow-ups per lead)
- Call statuses: Interested / Not Interested / Call Back / Not Reachable / Wrong Number
- Leads are locked after 5 follow-ups

---

## CSV Upload Format

The CSV file must have these column headers (case-insensitive):

```
name, email, phone, city, state, course, college, campaign, lead_type, lead_origin, lead_zone
```

**Required columns:** `name`, `email`, `phone`
**Optional columns:** all others

---

## Project Structure

```
/app
  /api              — API routes (auth, users, leads, permissions, feedback, upload)
  /dashboard        — Role-based dashboard pages
    /super-admin    — User management + permission matrix
    /operations     — CSV upload
    /reports        — Lead approval/rejection
    /counselling-tl — Lead assignment
    /counselling-agent — Feedback submission
  /login            — Authentication page
/components
  /ui               — shadcn/ui components
  /shared           — Sidebar, Header
  /leads            — Lead detail modal
/lib
  prisma.ts         — Prisma singleton
  auth.ts           — NextAuth config
  permissions.ts    — Permission helpers
  csv-parser.ts     — CSV parsing + masking utilities
  utils.ts          — Shared utilities
/prisma
  schema.prisma     — Database schema
  seed.ts           — Seed data
/types
  next-auth.d.ts    — Type extensions
```

---

## Security

- Passwords hashed with **bcryptjs** (12 rounds)
- All API routes validate session and role before responding
- Role-based route protection via **Next.js middleware**
- Input validation on all API routes using **Zod**
- Phone/email masking based on permission flags

---

## Tech Stack

| Layer        | Technology                     |
|--------------|-------------------------------|
| Framework    | Next.js 14 (App Router)        |
| Database     | PostgreSQL                     |
| ORM          | Prisma 5                       |
| Auth         | NextAuth.js v4                 |
| Styling      | Tailwind CSS + shadcn/ui       |
| State        | TanStack Query v5              |
| Forms        | React Hook Form + Zod          |
| CSV Parsing  | PapaParse                      |
| Icons        | Lucide React                   |
