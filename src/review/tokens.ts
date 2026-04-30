function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ReviewTokenPayload = { jobId: string; exp: number };

export async function signReviewToken(secret: string, jobId: string, ttlSec: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${jobId}.${exp}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyReviewToken(
  secret: string,
  token: string,
): Promise<ReviewTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [jobId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!jobId || !Number.isFinite(exp) || !sig) return null;
  const payload = `${jobId}.${exp}`;
  const expected = await hmacHex(secret, payload);
  if (!timingSafeEqual(sig.toLowerCase(), expected.toLowerCase())) return null;
  if (Math.floor(Date.now() / 1000) > exp) return null;
  return { jobId, exp };
}
