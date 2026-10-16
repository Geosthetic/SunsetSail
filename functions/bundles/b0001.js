/**
 * Netlify Function: GET /v1/bundles/:id
 * 
 * Returns detailed info for a specific bundle.
 * Netlify handles dynamic routing via b0001.js naming convention.
 */

const path = require('path');
const fs = require('fs');

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed. Use GET.' })
    };
  }

  // Extract bundle ID from path
  // Netlify passes params in event.pathParameters for HTTP proxy, or parse event.path
  let bundleId = null;
  
  // Try params first (preferred for Netlify)
  if (event.pathParameters && event.pathParameters.id) {
    bundleId = event.pathParameters.id;
  } else {
    // Fallback: parse path manually (e.g., "/v1/bundles/caribbean-bundle")
    const segments = event.path.split('/').filter(Boolean);
    bundleId = segments[segments.length - 1];
  }

  if (!bundleId || bundleId === 'id') {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing bundle ID parameter. Usage: GET /v1/bundles/{id}' })
    };
  }

  try {
    const bundlesPath = path.join(process.cwd(), '..', '..', 'data', 'bundles.json');
    
    let fullPath;
    try {
      fullPath = path.join(process.cwd(), '..', '..', 'data', 'bundles.json');
      fs.accessSync(fullPath);
    } catch (e) {
      fullPath = path.join(process.cwd(), 'data', 'bundles.json');
    }

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(raw);

    // Find the bundle
    const bundle = data.bundles.find(b => b.id === bundleId);

    if (!bundle) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Bundle not found',
          availableIds: data.bundles.map(b => b.id)
        })
      };
    }

    // Return full bundle data (public-facing)
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400'
      },
      body: JSON.stringify({
        version: data.version,
        currency: data.currency,
        bundle: {
          id: bundle.id,
          schemaId: bundle.schemaId,
          name: bundle.name,
          nights: bundle.nights,
          region: bundle.region,
          touristTypes: bundle.touristTypes,
          summary: bundle.summary,
          description: bundle.description,
          itinerary: bundle.itinerary,
          pricing: {
            tier: bundle.pricing.tier,
            minPrice: bundle.pricing.minPrice,
            maxPrice: bundle.pricing.maxPrice,
            currency: data.currency,
            perPerson: bundle.pricing.perPerson,
            priceLabel: bundle.pricing.priceLabel
          },
          availability: bundle.availability,
          includes: bundle.includes,
          slug: bundle.slug,
          seoKeywords: bundle.seoKeywords
        }
      })
    };
  } catch (err) {
    console.error('Error fetching bundle:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error. Please try again later.' })
    };
  }
};
