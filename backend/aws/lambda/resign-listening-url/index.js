const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");
const AWS = require("aws-sdk");

/**
 * Lambda: resign-listening-url
 *
 * Purpose:
 *  - Accepts { jwt_token, l_item_uid } in POST body
 *  - Verifies jwt_token using SUPABASE_JWT_SECRET (same pattern as existing lambdas)
 *  - Reads the l_items row for provided uid using Supabase service role key
 *  - If bucket/object is public (USE_PUBLIC_ACL === "true") return stored public_url
 *  - Otherwise generate a fresh presigned GET URL and return it
 *
 * NOTE:
 *  - This function is intentionally conservative: it only verifies token signature and that a matching l_items row exists.
 *  - You will supply the real Lambda URL when wiring client-side code.
 *
 * Environment variables expected:
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - SUPABASE_JWT_SECRET
 *  - S3_BUCKET
 *  - AWS_REGION
 *  - PRESIGNED_URL_EXPIRES (seconds, default "3600")
 *  - USE_PUBLIC_ACL ("true" or "false")
 */

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET,
  S3_BUCKET,
  AWS_REGION,
  PRESIGNED_URL_EXPIRES = "3600",
  USE_PUBLIC_ACL = "false",
} = process.env;

// --- CORS Configuration ---
// Add the domains that are allowed to access this Lambda function.
// For local development, you might want to add 'http://localhost:3000', etc.
const allowedOrigins = ["https://llm-crl.netlify.com", "http://localhost:5173"];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
AWS.config.update({ region: AWS_REGION });
const s3 = new AWS.S3();

exports.handler = async (event) => {
  // Basic CORS response headers (mirror origin if provided)
  const origin = event.headers.origin;

  const corsHeaders = {};

  if (allowedOrigins.includes(origin)) {
    corsHeaders["Access-Control-Allow-Origin"] = origin;
    corsHeaders["Access-Control-Allow-Headers"] = "Content-Type";
    corsHeaders["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    corsHeaders["Access-Control-Allow-Credentials"] = true;
  }

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": origin, // Reflecting the origin
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Request body missing" }),
      };
    }

    const body =
      typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    const { jwt_token, l_item_uid } = body || {};

    if (!jwt_token || !l_item_uid) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          error: "jwt_token and l_item_uid required",
        }),
      };
    }

    // Verify JWT signature only (no DB lookup) - same approach used by other lambdas
    let decoded;
    try {
      decoded = jwt.verify(jwt_token, SUPABASE_JWT_SECRET);
    } catch (err) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Invalid token" }),
      };
    }

    const user_id = decoded.sub || decoded.user_id || null;
    if (!user_id) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Invalid token payload" }),
      };
    }

    // Fetch l_items row
    const { data: lItem, error: lErr } = await supabase
      .from("l_items")
      .select("uid,s3_key,public_url,is_deleted")
      .eq("uid", l_item_uid)
      .maybeSingle();

    if (lErr) {
      console.error("supabase l_items fetch error", lErr);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "DB error fetching l_item" }),
      };
    }

    if (!lItem) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "l_item not found" }),
      };
    }

    if (lItem.is_deleted) {
      return {
        statusCode: 410,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "l_item is deleted" }),
      };
    }

    // If bucket is public and public_url exists, just return it
    if (USE_PUBLIC_ACL === "true" && lItem.public_url) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, public_url: lItem.public_url }),
      };
    }

    // Need s3_key to generate signed url
    const key = lItem.s3_key;
    if (!key) {
      // If no s3_key but public_url exists, return it anyway
      if (lItem.public_url) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: true, public_url: lItem.public_url }),
        };
      }
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "No s3_key for l_item" }),
      };
    }

    // Generate presigned URL (getObject)
    const expires = parseInt(PRESIGNED_URL_EXPIRES, 10) || 3600;
    const signedUrl = s3.getSignedUrl("getObject", {
      Bucket: S3_BUCKET,
      Key: key,
      Expires: expires,
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, public_url: signedUrl }),
    };
  } catch (err) {
    console.error("resign handler error", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: "internal_server_error" }),
    };
  }
};
