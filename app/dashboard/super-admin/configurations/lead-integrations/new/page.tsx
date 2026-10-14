'use client';

import { useSearchParams } from 'next/navigation';
import { LeadIntegrationBuilder } from '@/components/lead-integrations/integration-builder';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

export default function NewLeadIntegrationPage() {
  // ?kind comes from whichever list the user pressed Add on, so a webhook
  // started from the Webhooks page opens on the recording trigger instead of
  // quietly defaulting to referral and never firing.
  const isRecording = useSearchParams().get('kind') === 'recording';

  return (
    <PinGate
      action={PIN_GATED_ACTIONS.LEAD_INTEGRATIONS}
      title={isRecording ? 'Webhooks' : 'Lead Integrations'}
    >
      <LeadIntegrationBuilder defaultTrigger={isRecording ? 'RECORDING_RECEIVED' : 'REFERRAL_CREATED'} />
    </PinGate>
  );
}
