import { fail } from "./common.mjs";
import { identityRoutePath, identityResourcePath } from "./route-path.mjs";
const resources = {
  tasks: "tasks",
  "task-attachments": "task_attachments",
  documents: "documents",
  skills: "skills",
  automations: "automations",
  "automation-runs": "automation_runs",
  "calendar-events": "calendar_events",
  devices: "devices",
  employees: "employees",
  bots: "employees",
  notifications: "notifications",
  conversations: "conversations",
  "api-keys": "api_keys",
  invitations: "invitations",
  members: "members",
  actions: "a2a_actions",
};
const isRead = (req) => ["GET", "HEAD", "OPTIONS"].includes(req.method);
export function requiredPermission(req) {
  const path = identityRoutePath(req);
  const operation = identityResourcePath(req);
  // Management is an operation policy, not a synonym for HTTP mutation.
  const management =
    /^\/employees\/[^/]+\/environment(?:\/|$)/i.test(operation) ||
    /^\/ziwei-connect\/terminal(?:\/|$)/i.test(operation) ||
    (!isRead(req) &&
      (/^\/documents\/git\/(?:import|export)$/i.test(operation) ||
        /^\/devices\/[^/]+\/client-updates(?:\/|$)/i.test(operation) ||
        /^\/devices\/pairing$/i.test(operation) ||
        /^\/ziwei-connect\/bindings(?:\/|$)/i.test(operation) ||
        /^\/employees\/[^/]+\/custom-params(?:\/|$)/i.test(operation) ||
        (req.method === "PUT" &&
          /^\/employees\/[^/]+\/phone-mcp$/i.test(operation)) ||
        (req.method === "DELETE" && /^\/employees\/[^/]+$/i.test(operation))));
  if (
    management ||
    /\/(settings|api-keys)(\/|$)/i.test(path) ||
    (!isRead(req) && /\/(members|invitations)(\/|$)/i.test(path)) ||
    (/force-abandon|failure-finalization|\/workspaces$/i.test(path) &&
      !isRead(req))
  )
    return "admin";
  return isRead(req) ? "read" : "write";
}
export function createNativeAuthorization(db, bindings) {
  function memberships(userId, binding) {
    return db
      .prepare(
        `SELECT m.id,m.workspace_id,m.name AS member_name,m.email,m.role,m.avatar,m.joined_at,w.slug,w.name,w.kind,w.timezone FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY m.joined_at`,
      )
      .all(userId)
      .filter((x) => binding.workspaceIds.includes(x.workspace_id));
  }
  function native({ principal, permission, resource: req }) {
    const binding = bindings.get(principal.issuer, principal.subject);
    if (!binding?.enabled || binding.version !== principal.bindingVersion)
      return false;
    const rows = memberships(principal.nativeUserId, binding);
    if (!rows.length) return false;
    const path = identityRoutePath(req);
    let slug;
    try {
      slug = decodeURIComponent(
        path.match(/\/workspaces\/([^/]+)/i)?.[1] || "",
      );
    } catch {
      return false;
    }
    let membership = slug ? rows.find((x) => x.slug === slug) : null;
    if (slug && !membership) return false;
    const afterWorkspace = identityResourcePath(req);
    let direct = afterWorkspace.match(
      /^\/(tasks|task-attachments|documents|skills|automations|automation-runs|calendar-events|devices|employees|bots|notifications|conversations|api-keys|invitations|members|actions)\/([^/]+)/i,
    );
    if (/^\/documents\/git\/(?:import|export)$/i.test(afterWorkspace))
      direct = null;
    if (
      direct &&
      ({
        skills: { import: ["POST"], copy: ["POST"] },
        notifications: { read: ["POST"] },
        devices: { pairing: ["POST"] },
        documents: { trash: ["GET", "HEAD"] },
        bots: { capabilities: ["GET", "HEAD"] },
      }[direct[1].toLowerCase()] || {})[direct[2].toLowerCase()]?.includes(
        req.method,
      )
    )
      direct = null;
    let resourceRow = null,
      kind = null;
    if (direct) {
      kind = direct[1].toLowerCase();
      let resourceId;
      try {
        resourceId = decodeURIComponent(direct[2]);
      } catch {
        return false;
      }
      try {
        resourceRow =
          kind === "task-attachments"
            ? db
                .prepare(
                  "SELECT a.*,t.workspace_id FROM task_attachments a JOIN tasks t ON t.id=a.task_id WHERE a.id=?",
                )
                .get(resourceId)
            : db
                .prepare(`SELECT * FROM ${resources[kind]} WHERE id=?`)
                .get(resourceId);
      } catch {
        return false;
      }
      if (!resourceRow) return false;
      if (!resourceRow.workspace_id) return false;
      const actual = rows.find(
        (m) => m.workspace_id === resourceRow.workspace_id,
      );
      if (
        !actual ||
        (membership && membership.workspace_id !== actual.workspace_id)
      )
        return false;
      membership = actual;
    }
    if (!membership) {
      if (
        ![
          "/api/workspaces",
          "/api/identity/me",
          "/api/auth/me",
          "/api/auth/status",
        ].includes(path.toLowerCase())
      )
        return false;
      if (!isRead(req)) return false;
    }
    if (
      permission === "admin" &&
      (!membership || !["owner", "admin"].includes(membership.role))
    )
      return false;
    if (membership && !["owner", "admin", "member"].includes(membership.role))
      return false;
    const metadataOnly =
      isRead(req) &&
      [
        "/api/identity/me",
        "/api/auth/me",
        "/api/auth/status",
        "/api/workspaces",
      ].includes(path.toLowerCase());
    if (binding.kind === "employee" && !metadataOnly) {
      if (
        !resourceRow ||
        !["employees", "bots"].includes(kind) ||
        resourceRow.id !== binding.employeeId ||
        resourceRow.owner_user_id !== binding.nativeUserId
      )
        return false;
      const e = db
        .prepare("SELECT * FROM employees WHERE id=?")
        .get(binding.employeeId);
      if (
        !e ||
        e.workspace_id !== membership.workspace_id ||
        e.owner_user_id !== binding.nativeUserId
      )
        return false;
    }
    if (
      resourceRow &&
      ["employees", "bots"].includes(kind) &&
      ["personal", "private"].includes(resourceRow.visibility) &&
      resourceRow.owner_user_id !== principal.nativeUserId &&
      !["owner", "admin"].includes(membership.role)
    )
      return false;
    if (
      resourceRow &&
      kind === "devices" &&
      !isRead(req) &&
      resourceRow.owner_user_id !== principal.nativeUserId &&
      !["owner", "admin"].includes(membership.role)
    )
      return false;
    // Preserve the binding's single employee/device scope before any business call.
    if (binding.kind === "employee" && !metadataOnly) {
      for (const key of ["employeeId", "employee_id"])
        if (req.body?.[key] && req.body[key] !== binding.employeeId)
          return false;
      const device = resourceRow.target_device_id;
      for (const key of [
        "deviceId",
        "device_id",
        "targetDeviceId",
        "target_device_id",
      ])
        if (req.body?.[key] && req.body[key] !== device) return false;
    }
    req.workspaceRole = membership?.role || rows[0].role;
    return true;
  }
  return {
    native,
    memberships,
    view(principal, req) {
      const b = bindings.get(principal.issuer, principal.subject),
        rows = memberships(principal.nativeUserId, b);
      const user = db
        .prepare(
          "SELECT id,email,name,created_at,last_login_at FROM local_users WHERE id=?",
        )
        .get(principal.nativeUserId);
      if (!user) fail("FORBIDDEN", "Native identity no longer exists.", 403);
      return {
        user,
        user_id: user.id,
        memberships: rows,
        workspace:
          rows.find((x) => x.role === req.workspaceRole) || rows[0] || null,
        role: req.workspaceRole || rows[0]?.role,
        identity: principal,
        scopes: principal.scopes,
        verification: "server",
        verified: true,
      };
    },
  };
}
