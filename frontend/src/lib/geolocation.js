// Explains why the browser can't give us a location, in terms the user can act on.
export function locationUnavailableReason() {
  if (!window.isSecureContext) {
    return 'Location only works on a secure (https://) page. Open the app using its https:// address.';
  }
  if (!navigator.geolocation) return 'This browser does not support location.';
  return null;
}

export function describeLocationError(error) {
  if (error?.code === 1) {
    return 'Location permission is blocked. Allow location for this site in your browser settings (tap the icon next to the address bar), then try again.';
  }
  if (error?.code === 3) return 'Getting your location took too long. Check that GPS is on and try again.';
  return 'Your location is unavailable right now. Check that GPS/location is on.';
}
