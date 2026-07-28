'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

export type MarkerColor = 'blue' | 'red' | 'green' | 'orange' | 'purple' | 'default';

export interface MapMarker {
  position: [number, number];
  label: string;
  popupContent?: string;
  onClick?: () => void;
  color?: MarkerColor;
}

interface MapViewProps {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  height?: string;
  className?: string;
  showUserLocation?: boolean;
}

// Marker colors for different types
const MARKER_COLORS: Record<MarkerColor, string> = {
  blue: '#3b82f6',
  red: '#ef4444',
  green: '#22c55e',
  orange: '#f97316',
  purple: '#a855f7',
  default: '#000000',
};

// Leaflet map component that only loads on the client
function LeafletMap({
  center,
  zoom = 14,
  markers = [],
  height = '300px',
  className = '',
  showUserLocation = false,
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const [L, setL] = useState<any>(null);

  // Dynamically load Leaflet
  useEffect(() => {
    import('leaflet').then((leaflet) => {
      // Fix default marker icons
      const DefaultIcon = leaflet.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });

      leaflet.Marker.prototype.options.icon = DefaultIcon;
      setL(leaflet);
    });
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || !L || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center,
      zoom,
      scrollWheelZoom: false,
    });

    // Add OpenStreetMap tiles (free, no API key needed)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    markersLayerRef.current = L.layerGroup().addTo(map);

    // Add user location if requested
    if (showUserLocation && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userIcon = L.divIcon({
            html: '<div class="user-location-dot"></div>',
            className: 'user-location-marker',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          });
          L.marker([position.coords.latitude, position.coords.longitude], {
            icon: userIcon,
          })
            .addTo(map)
            .bindPopup('You are here');
        },
        () => {
          // Silently fail if user denies location
        }
      );
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [L, showUserLocation]);

  // Update center and zoom when props change
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView(center, zoom);
    }
  }, [center, zoom]);

  // Update markers when they change
  useEffect(() => {
    if (!markersLayerRef.current || !L) return;

    // Clear existing markers
    markersLayerRef.current.clearLayers();

    // Add new markers
    markers.forEach((marker) => {
      // Get marker color
      const markerColor = MARKER_COLORS[marker.color || 'default'];

      // Create colored marker icon
      const coloredIcon = L.divIcon({
        html: `
          <div class="noor-marker">
            <div class="noor-pin" style="background: ${markerColor};"></div>
          </div>
        `,
        className: 'custom-marker-icon',
        iconSize: [24, 32],
        iconAnchor: [12, 32],
        popupAnchor: [0, -32],
      });

      const leafletMarker = L.marker(marker.position, { icon: coloredIcon });

      if (marker.popupContent || marker.label) {
        leafletMarker.bindPopup(marker.popupContent || marker.label);
      }

      if (marker.onClick) {
        leafletMarker.on('click', marker.onClick);
      }

      leafletMarker.addTo(markersLayerRef.current!);
    });

    // Fit bounds if there are multiple markers
    if (markers.length > 1 && mapRef.current) {
      const bounds = L.latLngBounds(markers.map((m) => m.position));
      mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [markers, L]);

  if (!L) {
    return (
      <div
        className={`rounded-2xl overflow-hidden bg-gray-100 flex items-center justify-center ${className}`}
        style={{ height, width: '100%' }}
      >
        <div className="text-gray-400 text-sm">Loading map...</div>
      </div>
    );
  }

  return (
    <>
      {/* Leaflet CSS loaded via CDN */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      <style jsx global>{`
        .user-location-marker {
          background: transparent;
        }
        .user-location-dot {
          width: 16px;
          height: 16px;
          background: #3b82f6;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }
        .leaflet-container {
          font-family: inherit;
        }
        .custom-marker-icon {
          background: transparent !important;
          border: none !important;
        }
        .noor-marker {
          position: relative;
          width: 24px;
          height: 32px;
        }
        .noor-marker .noor-pin {
          width: 20px;
          height: 20px;
          border-radius: 50% 50% 50% 0;
          background: #000000;
          position: absolute;
          transform: rotate(-45deg);
          left: 2px;
          top: 0;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        }
        .noor-marker .noor-pin::after {
          content: '';
          width: 6px;
          height: 6px;
          background: white;
          position: absolute;
          border-radius: 50%;
          top: 5px;
          left: 5px;
        }
        .leaflet-popup-content {
          margin: 12px 16px;
          line-height: 1.5;
        }
        .leaflet-popup-content-wrapper {
          border-radius: 12px;
        }
      `}</style>
      <div
        ref={mapContainerRef}
        className={`rounded-2xl overflow-hidden ${className}`}
        style={{ height, width: '100%' }}
      />
    </>
  );
}

// Export with no SSR
export const MapView = dynamic(() => Promise.resolve(LeafletMap), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl overflow-hidden bg-gray-100 flex items-center justify-center" style={{ height: '300px', width: '100%' }}>
      <div className="text-gray-400 text-sm">Loading map...</div>
    </div>
  ),
});

// Mini map variant for cards
interface MiniMapProps {
  lat: number;
  lng: number;
  label?: string;
}

function MiniMapComponent({ lat, lng, label }: MiniMapProps) {
  return (
    <MapView
      center={[lat, lng]}
      zoom={15}
      height="150px"
      markers={label ? [{ position: [lat, lng], label }] : []}
      className="border border-gray-200"
    />
  );
}

export const MiniMap = dynamic(() => Promise.resolve(MiniMapComponent), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl overflow-hidden bg-gray-100 flex items-center justify-center border border-gray-200" style={{ height: '150px', width: '100%' }}>
      <div className="text-gray-400 text-sm">Loading map...</div>
    </div>
  ),
});

// Helper to get marker color from campus side (all black for Noor branding)
export function getCampusSideColor(side: string): MarkerColor {
  return 'default';
}
