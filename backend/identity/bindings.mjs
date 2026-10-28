import { fail } from "./common.mjs";
import {managedWorkspaceBindingAllowed} from "../member-provisioning/service.mjs";
// Explicit enablement only: importing this module never migrates a database.
export function createBindingStore(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS unified_identity_bindings(issuer TEXT NOT NULL,subject TEXT NOT NULL,native_user_id TEXT NOT NULL,kind TEXT NOT NULL,employee_id TEXT,client_id TEXT UNIQUE,workspace_ids TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,version TEXT NOT NULL,PRIMARY KEY(issuer,subject));`,
  );
  function get(issuer, subject) {
    const row = db
      .prepare(
        "SELECT * FROM unified_identity_bindings WHERE issuer=? AND subject=?",
      )
      .get(issuer, subject);
    if (!row) return null;
    return {
      issuer: row.issuer,
      subject: row.subject,
      nativeUserId: row.native_user_id,
      kind: row.kind,
      employeeId: row.employee_id,
      clientId: row.client_id,
      workspaceIds: JSON.parse(row.workspace_ids),
      enabled: row.enabled === 1 && managedWorkspaceBindingAllowed(db,issuer,subject,row.native_user_id),
      version: row.version,
      site: "workspace",
      principalId:
        row.kind === "employee" ? row.employee_id : row.native_user_id,
      employeeClientId: row.client_id,
    };
  }
  return {
    get,
    addCreatedWorkspace({issuer,subject,nativeUserId,workspaceId}) {
      const old=get(issuer,subject);
      if(!old?.enabled||old.kind!=='human'||old.nativeUserId!==nativeUserId||!db.prepare("SELECT 1 FROM members WHERE user_id=? AND workspace_id=? AND role='owner'").get(nativeUserId,workspaceId))fail('FORBIDDEN','A verified human creator and original owner membership are required.',403);
      if(old.workspaceIds.includes(workspaceId))return;
      db.prepare('UPDATE unified_identity_bindings SET workspace_ids=?,version=CAST(CAST(version AS INTEGER)+1 AS TEXT) WHERE issuer=? AND subject=? AND enabled=1').run(JSON.stringify([...old.workspaceIds,workspaceId]),issuer,subject);
    },
    bind(input) {
      const {
        issuer,
        subject,
        nativeUserId,
        workspaceIds,
        kind = "human",
        employeeId = null,
        clientId = null,
      } = input;
      if (
        !issuer ||
        !subject ||
        !nativeUserId ||
        !Array.isArray(workspaceIds) ||
        !workspaceIds.length ||
        workspaceIds.some((x) => typeof x !== "string" || !x) ||
        !["human", "employee"].includes(kind) ||
        !db.prepare("SELECT id FROM local_users WHERE id=?").get(nativeUserId)
      )
        fail(
          "FORBIDDEN",
          "Explicit native user and workspace binding is required.",
          403,
        );
      if (kind === "employee") {
        const e = db
          .prepare("SELECT * FROM employees WHERE id=?")
          .get(employeeId);
        if (
          !e ||
          e.owner_user_id !== nativeUserId ||
          workspaceIds.length !== 1 ||
          e.workspace_id !== workspaceIds[0] ||
          (clientId !== null &&
            (typeof clientId !== "string" ||
              !clientId.startsWith("ziwei-workspace-worker-")))
        )
          fail(
            "FORBIDDEN",
            "A single employee, owner, site client and workspace binding is required.",
            403,
          );
      } else if (clientId || employeeId)
        fail(
          "FORBIDDEN",
          "Human binding cannot claim an employee client.",
          403,
        );
      for (const workspace of workspaceIds)
        if (
          !db
            .prepare("SELECT 1 FROM members WHERE user_id=? AND workspace_id=?")
            .get(nativeUserId, workspace)
        )
          fail("FORBIDDEN", "Native workspace membership is required.", 403);
      const old = get(issuer, subject);
      if (old) {
        if (
          old.nativeUserId !== nativeUserId ||
          old.kind !== kind ||
          old.employeeId !== employeeId ||
          old.clientId !== clientId ||
          JSON.stringify(old.workspaceIds) !== JSON.stringify(workspaceIds)
        )
          fail(
            "FORBIDDEN",
            "Identity binding is immutable; provision a new reviewed binding.",
            403,
          );
        return old;
      }
      db.prepare(
        "INSERT INTO unified_identity_bindings VALUES(?,?,?,?,?,?,?,1,?)",
      ).run(
        issuer,
        subject,
        nativeUserId,
        kind,
        employeeId,
        clientId,
        JSON.stringify(workspaceIds),
        "1",
      );
      return get(issuer, subject);
    },
    disable(issuer, subject) {
      db.prepare(
        "UPDATE unified_identity_bindings SET enabled=0,version=CAST(CAST(version AS INTEGER)+1 AS TEXT) WHERE issuer=? AND subject=?",
      ).run(issuer, subject);
    },
    machines() {
      return db
        .prepare(
          "SELECT client_id AS clientId,subject,employee_id AS principalId FROM unified_identity_bindings WHERE kind='employee' AND client_id IS NOT NULL",
        )
        .all();
    },
  };
}
