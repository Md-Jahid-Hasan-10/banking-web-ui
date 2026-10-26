class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/* ---------- Session (sessionStorage, cleared when the tab closes) ---------- */
const Session = {
    save(data) {
        sessionStorage.setItem("auth", JSON.stringify(data));
    },
    get() {
        try {
            const s = JSON.parse(sessionStorage.getItem("auth"));
            if (!s || !s.token) return null;
            if (Date.now() >= s.expiresAt) {
                this.clear();
                return null;
            }
            return s;
        } catch {
            return null;
        }
    },
    token() {
        const s = this.get();
        return s ? s.token : null;
    },
    clear() {
        sessionStorage.removeItem("auth");
    }
};

function redirectToLogin() {
    window.location.replace("login.html");
}

function requireAuth() {
    const s = Session.get();
    if (!s) {
        redirectToLogin();
        return null;
    }
    return s;
}

/* ---------- Core request helper ---------- */
async function request(path, { method = "GET", body, auth = true } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    if (auth) {
        const token = Session.token();
        if (!token) {
            redirectToLogin();
            throw new ApiError(401, "Please log in");
        }
        headers["Authorization"] = "Bearer " + token;
    }

    let res;
    try {
        res = await fetch(CONFIG.API_BASE + path, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
    } catch {
        throw new ApiError(0, "Cannot reach the server. Is the gateway running on port 8080?");
    }

    let data = null;
    const text = await res.text();
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
    }

    if (res.status === 401 && auth) {
        Session.clear();
        redirectToLogin();
    }

    if (!res.ok) {
        throw new ApiError(res.status, (data && data.message) || "Request failed (" + res.status + ")");
    }
    return data;
}

/* ---------- Mock data for accounts and transfers (USE_MOCK = true) ---------- */
const r2 = (n) => Math.round(n * 100) / 100;

const Mock = {
    key() {
        const s = Session.get();
        return "mock:" + (s ? s.userId : "anon");
    },
    state() {
        let st = null;
        try {
            st = JSON.parse(sessionStorage.getItem(this.key()));
        } catch {
            st = null;
        }
        if (!st) {
            st = {
                accounts: [
                    { accountNumber: "ACC-1001", accountType: "SAVINGS", balance: 5000, currency: "USD" },
                    { accountNumber: "ACC-1002", accountType: "CURRENT", balance: 1200, currency: "USD" }
                ],
                transfers: [],
                pending: {}
            };
            this.save(st);
        }
        return st;
    },
    save(st) {
        sessionStorage.setItem(this.key(), JSON.stringify(st));
    },
    delay(value) {
        return new Promise((resolve) => setTimeout(() => resolve(value), 250));
    },
    reject(status, message) {
        return new Promise((_, reject) => setTimeout(() => reject(new ApiError(status, message)), 250));
    },

    listAccounts() {
        return this.delay(this.state().accounts);
    },
    createAccount(accountType) {
        const st = this.state();
        const acc = {
            accountNumber: "ACC-" + (1001 + st.accounts.length),
            accountType,
            balance: 0,
            currency: "USD"
        };
        st.accounts.push(acc);
        this.save(st);
        return this.delay(acc);
    },
    initiate(p) {
        const st = this.state();
        const from = st.accounts.find((a) => a.accountNumber === p.fromAccountNumber);
        if (!from) return this.reject(404, "From account not found");
        if (p.toAccountNumber === p.fromAccountNumber) {
            return this.reject(400, "Cannot transfer to the same account");
        }
        const own = st.accounts.some((a) => a.accountNumber === p.toAccountNumber);
        const fee = own ? 0 : 10;
        const total = r2(p.amount + fee);
        if (from.balance < total) return this.reject(400, "Insufficient balance");

        const transferId = "TXN-" + Date.now();
        st.pending[transferId] = {
            from: p.fromAccountNumber,
            to: p.toAccountNumber,
            amount: p.amount,
            fee
        };
        this.save(st);
        return this.delay({
            transferId,
            fee,
            totalDebit: total,
            status: "PENDING_OTP",
            message: "OTP sent. Mock mode: use 123456"
        });
    },
    confirm(transferId, otp) {
        const st = this.state();
        const t = st.pending[transferId];
        if (!t) return this.reject(404, "Transfer not found");
        if (otp !== "123456") return this.reject(400, "Invalid OTP");

        const from = st.accounts.find((a) => a.accountNumber === t.from);
        from.balance = r2(from.balance - t.amount - t.fee);
        const to = st.accounts.find((a) => a.accountNumber === t.to);
        if (to) to.balance = r2(to.balance + t.amount);

        delete st.pending[transferId];
        st.transfers.unshift({
            transferId,
            fromAccountNumber: t.from,
            toAccountNumber: t.to,
            amount: t.amount,
            fee: t.fee,
            status: "SUCCESS",
            createdAt: new Date().toISOString()
        });
        this.save(st);
        return this.delay({ transferId, status: "SUCCESS", message: "Transfer completed" });
    },
    listTransfers() {
        return this.delay(this.state().transfers);
    }
};

/* ---------- Public API used by the pages ---------- */
const Api = {
    register(payload) {
        return request("/api/auth/register", { method: "POST", body: payload, auth: false });
    },

    async login(payload) {
        const d = await request("/api/auth/login", { method: "POST", body: payload, auth: false });
        Session.save({
            token: d.token,
            expiresAt: Date.now() + d.expiresIn * 1000,
            userId: d.userId,
            fullName: d.fullName,
            email: d.email,
            role: d.role
        });
        return d;
    },

    listAccounts() {
        return CONFIG.USE_MOCK ? Mock.listAccounts() : request("/api/accounts");
    },

    createAccount(accountType) {
        return CONFIG.USE_MOCK
            ? Mock.createAccount(accountType)
            : request("/api/accounts", { method: "POST", body: { accountType } });
    },

    initiateTransfer(payload) {
        return CONFIG.USE_MOCK
            ? Mock.initiate(payload)
            : request("/api/transfers", { method: "POST", body: payload });
    },

    confirmTransfer(transferId, otp) {
        return CONFIG.USE_MOCK
            ? Mock.confirm(transferId, otp)
            : request("/api/transfers/" + encodeURIComponent(transferId) + "/confirm", {
                method: "POST",
                body: { otp }
            });
    },

    listTransfers() {
        return CONFIG.USE_MOCK ? Mock.listTransfers() : request("/api/transfers");
    }
};