/**
 * Netlify Function: GET /v1/bundles
 * 
 * Returns all active vacation bundles from data/bundles.json.
 * Public access (no authentication required).
 */

const path = require('path');
const fs = require('fs');

exports.handler = async (event, context) => {
  // CORS headers for API access
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

  try {
    // Read bundles.json (works locally and on Netlify after build)
    const bundlesPath = path.join(process.cwd(), 'data', 'bundles.json');
    
    // For production, Netlify Functions run from .netlify/functions/
    // So we need to go up directories to reach data/
    let fullPath;
    try {
      // Production environment
      fullPath = path.join(process.cwd(), '..', '..', 'data', 'bundles.json');
      fs.accessSync(fullPath);
    } catch (e) {
      // Fallback to relative path
      fullPath = bundlesPath;
    }

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(raw);

    // Return only public bundle data (strip internal fields)
    const publicBundles = data.bundles.map(bundle => ({
      id: bundle.id,
      name: bundle.name,
      nights: bundle.nights,
      region: bundle.region,
      touristTypes: bundle.touristTypes,
      summary: bundle.summary,
      description: bundle.description,
      priceTier: bundle.pricing.tier,
      minPrice: bundle.pricing.minPrice,
      maxPrice: bundle.pricing.maxPrice,
      currency: data.currency,
      availability: bundle.availability,
      includes: bundle.includes,
      slug: bundle.slug
    }));

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' // 1 hour cache
      },
      body: JSON.stringify({
        version: data.version,
        lastUpdated: data.lastUpdated,
        currency: data.currency,
        bundles: publicBundles,
        total: publicBundles.length
      })
    };
  } catch (err) {
    console.error('Error fetching bundles:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error. Please try again later.' })
    };
  }
};
