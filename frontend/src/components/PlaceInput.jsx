import { useEffect, useRef } from 'react';
import { googleMapsApiKey, loadGoogleMapsScript } from '../lib/googleMaps.js';

// A location field. Typing stores a plain address; picking a Google Places suggestion also
// stores coordinates, which gives accurate fares and map routes.
function PlaceInput({ label, value, onChange, placeholder, marker, action, disabled }) {
  const inputRef = useRef(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!googleMapsApiKey) return undefined;
    let listener;
    let isMounted = true;

    loadGoogleMapsScript()
      .then((maps) => {
        if (!isMounted || !inputRef.current || !maps.places?.Autocomplete) return;
        const autocomplete = new maps.places.Autocomplete(inputRef.current, {
          fields: ['formatted_address', 'geometry', 'name'],
          componentRestrictions: { country: 'in' },
        });
        listener = autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          const location = place?.geometry?.location;
          if (!location) return;
          const name = place.name && !place.formatted_address?.startsWith(place.name) ? `${place.name}, ` : '';
          onChangeRef.current({
            address: `${name}${place.formatted_address ?? ''}`,
            lat: location.lat(),
            lng: location.lng(),
          });
        });
      })
      .catch(() => {
        // Without Places the field still works as a plain text input.
      });

    return () => {
      isMounted = false;
      listener?.remove();
    };
  }, []);

  return (
    <div className="flex h-12 items-center gap-3 rounded-lg bg-canvas px-3.5 ring-ink transition focus-within:bg-white focus-within:ring-2">
      <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">{marker}</span>
      <input
        ref={inputRef}
        aria-label={label}
        value={value?.address ?? ''}
        onChange={(event) => onChange({ address: event.target.value })}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted disabled:opacity-60"
      />
      {action}
    </div>
  );
}

export default PlaceInput;
