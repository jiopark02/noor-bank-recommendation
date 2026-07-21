'use client';

import React from 'react';

interface AIOrbProps {
  /** Orb diameter in pixels */
  size?: number;
  /** 'sphere' = defined iridescent sphere; 'soft' = fully blurred ambient blob */
  variant?: 'sphere' | 'soft';
  /** Wrap the sphere in a translucent halo ring */
  halo?: boolean;
  className?: string;
}

export function AIOrb({ size = 96, variant = 'sphere', halo = false, className = '' }: AIOrbProps) {
  if (variant === 'soft') {
    return (
      <div
        aria-hidden
        className={`ai-orb-soft ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const orb = (
    <div aria-hidden className={`ai-orb ${halo ? '' : className}`} style={{ width: size, height: size }} />
  );

  if (!halo) return orb;

  const haloSize = Math.round(size * 1.3);
  return (
    <div
      aria-hidden
      className={`ai-orb-halo ${className}`}
      style={{ width: haloSize, height: haloSize }}
    >
      {orb}
    </div>
  );
}
