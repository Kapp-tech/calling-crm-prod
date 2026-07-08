-- CreateTable
CREATE TABLE "LeadProfile" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "budget" TEXT,
    "preferredCourseIds" JSONB,
    "preferredCollegeIds" JSONB,
    "preferredCityNames" JSONB,
    "preferredStateNames" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadProfile_leadId_key" ON "LeadProfile"("leadId");

-- AddForeignKey
ALTER TABLE "LeadProfile" ADD CONSTRAINT "LeadProfile_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
