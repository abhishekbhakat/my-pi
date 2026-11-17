#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AUTH_ENDPOINT = "https://slack.com/oauth/v2/authorize";
const TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.user.access";

function readJson(url, optional = false) {
  try { return JSON.parse(readFileSync(url, "utf8")); }
  catch (error) {
    if (optional && error.code === "ENOENT") return {};
    throw new Error("Cannot read Slack auth configuration");
  }
}

export function authSettings(config, stored) {
  const clientId = stored.client_id || config.oauth?.client_id || config.auth?.client_id ||
    config.oauth?.CLIENT_ID || config.oauth?.clientId || config.auth?.CLIENT_ID || config.auth?.clientId;
  if (typeof clientId !== "string" || !clientId || clientId.startsWith("YOUR_")) {
    throw new Error("client_id not found in slack-auth.json or mcp-config.json");
  }
  const redirect = new URL(config.oauth?.redirect_uri ||
    `http://localhost:${config.oauth?.callback_port || 3118}/oauth/callback`);
  if (redirect.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(redirect.hostname) ||
      redirect.username || redirect.password || redirect.search || redirect.hash) {
    throw new Error("OAuth redirect must use HTTP on localhost or 127.0.0.1");
  }
  const scopes = config.oauth?.scopes;
  if ((!Array.isArray(scopes) && typeof scopes !== "string") || !scopes.length) {
    throw new Error("OAuth scopes are missing from mcp-config.json");
  }
  return { clientId, redirect, scopes: Array.isArray(scopes) ? scopes.join(",") : scopes };
}

export function authorization(settings) {
  const verifier = randomBytes(64).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    user_scope: settings.scopes,
    redirect_uri: settings.redirect.href,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url, state, verifier };
}

export async function callbackListener(redirect, expectedState, timeoutMs = 300_000) {
  let accept;
  let reject;
  const result = new Promise((resolveResult, rejectResult) => {
    accept = resolveResult;
    reject = rejectResult;
  });
  // A callback may arrive before the caller starts awaiting result.
  result.catch(() => {});
  const timer = setTimeout(() => reject(new Error("Timed out waiting for Slack authorization callback")), timeoutMs);
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method !== "GET" || url.pathname !== redirect.pathname) {
      response.writeHead(404).end();
      return;
    }
    const state = Buffer.from(url.searchParams.get("state") || "");
    const expected = Buffer.from(expectedState);
    if (state.length !== expected.length || !timingSafeEqual(state, expected)) {
      response.writeHead(400).end("OAuth state mismatch");
      reject(new Error("OAuth state mismatch"));
    } else if (url.searchParams.has("error") || !url.searchParams.get("code")) {
      response.writeHead(400).end("Slack authorization failed");
      reject(new Error("Slack authorization failed"));
    } else {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>Authorization received</h1><p>Return to the terminal to check the result.</p>");
      accept(url.searchParams.get("code"));
    }
  });
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(Number(redirect.port || 80), "127.0.0.1", resolveListen);
    });
  } catch {
    clearTimeout(timer);
    throw new Error("Cannot start Slack OAuth callback listener; check callback port");
  }
  return {
    server, result,
    close() { clearTimeout(timer); server.close(); server.closeAllConnections(); },
  };
}

export async function exchangeCode(settings, code, verifier) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    body: new URLSearchParams({
      client_id: settings.clientId, code, redirect_uri: settings.redirect.href,
      code_verifier: verifier, grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Slack token exchange failed with HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error("Slack rejected the token exchange; check OAuth app settings");
  const token = data.authed_user?.access_token ? data.authed_user : data;
  if (typeof token.access_token !== "string" || !token.access_token.startsWith("xoxp-")) {
    throw new Error("Slack did not return a user access token; bot tokens are not saved");
  }
  return token;
}

export function saveToken(authUrl, stored, clientId, token) {
  const data = { ...stored, client_id: clientId, access_token: token.access_token };
  if (token.refresh_token) data.refresh_token = token.refresh_token;
  // A replacement access token must not retain another grant's refresh token.
  else delete data.refresh_token;
  const temp = new URL(`./.slack-auth-${randomBytes(8).toString("hex")}.tmp`, authUrl);
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temp, authUrl);
  } finally { rmSync(temp, { force: true }); }
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url.href] : [url.href];
  const browser = spawn(command, args, { stdio: "ignore" });
  browser.on("error", () => console.error("Cannot open browser. Check your default browser configuration, then retry."));
  browser.on("exit", (code) => {
    if (code) console.error("Browser command failed. Check your default browser configuration, then retry.");
  });
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("bun slack-auth.mjs\nSlack user-token OAuth with PKCE. Configure client_id in slack-auth.json.\nOpens browser, waits up to 300 seconds, saves token with mode 0600.");
    return;
  }
  if (process.argv.length > 2) throw new Error("Unknown argument. Use --help.");
  const authUrl = new URL("./slack-auth.json", import.meta.url);
  const stored = readJson(authUrl, true);
  const settings = authSettings(readJson(new URL("./mcp-config.json", import.meta.url)), stored);
  const request = authorization(settings);
  const callback = await callbackListener(settings.redirect, request.state);
  try {
    openBrowser(request.url);
    console.log("Complete Slack authorization in your browser. Waiting for callback...");
    const code = await callback.result;
    const token = await exchangeCode(settings, code, request.verifier);
    saveToken(authUrl, stored, settings.clientId, token);
    console.log(`Token saved to ${fileURLToPath(authUrl)}. Run slack list to verify.`);
  } finally { callback.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    // OAuth responses may contain credentials. Only print our own bounded errors.
    const safe = /^(client_id not found|OAuth |Cannot (read|start)|Timed out|Slack (authorization failed|token exchange|rejected|did not)|Unknown argument)/.test(error.message);
    console.error(`slack-auth: ${safe ? error.message : "authentication failed; check network and OAuth app settings"}`);
    process.exitCode = 1;
  });
}
