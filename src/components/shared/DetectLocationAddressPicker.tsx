import React, { useCallback, useEffect, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  type MapMouseEvent,
} from '@vis.gl/react-google-maps';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../ui/Primitives';

export interface DetectedAddressData {
  formattedAddress: string;
  streetAddress: string;
  city: string;
  district: string;
  stateRegion: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  placeId?: string;
}

interface DetectLocationAddressPickerProps {
  onAddressDetected: (data: DetectedAddressData) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  helperText?: string;
}

const GMP_ATTRIBUTION_IDS = ['gmp_mcp_codeassist_v1_aistudio'];

export function DetectLocationAddressPicker({
  onAddressDetected,
  disabled = false,
  compact = false,
  label = 'Detect School Location',
  helperText = 'Use your device GPS to automatically fill your campus street address, city, state, and postal code.',
}: DetectLocationAddressPickerProps) {
  const [mapsApiKey, setMapsApiKey] = useState<string>('');
  const [detecting, setDetecting] = useState(false);
  const [resolvingPin, setResolvingPin] = useState(false);
  const [error, setError] = useState('');
  const [detected, setDetected] = useState<DetectedAddressData | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap] = useState(false);

  // Hydrate runtime Google Maps API key from backend config when not embedded at build time
  useEffect(() => {
    if (mapsApiKey) return;
    let cancelled = false;
    fetch('/api/maps/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { apiKey?: string } | null) => {
        if (!cancelled && data?.apiKey) {
          setMapsApiKey(data.apiKey);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mapsApiKey]);

  const reverseGeocodeCoords = useCallback(
    async (lat: number, lng: number, isPinAdjustment = false) => {
      setError('');
      if (isPinAdjustment) {
        setResolvingPin(true);
      } else {
        setDetecting(true);
      }

      try {
        const res = await fetch(
          `/api/geocode/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}&language=en`,
        );

        const payload = (await res.json().catch(() => ({}))) as {
          result?: DetectedAddressData;
          error?: { status?: string; message?: string };
        };

        // Tier-2 Demo Key Quota Defense
        if (res.status === 429 || payload?.error?.status === 'RESOURCE_EXHAUSTED') {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          setError('Location lookup quota reached. You can still type your school address manually below.');
          return;
        }

        if (!res.ok || !payload?.result) {
          setError(
            payload?.error?.message ||
              'Unable to resolve a street address for this location. Please adjust the pin or enter your address manually.',
          );
          return;
        }

        const resolved = payload.result;
        setCoords({ lat: resolved.latitude, lng: resolved.longitude });
        setDetected(resolved);
        setShowMap(true);
        onAddressDetected(resolved);
      } catch {
        setError('Network error while looking up address. Please check your connection or type the address manually.');
      } finally {
        setDetecting(false);
        setResolvingPin(false);
      }
    },
    [onAddressDetected],
  );

  const handleDetectLocation = useCallback(() => {
    if (disabled || detecting) return;
    setError('');

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Location detection is not supported by this browser. Please enter your school address manually.');
      return;
    }

    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));
        setCoords({ lat, lng });
        void reverseGeocodeCoords(lat, lng, false);
      },
      (geoErr) => {
        setDetecting(false);
        switch (geoErr.code) {
          case geoErr.PERMISSION_DENIED:
            setError(
              'Location permission was denied. Allow location access in your browser settings or type the school address manually.',
            );
            break;
          case geoErr.POSITION_UNAVAILABLE:
            setError('Current location is unavailable from your device. Please enter the school address manually.');
            break;
          case geoErr.TIMEOUT:
            setError('Location request timed out. Please try again or enter the address manually.');
            break;
          default:
            setError('Unable to detect your current location. Please enter the school address manually.');
            break;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      },
    );
  }, [disabled, detecting, reverseGeocodeCoords]);

  const handleMapClick = useCallback(
    (ev: MapMouseEvent) => {
      if (disabled || resolvingPin) return;
      const latLng = ev.detail?.latLng;
      if (!latLng) return;
      const lat = Number(latLng.lat.toFixed(6));
      const lng = Number(latLng.lng.toFixed(6));
      setCoords({ lat, lng });
      void reverseGeocodeCoords(lat, lng, true);
    },
    [disabled, resolvingPin, reverseGeocodeCoords],
  );

  const handleMarkerDragEnd = useCallback(
    (ev: { latLng?: { lat(): number; lng(): number } | null }) => {
      if (disabled || resolvingPin) return;
      const lat = ev.latLng?.lat();
      const lng = ev.latLng?.lng();
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      const nextLat = Number(lat.toFixed(6));
      const nextLng = Number(lng.toFixed(6));
      setCoords({ lat: nextLat, lng: nextLng });
      void reverseGeocodeCoords(nextLat, nextLng, true);
    },
    [disabled, resolvingPin, reverseGeocodeCoords],
  );

  return (
    <div
      className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 ${compact ? 'p-3.5' : 'p-4'} space-y-3`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-blue-950/60 border border-teal-200 dark:border-blue-800 text-teal-700 dark:text-blue-300 flex items-center justify-center shrink-0 mt-0.5">
            <MapPin className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{label}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{helperText}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {coords && mapsApiKey && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowMap((prev) => !prev)}
              disabled={disabled}
            >
              {showMap ? 'Hide Map' : 'Verify on Map'}
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleDetectLocation}
            disabled={disabled || detecting || resolvingPin}
          >
            {detecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Detecting…
              </>
            ) : detected ? (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Re-detect Location
              </>
            ) : (
              <>
                <Navigation className="w-3.5 h-3.5" />
                Detect Current Location
              </>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 text-xs text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2"
        >
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {detected && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900 dark:text-emerald-200 bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
          <div className="flex items-start gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-emerald-950 dark:text-emerald-100">Address detected and filled into form</p>
              <p className="text-[11px] text-emerald-800 dark:text-emerald-300 truncate">{detected.formattedAddress}</p>
            </div>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-emerald-700 dark:text-emerald-300 shrink-0">
            {detected.latitude.toFixed(5)}, {detected.longitude.toFixed(5)}
          </span>
        </div>
      )}

      {showMap && coords && mapsApiKey && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Drag the campus pin or click anywhere on the map to fine-tune the exact address.</span>
            {resolvingPin && (
              <span className="inline-flex items-center gap-1 text-teal-700 dark:text-blue-400 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" /> Updating address…
              </span>
            )}
          </div>
          <div className="w-full h-60 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <APIProvider apiKey={mapsApiKey} libraries={['marker']} language="en">
              <GoogleMap
                mapId="DEMO_MAP_ID"
                center={coords}
                defaultZoom={16}
                gestureHandling="greedy"
                streetViewControl={false}
                mapTypeControl={false}
                onClick={handleMapClick}
                internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
                className="w-full h-full"
              >
                <AdvancedMarker
                  position={coords}
                  draggable={!disabled}
                  onDragEnd={handleMarkerDragEnd}
                  title="Detected School Campus Location"
                >
                  <Pin background="#0D9488" borderColor="#0B1528" glyphColor="#FFFFFF" />
                </AdvancedMarker>
              </GoogleMap>
            </APIProvider>
          </div>
        </div>
      )}
    </div>
  );
}
