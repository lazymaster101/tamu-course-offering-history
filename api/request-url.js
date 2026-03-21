export function resolveRequestUrl(request) {
  const rawUrl = String(request?.url ?? "").trim();

  if (!rawUrl) {
    return new URL("http://localhost/");
  }

  try {
    return new URL(rawUrl);
  } catch {
    const protocol = request?.headers?.get?.("x-forwarded-proto") || "https";
    const host = request?.headers?.get?.("x-forwarded-host")
      || request?.headers?.get?.("host")
      || "localhost";
    return new URL(rawUrl, `${protocol}://${host}`);
  }
}
