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

function renderNav(active) {
    const nav = $("nav");
    nav.textContent = "";
    nav.appendChild(makeEl("span", "brand", "Banking"));

    [
        ["dashboard.html", "Dashboard"],
        ["transfer.html", "Transfer"],
        ["history.html", "History"]
    ].forEach(([href, label]) => {
        const a = makeEl("a", href === active ? "active" : "", label);
        a.href = href;
        nav.appendChild(a);
    });

    nav.appendChild(makeEl("span", "spacer"));

    const s = Session.get();
    if (s) nav.appendChild(makeEl("span", "nav-user", s.fullName));

    const logout = makeEl("button", "btn btn-secondary", "Log out");
    logout.addEventListener("click", () => {
        Session.clear();
        redirectToLogin();
    });
    nav.appendChild(logout);
}