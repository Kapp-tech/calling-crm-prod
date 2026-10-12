// The single source of truth for which lead fields a Lead Integration's JSON
// body template can reference via {{field}}. Purely static data (no DB call)
// so the field-picker sidebar can render instantly on both the create and
// edit builder pages. Keep FIELD_CATALOG's `key`s in sync with
// buildLeadTemplateData()'s output keys below — the picker only makes sense
// if what you click actually resolves to a value at send time.

export type FieldGroup = 'Lead' | 'Agent' | 'LeadProfile' | 'System';

export interface FieldDef {
  key: string;
  label: string;
  group: FieldGroup;
  isArray?: boolean; // JSON array column — use {{join(field)}} to flatten to a string
}

export const FIELD_CATALOG: FieldDef[] = [
  // Lead — core
  { key: 'id', label: 'Lead ID', group: 'Lead' },
  { key: 'name', label: 'Name', group: 'Lead' },
  { key: 'email', label: 'Email', group: 'Lead' },
  { key: 'phone', label: 'Phone', group: 'Lead' },
  { key: 'city', label: 'City (name)', group: 'Lead' },
  { key: 'state', label: 'State (name)', group: 'Lead' },
  { key: 'cityId', label: 'City ID (LMS)', group: 'Lead' },
  { key: 'stateId', label: 'State ID (LMS)', group: 'Lead' },
  { key: 'courseId', label: 'Course ID (LMS)', group: 'Lead' },
  { key: 'course', label: 'Course (name)', group: 'Lead' },
  { key: 'college', label: 'College', group: 'Lead' },
  { key: 'kappCollegeId', label: 'KAPP College ID', group: 'Lead' },
  // Shortlist if the student has one, else the lead's own college — send with
  // {{jsonArray(...)}}, which the LMS kapp_id accepts for one college or many.
  { key: 'kappCollegeIds', label: 'KAPP College IDs (preferences, else lead\'s)', group: 'Lead', isArray: true },
  { key: 'campaign', label: 'Campaign', group: 'Lead' },
  { key: 'leadType', label: 'Lead Type', group: 'Lead' },
  { key: 'leadOrigin', label: 'Lead Origin', group: 'Lead' },
  { key: 'leadZone', label: 'Lead Zone', group: 'Lead' },
  { key: 'category', label: 'Category', group: 'Lead' },
  { key: 'gender', label: 'Gender', group: 'Lead' },
  { key: 'classYear', label: 'Class / Year', group: 'Lead' },
  { key: 'parentName', label: "Parent's Name", group: 'Lead' },
  { key: 'parentMobile', label: "Parent's Mobile", group: 'Lead' },
  { key: 'altEmail1', label: 'Alternate Email 1', group: 'Lead' },
  { key: 'altEmail2', label: 'Alternate Email 2', group: 'Lead' },
  { key: 'altPhone1', label: 'Alternate Phone 1', group: 'Lead' },
  { key: 'altPhone2', label: 'Alternate Phone 2', group: 'Lead' },
  { key: 'correctCity', label: 'Verified City', group: 'Lead' },
  { key: 'correctState', label: 'Verified State', group: 'Lead' },
  { key: 'createdAt', label: 'Created At', group: 'Lead' },
  { key: 'referredBy_name', label: 'Referred By (Name)', group: 'Lead' },

  // Agent — whoever the lead is currently assigned to. All null on an
  // unassigned lead, which renders as an empty string in the template.
  // There is no single "agent id", so each identifier is offered separately:
  // pick Employee Code to match on a human-readable code, User ID for this
  // CRM's own primary key, or Dialer ID for the DialShree seat.
  { key: 'assignedTo_name', label: 'Agent Name', group: 'Agent' },
  { key: 'assignedTo_employeeCode', label: 'Agent Employee Code', group: 'Agent' },
  { key: 'assignedTo_id', label: 'Agent User ID (CRM)', group: 'Agent' },
  { key: 'assignedTo_email', label: 'Agent Email', group: 'Agent' },
  { key: 'assignedTo_dialshreeId', label: 'Agent Dialer ID (DialShree)', group: 'Agent' },

  // LeadProfile — extended student profile (may not exist for every lead)
  { key: 'profile_budget', label: 'Budget', group: 'LeadProfile' },
  { key: 'profile_courseType', label: 'Course Type', group: 'LeadProfile' },
  { key: 'profile_collegeType', label: 'College Type', group: 'LeadProfile' },
  { key: 'profile_specialisation', label: 'Specialisation', group: 'LeadProfile' },
  { key: 'profile_scholarshipAwareness', label: 'Scholarship Awareness', group: 'LeadProfile' },
  { key: 'profile_loanRequirement', label: 'Loan Requirement', group: 'LeadProfile' },
  { key: 'profile_loanAmount', label: 'Loan Amount', group: 'LeadProfile' },
  { key: 'profile_paymentModePreference', label: 'Payment Mode Preference', group: 'LeadProfile' },
  { key: 'profile_stayPreference', label: 'Stay Preference', group: 'LeadProfile' },
  { key: 'profile_class10Percentage', label: 'Class 10 %', group: 'LeadProfile' },
  { key: 'profile_class12Percentage', label: 'Class 12 %', group: 'LeadProfile' },
  { key: 'profile_board', label: 'Board', group: 'LeadProfile' },
  { key: 'profile_mediumOfInstruction', label: 'Medium of Instruction', group: 'LeadProfile' },
  // The student's shortlist of colleges, as LMS college_id / KAPP College ID
  // values. Send with {{jsonArray(...)}} to get a real JSON array — the LMS
  // kapp_id accepts one college or many.
  { key: 'profile_preferredCollegeIds', label: 'College Preferences (IDs)', group: 'LeadProfile', isArray: true },
  { key: 'profile_preferredCityNames', label: 'Preferred Cities', group: 'LeadProfile', isArray: true },
  { key: 'profile_preferredStateNames', label: 'Preferred States', group: 'LeadProfile', isArray: true },
  { key: 'profile_entranceExam', label: 'Entrance Exams', group: 'LeadProfile', isArray: true },
  { key: 'profile_keyAmenities', label: 'Key Amenities', group: 'LeadProfile', isArray: true },

  // System — computed at send time, not stored on the lead
  { key: 'today', label: "Today's Date (YYYY-MM-DD)", group: 'System' },
  { key: 'now', label: 'Current Timestamp (ISO)', group: 'System' },
];

/** Static stand-in data for the builder's "Sample Data" preview mode — no real lead required. */
export const SAMPLE_LEAD_DATA: Record<string, unknown> = {
  id: 'LID1000000',
  name: 'CRM Test Lead',
  email: 'test.lead@example.com',
  phone: '9835737485',
  city: 'Patna',
  state: 'Bihar',
  cityId: 1287,
  stateId: 6,
  course: 'B.Tech',
  courseId: 334, // B.Tech's real LMS course_group_id
  college: 'Sample Institute of Technology',
  kappCollegeId: '7034171',
  kappCollegeIds: ['7009221', '7042491'],
  campaign: 'Referral',
  leadType: 'Hot',
  leadOrigin: 'Referral',
  leadZone: 'East',
  category: 'General',
  gender: 'Male',
  classYear: '12th',
  parentName: 'Sample Parent',
  parentMobile: '9800000000',
  altEmail1: null,
  altEmail2: null,
  altPhone1: null,
  altPhone2: null,
  correctCity: 'Patna',
  correctState: 'Bihar',
  createdAt: new Date().toISOString(),
  referredBy_name: 'Referring Lead Name',
  assignedTo_name: 'Assigned Agent Name',
  assignedTo_employeeCode: 'EMP-1005',
  assignedTo_id: 'cmrbs2soa000059hhdf5kcdoq',
  assignedTo_email: 'agent@example.com',
  assignedTo_dialshreeId: '51152',

  profile_budget: '2-4 Lakhs',
  profile_courseType: 'Regular',
  profile_collegeType: 'Private',
  profile_specialisation: 'Computer Science',
  profile_scholarshipAwareness: 'Yes',
  profile_loanRequirement: 'No',
  profile_loanAmount: null,
  profile_paymentModePreference: 'Full Payment',
  profile_stayPreference: 'Hostel',
  profile_class10Percentage: '85',
  profile_class12Percentage: '82',
  profile_board: 'CBSE',
  profile_mediumOfInstruction: 'English',
  profile_preferredCollegeIds: [7009221, 7042725],
  profile_preferredCityNames: ['Patna', 'Delhi'],
  profile_preferredStateNames: ['Bihar', 'Delhi'],
  profile_entranceExam: ['JEE Main'],
  profile_keyAmenities: ['Wifi', 'Mess'],

  today: new Date().toISOString().slice(0, 10),
  now: new Date().toISOString(),
};
