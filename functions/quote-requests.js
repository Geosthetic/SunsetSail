/**
 * Netlify Function: POST /v1/quote-requests
 * 
 * Submits a new quote request for review.
 * Validates required fields, sanitizes input, and stores for review.
 * Sends confirmation email to client (via SendGrid/Netlify Forms).
 */

const path = require('path');
const fs = require('fs');

// Configuration — move to environment variables in production
const CONFIG = {
  quotesDir: path.join(process.cwd(), '..', '..', 'data', 'quotes'),
  maxPartySize: 12,
  validBudgetTiers: ['economy', 'premium', 'luxury'],
  validBundleOptions: ['caribbean', 'alaska', 'mediterranean', 'custom'],
  retentionDays: 90,
  adminEmail: process.env.ADMIN_EMAIL || 'quotes@sunsetsailtravel.example'
};

// Ensure quotes directory exists
function ensureQuotesDir() {
  if (!fs.existsSync(CONFIG.quotesDir)) {
    fs.mkdirSync(CONFIG.quotesDir, { recursive: true });
  }
}

// Sanitize input to prevent XSS/injection
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .substring(0, 2000); // Max length
}

// Validate form data
function validateQuote(payload) {
  const errors = [];

  // Required fields
  if (!payload.name || payload.name.trim().length < 2) {
    errors.push('Name must be at least 2 characters');
  }

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    errors.push('Valid email is required');
  }

  // Optional but validated if present
  if (payload.phone && !/^\+?[\d\s\-()]{7,20}$/.test(payload.phone)) {
    errors.push('Invalid phone number format');
  }

  if (payload.partySize) {
    const size = parseInt(payload.partySize, 10);
    if (isNaN(size) || size < 1 || size > CONFIG.maxPartySize) {
      errors.push(`Party size must be between 1 and ${CONFIG.maxPartySize}`);
    }
  }

  if (payload.budgetTier && !CONFIG.validBudgetTiers.includes(payload.budgetTier)) {
    errors.push(`Invalid budget tier. Valid options: ${CONFIG.validBudgetTiers.join(', ')}`);
  }

  if (payload.bundle && !CONFIG.validBundleOptions.includes(payload.bundle)) {
    errors.push(`Invalid bundle option. Valid options: ${CONFIG.validBundleOptions.join(', ')}`);
  }

  return errors;
}

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
    };
  }

  try {
    // Parse request body
    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch (e) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    // Sanitize all string fields
    Object.keys(payload).forEach(key => {
      if (typeof payload[key] === 'string') {
        payload[key] = sanitizeInput(payload[key]);
      }
    });

    // Validate
    const validationErrors = validateQuote(payload);
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Validation failed',
          details: validationErrors
        })
      };
    }

    // Enrich with metadata
    const quoteRequest = {
      id: `Q-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CONFIG.retentionDays * 24 * 60 * 60 * 1000).toISOString(),
      ...payload,
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['X-Forwarded-For'] || 'unknown',
      userAgent: event.headers['user-agent'] || 'unknown',
      status: 'pending', // pending → reviewed → completed | declined
      notes: sanitizeInput(payload.notes || '')
    };

    // Store locally (for demo/development)
    // In production, use Netlify DB, Airtable, or external database
    ensureQuotesDir();
    const filePath = path.join(CONFIG.quotesDir, `${quoteRequest.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(quoteRequest, null, 2), 'utf-8');

    // TODO: Add email notification here
    // Options:
    // - Netlify Forms integration (set up form in Netlify dashboard)
    // - SendGrid API (requires env var SENDGRID_API_KEY)
    // - AWS SES (requires env vars AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    // For now, log success message
    console.log(`New quote request received: ${quoteRequest.id} from ${quoteRequest.email}`);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        requestId: quoteRequest.id,
        message: 'Quote request received. We will respond within 1 business day.',
        retentionDays: CONFIG.retentionDays
      })
    };
  } catch (err) {
    console.error('Error processing quote request:', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error. Please try again later.',
        requestId: `ERR-${Date.now()}`
      })
    };
  }
};
