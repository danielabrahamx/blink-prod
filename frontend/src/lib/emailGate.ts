const SIGNUP_KEY = "blink_email_signup_v1";
const SKIP_KEY = "blink_email_skipped_session";

type SignupRecord = { status: "signed_up"; at: string };

function readLocal(): SignupRecord | null {
  try {
    const raw = window.localStorage.getItem(SIGNUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SignupRecord;
    return parsed?.status === "signed_up" ? parsed : null;
  } catch {
    return null;
  }
}

function readSession(): boolean {
  try {
    return window.sessionStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function hasSignedUp(): boolean {
  return readLocal() !== null;
}

export function hasPassedGate(): boolean {
  return hasSignedUp() || readSession();
}

export function markSignedUp(): void {
  try {
    const record: SignupRecord = {
      status: "signed_up",
      at: new Date().toISOString(),
    };
    window.localStorage.setItem(SIGNUP_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable (Safari private, quota, etc.) — gate still flips via component state.
  }
}

export function markSkippedThisSession(): void {
  try {
    window.sessionStorage.setItem(SKIP_KEY, "1");
  } catch {
    // noop
  }
}
