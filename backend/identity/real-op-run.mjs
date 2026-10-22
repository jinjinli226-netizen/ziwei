// Opt-in synthetic integration supervisor; never imported by production startup.
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
const project = path.resolve(import.meta.dirname, "../.."),
  root = path.join(project, ".local/identity-real-op"),
  logs = path.join(root, "logs");
const evidence =
  "D:/AINavtie/ops/cli-standard/identity-readiness/workspace/real-op";
for (const dir of [root, logs, evidence])
  fs.mkdirSync(dir, { recursive: true });
const instance = "workspace-real-op-" + crypto.randomUUID(),
  runDir = path.join(root, instance);
fs.mkdirSync(runDir);
const journal = path.join(logs, instance + ".ndjson"),
  state = path.join(root, "observer-state.json"),
  lock = path.join(root, "runner.lock");
const fd = fs.openSync(lock, "wx");
fs.writeFileSync(fd, String(process.pid));
fs.closeSync(fd);
const log = (event, data = {}) => {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    instance,
    event,
    pid: process.pid,
    ppid: process.ppid,
    ...data,
  });
  fs.appendFileSync(journal, line + "\n");
  console.log(line);
};
if (fs.existsSync(state)) {
  const previous = JSON.parse(fs.readFileSync(state));
  if (!previous.finished)
    log("previous_unclean_exit", {
      previousInstance: previous.instance,
      previousPid: previous.pid,
    });
}
fs.writeFileSync(
  state,
  JSON.stringify({ instance, pid: process.pid, finished: false }),
);
const secrets = [],
  secret = () => {
    const x = crypto.randomBytes(32).toString("hex");
    secrets.push(x);
    return x;
  };
const redact = (value) => {
  let s = String(value);
  for (const value of secrets) s = s.replaceAll(value, "[redacted]");
  return s
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[redacted]")
    .replace(
      /(?:access_token|refresh_token|id_token|logout_token|device_code|code_verifier|client_secret|password)[=:]\s*[^\s&]+/gi,
      "[sensitive-field-redacted]",
    );
};
function output(p, name) {
  for (const [stream, kind] of [
    [p.stdout, "stdout"],
    [p.stderr, "stderr"],
  ]) {
    let rotation = 0;
    const file = path.join(logs, instance + "." + name + "." + kind + ".log");
    stream.on("data", (chunk) => {
      const safe = redact(chunk);
      if (
        fs.existsSync(file) &&
        fs.statSync(file).size + Buffer.byteLength(safe) > 5 * 1024 * 1024
      )
        fs.renameSync(file, file + "." + ++rotation);
      fs.appendFileSync(file, safe);
      if (name === "checks") process.stdout.write(safe);
    });
  }
}
const java =
    "D:/AINavtie/unified-cli/.local/toolchains/temurin/jdk-21.0.12.1+1-jre",
  sourceHome =
    "D:/AINavtie/unified-cli/.local/toolchains/keycloak/keycloak-26.8.1",
  home = path.join(root, "keycloak-26.8.1");
const cert = path.join(runDir, "certificate.pem"),
  pfx = path.join(runDir, "identity-test.p12"),
  fixture = path.join(runDir, "private-fixture.json"),
  resultFile = path.join(runDir, "result.json"),
  executedScript = path.join(
    project,
    "backend/identity",
    instance + ".integration.mjs",
  );
const executionSource = process.argv.includes("--focused-worker-mappers")
  ? "backend/identity/real-op-focused.integration.mjs"
  : "backend/identity/real-op.integration.mjs";
const sourceFiles = [
  "backend/app.mjs",
  ...fs
    .readdirSync(path.join(project, "backend/identity"))
    .filter(
      (name) =>
        name.endsWith(".mjs") &&
        !name.endsWith(".test.mjs") &&
        !name.includes("workspace-real-op-"),
    )
    .map((name) => "backend/identity/" + name),
  "packages/workspace-cli/src/unified.mjs",
  "packages/workspace-cli/src/registry.mjs",
  ...["cli.md", "index.html", "llms.txt"].map(
    (name) => "docs/public/workspace-cli/" + name,
  ),
];
const hashSources = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(project, file)))
        .digest("hex"),
    ]),
  );
let sourceHashesAtStart;
let kc,
  worker,
  timer,
  realmFile,
  failed = false,
  result = {},
  listenerObservationRunning = false;
const listenerSnapshots = [];
async function command(binary, args, env = {}) {
  const p = spawn(binary, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  output(p, "setup");
  const [code] = await once(p, "exit");
  if (code !== 0) throw Error("Synthetic setup command failed");
}
async function stop(p) {
  if (!p || p.exitCode !== null) return;
  const q = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$taskChild=Get-CimInstance Win32_Process -Filter 'ProcessId = ${p.pid}'; if($taskChild -and $taskChild.ParentProcessId -eq ${process.pid}) { exit 0 } else { exit 2 }`,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  const [verified] = await once(q, "exit");
  if (p.exitCode !== null) return;
  if (verified !== 0) {
    failed = true;
    log("owned_stop_refused", { childPid: p.pid });
    return;
  }
  const ended = once(p, "exit");
  const kill = spawn("taskkill.exe", ["/PID", String(p.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  const [killCode] = await once(kill, "exit");
  log("owned_tree_stop", { childPid: p.pid, killCode });
  await Promise.race([ended, new Promise((r) => setTimeout(r, 10000))]);
}
async function free(port) {
  const probe = net.createServer();
  probe.listen(port, "127.0.0.1");
  await once(probe, "listening");
  await new Promise((r) => probe.close(r));
}
try {
  for (const port of [5372, 5373, 5374]) await free(port);
  for (const forced of [false, true]) {
    const p = spawn(
      process.execPath,
      [
        "-e",
        forced
          ? "setInterval(()=>{},1000)"
          : "setTimeout(()=>process.exit(7),50)",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    log("diagnostic_start", { childPid: p.pid, forced });
    const exit = once(p, "exit");
    if (forced) p.kill("SIGKILL");
    const [code, signal] = await exit;
    log("diagnostic_exit", {
      childPid: p.pid,
      code,
      signal,
      expectedAbnormal: true,
      forced,
    });
    if (!forced && code !== 7)
      throw Error("Independent exit observer diagnostic failed");
  }
  if (!fs.existsSync(home)) {
    log("runtime_copy_start");
    fs.cpSync(sourceHome, home, {
      recursive: true,
      filter: (source) => {
        const rel = path.relative(sourceHome, source);
        return !rel || !["data", "logs"].includes(rel.split(path.sep)[0]);
      },
    });
    log("runtime_copy_complete");
  }
  const tlsPass = secret();
  await command(
    path.join(java, "bin/keytool.exe"),
    [
      "-genkeypair",
      "-alias",
      "workspace-fixture",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-storetype",
      "PKCS12",
      "-keystore",
      pfx,
      "-storepass:env",
      "ZIWEI_TEST_TLS_PASS",
      "-keypass:env",
      "ZIWEI_TEST_TLS_PASS",
      "-dname",
      "CN=127.0.0.1",
      "-validity",
      "2",
      "-ext",
      "SAN=ip:127.0.0.1,dns:localhost",
      "-ext",
      "BC=ca:true",
      "-ext",
      "KU=digitalSignature,keyEncipherment,keyCertSign",
      "-ext",
      "EKU=serverAuth",
    ],
    { ZIWEI_TEST_TLS_PASS: tlsPass },
  );
  await command(
    path.join(java, "bin/keytool.exe"),
    [
      "-exportcert",
      "-rfc",
      "-alias",
      "workspace-fixture",
      "-keystore",
      pfx,
      "-storepass:env",
      "ZIWEI_TEST_TLS_PASS",
      "-file",
      cert,
    ],
    { ZIWEI_TEST_TLS_PASS: tlsPass },
  );
  const realm = JSON.parse(
    fs.readFileSync(
      "D:/AINavtie/unified-cli/config/keycloak-sites.candidate.json",
      "utf8",
    ),
  );
  realm.clients = realm.clients.filter((c) =>
    /^ziwei-(workspace|world)-/.test(c.clientId),
  );
  realm.clientScopes = realm.clientScopes.filter((c) =>
    /^(?:ziwei-)?(?:workspace|world)(?::|-)/.test(c.name),
  );
  realm.roles.client = Object.fromEntries(
    Object.entries(realm.roles.client).filter(([id]) =>
      /^ziwei-(workspace|world)-/.test(id),
    ),
  );
  realm.clientScopeMappings = Object.fromEntries(
    Object.entries(realm.clientScopeMappings).filter(([id]) =>
      /^ziwei-(workspace|world)-/.test(id),
    ),
  );
  realm.realm = instance;
  realm.enabled = true;
  realm.sslRequired = "all";
  realm.eventsEnabled = false;
  realm.adminEventsEnabled = false;
  const credentials = {},
    password = secret(),
    origin = "https://127.0.0.1:5373",
    issuer = "https://127.0.0.1:5372/realms/" + instance;
  for (const client of realm.clients) {
    if (!client.publicClient)
      client.secret = credentials[client.clientId] = secret();
    if (client.standardFlowEnabled) {
      client.rootUrl = origin;
      client.redirectUris = [
        origin +
          (client.clientId === "ziwei-workspace-web"
            ? "/api/identity/callback"
            : "/fixture-callback/" + client.clientId),
      ];
      client.webOrigins = [origin];
      client.attributes["post.logout.redirect.uris"] = origin + "/";
      if (client.clientId === "ziwei-workspace-web")
        client.attributes["backchannel.logout.url"] =
          origin + "/api/identity/backchannel-logout";
      else delete client.attributes["backchannel.logout.url"];
    }
  }
  realm.users = [
    {
      username: "fixture-human",
      enabled: true,
      emailVerified: true,
      email: "fixture-human@example.invalid",
      firstName: "Synthetic",
      lastName: "Workspace",
      credentials: [{ type: "password", value: password, temporary: false }],
      clientRoles: {
        "ziwei-workspace-api": ["access", "read", "write", "admin"],
        "ziwei-world-api": ["access", "read"],
      },
    },
  ];
  const operator = {
    clientId: "fixture-operator",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    secret: (credentials["fixture-operator"] = secret()),
    clientAuthenticatorType: "client-secret",
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    fullScopeAllowed: true,
    defaultClientScopes: [],
    optionalClientScopes: [],
    protocolMappers: [
      {
        name: "operator-admin-roles",
        protocol: "openid-connect",
        protocolMapper: "oidc-usermodel-client-role-mapper",
        config: {
          "usermodel.clientRoleMapping.clientId": "realm-management",
          "claim.name": "resource_access.realm-management.roles",
          "jsonType.label": "String",
          multivalued: "true",
          "access.token.claim": "true",
        },
      },
    ],
  };
  realm.clients.push(operator);
  realm.users.push({
    username: "service-account-fixture-operator",
    serviceAccountClientId: "fixture-operator",
    enabled: true,
    clientRoles: {
      "realm-management": [
        "manage-users",
        "view-users",
        "query-users",
        "view-clients",
        "manage-clients",
        "manage-realm",
      ],
    },
  });
  const employee = "ziwei-workspace-worker-fixture";
  realm.clients.push({
    clientId: employee,
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    secret: (credentials[employee] = secret()),
    clientAuthenticatorType: "client-secret",
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    fullScopeAllowed: false,
    defaultClientScopes: ["ziwei-workspace-audience"],
    optionalClientScopes: ["workspace:read", "workspace:write"],
  });
  realm.users.push({
    username: "service-account-" + employee,
    serviceAccountClientId: employee,
    enabled: true,
    clientRoles: { "ziwei-workspace-api": ["access", "read", "write"] },
  });
  const imports = path.join(home, "data/import");
  fs.mkdirSync(imports, { recursive: true });
  realmFile = path.join(imports, instance + "-realm.json");
  fs.writeFileSync(realmFile, JSON.stringify(realm), { mode: 0o600 });
  fs.writeFileSync(
    fixture,
    JSON.stringify({
      instance,
      origin,
      issuer,
      credentials,
      password,
      pfx,
      tlsPass,
      cert,
      resultFile,
      runDir,
      evidence,
    }),
    { mode: 0o600 },
  );
  const kcCommand = `"${path.join(home, "bin/kc.bat")}" start --cache=local --http-host=127.0.0.1 --http-enabled=false --https-port=5372 --https-key-store-file="${pfx}" --https-key-store-type=PKCS12 --hostname=https://127.0.0.1:5372 --db=dev-mem --import-realm --log-console-color=false --truststore-paths="${cert}"`;
  kc = spawn("cmd.exe", ["/d", "/s", "/c", '"' + kcCommand + '"'], {
    windowsVerbatimArguments: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      JAVA_HOME: java,
      JAVA_OPTS_APPEND:
        "-Dcom.arjuna.ats.internal.arjuna.utils.SocketProcessIdPort=5374 -Dcom.arjuna.ats.internal.arjuna.utils.SocketProcessIdMaxPorts=1",
      KC_HTTPS_KEY_STORE_PASSWORD: tlsPass,
      KC_HEALTH_ENABLED: "false",
      KC_METRICS_ENABLED: "false",
    },
  });
  output(kc, "keycloak");
  kc.on("exit", (code, signal) =>
    log("keycloak_exit", { childPid: kc.pid, code, signal }),
  );
  log("keycloak_start", {
    childPid: kc.pid,
    ports: [5372, 5374],
    bind: "127.0.0.1",
    tls: true,
  });
  sourceHashesAtStart = hashSources();
  fs.copyFileSync(path.join(project, executionSource), executedScript);
  fs.copyFileSync(
    executedScript,
    path.join(evidence, instance + ".executed-integration.mjs.txt"),
  );
  worker = spawn(process.execPath, [executedScript, fixture], {
    cwd: project,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: cert,
      ZIWEI_REAL_OP_BROWSER_OBSERVATION: process.argv.includes(
        "--browser-observation",
      )
        ? "1"
        : "0",
    },
  });
  output(worker, "checks");
  worker.on("exit", (code, signal) =>
    log("checks_exit", { childPid: worker.pid, code, signal }),
  );
  log("checks_start", {
    childPid: worker.pid,
    ports: [5373],
    caTrust: "isolated-child-NODE_EXTRA_CA_CERTS",
  });
  const health = async (port) =>
    new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  timer = setInterval(async () => {
    if (listenerObservationRunning) return;
    listenerObservationRunning = true;
    try {
      const observed = await ownedListeners(kc, worker);
      listenerSnapshots.push({
        at: new Date().toISOString(),
        listeners: observed,
      });
      const valid = observed.every(
        (x) =>
          [5372, 5373, 5374].includes(x.LocalPort) &&
          x.LocalAddress === "127.0.0.1",
      );
      log("independent_health", {
        keycloakPid: kc.pid,
        keycloakAlive: kc.exitCode === null,
        workerPid: worker.pid,
        workerAlive: worker.exitCode === null,
        listeners: observed,
        registeredPortsOnly: valid,
        intervalMs: 10000,
      });
      if (!valid) {
        log("unexpected_listener_process", { listeners: observed });
        failed = true;
        await stop(worker);
      } else if (
        observed.some((x) => x.LocalPort === 5372) &&
        observed.some((x) => x.LocalPort === 5374)
      )
        fs.writeFileSync(
          path.join(runDir, "listeners-approved"),
          "registered-loopback-ports-only",
        );
    } catch (error) {
      failed = true;
      log("listener_observation_failure", { message: redact(error.message) });
      await stop(worker);
    } finally {
      listenerObservationRunning = false;
    }
  }, 10000);
  const deadline = setTimeout(() => {
    failed = true;
    log("deadline");
    void stop(worker);
  }, 480000);
  const [code, signal] = await once(worker, "exit");
  clearTimeout(deadline);
  if (code !== 0 || signal) throw Error("Workspace real OP checks failed");
  result = JSON.parse(fs.readFileSync(resultFile));
} catch (error) {
  failed = true;
  log("failure", {
    name: error.name,
    code: error.code || null,
    message: redact(error.message),
  });
  if (fs.existsSync(resultFile))
    result = JSON.parse(fs.readFileSync(resultFile));
} finally {
  clearInterval(timer);
  while (listenerObservationRunning)
    await new Promise((resolve) => setTimeout(resolve, 20));
  await stop(worker);
  await stop(kc);
  const sourceHashes = hashSources(),
    sourceStable =
      Boolean(sourceHashesAtStart) &&
      JSON.stringify(sourceHashes) === JSON.stringify(sourceHashesAtStart);
  if (!sourceStable) failed = true;
  const releasedListeners =
    kc && worker ? await ownedListeners(kc, worker) : [];
  if (releasedListeners.length) failed = true;
  for (const file of [fixture, realmFile, pfx, executedScript])
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  const credentialDir = path.resolve(runDir, "cli-private");
  if (
    credentialDir.startsWith(path.resolve(runDir) + path.sep) &&
    fs.existsSync(credentialDir)
  )
    fs.rmSync(credentialDir, { recursive: true, force: true });
  fs.writeFileSync(
    state,
    JSON.stringify({ instance, pid: process.pid, finished: true }),
  );
  fs.unlinkSync(lock);
  const report = {
    ...result,
    passed: !failed && result.passed === true,
    instance,
    at: new Date().toISOString(),
    supervisorExit: failed ? 1 : 0,
    keycloak: "26.8.1",
    java: "21.0.12.1",
    production: false,
    journal,
    listenerSnapshots,
    sourceHashesAtStart,
    sourceStable,
    releasedListeners,
    executedSnapshot: instance + ".executed-integration.mjs.txt",
    executionSource,
    internalListener: {
      port: 5374,
      purpose:
        "Narayana 7.3.4 SocketProcessId unique process identity; no application protocol",
      bound: "127.0.0.1",
      property: "com.arjuna.ats.internal.arjuna.utils.SocketProcessIdPort",
      historicalObservedPorts: [27711, 50188],
      source:
        "https://github.com/jbosstm/narayana/blob/7.3.4.Final/ArjunaCore/arjuna/classes/com/arjuna/ats/internal/arjuna/utils/SocketProcessId.java",
    },
    tls: {
      syntheticCertificate: true,
      hostnameVerified: Boolean(
        result.checks?.some((c) => c.name.includes("https_discovery")),
      ),
      systemTrustModified: false,
      disabledVerification: false,
      scopedNodeTrust: true,
    },
    secretsRemoved: [fixture, realmFile, pfx].every(
      (file) => !file || !fs.existsSync(file),
    ),
    sourceHashes,
  };
  fs.writeFileSync(
    path.join(evidence, instance + ".json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  log("supervisor_exit", {
    code: failed ? 1 : 0,
    evidence: path.join(evidence, instance + ".json"),
    secretsRemoved: report.secretsRemoved,
  });
  process.exitCode = failed ? 1 : 0;
}

async function ownedListeners(kcProcess, workerProcess) {
  const command = `$taskRows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $taskIds=@(${kcProcess.pid},${workerProcess.pid}); for($taskRound=0;$taskRound -lt 6;$taskRound++){ $taskNew=@($taskRows | Where-Object { $taskIds -contains $_.ParentProcessId } | Select-Object -ExpandProperty ProcessId); $taskIds=@($taskIds+$taskNew | Select-Object -Unique) }; @(Get-NetTCPConnection -State Listen | Where-Object { $taskIds -contains $_.OwningProcess } | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Compress`;
  const p = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  p.stdout.on("data", (x) => (stdout += x));
  const [code] = await once(p, "exit");
  if (code !== 0) throw Error("Owned listener observation failed");
  const result = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(result) ? result : [result];
}
