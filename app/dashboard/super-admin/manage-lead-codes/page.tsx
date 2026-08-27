import { DropdownOptionsManager } from '@/components/admin/dropdown-options-manager';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <DropdownOptionsManager
        type="LEAD_CODE"
        title="LeadCode List"
        description="Map a lead code to a Data Calling Type. Every lead carrying that code shows the mapped value on All Leads, replacing whatever it had — applied the moment you save, and to new leads as they arrive. Matching ignores capitalisation."
        placeholder="e.g. CKT200"
        leadCodeMapping
      />
    </div>
  );
}
