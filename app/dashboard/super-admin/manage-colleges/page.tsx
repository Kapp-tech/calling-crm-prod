import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="COLLEGE"
        title="Manage Colleges"
        description="Manage colleges. Each college requires a unique KAPP College ID. CSV uploads must use the KAPP College ID in the college field — it will be resolved to the college name automatically. Zone and Deal Type set here are applied to every lead ingested for the college."
        placeholder="e.g. IIT Delhi"
        idField={{ label: 'KAPP College ID', placeholder: 'e.g. KA001' }}
        collegeAttributes
      />
    </div>
  );
}
