export const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';

let googleMapsPromise;

export function loadGoogleMapsScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only run in the browser.'));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (!googleMapsApiKey) {
    return Promise.reject(new Error('A Google Maps API key is required.'));
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-google-maps="cab-system"]');
    const script = existingScript ?? document.createElement('script');

    const handleLoad = () => {
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        googleMapsPromise = undefined;
        reject(new Error('Google Maps failed to initialize.'));
      }
    };
    const handleError = () => {
      googleMapsPromise = undefined;
      reject(new Error('Google Maps failed to load.'));
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existingScript) {
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}&libraries=geometry,places&loading=async&v=weekly`;
      script.async = true;
      script.defer = true;
      script.dataset.googleMaps = 'cab-system';
      document.head.appendChild(script);
    }
  });

  return googleMapsPromise;
}

// Google accepts either coordinates or a free-text address as a route endpoint.
export const toRouteEndpoint = (place) => (Number.isFinite(place?.lat) ? { lat: place.lat, lng: place.lng } : place?.address);

export async function getDrivingRoute(origin, destination) {
  const maps = await loadGoogleMapsScript();
  const { Route } = await maps.importLibrary('routes');
  const { routes } = await Route.computeRoutes({
    origin: toRouteEndpoint(origin),
    destination: toRouteEndpoint(destination),
    travelMode: 'DRIVING',
    fields: ['path', 'distanceMeters', 'durationMillis'],
  });

  if (!routes?.length) {
    throw new Error('Google Maps could not find a driving route.');
  }

  const [route] = routes;
  return {
    route,
    distanceKm: Number.isFinite(route.distanceMeters) ? route.distanceMeters / 1000 : null,
    durationMin: Number.isFinite(route.durationMillis) ? route.durationMillis / 60000 : null,
  };
}

// Fills in coordinates for an address typed without picking a suggestion. The server only uses
// a measured road distance when both ends have coordinates, so this keeps fares accurate.
export async function withCoordinates(place) {
  if (Number.isFinite(place?.lat) || !place?.address) return place;
  try {
    const maps = await loadGoogleMapsScript();
    const { results } = await new maps.Geocoder().geocode({ address: place.address, region: 'in' });
    const location = results?.[0]?.geometry?.location;
    return location ? { ...place, lat: location.lat(), lng: location.lng() } : place;
  } catch {
    return place;
  }
}

export async function reverseGeocode(point) {
  const maps = await loadGoogleMapsScript();
  const geocoder = new maps.Geocoder();
  const { results } = await geocoder.geocode({ location: point });
  return results?.[0]?.formatted_address ?? null;
}
