'use strict';

const https = require('https');

/**
 * Makes an authenticated GET request to the Stripe API.
 * @param {string} path - API path e.g. '/v1/subscriptions?status=active'
 * @returns {Promise<object>} Parsed JSON response
 */
function stripeGet(path) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.STRIPE_API_KEY;
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`Failed to parse Stripe response: ${err.message}`));
          }
        } else {
          reject(new Error(`Stripe API error ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

/**
 * Fetches revenue metrics from Stripe.
 * @returns {Promise<object>} Revenue report or { skipped: true, reason: string }
 */
async function getStripeReport() {
  const available = process.env.STRIPE_API_KEY || false;
  if (!available) {
    console.log('[stripe] not configured — skipping');
    return { skipped: true, reason: 'not configured' };
  }

  try {
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

    // MRR: sum plan amounts from active subscriptions (approximation)
    let mrr = 0;
    try {
      const activeSubs = await stripeGet('/v1/subscriptions?status=active&limit=100');
      for (const sub of (activeSubs.data || [])) {
        // items.data[0].price.unit_amount is in cents
        const amount = sub.items?.data?.[0]?.price?.unit_amount || 0;
        const interval = sub.items?.data?.[0]?.price?.recurring?.interval || 'month';
        // Normalize to monthly
        if (interval === 'year') {
          mrr += Math.round(amount / 12);
        } else {
          mrr += amount;
        }
      }
      // Convert cents to dollars
      mrr = Math.round(mrr / 100);
    } catch (err) {
      console.warn('[stripe] Failed to fetch MRR:', err.message);
    }

    // New subscribers in last 30 days
    let newSubscribers = 0;
    try {
      const newSubs = await stripeGet(`/v1/subscriptions?created[gte]=${thirtyDaysAgo}&limit=100`);
      newSubscribers = (newSubs.data || []).length;
    } catch (err) {
      console.warn('[stripe] Failed to fetch new subscribers:', err.message);
    }

    // Churn: canceled subscriptions in last 30 days
    let churn = 0;
    try {
      const canceledSubs = await stripeGet(`/v1/subscriptions?status=canceled&canceled_at[gte]=${thirtyDaysAgo}&limit=100`);
      churn = (canceledSubs.data || []).length;
    } catch (err) {
      console.warn('[stripe] Failed to fetch churn:', err.message);
    }

    // Failed payments in last 30 days
    let failedPayments = 0;
    try {
      const failedIntents = await stripeGet(`/v1/payment_intents?created[gte]=${thirtyDaysAgo}&status=requires_payment_method&limit=100`);
      failedPayments = (failedIntents.data || []).length;
    } catch (err) {
      console.warn('[stripe] Failed to fetch failed payments:', err.message);
    }

    return {
      mrr,
      newSubscribers,
      churn,
      failedPayments,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[stripe] Fetch failed:', err.message);
    return { skipped: true, reason: `fetch failed: ${err.message}` };
  }
}

module.exports = { getStripeReport };

if (require.main === module) {
  getStripeReport().then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }).catch(err => {
    console.error('[stripe] Unexpected error:', err.message);
    process.exit(1);
  });
}
