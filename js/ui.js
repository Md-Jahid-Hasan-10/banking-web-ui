function $(id) {
  return document.getElementById(id);
}

function showMessage(el, text, type) {
  el.textContent = text;
  el.className = "msg " + type;
  el.hidden = false;
}

function hideMessage(el) {
  el.hidden = true;
  el.textContent = "";
}

function setBusy(btn, busy, busyLabel) {
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = busyLabel || "Please wait...";
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

function formatMoney(amount, currency) {
  const n = Number(amount);
  const text = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return currency ? text + " " + currency : text;
}

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString();
}

function makeEl(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const STATUS_LABELS = {
  VALIDATING: "Checking",
  FEE_PENDING: "Calculating fee",
  OTP_PENDING: "Sending code",
  AWAITING_OTP: "Waiting for code",
  WITHDRAWING: "Moving money",
  DEPOSITING: "Moving money",
  REVERSING: "Returning money",
  COMPLETED: "Completed",
  SUCCESS: "Completed",
  FAILED: "Failed",
  REVERSED: "Reversed",
  EXPIRED: "Expired",
  RECONCILIATION_REQUIRED: "Under review",
  PENDING_OTP: "Waiting for code",
  PROCESSING: "Processing",
  UNCONFIRMED: "Unconfirmed"
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status || "";
}

function typeLabel(type) {
  if (type === "DEPOSIT") return "Deposit";
  if (type === "WITHDRAWAL") return "Withdrawal";
  return "Transfer";
}

function renderNav(active) {
  const nav = $("nav");
  nav.textContent = "";
  nav.appendChild(makeEl("span", "brand", "Banking"));

  [
    ["dashboard.html", "Dashboard"],
    ["transfer.html", "Transfer"],
    ["cash.html", "Deposit / Withdraw"],
    ["history.html", "History"]
  ].forEach(function (item) {
    const a = makeEl("a", item[0] === active ? "active" : "", item[1]);
    a.href = item[0];
    nav.appendChild(a);
  });

  nav.appendChild(makeEl("span", "spacer"));

  const s = Session.get();
  if (s) nav.appendChild(makeEl("span", "nav-user", s.fullName));

  const logout = makeEl("button", "btn btn-secondary", "Log out");
  logout.addEventListener("click", function () {
    Session.clear();
    redirectToLogin();
  });
  nav.appendChild(logout);
}