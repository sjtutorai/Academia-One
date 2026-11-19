import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Geocoding REST API Reference:
// https://developers.google.com/maps/documentation/geocoding/requests-reverse-geocoding?utm_campaign=gmp_mcp_codeassist_v1_aistudio
const GMP_SOLUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

interface ParsedAddress {
  formattedAddress: string;
  streetAddress: string;
  city: string;
  district: string;
  stateRegion: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  placeId: string;
}

interface AddressCompLike {
  longText?: string;
  shortText?: string;
  long_name?: string;
  short_name?: string;
  types?: string[];
}

function getCompText(components: AddressCompLike[], type: string): string {
  const match = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
  return (match?.longText || match?.long_name || '').trim();
}

function parseAddressComponents(
  formattedAddress: string,
  components: AddressCompLike[],
  lat: number,
  lng: number,
  placeId: string,
): ParsedAddress {
  const streetNumber = getCompText(components, 'street_number');
  const route = getCompText(components, 'route');
  const premise = getCompText(components, 'premise');
  const sublocality =
    getCompText(components, 'sublocality_level_1') ||
    getCompText(components, 'sublocality') ||
    getCompText(components, 'neighborhood');

  const city =
    getCompText(components, 'locality') ||
    getCompText(components, 'postal_town') ||
    getCompText(components, 'administrative_area_level_3') ||
    sublocality;

  const district = getCompText(components, 'administrative_area_level_2');
  const stateRegion = getCompText(components, 'administrative_area_level_1');
  const country = getCompText(components, 'country');
  const postalCode = getCompText(components, 'postal_code');

  const streetParts = [premise, [streetNumber, route].filter(Boolean).join(' '), sublocality].filter(Boolean);
  const streetAddress = streetParts.length > 0 ? streetParts.join(', ') : formattedAddress;

  return {
    formattedAddress,
    streetAddress,
    city,
    district,
    stateRegion,
    country,
    postalCode,
    latitude: lat,
    longitude: lng,
    placeId,
  };
}

function getServerMapsApiKey(): string {
  return (process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Exposes the configured Maps JS API key to the browser <APIProvider> if not already bundled via VITE_
  app.get('/api/maps/config', (_req, res) => {
    const apiKey = (process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
    res.json({ apiKey, configured: Boolean(apiKey) });
  });

  // Server-side proxy for Google Maps Platform Reverse Geocoding (avoids browser CORS restriction CF1)
  app.get('/api/geocode/reverse', async (req, res) => {
    const latRaw = String(req.query.lat ?? '');
    const lngRaw = String(req.query.lng ?? '');
    const language = String(req.query.language ?? 'en').slice(0, 16) || 'en';

    const lat = Number(latRaw);
    const lng = Number(lngRaw);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: 'Valid latitude and longitude coordinates are required.' } });
      return;
    }

    const apiKey = getServerMapsApiKey();
    if (!apiKey) {
      res.status(503).json({
        error: {
          status: 'UNAVAILABLE',
          message: 'Google Maps API key is not configured on the server. Please enter the school address manually.',
        },
      });
      return;
    }

    try {
      // 1. Primary: Geocoding API v4 REST endpoint
      const v4Url = new URL('https://geocode.googleapis.com/v4/geocode/location');
      v4Url.searchParams.set('location.latitude', String(lat));
      v4Url.searchParams.set('location.longitude', String(lng));
      v4Url.searchParams.set('languageCode', language);

      const v4Res = await fetch(v4Url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'results.placeId,results.formattedAddress,results.addressComponents,results.location',
          'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
        },
      });

      const v4Data = (await v4Res.json().catch(() => ({}))) as {
        results?: Array<{
          placeId?: string;
          formattedAddress?: string;
          addressComponents?: AddressCompLike[];
          location?: { latitude?: number; longitude?: number };
        }>;
        error?: { status?: string; message?: string; code?: number };
      };

      if (v4Res.status === 429 || v4Data?.error?.status === 'RESOURCE_EXHAUSTED') {
        res.status(429).json({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            message: 'Google Maps Platform geocoding quota reached.',
          },
        });
        return;
      }

      if (v4Res.ok && Array.isArray(v4Data?.results) && v4Data.results.length > 0) {
        const primary = v4Data.results[0];
        const parsed = parseAddressComponents(
          primary?.formattedAddress || '',
          Array.isArray(primary?.addressComponents) ? primary.addressComponents : [],
          primary?.location?.latitude ?? lat,
          primary?.location?.longitude ?? lng,
          primary?.placeId || '',
        );
        res.json({ result: parsed });
        return;
      }

      // 2. Fallback: Classic Geocoding REST API (maps.googleapis.com/maps/api/geocode/json)
      const restUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      restUrl.searchParams.set('latlng', `${lat},${lng}`);
      restUrl.searchParams.set('language', language);
      restUrl.searchParams.set('key', apiKey);

      const restRes = await fetch(restUrl.toString(), {
        method: 'GET',
        headers: {
          'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
        },
      });

      const restData = (await restRes.json().catch(() => ({}))) as {
        status?: string;
        error_message?: string;
        results?: Array<{
          place_id?: string;
          formatted_address?: string;
          address_components?: AddressCompLike[];
          geometry?: { location?: { lat?: number; lng?: number } };
        }>;
      };

      if (restRes.status === 429 || restData?.status === 'OVER_QUERY_LIMIT' || restData?.status === 'OVER_DAILY_LIMIT') {
        res.status(429).json({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            message: 'Google Maps Platform geocoding quota reached.',
          },
        });
        return;
      }

      if (restData?.status === 'OK' && Array.isArray(restData.results) && restData.results.length > 0) {
        const primary = restData.results[0];
        const parsed = parseAddressComponents(
          primary?.formatted_address || '',
          Array.isArray(primary?.address_components) ? primary.address_components : [],
          primary?.geometry?.location?.lat ?? lat,
          primary?.geometry?.location?.lng ?? lng,
          primary?.place_id || '',
        );
        res.json({ result: parsed });
        return;
      }

      if (restData?.status === 'ZERO_RESULTS' || (v4Res.ok && (!v4Data.results || v4Data.results.length === 0))) {
        res.status(404).json({
          error: {
            status: 'NOT_FOUND',
            message: 'No street address was found at these coordinates. Please adjust the pin or type the address manually.',
          },
        });
        return;
      }

      res.status(502).json({
        error: {
          status: restData?.status || v4Data?.error?.status || 'UPSTREAM_ERROR',
          message:
            restData?.error_message ||
            v4Data?.error?.message ||
            'Unable to resolve an address for these coordinates right now.',
        },
      });
    } catch {
      res.status(502).json({
        error: {
          status: 'NETWORK_ERROR',
          message: 'Unable to reach the geocoding service. Please check your connection or enter the address manually.',
        },
      });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AcademiaOne server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
