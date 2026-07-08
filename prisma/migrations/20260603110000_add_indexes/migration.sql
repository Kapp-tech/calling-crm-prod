-- CreateIndex: User indexes
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_teamId_idx" ON "User"("teamId");
CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User"("isActive");
CREATE INDEX IF NOT EXISTS "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex: Lead indexes
CREATE INDEX IF NOT EXISTS "Lead_status_idx" ON "Lead"("status");
CREATE INDEX IF NOT EXISTS "Lead_assignedToId_idx" ON "Lead"("assignedToId");
CREATE INDEX IF NOT EXISTS "Lead_teamId_idx" ON "Lead"("teamId");
CREATE INDEX IF NOT EXISTS "Lead_uploadedById_idx" ON "Lead"("uploadedById");
CREATE INDEX IF NOT EXISTS "Lead_batchId_idx" ON "Lead"("batchId");
CREATE INDEX IF NOT EXISTS "Lead_status_teamId_idx" ON "Lead"("status", "teamId");
CREATE INDEX IF NOT EXISTS "Lead_status_assignedToId_idx" ON "Lead"("status", "assignedToId");

-- CreateIndex: LeadFeedback indexes
CREATE INDEX IF NOT EXISTS "LeadFeedback_leadId_idx" ON "LeadFeedback"("leadId");
CREATE INDEX IF NOT EXISTS "LeadFeedback_agentId_idx" ON "LeadFeedback"("agentId");
CREATE INDEX IF NOT EXISTS "LeadFeedback_feedbackOptionId_idx" ON "LeadFeedback"("feedbackOptionId");
CREATE INDEX IF NOT EXISTS "LeadFeedback_createdAt_idx" ON "LeadFeedback"("createdAt");

-- CreateIndex: FeedbackOption indexes
CREATE INDEX IF NOT EXISTS "FeedbackOption_isActive_idx" ON "FeedbackOption"("isActive");
CREATE INDEX IF NOT EXISTS "FeedbackOption_isActive_sortOrder_idx" ON "FeedbackOption"("isActive", "sortOrder");

-- CreateIndex: ActivityLog indexes
CREATE INDEX IF NOT EXISTS "ActivityLog_userId_idx" ON "ActivityLog"("userId");
CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_action_idx" ON "ActivityLog"("action");
