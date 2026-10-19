import assert from "node:assert/strict";

const baseUrl = "https://practice-ready-backend.connect-fb5.workers.dev";
const cdpUrl = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9231";
const email = `omnirush-browser-${Date.now()}@vijaybhoomi.edu.in`;
const password = `Browser-${crypto.randomUUID()}-a1`;

const registration = await fetch(`${baseUrl}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, fullName: "OmniRush Browser Verification", password }),
});
assert.equal(registration.status, 201, "browser verification account registration");

const targets = await (await fetch(`${cdpUrl}/json/list`)).json();
const target = targets.find((entry) => entry.type === "page");
assert.ok(target?.webSocketDebuggerUrl, "Chrome CDP page is unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const errors = [];
const failedResponses = [];

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") errors.push("runtime exception");
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") errors.push("console error");
  if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
    failedResponses.push(message.params.response.status);
  }
  const resolver = pending.get(message.id);
  if (resolver) {
    pending.delete(message.id);
    resolver(message);
  }
};

function command(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.result?.result?.value;
}

async function waitFor(predicate, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(`Boolean(${predicate})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Browser condition timed out: ${predicate}`);
}

await new Promise((resolve) => { socket.onopen = resolve; });
await command("Runtime.enable");
await command("Log.enable");
await command("Network.enable");
await command("Page.enable");
await command("Page.navigate", { url: baseUrl });
await waitFor("document.body.innerText.includes('Welcome back') && document.getElementById('login-email')");

async function typeInto(id, text) {
  await evaluate(`document.getElementById(${JSON.stringify(id)}).focus()`);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace" });
  await command("Input.insertText", { text });
}
await typeInto("login-email", email);
await typeInto("login-password", password);
await evaluate("document.getElementById('login-password').form.requestSubmit()");
await waitFor("document.body.innerText.includes('What do you need for practice?')");
await waitFor("[...document.querySelectorAll('button')].some((button) => button.offsetParent !== null && (button.getAttribute('aria-label') || '').startsWith('Account menu for'))");

await evaluate("[...document.querySelectorAll('button')].find((button) => button.offsetParent !== null && (button.getAttribute('aria-label') || '').startsWith('Account menu for')).focus()");
await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter" });
await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
await waitFor("document.querySelector('[data-slot=dropdown-menu-content][data-state=open]')");
await evaluate("[...document.querySelectorAll('[data-slot=dropdown-menu-item]')].find((item) => item.innerText.trim() === 'Manage account')?.click()");
await waitFor("document.body.innerText.includes('Manage account') && document.body.innerText.includes('Phone number')");

await evaluate("[...document.querySelectorAll('[data-slot=dropdown-menu-item]')].find((item) => item.innerText.trim() === 'Log out')?.click()");
await waitFor("document.body.innerText.includes('Welcome back') && !document.body.innerText.includes('What do you need for practice?')");
assert.deepEqual(errors, [], "browser console/runtime errors");
assert.deepEqual(failedResponses, [], "browser HTTP failures");
console.log("Production browser smoke passed: visible login, real login, original account controls, profile dialog, logout, no console errors, no failed same-origin requests.");
socket.close();
