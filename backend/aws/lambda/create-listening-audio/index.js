const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");
const AWS = require("aws-sdk");

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET,
  LAMBDA_WORKER_NAME,
  AWS_REGION,
  MIN_TOKENS_REQUIRED = "1",
} = process.env;

// --- CORS Configuration ---
// Add the domains that are allowed to access this Lambda function.
// For local development, you might want to add 'http://localhost:3000', etc.
const allowedOrigins = ["https://llm-crl.netlify.com", "http://localhost:5173"];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
AWS.config.update({ region: AWS_REGION });
const lambda = new AWS.Lambda();

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

exports.handler = async (event) => {
  // --- CORS Handling ---
  const origin = event.headers.origin;
  const corsHeaders = {};

  if (allowedOrigins.includes(origin)) {
    corsHeaders["Access-Control-Allow-Origin"] = origin;
    corsHeaders["Access-Control-Allow-Credentials"] = true;
  }

  // Handle preflight OPTIONS request for CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204, // No Content
      headers: {
        "Access-Control-Allow-Origin": origin, // Reflecting the origin
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  try {
    // Parse incoming request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Request body is missing" }),
      };
    }
    const { jwt_token, rl_item_id } = JSON.parse(event.body);

    if (!jwt_token || !rl_item_id) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "jwt_token and rl_item_id are required",
        }),
      };
    }

    // 1) Verify JWT signature (no DB call). If invalid -> 401
    let decoded;
    try {
      decoded = jwt.verify(jwt_token, SUPABASE_JWT_SECRET);
    } catch (err) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid token" }),
      };
    }

    const user_id = decoded.sub || decoded.user_id || null;
    if (!user_id) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid token payload" }),
      };
    }

    // 2) Fetch rl_items row
    const { data: rlItems, error: rlErr } = await supabase
      .from("rl_items")
      .select("id, l_item_id, r_item")
      .eq("id", rl_item_id)
      .limit(1)
      .single();

    if (rlErr) {
      console.error("rl_items fetch error", rlErr);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "DB error fetching rl_item" }),
      };
    }

    // 3) Check l_item_id conditions
    const l_item_id = rlItems.l_item_id;
    if (
      l_item_id &&
      l_item_id !== ZERO_UUID &&
      l_item_id !== "00000000000000000000000000000000"
    ) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: "l_item already exists" }),
      };
    }
    if (l_item_id === ZERO_UUID) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: "audio creation already in progress" }),
      };
    }

    // 4) Check token balance (without consuming)
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("tokens")
      .select("user_id, free, paid")
      .eq("user_id", user_id)
      .limit(1)
      .single();

    if (tokenErr) {
      console.error("tokens fetch", tokenErr);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "DB error fetching tokens" }),
      };
    }

    const free = tokenRow ? tokenRow.free || 0 : 0;
    const paid = tokenRow ? tokenRow.paid || 0 : 0;
    const totalAvailable = free + paid;
    const required = parseInt(MIN_TOKENS_REQUIRED, 10);

    if (totalAvailable < required) {
      return {
        statusCode: 402,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Insufficient tokens" }),
      };
    }

    // 5) Invoke worker async (Event)
    const payload = {
      user_id,
      rl_item_id,
      r_item: rlItems.r_item,
    };

    const invokeParams = {
      FunctionName: LAMBDA_WORKER_NAME,
      InvocationType: "Event", // async
      Payload: JSON.stringify(payload),
    };

    await lambda.invoke(invokeParams).promise();

    // 6) Return 200 immediate response
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: "processing", rl_item_id }),
    };
  } catch (err) {
    console.error("handler error", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "internal_server_error" }),
    };
  }
};
