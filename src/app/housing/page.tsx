'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { PageLayout, PageHeader, LoadingSpinner } from '@/components/layout';
import { useApartments } from '@/hooks/useApartments';
import { Apartment } from '@/types/database';
import { MapView, LocationBadge, DirectionsButton } from '@/components/maps';
import { UNIVERSITY_LOCATIONS, CampusSide } from '@/lib/universityData';

const AMENITY_FILTERS = [
  { id: 'gym', label: 'Gym' },
  { id: 'furnished', label: 'Furnished' },
  { id: 'parking', label: 'Parking' },
];

const CAMPUS_SIDE_FILTERS: { id: CampusSide | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'north', label: 'North' },
  { id: 'south', label: 'South' },
  { id: 'east', label: 'East' },
  { id: 'west', label: 'West' },
];

// Currency symbols by country
const CURRENCY_SYMBOLS: Record<string, string> = {
  US: '$',
  UK: '£',
  CA: 'C$',
};

export default function HousingPage() {
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [selectedCampusSide, setSelectedCampusSide] = useState<CampusSide | 'all'>('all');
  const [showMap, setShowMap] = useState(true);
  const [userUniversity, setUserUniversity] = useState<string>('Stanford');
  const [destinationCountry, setDestinationCountry] = useState<string>('US');

  // Load user profile and country from localStorage
  useEffect(() => {
    try {
      const savedCountry = localStorage.getItem('noor_selected_country');
      if (savedCountry && (savedCountry === 'US' || savedCountry === 'UK' || savedCountry === 'CA')) {
        setDestinationCountry(savedCountry);
      }
      const profile = localStorage.getItem('noor_user_profile');
      if (profile) {
        const parsed = JSON.parse(profile);
        if (parsed.university) {
          setUserUniversity(parsed.university);
        }
        if (parsed.destinationCountry) {
          setDestinationCountry(parsed.destinationCountry);
        }
      }
    } catch (e) {
      // Use default
    }
  }, []);

  const currencySymbol = CURRENCY_SYMBOLS[destinationCountry] || '$';

  const filters = {
    gym: selectedAmenities.includes('gym'),
    furnished: selectedAmenities.includes('furnished'),
    parking: selectedAmenities.includes('parking'),
    campusSide: selectedCampusSide !== 'all' ? selectedCampusSide : undefined,
    university: userUniversity,
  };

  const { apartments, isLoading, error, total, refetch } = useApartments({
    limit: 50,
    filters,
  });

  useEffect(() => {
    refetch();
  }, [selectedAmenities, selectedCampusSide, userUniversity]);

  const toggleAmenity = (id: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  // Get university center for map
  const universityCenter = useMemo(() => {
    const uni = UNIVERSITY_LOCATIONS[userUniversity];
    if (uni) {
      return [uni.center.lat, uni.center.lng] as [number, number];
    }
    return [37.4275, -122.1697] as [number, number]; // Default to Stanford
  }, [userUniversity]);

  // Create map markers from apartments with coordinates
  const mapMarkers = useMemo(() => {
    return apartments
      .filter((apt) => apt.latitude && apt.longitude)
      .map((apt) => ({
        position: [apt.latitude!, apt.longitude!] as [number, number],
        label: apt.name,
        popupContent: `<strong>${apt.name}</strong><br/>${currencySymbol}${apt.price_min.toLocaleString()}-${apt.price_max.toLocaleString()}/mo`,
      }));
  }, [apartments, currencySymbol]);

  return (
    <PageLayout>
      <PageHeader
        title="Housing"
        subtitle="Find your home near campus"
        rightContent={
          <button
            onClick={() => setShowMap(!showMap)}
            className="text-sm text-gray-500 hover:text-black transition-colors"
          >
            {showMap ? 'Hide map' : 'Show map'}
          </button>
        }
      />

      {/* Reassurance message */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <p className="text-sm text-gray-600 leading-relaxed">
          Finding housing can feel overwhelming. Take your time — most leases start 1-2 months before move-in. We found {total} options near your campus.
        </p>
      </div>

      {/* Amenity Filters */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {AMENITY_FILTERS.map((filter) => (
          <button
            key={filter.id}
            onClick={() => toggleAmenity(filter.id)}
            className={`py-4 px-4 rounded-2xl border-[1.5px] text-sm font-medium transition-all duration-300 ${
              selectedAmenities.includes(filter.id)
                ? 'border-black bg-black text-white'
                : 'border-gray-200 bg-white text-black hover:border-gray-400'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Campus Side Filters */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {CAMPUS_SIDE_FILTERS.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setSelectedCampusSide(filter.id)}
            className={`px-4 py-2 rounded-full border-[1.5px] text-sm font-medium whitespace-nowrap transition-all duration-300 ${
              selectedCampusSide === filter.id
                ? 'border-black bg-black text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Map Section */}
      {showMap && mapMarkers.length > 0 && (
        <div className="mb-6">
          <MapView
            center={universityCenter}
            zoom={14}
            markers={mapMarkers}
            height="250px"
            className="border border-gray-200"
          />
          <p className="text-xs text-gray-400 mt-2 text-center">
            {mapMarkers.length} apartments shown on map
          </p>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="noor-card p-8 text-center">
          <p className="text-gray-500 mb-5">Failed to load apartments</p>
          <button onClick={refetch} className="text-black text-sm border-b border-gray-300 hover:border-black transition-colors duration-300">
            Try again
          </button>
        </div>
      ) : apartments.length === 0 ? (
        <div className="noor-card p-10 text-center">
          <p className="text-gray-500">No apartments found.</p>
          <p className="text-gray-400 text-sm mt-2">Try adjusting your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {apartments.map((apartment) => (
            <ApartmentCard key={apartment.id} apartment={apartment} currencySymbol={currencySymbol} />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

function ApartmentCard({ apartment, currencySymbol = '$' }: { apartment: Apartment; currencySymbol?: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const imageUrl = apartment.images?.[0] || null;

  return (
    <>
      <button onClick={() => setShowDetails(true)} className="text-left group">
        {/* Image */}
        <div className="aspect-[4/3] bg-gray-100 rounded-2xl overflow-hidden mb-4 relative">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={apartment.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
              <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.25} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
          )}
          {apartment.campus_side && (
            <div className="absolute top-2 left-2">
              <LocationBadge side={apartment.campus_side as CampusSide} size="sm" />
            </div>
          )}
        </div>

        {/* Info */}
        <h3 className="font-medium text-black text-sm transition-opacity duration-300 group-hover:opacity-70">
          {apartment.name}
        </h3>
        <div className="mt-1 space-y-0.5">
          <p className="text-gray-700 text-sm">
            <span className="font-medium">Solo:</span> {currencySymbol}{apartment.price_min.toLocaleString()}-{apartment.price_max.toLocaleString()}/mo
          </p>
          <p className="text-gray-500 text-sm">
            <span className="font-medium">Shared:</span> {currencySymbol}{(apartment.shared_price_min || Math.round(apartment.price_min * 0.55)).toLocaleString()}-{(apartment.shared_price_max || Math.round(apartment.price_max * 0.55)).toLocaleString()}/mo
          </p>
        </div>
        <p className="text-gray-400 text-xs mt-2">
          {apartment.bedrooms} · {apartment.walking_minutes} min walk
        </p>
      </button>

      {/* Detail Modal */}
      {showDetails && (
        <ApartmentDetailModal apartment={apartment} currencySymbol={currencySymbol} onClose={() => setShowDetails(false)} />
      )}
    </>
  );
}

function ApartmentDetailModal({ apartment, currencySymbol = '$', onClose }: { apartment: Apartment; currencySymbol?: string; onClose: () => void }) {
  const imageUrl = apartment.images?.[0] || null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white w-full max-w-lg rounded-t-3xl max-h-[85vh] overflow-y-auto animate-slide-up">
        {/* Handle */}
        <div className="sticky top-0 bg-white pt-3 pb-2 flex justify-center">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Content */}
        <div className="px-6 pb-8">
          {/* Image */}
          {imageUrl && (
            <div className="aspect-video bg-gray-100 rounded-2xl overflow-hidden mb-4">
              <img src={imageUrl} alt={apartment.name} className="w-full h-full object-cover" />
            </div>
          )}

          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-semibold text-black">{apartment.name}</h2>
              <p className="text-gray-500 text-sm mt-1">{apartment.address}</p>
            </div>
            {apartment.campus_side && (
              <LocationBadge side={apartment.campus_side as CampusSide} size="md" />
            )}
          </div>

          {/* Price */}
          <div className="mb-6">
            <div className="space-y-2">
              <div className="flex items-baseline gap-3">
                <span className="text-xs uppercase tracking-wide text-gray-500 w-14">Solo</span>
                <p className="text-xl font-semibold text-black">
                  {currencySymbol}{apartment.price_min.toLocaleString()} - {currencySymbol}{apartment.price_max.toLocaleString()}
                  <span className="text-sm font-normal text-gray-500">/mo</span>
                </p>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-xs uppercase tracking-wide text-gray-500 w-14">Shared</span>
                <p className="text-lg font-medium text-gray-700">
                  {currencySymbol}{(apartment.shared_price_min || Math.round(apartment.price_min * 0.55)).toLocaleString()} - {currencySymbol}{(apartment.shared_price_max || Math.round(apartment.price_max * 0.55)).toLocaleString()}
                  <span className="text-sm font-normal text-gray-500">/mo</span>
                </p>
              </div>
            </div>
            <p className="text-gray-500 text-sm mt-3">
              {apartment.bedrooms} · {apartment.bathrooms} bath · {apartment.sqft_min}-{apartment.sqft_max} sqft
            </p>
          </div>

          {/* Commute Times */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="text-center p-3 bg-gray-50 rounded-xl">
              <p className="text-lg font-medium text-black">{apartment.walking_minutes}</p>
              <p className="text-xs text-gray-500">min walk</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-xl">
              <p className="text-lg font-medium text-black">{apartment.biking_minutes}</p>
              <p className="text-xs text-gray-500">min bike</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-xl">
              <p className="text-lg font-medium text-black">{apartment.transit_minutes}</p>
              <p className="text-xs text-gray-500">min transit</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-xl">
              <p className="text-lg font-medium text-black">{apartment.driving_minutes}</p>
              <p className="text-xs text-gray-500">min drive</p>
            </div>
          </div>

          {/* Amenities */}
          <div className="mb-6">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Amenities</p>
            <div className="flex flex-wrap gap-2">
              {apartment.gym && <span className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-600">Gym</span>}
              {apartment.furnished && <span className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-600">Furnished</span>}
              {apartment.parking && <span className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-600">Parking</span>}
              {apartment.pet_policy && apartment.pet_policy !== 'No pets' && (
                <span className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-600">{apartment.pet_policy}</span>
              )}
            </div>
          </div>

          {/* Rating */}
          <div className="flex items-center gap-2 mb-6">
            <span className="text-black font-medium">{apartment.rating}</span>
            <span className="text-yellow-500">★</span>
            <span className="text-gray-400 text-sm">({apartment.review_count} reviews)</span>
          </div>

          {/* Map & Directions */}
          {apartment.latitude && apartment.longitude && (
            <div className="mb-6">
              <MapView
                center={[apartment.latitude, apartment.longitude]}
                zoom={15}
                markers={[{ position: [apartment.latitude, apartment.longitude], label: apartment.name }]}
                height="150px"
                className="mb-3"
              />
              <DirectionsButton lat={apartment.latitude} lng={apartment.longitude} label={apartment.address} />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 border-[1.5px] border-gray-300 rounded-xl font-medium hover:border-black transition-colors"
            >
              Close
            </button>
            {apartment.contact_website && (
              <a
                href={apartment.contact_website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-3 bg-black text-white rounded-xl font-medium text-center hover:bg-gray-800 transition-colors"
              >
                View Listing
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
