import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="DEAL_TYPE"
        title="Manage Deal Type"
        description="Manage allowed deal type values. CSV uploads and the API must use one of these exact values in the deal_type field."
        placeholder="e.g. New Business"
      />
    </div>
  );
}
