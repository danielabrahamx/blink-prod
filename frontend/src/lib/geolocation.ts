import { useEffect, useRef, useState } from 'react';

export interface LatLng {
  lat: number;
  lng: number;
}

export type GeolocationStatus =
  | 'pending'
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'error';

export interface GeolocationState {
  position: GeolocationPosition | null;
  error: GeolocationPositionError | null;
  status: GeolocationStatus;
}

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two lat/lng points, in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

const DEFAULT_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 10_000,
};

export function useGeolocation(): GeolocationState {
  const [state, setState] = useState<GeolocationState>({
    position: null,
    error: null,
    status: 'pending',
  });
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState({ position: null, error: null, status: 'unsupported' });
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      position => setState({ position, error: null, status: 'granted' }),
      error =>
        setState({
          position: null,
          error,
          status: error.code === error.PERMISSION_DENIED ? 'denied' : 'error',
        }),
      DEFAULT_OPTIONS,
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return state;
}
