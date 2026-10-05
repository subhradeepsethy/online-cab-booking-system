// Carries the trip a visitor typed on the home page through login to the rider screen.
const key = 'cab-system-trip-draft';

export function saveTripDraft(draft) {
  sessionStorage.setItem(key, JSON.stringify(draft));
}

export function takeTripDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    sessionStorage.removeItem(key);
    return draft;
  } catch {
    return null;
  }
}
