'use client';

import { IntegrationsListPage } from '@/components/lead-integrations/integrations-list';

/**
 * Webhooks — the recording side of the same integrations engine.
 *
 * Its own route rather than a query param on Lead Integrations: the sidebar
 * decides the active entry from `pathname`, which drops the query string, so
 * `?kind=recording` could never highlight Webhooks and always highlighted Lead
 * Integrations — the right page looked like the wrong one. A distinct path
 * fixes the highlight, the title and the back button together, while the
 * screen itself stays one component.
 */
export default function WebhooksPage() {
  return <IntegrationsListPage kind="recording" />;
}
