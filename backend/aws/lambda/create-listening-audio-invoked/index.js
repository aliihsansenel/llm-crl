// worker.js (Lambda B - worker)
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const fetch = require("cross-fetch"); // node v18 has fetch built-in; adjust for runtime
const AWS = require("aws-sdk");

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_KEY,
  S3_BUCKET,
  AWS_REGION,
  MIN_TOKENS_REQUIRED = "7",
  PRESIGNED_URL_EXPIRES = "3600",
  USE_PUBLIC_ACL = "false",
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
AWS.config.update({ region: AWS_REGION });
const s3 = new AWS.S3();
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

async function callOpenAITTS(text) {
  // NOTE: This is a generalized example — adjust endpoint and payload to match your OpenAI TTS API usage
  // Here we call OpenAI's TTS endpoint (pseudo), expecting binary audio back (aac).
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts", // adjust to actual TTS model you want
      voice: "coral",
      input: text,
      format: "aac",
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI TTS error: ${resp.status} ${txt}`);
  }

  // return ArrayBuffer or Buffer
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadToS3(buffer, key) {
  const params = {
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: "audio/aac",
  };
  if (USE_PUBLIC_ACL === "true") {
    params.ACL = "public-read";
  }
  await s3.putObject(params).promise();

  if (USE_PUBLIC_ACL === "true") {
    // public url construction (if bucket is public)
    return `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}`;
  } else {
    // presigned url
    const url = s3.getSignedUrl("getObject", {
      Bucket: S3_BUCKET,
      Key: key,
      Expires: parseInt(PRESIGNED_URL_EXPIRES, 10),
    });
    return url;
  }
}

exports.handler = async (event) => {
  const payload =
    typeof event === "object" && event.body ? JSON.parse(event.body) : event;
  const { user_id, rl_item_id, r_item } = payload;

  if (!user_id || !rl_item_id || !r_item) {
    console.error("missing inputs", payload);
    return;
  }

  const newUid = uuidv4();

  try {
    const insertRes = await supabase
      .from("l_items")
      .insert([{ uid: newUid, rl_item_id, is_deleted: false }])
      .select()
      .single();
    if (insertRes.error) throw insertRes.error;

    await supabase
      .from("rl_items")
      .update({ l_item_id: ZERO_UUID })
      .eq("id", rl_item_id);

    const audioBuffer = await callOpenAITTS(r_item);

    // ✅ use newUid for file naming
    const s3Key = `files/${newUid}.aac`;
    const publicUrl = await uploadToS3(audioBuffer, s3Key);

    await supabase
      .from("l_items")
      .update({ s3_key: s3Key, public_url: publicUrl })
      .eq("uid", newUid);
    await supabase
      .from("rl_items")
      .update({ l_item_id: newUid })
      .eq("id", rl_item_id);

    // token logic ...
    const tokensFetch = await supabase
      .from("tokens")
      .select("user_id, free, paid")
      .eq("user_id", user_id)
      .single();
    if (tokensFetch.error) throw tokensFetch.error;

    let { free = 0, paid = 0 } = tokensFetch.data;
    const required = parseInt(MIN_TOKENS_REQUIRED, 10);
    const useFromFree = Math.min(free, required);
    const remaining = required - useFromFree;
    free -= useFromFree;
    paid -= remaining;
    const tokenUpdate = await supabase
      .from("tokens")
      .update({ free, paid })
      .eq("user_id", user_id);
    if (tokenUpdate.error) throw tokenUpdate.error;

    console.log("TTS success", { rl_item_id, newUid, s3Key, publicUrl });
    return;
  } catch (err) {
    console.error("worker error", err);
    try {
      await supabase
        .from("rl_items")
        .update({ l_item_id: null })
        .eq("id", rl_item_id);
    } catch (e) {
      console.error("failed to reset rl_items after error", e);
    }
    return;
  }
};
