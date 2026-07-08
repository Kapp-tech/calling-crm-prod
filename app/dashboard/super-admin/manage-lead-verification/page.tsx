import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="LEAD_VERIFICATION"
        title="Manage Lead Verification"
        description="Manage allowed lead verification status values. CSV uploads must use one of these exact values in the lead_verification field."
        placeholder="e.g. Verified"
      />
    </div>
  );
}
