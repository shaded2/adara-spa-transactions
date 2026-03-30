/**
 * Cloudflare Pages Function: /api/transactions
 * Proxies GHL payment transactions for Adara Spa, enriched with order line items.
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

const GHL_HEADERS = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  Version: GHL_API_VERSION,
  "Content-Type": "application/json",
});

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  const period = url.searchParams.get("period") || "daily";
  const customStart = url.searchParams.get("startAt");
  const customEnd = url.searchParams.get("endAt");

  const locationId = env.GHL_LOCATION_ID || "T3ndPiD159wpeSV0zQc7";
  const apiKey = env.GHL_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server configuration missing" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const { startAt, endAt } = customStart && customEnd
    ? { startAt: customStart, endAt: customEnd }
    : getDateRange(period);

  try {
    // 1. Fetch transactions list
    const params = new URLSearchParams({
      altId: locationId,
      altType: "location",
      startAt,
      endAt,
      limit: "100",
    });

    const txRes = await fetch(
      `${GHL_API_BASE}/payments/transactions?${params}`,
      { headers: GHL_HEADERS(apiKey) }
    );

    if (!txRes.ok) {
      const errorBody = await txRes.text();
      console.error("GHL transactions error:", txRes.status, errorBody);
      return new Response(
        JSON.stringify({ error: "GHL API error", status: txRes.status, message: errorBody }),
        { status: txRes.status, headers: corsHeaders() }
      );
    }

    const data = await txRes.json();
    const transactions = data?.data || [];

    // 2. For transactions without chargeSnapshot line items, fetch their order to get items
    const needsEnrichment = transactions.filter(
      t => t.entityType === "order" && t.entityId && !t.chargeSnapshot?.lineItems
    );

    if (needsEnrichment.length > 0) {
      const orderResults = await Promise.all(
        needsEnrichment.map(t => fetchOrder(t.entityId, apiKey))
      );

      // Merge order items back into transactions by entityId
      const orderMap = {};
      needsEnrichment.forEach((t, i) => {
        if (orderResults[i]) orderMap[t.entityId] = orderResults[i];
      });

      transactions.forEach(t => {
        if (orderMap[t.entityId]) {
          t._orderItems = orderMap[t.entityId];
        }
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } }
    );
  }
}

async function fetchOrder(orderId, apiKey) {
  try {
    const res = await fetch(
      `${GHL_API_BASE}/payments/orders/${orderId}`,
      { headers: GHL_HEADERS(apiKey) }
    );
    if (!res.ok) return null;
    const body = await res.json();
    // GHL returns the order either at root or under .order
    const order = body?.order || body;
    // Items may be under .items or .lineItems
    const items = order?.items || order?.lineItems || [];
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function getDateRange(period) {
  const now = new Date();
  let startAt;

  switch (period) {
    case "daily": {
      startAt = new Date(now);
      startAt.setHours(0, 0, 0, 0);
      break;
    }
    case "weekly": {
      startAt = new Date(now);
      startAt.setDate(startAt.getDate() - 7);
      startAt.setHours(0, 0, 0, 0);
      break;
    }
    case "monthly": {
      startAt = new Date(now);
      startAt.setDate(startAt.getDate() - 30);
      startAt.setHours(0, 0, 0, 0);
      break;
    }
    default:
      startAt = new Date(now);
      startAt.setHours(0, 0, 0, 0);
  }

  return {
    startAt: startAt.toISOString(),
    endAt: now.toISOString(),
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}
