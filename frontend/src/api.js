const base = import.meta.env.VITE_API_URL ?? "";

async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function formatApiError(data) {
  if (!data) return "Unknown error";
  const d = data.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => (e.msg ? `${e.loc?.join?.(".") ?? "field"}: ${e.msg}` : JSON.stringify(e)))
      .join("; ");
  }
  if (d && typeof d === "object") return JSON.stringify(d);
  return typeof data === "string" ? data : JSON.stringify(data);
}

export async function getHealth() {
  const res = await fetch(`${base}/api/health`);
  const data = await parseJsonSafe(res);
  return { ok: res.ok, status: res.status, data };
}

export async function getOptions() {
  const res = await fetch(`${base}/api/options`);
  const data = await parseJsonSafe(res);
  return { ok: res.ok, status: res.status, data };
}

export async function postPredict(body) {
  const res = await fetch(`${base}/api/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(res);
  return { ok: res.ok, status: res.status, data };
}

export async function postDatasetMatches(body) {
  const res = await fetch(`${base}/api/dataset-matches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(res);
  return { ok: res.ok, status: res.status, data };
}
