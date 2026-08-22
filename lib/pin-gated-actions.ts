// Single source of truth for PIN-gated Super Admin action keys — shared by
// the frontend (<PinGate action={...}>) and the API routes that enforce the
// gate server-side (isActionUnlocked(userId, ...)), so the two can never
// drift out of sync. Add a new key here whenever another destructive/
// sensitive tool needs the same 6-digit PIN protection.
export const PIN_GATED_ACTIONS = {
  BULK_DELETE_LEADS: 'BULK_DELETE_LEADS',
  MANAGE_PERMISSIONS: 'MANAGE_PERMISSIONS',
  API_KEYS: 'API_KEYS',
  LEAD_INTEGRATIONS: 'LEAD_INTEGRATIONS',
  // Email rules decide who outside the CRM receives company performance data,
  // and a rule can be pointed at any address — worth the same gate as API keys.
  EMAIL_AUTOMATION: 'EMAIL_AUTOMATION',
} as const;

export type PinGatedAction = (typeof PIN_GATED_ACTIONS)[keyof typeof PIN_GATED_ACTIONS];
