# banking-web-ui

> The static browser front end of the banking platform: 8 HTML pages, 4 vanilla-JS modules and one Python file server, talking to nothing but the API gateway on `http://localhost:8080`. Served on port **3000**.

## Table of Contents

- [What It Does](#what-it-does)
- [Architecture At A Glance](#architecture-at-a-glance)
- [HTTP API](#http-api)
- [Error Response Shape](#error-response-shape)
- [Database](#database)
- [Kafka Topics](#kafka-topics)
- [Configuration](#configuration)
- [Behaviour Rules](#behaviour-rules)
- [Running It](#running-it)
- [API Quick Reference (curl examples)](#api-quick-reference-curl-examples)
- [Configuration Reference (quick table)](#configuration-reference-quick-table)
- [Troubleshooting](#troubleshooting)
- [Notes and Known Limitations](#notes-and-known-limitations)

## What It Does

The web UI is the **browser front end** of the platform. It lets a customer register, verify their
e-mail address, log in, open a savings or current account, deposit money, withdraw money, transfer
money to another account, and follow what happens to a running transaction until it reaches a final
state.

This repository is **not** a Maven project and **not** a Node/npm project. It is a folder of plain
HTML, vanilla JavaScript and one CSS file, served by a 33-line Python standard-library HTTP
server. There is **no `package.json`**, **no build step** and **no dependency installation**.

It owns **no backend state at all**. Everything it knows comes from the API gateway, which is the
only service it talks to — the comment in `js/config.js` states the rule: *"The UI only ever talks
to the API Gateway."* It never calls the domain services (`user-service`, `account-service`,
`fund-transfer-service`) directly, and it is **not** a Eureka client — it does not appear in the
registry on port 8761.

The user session lives in the browser's `sessionStorage`, so it disappears when the tab is closed.
There is no refresh token and no server-side session.

## Architecture At A Glance

```
  browser
    │  http://localhost:3000  (static files)
    ▼
 ┌───────────────────────────────────────────────────────────┐
 │  serve.py — SimpleHTTPRequestHandler on 127.0.0.1:3000    │
 │  /login → login.html, Cache-Control: no-store             │
 └───────────────┬───────────────────────────────────────────┘
                │  fetch()
                │  Authorization: Bearer <jwt>
                ▼
 ┌───────────────────────────────────────────────────────────┐
 │  api-gateway :8080                                        │
 │    /api/auth/**      → user-service        :8083         │
 │    /api/accounts/**  → account-service     :8081         │
 │    /api/transfers/** → fund-transfer-service :8082        │
 └───────────────────────────────────────────────────────────┘
```

### The files

```
banking-web-ui/
├── cash.html                 155 lines
├── dashboard.html            138 lines
├── history.html              129 lines
├── index.html                 16 lines
├── login.html                 66 lines
├── register.html              81 lines
├── transfer.html             165 lines
├── verify.html                54 lines
├── css/
│   └── style.css             210 lines
├── js/
│   ├── api.js                167 lines
│   ├── config.js               4 lines
│   ├── flow.js               514 lines
│   └── ui.js                 104 lines
├── serve.py                   33 lines
└── .idea/                    (IntelliJ project files only — no application content)
```

Total: 8 HTML pages, 1 CSS file, 4 JS modules, 1 Python server.

### The `js/` modules

Every page loads the scripts in this order: `js/config.js`, `js/api.js`, `js/ui.js`, and then
`js/flow.js` **only on `transfer.html` and `cash.html`** — the two pages that start a transaction.

| Module | Lines | What it does |
|---|---|---|
| `js/config.js` | 4 | The only configuration in the whole UI: `CONFIG.API_BASE = "http://localhost:8080"` |
| `js/api.js` | 167 | The transport layer: `ApiError`, `Session`, `redirectToLogin()`, `requireAuth()`, the `request()` fetch wrapper and the `Api` object with the 13 endpoint calls |
| `js/ui.js` | 104 | DOM helpers and shared chrome: `$`, `showMessage`, `hideMessage`, `setBusy`, `formatMoney`, `formatDate`, `makeEl`, `STATUS_LABELS`, `statusLabel`, `typeLabel`, `renderNav` |
| `js/flow.js` | 514 | The saga tracker `TxFlow` — polls one transaction (transfer, deposit or withdrawal) from the first request to the final result, and renders the progress, OTP and result cards |

`js/flow.js` is a single IIFE `const TxFlow = (function () { ... })();` whose own header comment
says: *"Tracks one transaction (transfer, deposit or withdrawal) from the first request to the
final result. The server does the work in the background. This file asks for the status and shows
it. Needs api.js and ui.js to be loaded first."*

### The pages

| Page | `<title>` | Purpose |
|---|---|---|
| `index.html` | `Banking` | Pure redirector: to `dashboard.html` if a session exists, otherwise to `login.html` |
| `login.html` | `Login - Banking` | Email + password sign-in |
| `register.html` | `Register - Banking` | Creates an account |
| `verify.html` | `Verify email - Banking` | Confirms an e-mail address from the link in the verification mail |
| `dashboard.html` | `Dashboard - Banking` | The landing page after login: the user's accounts, and opening a new one |
| `transfer.html` | `Transfer - Banking` | Money transfer between accounts |
| `cash.html` | `Deposit / Withdraw - Banking` | Deposit money into, or withdraw money from, an account |
| `history.html` | `History - Banking` | Table of all past and in-flight transactions |

### The navigation bar

`renderNav(active)` in `js/ui.js` builds the shared nav on every authenticated page: the brand
text `Banking`, then the links **`Dashboard`** → `dashboard.html`, **`Transfer`** →
`transfer.html`, **`Deposit / Withdraw`** → `cash.html`, **`History`** → `history.html`; the active
one gets the CSS class `active`. Then a spacer, the user's `fullName` (CSS class `nav-user`), and
a **`Log out`** button that calls `Session.clear()` and redirects to `login.html`.

## HTTP API

The UI calls **only** the API gateway. The base URL is hard-coded in `js/config.js`:

```javascript
const CONFIG = {
  // The UI only ever talks to the API Gateway.
  API_BASE: "http://localhost:8080"
};
```

There is no build-time variable, no `window.__CONFIG__` override and no environment file.

### The endpoint surface the UI uses

Defined in `js/api.js`:

| Method | HTTP call | Gateway path | Auth |
|---|---|---|---|
| `Api.register(payload)` | `POST` | `/api/auth/register` | no |
| `Api.verifyEmail(token)` | `POST` body `{token}` | `/api/auth/verify` | no |
| `Api.login(payload)` | `POST` body `{email, password}` | `/api/auth/login` | no |
| `Api.listAccounts()` | `GET` | `/api/accounts` | yes |
| `Api.getAccount(accountNumber)` | `GET` | `/api/accounts/{accountNumber}` | yes |
| `Api.createAccount(accountType)` | `POST` body `{accountType}` | `/api/accounts` — *"Answers 202: the account is PENDING until the ledger has created it."* | yes |
| `Api.initiateTransfer(payload)` | `POST` body `{fromAccountNumber, toAccountNumber, amount}` | `/api/transfers` — *"The three calls below answer 202 with status VALIDATING. Follow them with getTransfer."* | yes |
| `Api.initiateDeposit(payload)` | `POST` body `{accountNumber, amount}` | `/api/transfers/deposit` | yes |
| `Api.initiateWithdrawal(payload)` | `POST` body `{accountNumber, amount}` | `/api/transfers/withdraw` | yes |
| `Api.getTransfer(transferId)` | `GET` | `/api/transfers/{transferId}` | yes |
| `Api.confirmTransfer(transferId, otp)` | `POST` body `{otp}` (or `{}` if `otp` is omitted) | `/api/transfers/{transferId}/confirm` — *"otp may be omitted to retry a transfer of the old flow that is UNCONFIRMED."* | yes |
| `Api.resendOtp(transferId)` | `POST` | `/api/transfers/{transferId}/resend-otp` | yes |
| `Api.listTransfers()` | `GET` | `/api/transfers` | yes |

### The request helper

```javascript
async function request(path, options) {
  const opts = options || {};
  const method = opts.method || "GET";
  const auth = opts.auth !== false;
  const headers = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = Session.token();
    if (!token) { redirectToLogin(); throw new ApiError(401, "Please log in"); }
    headers["Authorization"] = "Bearer " + token;
  }

  let res;
  try {
    res = await fetch(CONFIG.API_BASE + path, { method: method, headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    throw new ApiError(0, "Cannot reach the server. Is the gateway running on port 8080?");
  }

  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }

  if (res.status === 401 && auth) { Session.clear(); redirectToLogin(); }

  if (!res.ok) {
    throw new ApiError(res.status, (data && data.message) || "Request failed (" + res.status + ")");
  }
  return data;
}
```

Key behaviours:

* The `Authorization: Bearer <token>` header is added to every request **except** the three that
  pass `auth: false` (`register`, `verifyEmail`, `login`).
* A network failure produces the message
  **`Cannot reach the server. Is the gateway running on port 8080?`** with status `0`.
* A **401 on an authenticated request** clears the session and redirects to `login.html`.
* Error messages are taken from the server's JSON `message` field, falling back to
  `Request failed (<status>)`.

### The auth token storage

The session lives in **`sessionStorage`** under the key **`"auth"`**, so it is cleared when the tab
closes:

```javascript
/* Session lives in sessionStorage, so it is cleared when the tab closes. */
const Session = {
  save(data) { sessionStorage.setItem("auth", JSON.stringify(data)); },
  get() {
    try {
      const s = JSON.parse(sessionStorage.getItem("auth"));
      if (!s || !s.token) return null;
      if (Date.now() >= s.expiresAt) { this.clear(); return null; }
      return s;
    } catch (e) { return null; }
  },
  token() { const s = this.get(); return s ? s.token : null; },
  clear() { sessionStorage.removeItem("auth"); }
};
```

The stored object is written by `Api.login`:

```javascript
Session.save({
  token: d.token,
  expiresAt: Date.now() + d.expiresIn * 1000,
  userId: d.userId,
  fullName: d.fullName,
  email: d.email,
  role: d.role
});
```

so the session shape is `{token, expiresAt, userId, fullName, email, role}`. `expiresAt` is a
**client-side** expiry computed from the server's `expiresIn` (seconds × 1000); `Session.get()`
returns `null` and clears the session once `Date.now() >= expiresAt`.

### Error Response Shape

The UI does not define its own error body — it consumes the gateway's. Two shapes reach the
browser:

**The gateway's own error body** (`GatewayErrorWriter` in the api-gateway), used for 401, 404 and
429:

```json
{"timestamp":"2026-11-02T17:26:12.727697958","status":401,"error":"Unauthorized","message":"Missing or invalid Authorization header"}
```

| Field | Type | Notes |
|---|---|---|
| `timestamp` | string | Local `LocalDateTime`, no timezone offset |
| `status` | integer | The HTTP status code |
| `error` | string | The HTTP reason phrase |
| `message` | string | The gateway's message — **this is the field the UI shows to the user** |

**The Spring WebFlux default body**, used when the path matched no route at all:

```json
{"timestamp":"2026-11-02T11:29:21.331+00:00","path":"/nope","status":404,"error":"Not Found","requestId":"c32250c7-310"}
```

That body has **no `message` field**, so the UI falls back to `Request failed (404)`.

On top of that the UI has two error shapes of its own, produced by `js/api.js`:

| Shape | When | Message |
|---|---|---|
| `ApiError` with status `0` | The gateway could not be reached at all | `Cannot reach the server. Is the gateway running on port 8080?` |
| `ApiError` with status `401` | The session is missing but the request needed it | `Please log in` |

## Database

**Not applicable.** The web UI is a static front end with no server side, so it has no database and
no persistence layer. All of its state lives in the browser's `sessionStorage` under the key
`"auth"`, and everything else is fetched from the API gateway on demand.

## Kafka Topics

**Not applicable.** The web UI never touches Kafka. It does not even know that Kafka exists — the
transfer saga behind `/api/transfers` is what uses it, and the UI only observes the resulting
status through the REST API.

## Configuration

### Server and Spring properties

**Not applicable.** There is no Spring, no Maven and no `application.yaml` in this repository.

The only configuration is the single line in `js/config.js`:

| Name | Default | Meaning |
|---|---|---|
| `CONFIG.API_BASE` | `http://localhost:8080` | The base URL of the API gateway. **Hard-coded** — the only way to point the UI at a different gateway is to edit this file. |

### Custom `app.*` properties

**Not applicable.** This is a plain JavaScript front end; it uses no configuration framework.

### Environment variables

| Name | Default | Meaning |
|---|---|---|
| *(none)* | – | The UI reads no environment variables at all. The server takes one **command-line** argument: the port. |

The Python server takes the port as an argument:

```bash
python3 serve.py        # defaults to port 3000
python3 serve.py 3000   # explicit port
```

### Environment variables you must set

**None.** But the UI will not work unless the API gateway is running on port 8080 with the same
`JWT_SECRET` as the user service, and the web UI is served from one of the two origins the gateway
allows: `http://localhost:3000` or `http://127.0.0.1:3000`.

## Behaviour Rules

### User-facing workflows

| # | Feature | Entry point | Exact on-screen wording |
|---|---|---|---|
| 1 | **Register** | `register.html` (reachable from `login.html` via the link `Create an account`) | Heading `Create account`; fields `Full name`, `Email`, `Password`, `Confirm password`; hint `8 to 64 characters.`; submit button `Register` (busy `Creating...`); validation messages `Full name is required`, `Enter a valid email`, `Password must be 8 to 64 characters`, `Passwords do not match`; on success the server's message `If this email can be registered, we have sent you a message. Please check your inbox.` |
| 2 | **Verify e-mail** | `verify.html?token=…` (the link in the e-mail; the user-service default verify URL is `http://localhost:3000/verify.html`, configurable via `VERIFY_URL`) | Heading `Verify your email`; text `Press the button to confirm your email address.`; button `Confirm my email` (busy `Verifying...`); link `Go to login`; error `This verification link is incomplete. Please use the link from your email.` |
| 3 | **Log in** | `login.html` | Heading `Log in`; fields `Email`, `Password`; button `Log in` (busy `Logging in...`); error `Email and password are required`; after registration `Registration successful. Please log in.`; footer `New here? Create an account` |
| 4 | **Open an account** | `dashboard.html`, card `My accounts` | Select `Savings` / `Current`; button `Open account` (busy `Opening...`); the new card shows `Opening your account...` while `PENDING`; `Blocked` badge for a blocked account; `The new account could not be opened. <reason>`; `Your new account is still being opened. Refresh this page in a moment.`; `You have no accounts yet. Open one above.` |
| 5 | **Deposit** | `cash.html` → `Deposit money` | Heading `Deposit or withdraw`; label `What do you want to do?`; option `Deposit money`; hint `A deposit is added to your account right away.`; hint on the amount `Up to 1,000,000.00 with at most 2 decimals. No fee.`; button `Continue` (busy `Sending...`); error `The maximum amount is 1,000,000.00` |
| 6 | **Withdraw** | `cash.html` → `Withdraw money` | Option `Withdraw money`; hint `A withdrawal needs a one-time password.`; the same `Continue` flow; the OTP step appears |
| 7 | **Transfer** | `transfer.html` | Heading `Transfer money`; `From account` (dropdown with the number and balance), `To account number` (placeholder `e.g. ACC-12345678`), `Amount` (placeholder `0.00`); hint `Transfers between your own accounts are free. Other accounts have a fee.` → `Your own account: no fee expected.` / `Another account: a fee will apply.`; button `Continue` (busy `Sending...`); errors `Choose the account to send from`, `Enter the destination account number`, `Choose a different destination account`, `Enter a valid amount greater than 0 (max 2 decimals)` |
| 8 | **OTP confirmation** | shown by `js/flow.js` when the status becomes `AWAITING_OTP` | Card title `Confirm your transfer` / `Confirm your deposit` / `Confirm your withdrawal`; label `One-time password`; hint `We sent a 6-digit code to your email. It is valid for 5 minutes.`; buttons `Confirm` (busy `Confirming...`), `Resend code` (busy `Sending...`, countdown `Resend code (Ns)`), `Start over`; error `Enter the 6-digit code`; resend success `A new code is on its way. The old code no longer works.` |
| 9 | **Track a transaction** | the flow card after `Continue` | Card title `Working on it`; progress title `Processing your transfer` / `Processing your deposit` / `Processing your withdrawal`; a timeline with the step wording below; problem messages `We could not find this request.`, `We cannot reach the server right now. Your request is not lost.`, `This is taking longer than usual. Your request is still being processed. You can leave this page and follow it in History.` |
| 10 | **History** | `history.html` | Heading `History`; table columns `Date`, `Reference`, `Type`, `From`, `To`, `Amount`, `Fee`, `Status`; empty state `Nothing here yet.`; per-row button `Open` (opens `transfer.html?id=…` or `cash.html?id=…`); per-row button `Retry` (busy `Retrying...`) for `UNCONFIRMED` rows of the old synchronous flow |
| 11 | **Log out** | the `Log out` button in the nav bar | Clears the session and returns to `login.html` |
| 12 | **Resume a running transaction** | `transfer.html?id=<transferId>` / `cash.html?id=<transferId>` | The form is hidden and the flow resumes polling the transaction; the `Open` button on the History page links to exactly these URLs |

### The timeline wording

`js/flow.js` builds a timeline of the steps the saga went through:

| Server status | "in progress" wording | "done" wording |
|---|---|---|
| `VALIDATING` | `Checking your accounts` (TRANSFER) / `Checking your account` | `Accounts checked` / `Account checked` |
| `FEE_PENDING` | `Calculating the fee` | `Fee calculated` |
| `BALANCE_CHECKING` | `Checking your balance` | `Balance is enough` |
| `OTP_PENDING` | `Sending your one-time password` | `One-time password sent` |
| `AWAITING_OTP` | `Waiting for your one-time password` | `One-time password confirmed` |
| `WITHDRAWING` | `Taking the money from your account` | `Money taken from your account` |
| `DEPOSITING` | `Adding the money to your account` (DEPOSIT) / `Sending the money to the receiver` | `Money added to your account` / `Money sent to the receiver` |
| `REVERSING` | `Returning your money` | `Your money was returned` |

### The status wording

`STATUS_LABELS` in `js/ui.js` maps the server status to the wording shown to the user:

| Server status | Label shown |
|---|---|
| `VALIDATING` | `Checking` |
| `FEE_PENDING` | `Calculating fee` |
| `BALANCE_CHECKING` | `Checking balance` |
| `OTP_PENDING` | `Sending code` |
| `AWAITING_OTP` | `Waiting for code` |
| `WITHDRAWING` | `Moving money` |
| `DEPOSITING` | `Moving money` |
| `REVERSING` | `Returning money` |
| `COMPLETED` | `Completed` |
| `SUCCESS` | `Completed` |
| `FAILED` | `Failed` |
| `REVERSED` | `Reversed` |
| `EXPIRED` | `Expired` |
| `RECONCILIATION_REQUIRED` | `Under review` |
| `PENDING_OTP` | `Waiting for code` |
| `PROCESSING` | `Processing` |
| `UNCONFIRMED` | `Unconfirmed` |

`statusLabel(status)` returns `STATUS_LABELS[status] || status || ""`. `typeLabel(type)` returns
`Deposit` / `Withdrawal` / `Transfer`.

### The final result banner

| Server status | Title | Text |
|---|---|---|
| `COMPLETED` / `SUCCESS` | `Transfer completed` / `Deposit completed` / `Withdrawal completed` | `A confirmation email has been sent to you.` |
| `FAILED` | `Transfer not completed` etc. | `<message>. No money was moved.` |
| `REVERSED` | `Transfer reversed` | `The receiver could not be credited, so your money was returned to you, including the fee.` |
| `EXPIRED` | `Request expired` | `Nothing was changed. Please start a new one.` |
| anything else | `We are checking this request` | `Your money is safe. Please do not repeat the request. It will be finished automatically, or you can contact support with the reference below.` |

### The three cards

`js/flow.js` creates three cards inside the container:

* the **progress card** — `<h2>Working on it</h2>`, a spinner, a `.progress-message` and a
  `<ul class="timeline">`;
* the **OTP card** — `<h2>Confirm</h2>`, the summary, an input labelled **`One-time password`**
  (`maxlength="6"`, `inputmode="numeric"`, `autocomplete="one-time-code"`, placeholder
  `6 digits`), the hint `We sent a 6-digit code to your email. It is valid for 5 minutes.`, and the
  buttons **`Confirm`** (busy `Confirming...`), **`Resend code`** (busy `Sending...`, countdown
  `Resend code (Ns)`), **`Start over`**;
* the **result card** — the banner, the summary, and the buttons `New transfer` / `New deposit` /
  `New withdrawal` (or `Check again` for `RECONCILIATION_REQUIRED`), `Dashboard`, `History`.

### Polling and timing constants

| Constant | Value | Meaning |
|---|---|---|
| `FAST_POLL_MS` | `1000` | Poll interval during the first 20 s |
| `SLOW_POLL_MS` | `2000` | Poll interval after that |
| `FAST_POLL_FOR_MS` | `20000` | How long the fast interval lasts |
| `GIVE_UP_AFTER_MS` | `120000` | After 2 minutes the flow shows the "taking longer than usual" message |
| `MAX_CONSECUTIVE_ERRORS` | `5` | After 5 failed polls the flow shows the "cannot reach the server" message |
| `RESEND_COOLDOWN_S` | `30` | Seconds before the `Resend code` button is enabled again |

Final statuses are `COMPLETED`, `SUCCESS`, `FAILED`, `REVERSED`, `EXPIRED` and
`RECONCILIATION_REQUIRED`. `isFinal(data)` is `data.finished === true || FINAL.indexOf(data.status) !== -1`.

### The dashboard polling

`dashboard.html` polls for `PENDING` accounts every **1500 ms**, up to **40** polls. When the polls
run out and an account is still pending, the page shows
`Your new account is still being opened. Refresh this page in a moment.`

`history.html` auto-refreshes every **3000 ms** (up to **40** refreshes) while a transaction is
still moving. The statuses that count as "moving" are `VALIDATING`, `FEE_PENDING`,
`BALANCE_CHECKING`, `OTP_PENDING`, `WITHDRAWING`, `DEPOSITING` and `REVERSING`. The statuses that
get an `Open` button are those plus `AWAITING_OTP` and `RECONCILIATION_REQUIRED`.

### The saga switch

Both `transfer.html` and `cash.html` check the response status and refuse anything that is not the
saga flow:

> `"The server still runs the old synchronous flow. Start fund-transfer-service with`
> `TRANSFER_SAGA_ENABLED=true."`

This depends on the root `run.env` flag `TRANSFER_SAGA_ENABLED=true` (comment: *"The saga flow is
the one the web UI understands: it returns 202 with status VALIDATING, and the UI polls until the
OTP is requested. With it turned off the UI refuses the response and never shows the OTP box."*)

### Client-side validation rules

| Field | Rule | Message |
|---|---|---|
| Full name | must not be empty | `Full name is required` |
| E-mail | must match `/^\S+@\S+\.\S+$/` | `Enter a valid email` |
| Password | 8 to 64 characters | `Password must be 8 to 64 characters` |
| Password confirmation | must equal the password | `Passwords do not match` |
| Log-in fields | both must be non-empty | `Email and password are required` |
| Transfer amount | must match `/^\d+(\.\d{1,2})?$/` and be `> 0` | `Enter a valid amount greater than 0 (max 2 decimals)` |
| Cash amount | the same, plus `> 1000000` is rejected | `The maximum amount is 1,000,000.00` |
| OTP | must match `/^\d{6}$/` | `Enter the 6-digit code` |
| Transfer destination | must not equal the source account | `Choose a different destination account` |

### The verify page scrubs the token

`verify.html` reads `?token=` from the URL and then **removes it from the address bar** with
`window.history.replaceState(null, "", "verify.html")`, so it does not stay in the browser
history. If the token is missing, the button is disabled and the page shows
`This verification link is incomplete. Please use the link from your email.`

### `formatMoney` and `formatDate`

`formatMoney(amount, currency)` renders the amount with `toLocaleString` and **exactly 2 fraction
digits**, then appends `" " + currency` if a currency is given. `formatDate(iso)` renders
`toLocaleString()`, and returns the empty string for an invalid date.

## Running It

### Prerequisites

- **Python 3** (standard library only — no `pip install` needed)
- The **API gateway on port 8080** and the whole backend behind it, or the UI will show
  `Cannot reach the server. Is the gateway running on port 8080?`
- A browser

### Run it

```bash
cd banking-web-ui
python3 serve.py        # defaults to port 3000
python3 serve.py 3000   # explicit port
```

`serve.py` is a standard-library server:

```python
"""Tiny static file server for the banking web UI.
- /login becomes login.html (links without .html work)
- no-cache headers, so a normal refresh always shows your latest edits
Usage: python3 serve.py [port]    (default 3000)
"""
```

* It extends `SimpleHTTPRequestHandler` with `directory=ROOT` (the script's own folder).
* `translate_path` adds the `.html` extension when a file without an extension does not exist but
  `<path>.html` does — so `/login` serves `login.html`.
* `end_headers` adds `Cache-Control: no-store`, so a normal refresh always shows your latest
  edits.
* It binds to **`127.0.0.1`** only (`ThreadingHTTPServer(("127.0.0.1", port), handler)`), so it is
  reachable from the host but **not** from another machine.
* It prints `Serving <ROOT> on http://localhost:<port>`.

### Alternative static servers

```bash
cd banking-web-ui
python3 -m http.server 3000
npx serve -l 3000
```

### Via the root script

```bash
cd /home/bs01092/Projects/banking-microservices
./run-all.sh
```

`run-all.sh` starts it automatically:

```bash
nohup python3 "$ROOT/banking-web-ui/serve.py" 3000 > "$LOG_DIR/banking-web-ui.log" 2>&1 &
```

It skips the UI if port 3000 is already in use.

### Environment variables to export

**None.** The UI reads no environment variables.

### How to check it is healthy

```bash
# The server answers
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login.html
# 200

# The extension-less path works too
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login
# 200

# No caching, so a refresh shows your latest edits
curl -sI http://localhost:3000/login.html | grep -i cache-control
# Cache-Control: no-store
```

Then open **`http://localhost:3000`** in the browser. `index.html` redirects to `login.html` or
`dashboard.html`.

### How to stop it

```bash
# If you started it with ./run-all.sh
cd /home/bs01092/Projects/banking-microservices
./stop-all.sh

# If you started it by hand
# Ctrl+C in the terminal
```

## API Quick Reference (curl examples)

These are the same calls the UI makes, so you can reproduce what the browser does.

```bash
# The base URL the UI uses
BASE=http://localhost:8080

# Register (public)
curl -i -X POST $BASE/api/auth/register -H 'Content-Type: application/json' \
  -d '{"fullName":"Ada Lovelace","email":"ada@example.com","password":"supersecret"}'

# Verify the e-mail (public)
curl -i -X POST $BASE/api/auth/verify -H 'Content-Type: application/json' \
  -d '{"token":"<token-from-the-email>"}'

# Log in (public) and keep the token
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"supersecret"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

# List the accounts
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/accounts

# Open an account (202 — the account is PENDING until the ledger created it)
curl -i -X POST $BASE/api/accounts -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"accountType":"SAVINGS"}'

# Start a transfer (202 — the saga runs in the background)
TRANSFER=$(curl -s -X POST $BASE/api/transfers -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"fromAccountNumber":"ACC-12345678","toAccountNumber":"ACC-87654321","amount":10.00}')
echo "$TRANSFER"

# Poll the transfer, exactly as js/flow.js does
TRANSFER_ID=$(echo "$TRANSFER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["transferId"])')
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/transfers/$TRANSFER_ID"

# Confirm with the one-time password
curl -i -X POST "$BASE/api/transfers/$TRANSFER_ID/confirm" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"otp":"123456"}'

# Resend the one-time password
curl -i -X POST "$BASE/api/transfers/$TRANSFER_ID/resend-otp" -H "Authorization: Bearer $TOKEN"

# Deposit and withdraw
curl -i -X POST $BASE/api/transfers/deposit -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"accountNumber":"ACC-12345678","amount":50.00}'
curl -i -X POST $BASE/api/transfers/withdraw -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"accountNumber":"ACC-12345678","amount":20.00}'

# The history table
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/transfers
```

## Configuration Reference (quick table)

| Knob | Default | Change it when |
|---|---|---|
| `CONFIG.API_BASE` in `js/config.js` | `http://localhost:8080` | You run the gateway on another port or host. This is the **only** place you can change it |
| The port argument of `serve.py` | `3000` | Port 3000 is taken |
| The bind address in `serve.py` | `127.0.0.1` | You want to reach the UI from another machine — but then the gateway's CORS `allowedOrigins` must allow that origin too |
| The gateway's `globalcors.allowedOrigins` | `http://localhost:3000`, `http://127.0.0.1:3000` | You serve the UI from another origin |
| `TRANSFER_SAGA_ENABLED` in the root `run.env` | `true` | Never — with it off the UI refuses every transfer response |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot reach the server. Is the gateway running on port 8080?` | The API gateway is not running, or `CONFIG.API_BASE` points elsewhere | Start the gateway; check `js/config.js` |
| The browser console shows a CORS error | The UI is served from an origin that is not in `allowedOrigins` | Serve the UI on `http://localhost:3000` or `http://127.0.0.1:3000` |
| The page is blank after opening `http://localhost:3000` | `index.html` is a redirector and the browser blocked the redirect, or `serve.py` is not running | Check `logs/banking-web-ui.log`; open `http://localhost:3000/login.html` directly |
| The UI cannot be reached from another machine | `serve.py` binds to `127.0.0.1` only | Run your own static server on `0.0.0.0` and add that origin to the gateway's `allowedOrigins` |
| The session is gone after closing the tab | By design — the session lives in `sessionStorage` | Log in again |
| The UI shows `Please log in` even though the token is stored | The client-side `expiresAt` has passed (the token lives 60 minutes) | Log in again |
| `The server still runs the old synchronous flow. Start fund-transfer-service with TRANSFER_SAGA_ENABLED=true.` | The fund-transfer service runs without the saga flag | Set `TRANSFER_SAGA_ENABLED=true` in the root `run.env` and restart the service |
| `Choose an account` / `You need an active account first. Open one on the dashboard.` | The account list contains no `ACTIVE` account | Open one on the dashboard; the transfer and cash pages only list accounts whose status is `ACTIVE` |
| The account card keeps saying `Opening your account...` | The ledger has not confirmed the account yet | Wait; the dashboard polls for 60 s and then tells you to refresh |
| `Enter the 6-digit code` | The OTP field does not contain exactly six digits | Type the six-digit code from the e-mail |
| `A new code is on its way. The old code no longer works.` | You pressed `Resend code` | Use the newest code — the old one is dead |
| The `Resend code` button shows `Resend code (Ns)` | The 30-second cooldown is still running | Wait for the countdown |
| `We cannot reach the server right now. Your request is not lost.` | Five consecutive polls failed | Press `Try again`; the request itself is still running on the server |
| `This is taking longer than usual. Your request is still being processed.` | The saga has been running for more than 120 s | Press `Keep waiting`, or follow it in History |
| `We could not find this request.` | The gateway answered `404` for the transfer id | Press `Start over` |
| The History page shows `Nothing here yet.` | There are no transfers for this user | – |
| A refresh shows the old version of the page | Not possible — `serve.py` sends `Cache-Control: no-store` | – |

## Notes and Known Limitations

- **The API base URL is hard-coded** in `js/config.js`. There is no way to point the UI at a
  different gateway without editing that file — no build-time variable, no `window.__CONFIG__`
  override, no environment file.
- **The UI talks only to the gateway.** It never calls the domain services directly, and it is not
  a Eureka client — it does not appear in the registry on port 8761. `run-all.sh` says so
  explicitly: *"The discovery service does not register itself, and the web UI is not a Eureka
  client at all, so neither is counted here."*
- **The UI must be served from `http://localhost:3000` or `http://127.0.0.1:3000`.** The gateway's
  `allowedOrigins` contains exactly those two, and there is no wildcard. From any other origin the
  browser blocks the requests.
- **The static server binds to `127.0.0.1`**, so the UI is reachable from the host but not from
  another machine.
- **The session lives in `sessionStorage`**, so it is dropped when the tab closes. There is no
  refresh token and no server-side session.
- **The client-side expiry is a second source of truth.** `expiresAt` is computed from the
  server's `expiresIn`; the client believes the token has expired even if the server would still
  accept it.
- **The UI refuses the old synchronous flow.** Both `transfer.html` and `cash.html` check that the
  response status is `VALIDATING` and show *"The server still runs the old synchronous flow.
  Start fund-transfer-service with TRANSFER_SAGA_ENABLED=true."* otherwise. The saga flag lives in
  the root `run.env`.
- **The `Retry` button on the History page only appears for `UNCONFIRMED` rows** — transfers of the
  old synchronous flow. The in-code comment: *"Only for transfers of the old synchronous flow that
  ended UNCONFIRMED."*
- **`index.html` has no `<link>` to the CSS and an empty `<body>`** — it exists only to redirect.
- **The `.idea/` folder is IntelliJ project noise** and carries no application content.
- **`run-all.sh` prints a wrong hint for Kafka.** It says
  *"Start it first: docker compose up -d kafka kafka-init"* and refers to a `kafka-init` container,
  but **no `kafka-init` service exists** in either compose file. The command that actually works is
  `docker compose -f event-bus-service/docker-compose.yml up -d`.
- **The CSS has no framework.** `css/style.css` is 210 lines with CSS custom properties on `:root`
  (`--bg`, `--card`, `--text`, `--muted`, `--primary`, `--primary-hover`, `--border`, `--error-bg`,
  `--error-text`, `--success-bg`, `--success-text`, `--info-bg`, `--info-text`) plus a
  `@media (prefers-color-scheme: dark)` block that overrides them for a dark theme. Classes:
  `.nav`, `.container`, `.auth-wrap`, `.card`, `.form-group`, `.btn` / `.btn-secondary` /
  `.btn-block` / `.btn-small`, `.msg` (+ `error`, `success`, `info`, `warning`, `muted`), `.hint`,
  `.row-between`, `.accounts`, `.account-card`, `.balance`, `.summary`, `.table-wrap`, `.status`
  (+ per-status colours), `.center`, `.result-banner`, `.progress-row`, `.progress-message`,
  `.spinner`, `.timeline` / `.step-icon`, `.button-row`, `.badge`.
