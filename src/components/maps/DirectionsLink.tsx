'use client';

interface DirectionsLinkProps {
  lat: number;
  lng: number;
  label?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Opens Google Maps with directions to the specified location
 * Uses free Google Maps URL (no API key needed)
 */
export function DirectionsLink({
  lat,
  lng,
  label,
  className = '',
  children,
}: DirectionsLinkProps) {
  const destinationParam = label
    ? encodeURIComponent(label)
    : `${lat},${lng}`;

  const url = `https://www.google.com/maps/dir/?api=1&destination=${destinationParam}&destination_place_id=`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 text-sm font-medium text-black hover:opacity-70 transition-opacity ${className}`}
    >
      {children || (
        <>
          <DirectionsIcon />
          <span>Get Directions</span>
        </>
      )}
    </a>
  );
}

function DirectionsIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
      />
    </svg>
  );
}

// Button variant for use in cards
interface DirectionsButtonProps {
  lat: number;
  lng: number;
  label?: string;
}

export function DirectionsButton({ lat, lng, label }: DirectionsButtonProps) {
  const destinationParam = label
    ? encodeURIComponent(label)
    : `${lat},${lng}`;

  const url = `https://www.google.com/maps/dir/?api=1&destination=${destinationParam}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors"
    >
      <DirectionsIcon />
      <span>Directions</span>
    </a>
  );
}
