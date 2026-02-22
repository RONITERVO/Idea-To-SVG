const normalizeUrl = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
};

export const PRIVACY_POLICY_URL = normalizeUrl(import.meta.env.VITE_PRIVACY_POLICY_URL);
export const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL || "").trim() || null;
