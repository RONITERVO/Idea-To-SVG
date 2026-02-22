const normalizeUrl = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const normalized = new URL(trimmed);
    if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') {
      return null;
    }
    return normalized.toString();
  } catch {
    return null;
  }
};

const rawPrivacyPolicyUrl = import.meta.env.VITE_PRIVACY_POLICY_URL;
if (import.meta.env.PROD && !rawPrivacyPolicyUrl) {
  throw new Error('Missing VITE_PRIVACY_POLICY_URL in production');
}

export const PRIVACY_POLICY_URL = rawPrivacyPolicyUrl ? normalizeUrl(rawPrivacyPolicyUrl) : null;
if (import.meta.env.PROD && rawPrivacyPolicyUrl && !PRIVACY_POLICY_URL) {
  throw new Error('Invalid VITE_PRIVACY_POLICY_URL in production');
}

export const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL || "support@example.com").trim() || null;
