/*
 * Tracks one transaction (transfer, deposit or withdrawal) from the first request to the final result.
 * The server does the work in the background. This file asks for the status and shows it.
 * Needs api.js and ui.js to be loaded first.
 */
const TxFlow = (function () {
    "use strict";

    const FAST_POLL_MS = 1000;
    const SLOW_POLL_MS = 2000;
    const FAST_POLL_FOR_MS = 20000;
    const GIVE_UP_AFTER_MS = 120000;
    const MAX_CONSECUTIVE_ERRORS = 5;
    const RESEND_COOLDOWN_S = 30;

    const FINAL = ["COMPLETED", "SUCCESS", "FAILED", "REVERSED", "EXPIRED", "RECONCILIATION_REQUIRED"];

    const STEP_TEXT = {
        VALIDATING: {
            doing: function (t) { return t === "TRANSFER" ? "Checking your accounts" : "Checking your account"; },
            done: function (t) { return t === "TRANSFER" ? "Accounts checked" : "Account checked"; }
        },
        FEE_PENDING: {
            doing: function () { return "Calculating the fee"; },
            done: function () { return "Fee calculated"; }
        },
        OTP_PENDING: {
            doing: function () { return "Sending your one-time password"; },
            done: function () { return "One-time password sent"; }
        },
        AWAITING_OTP: {
            doing: function () { return "Waiting for your one-time password"; },
            done: function () { return "One-time password confirmed"; }
        },
        WITHDRAWING: {
            doing: function () { return "Taking the money from your account"; },
            done: function () { return "Money taken from your account"; }
        },
        DEPOSITING: {
            doing: function (t) { return t === "DEPOSIT" ? "Adding the money to your account" : "Sending the money to the receiver"; },
            done: function (t) { return t === "DEPOSIT" ? "Money added to your account" : "Money sent to the receiver"; }
        },
        REVERSING: {
            doing: function () { return "Returning your money"; },
            done: function () { return "Your money was returned"; }
        }
    };

    function kindOf(type) {
        if (type === "DEPOSIT") return "deposit";
        if (type === "WITHDRAWAL") return "withdrawal";
        return "transfer";
    }

    function capitalize(text) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function sentence(text) {
        const t = (text || "").trim();
        if (!t) return "";
        return /[.!?]$/.test(t) ? t : t + ".";
    }

    function isFinal(data) {
        return data.finished === true || FINAL.indexOf(data.status) !== -1;
    }

    function summaryRow(parent, label, value, strong) {
        const row = makeEl("div");
        row.appendChild(makeEl(strong ? "strong" : "span", strong ? "" : "label", label));
        row.appendChild(makeEl(strong ? "strong" : "span", "", value));
        parent.appendChild(row);
    }

    function fillSummary(el, data) {
        el.textContent = "";
        if (data.type === "TRANSFER" || !data.type) {
            summaryRow(el, "From", data.fromAccountNumber);
            summaryRow(el, "To", data.toAccountNumber);
            summaryRow(el, "Amount", formatMoney(data.amount));
            if (data.fee !== null && data.fee !== undefined) {
                summaryRow(el, "Fee", formatMoney(data.fee));
                summaryRow(el, "Total debit", formatMoney(data.totalDebit), true);
            }
        } else {
            const account = data.type === "DEPOSIT" ? data.toAccountNumber : data.fromAccountNumber;
            summaryRow(el, "Account", account);
            summaryRow(el, "Amount", formatMoney(data.amount), true);
        }
        summaryRow(el, "Reference", data.transferId);
    }

    function describe(data) {
        const kind = kindOf(data.type);
        switch (data.status) {
            case "COMPLETED":
            case "SUCCESS":
                return {
                    tone: "success",
                    title: capitalize(kind) + " completed",
                    text: "A confirmation email has been sent to you."
                };
            case "FAILED":
                return {
                    tone: "error",
                    title: capitalize(kind) + " not completed",
                    text: sentence(data.message || "The request failed") + " No money was moved."
                };
            case "REVERSED":
                return {
                    tone: "warning",
                    title: "Transfer reversed",
                    text: "The receiver could not be credited, so your money was returned to you, including the fee."
                };
            case "EXPIRED":
                return {
                    tone: "muted",
                    title: "Request expired",
                    text: "Nothing was changed. Please start a new one."
                };
            default:
                return {
                    tone: "warning",
                    title: "We are checking this request",
                    text: "Your money is safe. Please do not repeat the request. It will be finished automatically, "
                        + "or you can contact support with the reference below."
                };
        }
    }

    function create(container, options) {
        const opts = options || {};

        let transferId = null;
        let timer = null;
        let startedAt = 0;
        let errors = 0;
        let observed = [];
        let otpShownFor = null;
        let resendLeft = 0;
        let resendInterval = null;
        let resendSending = false;
        let problemHandler = null;

        container.textContent = "";
        container.hidden = true;

        // ---------------------------------------------------------------- progress card
        const progressCard = makeEl("div", "card");
        const progressTitle = makeEl("h2", "", "Working on it");
        const progressRow = makeEl("div", "progress-row");
        const spinner = makeEl("span", "spinner");
        spinner.setAttribute("aria-hidden", "true");
        const progressMessage = makeEl("p", "progress-message", "Starting...");
        progressMessage.setAttribute("role", "status");
        progressRow.appendChild(spinner);
        progressRow.appendChild(progressMessage);

        const timeline = makeEl("ul", "timeline");

        const problemBox = makeEl("div", "msg warning");
        problemBox.hidden = true;
        const problemText = makeEl("p", "", "");
        const problemButtons = makeEl("div", "button-row");
        const problemAction = makeEl("button", "btn btn-secondary", "Try again");
        problemAction.type = "button";
        const historyLink = makeEl("a", "btn btn-secondary", "Open History");
        historyLink.href = "history.html";
        problemButtons.appendChild(problemAction);
        problemButtons.appendChild(historyLink);
        problemBox.appendChild(problemText);
        problemBox.appendChild(problemButtons);

        progressCard.appendChild(progressTitle);
        progressCard.appendChild(progressRow);
        progressCard.appendChild(timeline);
        progressCard.appendChild(problemBox);

        // ---------------------------------------------------------------- OTP card
        const otpCard = makeEl("div", "card");
        const otpTitle = makeEl("h2", "", "Confirm");
        const otpSummary = makeEl("div", "summary");
        const otpForm = document.createElement("form");
        otpForm.noValidate = true;
        const otpGroup = makeEl("div", "form-group");
        const otpLabel = makeEl("label", "", "One-time password");
        otpLabel.htmlFor = "flowOtp";
        const otpInput = document.createElement("input");
        otpInput.id = "flowOtp";
        otpInput.type = "text";
        otpInput.inputMode = "numeric";
        otpInput.maxLength = 6;
        otpInput.autocomplete = "one-time-code";
        otpInput.placeholder = "6 digits";
        const otpHint = makeEl("div", "hint",
            "We sent a 6-digit code to your email. It is valid for 5 minutes.");
        otpGroup.appendChild(otpLabel);
        otpGroup.appendChild(otpInput);
        otpGroup.appendChild(otpHint);
        const otpMsg = makeEl("div", "msg");
        otpMsg.hidden = true;
        const otpButtons = makeEl("div", "button-row");
        const confirmBtn = makeEl("button", "btn", "Confirm");
        confirmBtn.type = "submit";
        const resendBtn = makeEl("button", "btn btn-secondary", "Resend code");
        resendBtn.type = "button";
        const startOverBtn = makeEl("button", "btn btn-secondary", "Start over");
        startOverBtn.type = "button";
        otpButtons.appendChild(confirmBtn);
        otpButtons.appendChild(resendBtn);
        otpButtons.appendChild(startOverBtn);
        otpForm.appendChild(otpGroup);
        otpForm.appendChild(otpMsg);
        otpForm.appendChild(otpButtons);

        otpCard.appendChild(otpTitle);
        otpCard.appendChild(otpSummary);
        otpCard.appendChild(otpForm);

        // ---------------------------------------------------------------- result card
        const resultCard = makeEl("div", "card");
        const resultBanner = makeEl("div", "msg result-banner");
        const resultTitle = makeEl("strong", "", "");
        const resultText = makeEl("span", "", "");
        resultBanner.appendChild(resultTitle);
        resultBanner.appendChild(resultText);
        const resultSummary = makeEl("div", "summary");
        const resultButtons = makeEl("div", "button-row");
        resultCard.appendChild(resultBanner);
        resultCard.appendChild(resultSummary);
        resultCard.appendChild(resultButtons);

        container.appendChild(progressCard);
        container.appendChild(otpCard);
        container.appendChild(resultCard);

        function showOnly(card) {
            progressCard.hidden = card !== progressCard;
            otpCard.hidden = card !== otpCard;
            resultCard.hidden = card !== resultCard;
            container.hidden = false;
        }

        // ---------------------------------------------------------------- polling
        function stopPolling() {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        }

        function schedule() {
            const delay = Date.now() - startedAt < FAST_POLL_FOR_MS ? FAST_POLL_MS : SLOW_POLL_MS;
            timer = setTimeout(poll, delay);
        }

        async function poll() {
            const id = transferId;
            try {
                const data = await Api.getTransfer(id);
                if (id !== transferId) return;
                errors = 0;
                handle(data);
            } catch (err) {
                if (id !== transferId) return;
                if (err.status === 404) {
                    showProblem("We could not find this request.", "Start over", function () {
                        if (opts.onNew) opts.onNew();
                    });
                    return;
                }
                errors++;
                if (errors >= MAX_CONSECUTIVE_ERRORS) {
                    showProblem("We cannot reach the server right now. Your request is not lost.", "Try again",
                        resumePolling);
                    return;
                }
                schedule();
            }
        }

        function resumePolling() {
            startedAt = Date.now();
            errors = 0;
            problemBox.hidden = true;
            spinner.hidden = false;
            stopPolling();
            poll();
        }

        function handle(data) {
            recordStep(data);

            if (data.status === "AWAITING_OTP") {
                showOtp(data);
                return;
            }
            if (isFinal(data)) {
                showResult(data);
                return;
            }

            showProgress(data);
            if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
                showProblem("This is taking longer than usual. Your request is still being processed. "
                    + "You can leave this page and follow it in History.", "Keep waiting", resumePolling);
                return;
            }
            schedule();
        }

        // ---------------------------------------------------------------- timeline
        function recordStep(data) {
            const last = observed[observed.length - 1];
            if ((!last || last.status !== data.status) && STEP_TEXT[data.status]) {
                observed.push({ status: data.status, type: data.type });
            }
            timeline.textContent = "";
            observed.forEach(function (step, index) {
                const current = index === observed.length - 1 && !isFinal(data) && data.status === step.status;
                const text = STEP_TEXT[step.status];
                const li = makeEl("li", current ? "current" : "done");
                li.appendChild(makeEl("span", "step-icon", current ? "" : "\u2713"));
                li.appendChild(makeEl("span", "", current ? text.doing(step.type) : text.done(step.type)));
                timeline.appendChild(li);
            });
        }

        // ---------------------------------------------------------------- cards
        function showProgress(data) {
            spinner.hidden = false;
            problemBox.hidden = true;
            progressTitle.textContent = "Processing your " + kindOf(data.type);
            progressMessage.textContent = data.message || "Working...";
            showOnly(progressCard);
        }

        function showProblem(text, label, handler) {
            stopPolling();
            spinner.hidden = true;
            problemText.textContent = text;
            problemAction.textContent = label;
            problemHandler = handler;
            problemBox.hidden = false;
            showOnly(progressCard);
        }

        function showOtp(data) {
            stopPolling();
            fillSummary(otpSummary, data);
            otpTitle.textContent = "Confirm your " + kindOf(data.type);
            if (otpShownFor !== data.transferId) {
                otpShownFor = data.transferId;
                otpInput.value = "";
                hideMessage(otpMsg);
                startResendTimer(RESEND_COOLDOWN_S);
            }
            showOnly(otpCard);
            otpInput.focus();
        }

        function showResult(data) {
            stopPolling();
            stopResendTimer();

            const d = describe(data);
            resultBanner.className = "msg result-banner " + d.tone;
            resultTitle.textContent = d.title;
            resultText.textContent = d.text;
            fillSummary(resultSummary, data);

            resultButtons.textContent = "";
            if (data.status === "RECONCILIATION_REQUIRED") {
                const again = makeEl("button", "btn", "Check again");
                again.type = "button";
                again.addEventListener("click", function () { track(data.transferId); });
                resultButtons.appendChild(again);
            }
            const another = makeEl("button", data.status === "RECONCILIATION_REQUIRED" ? "btn btn-secondary" : "btn",
                "New " + kindOf(data.type));
            another.type = "button";
            another.addEventListener("click", function () { if (opts.onNew) opts.onNew(); });
            resultButtons.appendChild(another);

            const dashboard = makeEl("a", "btn btn-secondary", "Dashboard");
            dashboard.href = "dashboard.html";
            resultButtons.appendChild(dashboard);
            const history = makeEl("a", "btn btn-secondary", "History");
            history.href = "history.html";
            resultButtons.appendChild(history);

            showOnly(resultCard);
            if (opts.onFinished) opts.onFinished(data);
        }

        // ---------------------------------------------------------------- resend countdown
        function updateResendButton() {
            if (resendSending) {
                resendBtn.textContent = "Sending...";
                resendBtn.disabled = true;
            } else if (resendLeft > 0) {
                resendBtn.textContent = "Resend code (" + resendLeft + "s)";
                resendBtn.disabled = true;
            } else {
                resendBtn.textContent = "Resend code";
                resendBtn.disabled = false;
            }
        }

        function stopResendTimer() {
            if (resendInterval !== null) {
                clearInterval(resendInterval);
                resendInterval = null;
            }
        }

        function startResendTimer(seconds) {
            stopResendTimer();
            resendLeft = seconds;
            updateResendButton();
            resendInterval = setInterval(function () {
                resendLeft--;
                if (resendLeft <= 0) {
                    resendLeft = 0;
                    stopResendTimer();
                }
                updateResendButton();
            }, 1000);
        }

        // ---------------------------------------------------------------- user actions
        problemAction.addEventListener("click", function () {
            if (problemHandler) problemHandler();
        });

        otpForm.addEventListener("submit", async function (e) {
            e.preventDefault();
            hideMessage(otpMsg);

            const code = otpInput.value.trim();
            if (!/^\d{6}$/.test(code)) {
                showMessage(otpMsg, "Enter the 6-digit code", "error");
                return;
            }

            setBusy(confirmBtn, true, "Confirming...");
            try {
                const data = await Api.confirmTransfer(transferId, code);
                startedAt = Date.now();
                errors = 0;
                stopResendTimer();
                handle(data);
            } catch (err) {
                showMessage(otpMsg, err.message, "error");
            }
            setBusy(confirmBtn, false);
        });

        resendBtn.addEventListener("click", async function () {
            hideMessage(otpMsg);
            resendSending = true;
            updateResendButton();
            try {
                await Api.resendOtp(transferId);
                showMessage(otpMsg, "A new code is on its way. The old code no longer works.", "info");
                resendSending = false;
                startResendTimer(RESEND_COOLDOWN_S);
            } catch (err) {
                showMessage(otpMsg, err.message, "error");
                resendSending = false;
                const wait = /(\d+) seconds/.exec(err.message);
                startResendTimer(wait ? Number(wait[1]) : 0);
            }
        });

        startOverBtn.addEventListener("click", function () {
            if (opts.onNew) opts.onNew();
        });

        // ---------------------------------------------------------------- public
        function track(id) {
            stopPolling();
            stopResendTimer();
            transferId = id;
            observed = [];
            errors = 0;
            otpShownFor = null;
            startedAt = Date.now();
            timeline.textContent = "";
            spinner.hidden = false;
            problemBox.hidden = true;
            progressTitle.textContent = "Working on it";
            progressMessage.textContent = "Starting...";
            showOnly(progressCard);
            poll();
        }

        function hide() {
            stopPolling();
            stopResendTimer();
            transferId = null;
            otpShownFor = null;
            container.hidden = true;
        }

        return { track: track, hide: hide };
    }

    return { create: create };
})();