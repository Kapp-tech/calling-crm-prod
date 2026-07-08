import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="ZONE"
        title="Manage Zones"
        description="Manage allowed geographic zone values. CSV uploads must use one of these exact values in the lead_zone field."
        placeholder="e.g. North"
      />
    </div>
  );
}
