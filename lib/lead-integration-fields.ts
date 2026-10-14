// The single source of truth for which lead fields a Lead Integration's JSON
// body template can reference via {{field}}. Purely static data (no DB call)
// so the field-picker sidebar can render instantly on both the create and
// edit builder pages. Keep FIELD_CATALOG's `key`s in sync with
// buildLeadTemplateData()'s output keys below — the picker only makes sense
// if what you click actually resolves to a value at send time.

export type FieldGroup = 'Lead' | 'Agent' | 'LeadProfile' | 'System' | 'Recording' | 'Call' | 'CallAgent';

export interface FieldDef {
  key: string;
  label: string;
  group: FieldGroup;
  isArray?: boolean; // JSON array column — use {{join(field)}} to flatten to a string
}

/**
 * Fields that only resolve on a RECORDING_RECEIVED push.
 *
 * Kept as their own list so the Body Builder can show the groups that apply to
 * the integration being edited — a referral webhook offering call_talk_time
 * would render it empty, which is worse than not offering it.
 */
export const RECORDING_FIELD_CATALOG: FieldDef[] = [
  { key: 'recording_url', label: 'Recording URL', group: 'Recording' },
  { key: 'recording_id', label: 'Recording ID', group: 'Recording' },
  { key: 'recording_available', label: 'Recording Available (true/false)', group: 'Recording' },

  { key: 'call_id', label: 'Call ID', group: 'Call' },
  { key: 'call_unique_id', label: "Call ID (dialer's)", group: 'Call' },
  { key: 'call_status', label: 'Call Status', group: 'Call' },
  { key: 'call_connected', label: 'Connected (true/false)', group: 'Call' },
  { key: 'call_type', label: 'Call Type (inbound/outbound)', group: 'Call' },
  { key: 'call_term_reason', label: 'Termination Reason', group: 'Call' },
  { key: 'call_disposition', label: 'Disposition', group: 'Call' },
  { key: 'call_duration_seconds', label: 'Duration (seconds)', group: 'Call' },
  { key: 'call_talk_time_seconds', label: 'Talk Time (seconds)', group: 'Call' },
  { key: 'call_ring_time_seconds', label: 'Ring Time (seconds)', group: 'Call' },
  { key: 'call_started_at', label: 'Call Started At (ISO)', group: 'Call' },
  { key: 'call_ended_at', label: 'Call Ended At (ISO)', group: 'Call' },
  { key: 'call_phone_number', label: 'Phone Number Dialled', group: 'Call' },
  { key: 'call_campaign', label: 'Dialer Campaign', group: 'Call' },
  { key: 'lead_matched', label: 'Lead Matched (true/false)', group: 'Call' },
  { key: 'lead_id', label: 'Lead ID (null if unmatched)', group: 'Call' },

  { key: 'agent_id', label: 'Agent ID', group: 'CallAgent' },
  { key: 'agent_name', label: 'Agent Name', group: 'CallAgent' },
  { key: 'agent_email', label: 'Agent Email', group: 'CallAgent' },
  { key: 'agent_employee_code', label: 'Agent Employee Code', group: 'CallAgent' },
  { key: 'agent_team_id', label: 'Agent Team ID', group: 'CallAgent' },
  { key: 'agent_seat', label: 'Dialer Seat', group: 'CallAgent' },
  { key: 'agent_dialshree_id', label: 'DialShree Agent ID', group: 'CallAgent' },

  { key: 'event_id', label: 'Event ID (stable per call)', group: 'System' },
  { key: 'event_type', label: 'Event Type', group: 'System' },
  { key: 'event_timestamp', label: 'Event Timestamp (ISO)', group: 'System' },
  { key: 'call_received_at', label: 'Recording Received At (ISO)', group: 'System' },
];

/** Sample values for the Live Preview of a recording webhook. */
export const SAMPLE_RECORDING_DATA: Record<string, unknown> = {
  recording_url: 'https://dialer5.elisiontec.com/RECORDINGS/MP3/.../sample-a',
  recording_id: 'cmv6dsm1700412nydy5l8s63z',
  recording_available: true,
  call_id: 'cmv6dsm1700412nydy5l8s63z',
  call_unique_id: '1760000000.12345',
  call_status: 'CONNECTED',
  call_connected: true,
  call_type: 'outbound',
  call_term_reason: 'CALLER',
  call_disposition: 'Interested',
  call_duration_seconds: 214,
  call_talk_time_seconds: 198,
  call_ring_time_seconds: 16,
  call_started_at: '2026-10-14T06:12:04.000Z',
  call_ended_at: '2026-10-14T06:15:38.000Z',
  call_phone_number: '9835737485',
  call_campaign: 'MBA_Outbound',
  lead_matched: true,
  lead_id: 'LID1000000',
  agent_id: 'cmrol6p7k000jzq7oldd7vd1v',
  agent_name: 'Sohit Rajput',
  agent_email: 'sohit.rajput@kollegeapply.com',
  agent_employee_code: 'EMP-1005',
  agent_team_id: 'team_alpha',
  agent_seat: 'VDCL',
  agent_dialshree_id: '100096',
  event_id: 'rec_cmv6dsm1700412nydy5l8s63z',
  event_type: 'RECORDING_RECEIVED',
  event_timestamp: '2026-10-14T06:15:40.000Z',
  call_received_at: '2026-10-14T06:15:39.000Z',
};

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
  // Already decided per push: the lead's own code for a college-preferences
  // update, the CRM's code for a referral. Use this for lead_code rather than
  // a literal, or both paths send the same value.
  { key: 'pushLeadCode', label: 'Lead Code to send (referral vs preferences)', group: 'System' },
  { key: 'pushSource', label: 'Push Source (REFERRAL / COLLEGE_PREFERENCES)', group: 'System' },
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
  pushLeadCode: 'CRM100',
  pushSource: 'REFERRAL',
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
