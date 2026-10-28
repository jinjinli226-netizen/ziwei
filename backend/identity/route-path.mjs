// Express defaults: static route segments are case-insensitive and one final
// slash is optional. Keep every captured workspace/resource identifier intact.
export function identityRoutePath(req) {
  const path = String(req.originalUrl || req.path || req.url || "").split(
    "?",
  )[0];
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function identityResourcePath(req) {
  return identityRoutePath(req)
    .replace(/^\/(?:api|mcp\/v1)\/workspaces\/[^/]+/i, "")
    .replace(/^\/(?:api|mcp\/v1)(?=\/)/i, "");
}
