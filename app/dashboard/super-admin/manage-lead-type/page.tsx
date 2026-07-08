import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="LEAD_TYPE"
        title="Manage Lead Types"
        description="Manage allowed lead type values. CSV uploads must use one of these exact values in the lead_type field."
        placeholder="e.g. Google Ads"
      />
    </div>
  );
}
