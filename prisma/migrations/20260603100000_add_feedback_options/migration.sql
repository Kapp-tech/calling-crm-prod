-- CreateTable: FeedbackOption
CREATE TABLE "FeedbackOption" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackOption_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey for FeedbackOption → User
ALTER TABLE "FeedbackOption" ADD CONSTRAINT "FeedbackOption_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Truncate existing feedback rows so we can safely drop callStatus (NOT NULL) and add feedbackOptionId (NOT NULL)
TRUNCATE TABLE "LeadFeedback";

-- Drop callStatus column (uses the CallStatus enum — must happen before DROP TYPE)
ALTER TABLE "LeadFeedback" DROP COLUMN "callStatus";

-- Drop followUpDate column
ALTER TABLE "LeadFeedback" DROP COLUMN "followUpDate";

-- Make remarks optional
ALTER TABLE "LeadFeedback" ALTER COLUMN "remarks" DROP NOT NULL;

-- Add feedbackOptionId (NOT NULL — safe because table is now empty)
ALTER TABLE "LeadFeedback" ADD COLUMN "feedbackOptionId" TEXT NOT NULL;

-- AddForeignKey for LeadFeedback → FeedbackOption
ALTER TABLE "LeadFeedback" ADD CONSTRAINT "LeadFeedback_feedbackOptionId_fkey"
    FOREIGN KEY ("feedbackOptionId") REFERENCES "FeedbackOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop the CallStatus enum (no longer referenced by any column)
DROP TYPE IF EXISTS "CallStatus";
