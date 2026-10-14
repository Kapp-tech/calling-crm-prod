'use client';

import { IntegrationsListPage } from '@/components/lead-integrations/integrations-list';

/** Configurations → Lead Integrations: the referral/preferences side. */
export default function LeadIntegrationsPage() {
  return <IntegrationsListPage kind="referral" />;
}
