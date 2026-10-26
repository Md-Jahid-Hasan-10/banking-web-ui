const CONFIG = {
    // The UI only ever talks to the API Gateway.
    API_BASE: "http://localhost:8080",

    // true  = accounts and transfers use fake local data (OTP is always 123456).
    // false = accounts and transfers call Yamin's real services through the gateway.
    // Register and login always use the real User Service.
    USE_MOCK: true
};