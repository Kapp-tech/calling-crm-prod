import { LeadIntegrationBuilder } from '@/components/lead-integrations/integration-builder';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

export default function EditLeadIntegrationPage({ params }: { params: { id: string } }) {
  return (
    <PinGate action={PIN_GATED_ACTIONS.LEAD_INTEGRATIONS} title="Lead Integrations">
      <LeadIntegrationBuilder integrationId={params.id} />
    </PinGate>
  );
}
