import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="DATA_CALLING_TYPE"
        title="Manage Data Calling Type"
        description="Manage allowed data calling type values. CSV uploads must use one of these exact values in the data_calling_type field."
        placeholder="e.g. Cold Call"
      />
    </div>
  );
}
