/**
 * Cloudflare Pages Function: /api/transactions
 * Proxies GHL payment transactions for Adara Spa
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

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
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Calculate date range based on period
  const { startAt, endAt } = customStart && customEnd
    ? { startAt: customStart, endAt: customEnd }
    : getDateRange(period);

  try {
    const params = new URLSearchParams({
      altId: locationId,
      altType: "location",
      startAt,
      endAt,
      limit: "100",
    });

    const response = await fetch(
      `${GHL_API_BASE}/payments/transactions?${params}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: GHL_API_VERSION,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("GHL API error:", response.status, errorBody);
      return new Response(
        JSON.stringify({
          error: "GHL API error",
          status: response.status,
          message: errorBody,
        }),
        {
          status: response.status,
          headers: corsHeaders(),
        }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(),
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      }
    );
  }
}

function getDateRange(period) {
  const now = new Date();
  let startAt;

  switch (period) {
    case "daily": {
      // Today: midnight to now
      startAt = new Date(now);
      startAt.setHours(0, 0, 0, 0);
      break;
    }
    case "weekly": {
      // Last 7 days
      startAt = new Date(now);
      startAt.setDate(startAt.getDate() - 7);
      startAt.setHours(0, 0, 0, 0);
      break;
    }
    case "monthly": {
      // Last 30 days
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
  return new Response(null, {
    headers: corsHeaders(),
  });
}
