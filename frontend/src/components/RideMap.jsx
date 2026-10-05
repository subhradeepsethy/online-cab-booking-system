import { useEffect, useRef, useState } from 'react';
import { getDrivingRoute, googleMapsApiKey, loadGoogleMapsScript, toRouteEndpoint } from '../lib/googleMaps.js';
import Icon from './Icon.jsx';

const defaultCenter = { lat: 20.2961, lng: 85.8245 };

// A quiet, low-contrast basemap so the route and markers stand out.
const mapStyles = [
  { elementType: 'geometry', stylers: [{ color: '#f3f4f6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f3f4f6' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e9ebee' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e2efe6' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#7b8190' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e4e6ea' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d5e3ef' }] },
];

const placeKey = (place) => (place?.address ? `${place.address}|${place.lat ?? ''}|${place.lng ?? ''}` : '');

function markerIcon(maps, { fillColor, strokeColor = '#ffffff', scale = 7, square = false }) {
  return {
    path: square ? 'M -1,-1 1,-1 1,1 -1,1 z' : maps.SymbolPath.CIRCLE,
    scale,
    fillColor,
    fillOpacity: 1,
    strokeColor,
    strokeWeight: square ? 2 : 3,
  };
}

// Leave room for the floating side panel when fitting the route on wide screens.
const fitPadding = () => (window.innerWidth >= 1024 ? { top: 72, right: 72, bottom: 72, left: 520 } : 40);

// Shows pickup (green), drop-off (black square) and, when given, the driver's live position
// with the driving route between pickup and drop-off.
function RideMap({ pickup, dropoff, driverLocation, className = 'h-72 rounded-2xl' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const driverMarkerRef = useRef(null);
  const [status, setStatus] = useState(googleMapsApiKey ? 'loading' : 'missing-key');
  const pickupKey = placeKey(pickup);
  const dropoffKey = placeKey(dropoff);

  useEffect(() => {
    if (!googleMapsApiKey) return undefined;
    let isMounted = true;

    loadGoogleMapsScript()
      .then((maps) => {
        if (!isMounted || !containerRef.current || mapRef.current) return;
        mapRef.current = new maps.Map(containerRef.current, {
          center: defaultCenter,
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: { position: maps.ControlPosition.RIGHT_BOTTOM },
          clickableIcons: false,
          styles: mapStyles,
        });
        setStatus('ready');
      })
      .catch(() => {
        if (isMounted) setStatus('error');
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return undefined;
    const maps = window.google.maps;
    let isMounted = true;

    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    const addOverlay = (overlay) => {
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
    };

    const points = [];
    if (Number.isFinite(pickup?.lat)) {
      addOverlay(new maps.Marker({ position: toRouteEndpoint(pickup), icon: markerIcon(maps, { fillColor: '#0f9d58' }), title: 'Pickup', zIndex: 5 }));
      points.push(toRouteEndpoint(pickup));
    }
    if (Number.isFinite(dropoff?.lat)) {
      addOverlay(new maps.Marker({ position: toRouteEndpoint(dropoff), icon: markerIcon(maps, { fillColor: '#0b0b0c', scale: 6, square: true }), title: 'Drop-off', zIndex: 5 }));
      points.push(toRouteEndpoint(dropoff));
    }

    const fitTo = (path) => {
      if (path.length === 1) {
        map.setCenter(path[0]);
        map.setZoom(15);
      } else if (path.length > 1) {
        const bounds = new maps.LatLngBounds();
        path.forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, fitPadding());
      }
    };

    fitTo(points);

    // Debounced so typing an address doesn't request a new route on every keystroke.
    const routeTimer = pickup?.address && dropoff?.address ? setTimeout(() => {
      getDrivingRoute(pickup, dropoff)
        .then(({ route }) => {
          if (!isMounted) return;
          route.createPolylines().forEach((polyline) => {
            polyline.setOptions({ strokeColor: '#0b0b0c', strokeWeight: 5, strokeOpacity: 0.9 });
            addOverlay(polyline);
          });
          fitTo(route.path);
        })
        .catch(() => {
          if (isMounted && points.length === 2) {
            addOverlay(new maps.Polyline({ path: points, strokeColor: '#0b0b0c', strokeOpacity: 0.6, strokeWeight: 4, geodesic: true }));
          }
        });
    }, 700) : null;

    return () => {
      isMounted = false;
      clearTimeout(routeTimer);
    };
    // pickupKey/dropoffKey capture every field of pickup/dropoff that affects the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pickupKey, dropoffKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    const maps = window.google.maps;

    if (!Number.isFinite(driverLocation?.lat)) {
      driverMarkerRef.current?.setMap(null);
      driverMarkerRef.current = null;
      return;
    }

    const position = { lat: driverLocation.lat, lng: driverLocation.lng };
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new maps.Marker({
        map,
        position,
        icon: markerIcon(maps, { fillColor: '#2563eb', scale: 8 }),
        title: 'Driver',
        zIndex: 10,
      });
      if (overlaysRef.current.length === 0) {
        map.setCenter(position);
        map.setZoom(15);
      }
    } else {
      driverMarkerRef.current.setPosition(position);
    }
  }, [status, driverLocation?.lat, driverLocation?.lng]);

  if (status === 'missing-key' || status === 'error') {
    return (
      <div className={`relative flex items-center justify-center overflow-hidden bg-[#eef0f3] ${className}`}>
        <div
          className="absolute inset-0 opacity-60"
          style={{ backgroundImage: 'linear-gradient(#dfe3e8 1px, transparent 1px), linear-gradient(90deg, #dfe3e8 1px, transparent 1px)', backgroundSize: '40px 40px' }}
        />
        <div className="relative flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-muted shadow-panel">
          <Icon name="pin" className="h-4 w-4" />
          {status === 'error' ? 'Map failed to load' : 'Add VITE_GOOGLE_MAPS_API_KEY to enable the map'}
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className={`w-full overflow-hidden bg-[#eef0f3] ${className}`} aria-label="Ride map" />;
}

export default RideMap;
