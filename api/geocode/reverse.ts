import type { IncomingMessage, ServerResponse } from 'node:http';

const GMP_SOLUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

type VercelReq = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
};

type VercelRes = ServerResponse & {
  status?: (code: number) => VercelRes;
  json?: (body: unknown) => void;
};

interface AddressCompLike {
  longText?: string;
  shortText?: string;
  long_name?: string;
  short_name?: string;
  types?: string[];
}

function sendJson(res: VercelRes, statusCode: number, payload: unknown) {
  if (typeof res.status === 'function') {
    const nextRes = res.status(statusCode);
    if (typeof nextRes.json === 'function') {
      nextRes.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
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
) {
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

function readQueryParam(req: VercelReq, key: string): string {
  const fromQuery = req.query?.[key];
  if (typeof fromQuery === 'string') return fromQuery;
  if (Array.isArray(fromQuery) && typeof fromQuery[0] === 'string') return fromQuery[0];
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'https://sjacademiaone.vercel.app');
      return parsed.searchParams.get(key) || '';
    } catch {
      return '';
    }
  }
  return '';
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: { status: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.' } });
    return;
  }

  const lat = Number(readQueryParam(req, 'lat'));
  const lng = Number(readQueryParam(req, 'lng'));
  const language = (readQueryParam(req, 'language') || 'en').slice(0, 16) || 'en';

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    sendJson(res, 400, {
      error: { status: 'INVALID_ARGUMENT', message: 'Valid latitude and longitude coordinates are required.' },
    });
    return;
  }

  const apiKey = (process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  if (!apiKey) {
    sendJson(res, 503, {
      error: {
        status: 'UNAVAILABLE',
        message: 'Google Maps API key is not configured on the server. Please enter the school address manually.',
      },
    });
    return;
  }

  try {
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
      sendJson(res, 429, {
        error: { status: 'RESOURCE_EXHAUSTED', message: 'Google Maps Platform geocoding quota reached.' },
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
      sendJson(res, 200, { result: parsed });
      return;
    }

    const restUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    restUrl.searchParams.set('latlng', `${lat},${lng}`);
    restUrl.searchParams.set('language', language);
    restUrl.searchParams.set('key', apiKey);

    const restRes = await fetch(restUrl.toString(), {
      method: 'GET',
      headers: { 'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID },
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
      sendJson(res, 429, {
        error: { status: 'RESOURCE_EXHAUSTED', message: 'Google Maps Platform geocoding quota reached.' },
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
      sendJson(res, 200, { result: parsed });
      return;
    }

    if (restData?.status === 'ZERO_RESULTS' || (v4Res.ok && (!v4Data.results || v4Data.results.length === 0))) {
      sendJson(res, 404, {
        error: {
          status: 'NOT_FOUND',
          message: 'No street address was found at these coordinates. Please adjust the pin or type the address manually.',
        },
      });
      return;
    }

    sendJson(res, 502, {
      error: {
        status: restData?.status || v4Data?.error?.status || 'UPSTREAM_ERROR',
        message:
          restData?.error_message ||
          v4Data?.error?.message ||
          'Unable to resolve an address for these coordinates right now.',
      },
    });
  } catch {
    sendJson(res, 502, {
      error: {
        status: 'NETWORK_ERROR',
        message: 'Unable to reach the geocoding service. Please check your connection or enter the address manually.',
      },
    });
  }
}
