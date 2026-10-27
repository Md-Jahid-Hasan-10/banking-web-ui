class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* Session lives in sessionStorage, so it is cleared when the tab closes. */
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
    } catch (e) {
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

async function request(path, options) {
  const opts = options || {};
  const method = opts.method || "GET";
  const auth = opts.auth !== false;
  const headers = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

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
      method: method,
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
  } catch (e) {
    throw new ApiError(0, "Cannot reach the server. Is the gateway running on port 8080?");
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
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
    return request("/api/accounts");
  },

  createAccount(accountType) {
    return request("/api/accounts", { method: "POST", body: { accountType: accountType } });
  },

  initiateDeposit(payload) {
    return request("/api/transfers/deposit", { method: "POST", body: payload });
  },

  initiateWithdrawal(payload) {
    return request("/api/transfers/withdraw", { method: "POST", body: payload });
  },

  initiateTransfer(payload) {
    return request("/api/transfers", { method: "POST", body: payload });
  },

  // otp may be omitted to retry a transfer that is UNCONFIRMED (the OTP was already accepted).
  confirmTransfer(transferId, otp) {
    return request("/api/transfers/" + encodeURIComponent(transferId) + "/confirm", {
      method: "POST",
      body: otp ? { otp: otp } : {}
    });
  },

  listTransfers() {
    return request("/api/transfers");
  }
};
