'use client';

import React, { useState, useEffect } from 'react';
import { PageLayout, PageHeader, LoadingSpinner } from '@/components/layout';
import { useApartments } from '@/hooks/useApartments';
import { Apartment } from '@/types/database';

const AMENITY_FILTERS = [
  { id: 'gym', label: 'Gym' },
  { id: 'furnished', label: 'Furnished' },
  { id: 'parking', label: 'Parking' },
];

export default function HousingPage() {
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);

  const filters = {
    gym: selectedAmenities.includes('gym'),
    furnished: selectedAmenities.includes('furnished'),
    parking: selectedAmenities.includes('parking'),
  };

  const { apartments, isLoading, error, total, refetch } = useApartments({
    limit: 20,
    filters,
  });

  useEffect(() => {
    refetch();
  }, [selectedAmenities]);

  const toggleAmenity = (id: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  return (
    <PageLayout>
      <PageHeader
        title="Housing."
        subtitle={`${total} near campus.`}
      />

      {/* Amenity Filters */}
      <div className="grid grid-cols-3 gap-3 mb-8">
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
            <ApartmentCard key={apartment.id} apartment={apartment} />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

function ApartmentCard({ apartment }: { apartment: Apartment }) {
  const imageUrl = apartment.images?.[0] || null;

  return (
    <button className="text-left group">
      {/* Image */}
      <div className="aspect-[4/3] bg-gray-100 rounded-2xl overflow-hidden mb-4">
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
      </div>

      {/* Info */}
      <h3 className="font-medium text-black text-sm transition-opacity duration-300 group-hover:opacity-70">
        {apartment.name}
      </h3>
      <p className="text-gray-500 text-sm mt-1">
        ${apartment.price_min.toLocaleString()}-${apartment.price_max.toLocaleString()}/mo
      </p>
      <p className="text-gray-400 text-xs mt-2">
        {apartment.bedrooms} · {apartment.walking_minutes} min walk
      </p>
    </button>
  );
}
