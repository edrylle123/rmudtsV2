/* ==========================================================================
   RMUDTS Installation Wizard — behaviour
   --------------------------------------------------------------------------
   Everything here is progressive enhancement: every step also works as a plain
   form POST if JavaScript is unavailable, it just gives less feedback while it
   runs.

   No dependencies. No inline event handlers. No secrets in the browser.
   ========================================================================== */
(function () {
  "use strict";

  var STAGES = ["connect", "tables", "indexes", "relationships", "defaults", "verify"];

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  var LEVEL_TITLES = { pass: "Success", warn: "Attention", fail: "Problem", info: "Notice" };

  /** Show a message in the banner area at the top of the step. */
  function notify(level, message) {
    var host = $("#async-messages");
    if (!host || !message) return;
    host.innerHTML = '<div class="banner banner-' + escapeHtml(level) + '"><strong>' +
      escapeHtml(LEVEL_TITLES[level] || "Notice") + ":</strong> " + escapeHtml(message) + "</div>";
    if (level === "fail") {
      host.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function clearNotice() {
    var host = $("#async-messages");
    if (host) host.innerHTML = "";
  }

  /** The hidden csrf input, refreshed from every response. */
  function csrfInput() {
    return $('input[name="csrf"]');
  }

  function formValues(form) {
    var data = new FormData(form || document.body);
    return data;
  }

  /**
   * POST an installer action and return the parsed JSON result.
   * Adds the CSRF token and the XHR header the server looks for.
   */
  function post(action, form, extra) {
    var data = formValues(form);
    data.set("action", action);
    Object.keys(extra || {}).forEach(function (key) {
      data.set(key, extra[key]);
    });
    return fetch("index.php", {
      method: "POST",
      body: data,
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
    }).then(function (response) {
      return response.text().then(function (text) {
        var json;
        try {
          json = JSON.parse(text);
        } catch (err) {
          throw new Error(
            "The server returned an unexpected response (" + response.status + "). " +
            "Check the browser console and the server error log."
          );
        }
        if (json.csrf && csrfInput()) {
          csrfInput().value = json.csrf;
        }
        return json;
      });
    });
  }

  /** Run a button's action while showing progress and disabling the control. */
  function withBusy(button, label, work) {
    var original = button ? button.innerHTML : "";
    if (button) {
      button.disabled = true;
      button.innerHTML = label || "Working…";
    }
    clearNotice();
    return Promise.resolve()
      .then(work)
      .catch(function (error) {
        notify("fail", error.message || String(error));
        return null;
      })
      .then(function (result) {
        if (button) {
          button.disabled = false;
          button.innerHTML = original;
        }
        return result;
      });
  }

  /* --------------------------------------------------------------- step 3 -- */

  function storageForm() {
    return $("#form-step3");
  }

  function renderStorageReport(rows) {
    var card = $("#storage-report-card");
    var body = $("#storage-report tbody");
    if (!card || !body) return;
    body.innerHTML = "";
    (rows || []).forEach(function (row) {
      var level = row.level || "info";
      body.insertAdjacentHTML("beforeend",
        "<tr class=\"row-" + escapeHtml(level) + "\"><td class=\"col-status\">" +
        '<span class="chip chip-' + escapeHtml(level) + '">' + escapeHtml(level.toUpperCase()) + "</span></td>" +
        "<td>" + escapeHtml(row.label || row.key) + "</td>" +
        "<td>" + escapeHtml(row.message) + "</td></tr>");
    });
    card.hidden = false;
  }

  function renderValidation(validation) {
    var rows = [];
    Object.keys(validation || {}).forEach(function (key) {
      rows.push({ level: validation[key].level, label: key, message: validation[key].message });
    });
    if (rows.length) renderStorageReport(rows);
  }

  function bindStorage() {
    var form = storageForm();
    if (!form) return;

    var check = $("#btn-storage-check");
    var apply = $("#btn-storage-apply");
    var defaults = $("#btn-storage-defaults");
    var state = $("#storage-state");

    if (defaults) {
      defaults.addEventListener("click", function () {
        $$("input[data-default]", form).forEach(function (input) {
          input.value = input.getAttribute("data-default");
        });
        if (state) state.textContent = "Recommended paths restored — verify them before continuing.";
      });
    }

    if (check) {
      check.addEventListener("click", function () {
        withBusy(check, "Verifying…", function () {
          return post("storage-check", form).then(function (result) {
            if (!result) return null;
            renderValidation(result.data.validation || {});
            notify(result.level, result.message);
            if (state) state.textContent = result.ok ? "All locations verified." : "Issues found — see the report.";
            return result;
          });
        });
      });
    }

    if (apply) {
      apply.addEventListener("click", function (event) {
        event.preventDefault();
        withBusy(apply, "Creating folders…", function () {
          return post("storage-apply", form).then(function (result) {
            if (!result) return null;
            renderValidation(result.data.validation || {});
            renderStorageReport(result.data.report || []);
            notify(result.level, result.message);
            if (result.ok) {
              if (state) state.textContent = "Storage prepared.";
              window.location.href = "?step=4";
            } else if (state) {
              state.textContent = "Some locations could not be created.";
            }
            return result;
          });
        });
      });
    }
  }

  /* ------------------------------------------------------------ step 4 & 5 -- */

  function renderDbChecks(checks) {
    var body = $("#db-test-body");
    var wrap = $("#db-test-results");
    if (!body) return;
    body.innerHTML = "";
    (checks || []).forEach(function (check) {
      var level = check.level || "info";
      body.insertAdjacentHTML("beforeend",
        "<tr class=\"row-" + escapeHtml(level) + "\"><td class=\"col-status\">" +
        '<span class="chip chip-' + escapeHtml(level) + '">' + escapeHtml(level.toUpperCase()) + "</span></td>" +
        "<td>" + escapeHtml(check.label) + "</td><td>" + escapeHtml(check.message) + "</td></tr>");
    });
    if (wrap) wrap.hidden = (checks || []).length === 0;
  }

  function bindDbTest() {
    var button = $("#btn-db-test");
    if (!button) return;
    var form = button.closest("form");
    button.addEventListener("click", function () {
      withBusy(button, "Testing…", function () {
        return post("db-test", form).then(function (result) {
          if (!result) return null;
          renderDbChecks((result.data && result.data.checks) || []);
          notify(result.level, result.message);
          var state = $("#db-test-state");
          if (state) state.textContent = result.ok ? "Connection verified." : "Connection failed.";
          return result;
        });
      });
    });
  }

  function consoleLine(level, message) {
    var consoleEl = $("#provision-console");
    if (!consoleEl) return;
    consoleEl.insertAdjacentHTML("beforeend",
      '<div class="console-line console-' + escapeHtml(level || "info") + '">' + escapeHtml(message) + "</div>");
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function setStage(stage, state, note) {
    var item = $('.stage[data-stage="' + stage + '"]');
    if (!item) return;
    item.classList.remove("is-done", "is-fail", "is-running");
    if (state) item.classList.add(state);
    var noteEl = $(".stage-note", item);
    if (noteEl && note) noteEl.textContent = note;
  }

  function bindProvision() {
    var button = $("#btn-provision");
    if (!button) return;
    var form = button.closest("form");
    var state = $("#provision-state");
    var bar = $("#provision-progress");
    var fill = bar ? $(".progress-bar-fill", bar) : null;
    var next = $("#form-step5 button[value=\"step-next\"]");

    function runStage(index) {
      if (index >= STAGES.length) {
        consoleLine("pass", "Provisioning complete.");
        if (state) state.textContent = "Provisioning completed — you can continue.";
        if (next) next.disabled = false;
        notify("pass", "Database provisioned successfully. Continue to application settings.");
        return Promise.resolve(true);
      }
      var stage = STAGES[index];
      setStage(stage, "is-running", "running…");
      consoleLine("stage", stage.toUpperCase());
      return post("db-provision", form, { stage: stage }).then(function (result) {
        if (!result) return false;
        var log = (result.data && result.data.log) || [];
        log.forEach(function (entry) {
          consoleLine(entry.level, entry.message);
        });
        setStage(stage, result.ok ? "is-done" : "is-fail", result.message);
        if (bar && result.data && typeof result.data.progress === "number") {
          bar.hidden = false;
          if (fill) fill.style.width = result.data.progress + "%";
        }
        if (!result.ok) {
          notify("fail", result.message + (stage === "verify" ? "" : " Fix the problem, then run provisioning again — stages already completed are skipped automatically."));
          if (state) state.textContent = "Provisioning stopped at: " + stage;
          return false;
        }
        return runStage(index + 1);
      });
    }

    button.addEventListener("click", function () {
      if (!window.confirm("Create the RMUDTS schema in the database?\n\nThis creates tables, indexes, relationships and default records. Existing data is never dropped.")) {
        return;
      }
      var consoleEl = $("#provision-console");
      if (consoleEl) consoleEl.innerHTML = "";
      consoleLine("info", "Starting provisioning for the configured database…");
      withBusy(button, "Provisioning…", function () {
        return runStage(0);
      }).then(function (ok) {
        if (ok === true && state) state.textContent = "Provisioning completed — continue when ready.";
      });
    });

    var reset = $("#btn-provision-reset");
    if (reset) {
      reset.addEventListener("click", function () {
        var consoleEl = $("#provision-console");
        if (consoleEl) consoleEl.innerHTML = '<div class="console-line console-info">Waiting to start…</div>';
        $$(".stage").forEach(function (item) {
          item.classList.remove("is-done", "is-fail", "is-running");
          var noteEl = $(".stage-note", item);
          if (noteEl) noteEl.textContent = "";
        });
        if (bar) bar.hidden = true;
        if (fill) fill.style.width = "0%";
      });
    }
  }

  /* --------------------------------------------------------------- step 7 -- */

  function renderPolicy(policy) {
    var list = $("#password-policy");
    var meter = $("#password-meter");
    var label = $("#password-meter-label");
    var span = meter ? $("span", meter) : null;
    if (span) span.style.width = (policy.score || 0) + "%";
    if (meter) {
      meter.classList.remove("is-weak", "is-fair", "is-strong");
      meter.classList.add(policy.score >= 100 ? "is-strong" : policy.score >= 70 ? "is-fair" : "is-weak");
    }
    if (label) label.textContent = "Strength: " + policy.label + " (" + policy.score + "% of the requirements met)";
    if (list) {
      $$("li", list).forEach(function (item) {
        var text = item.textContent.replace(/^\s*✓?\s*/, "").trim().toLowerCase();
        var match = (policy.requirements || []).filter(function (rule) {
          return rule.label.toLowerCase() === text;
        })[0];
        if (match) item.classList.toggle("is-met", !!match.met);
      });
    }
  }

  // Mirrors Rmudts\Installer\Security::checkPassword() so the live checklist
  // never disagrees with what the server will accept.
  var COMMON_PASSWORDS = ["password", "password1", "password123", "12345678", "123456789",
    "qwerty123", "admin", "admin123", "administrator", "letmein", "welcome1", "iloveyou",
    "rmudts", "changeme", "passw0rd", "p@ssw0rd", "qwertyuiop", "1q2w3e4r"];

  function isCommon(password) {
    var needle = password.toLowerCase();
    return COMMON_PASSWORDS.some(function (common) {
      return needle === common || needle.indexOf(common) !== -1;
    });
  }

  function localPolicy(password, confirm) {
    var requirements = [
      { label: "At least 10 characters", met: password.length >= 10 },
      { label: "Contains a lowercase letter", met: /[a-z]/.test(password) },
      { label: "Contains an uppercase letter", met: /[A-Z]/.test(password) },
      { label: "Contains a number", met: /\d/.test(password) },
      { label: "Contains a symbol (!@#$%^&*)", met: /[^A-Za-z0-9]/.test(password) },
      { label: "Not a commonly used password", met: password !== "" && !isCommon(password) },
      { label: "Both passwords match", met: password !== "" && password === confirm },
    ];
    var met = requirements.filter(function (rule) { return rule.met; }).length;
    var score = Math.round((met / requirements.length) * 100);
    return {
      ok: met === requirements.length,
      score: score,
      label: score >= 100 ? "Strong" : score >= 70 ? "Fair" : "Weak",
      requirements: requirements,
    };
  }

  function bindPassword() {
    var password = $('#form-step7 input[name="password"]');
    var confirm = $('#form-step7 input[name="password_confirm"]');
    if (!password) return;
    function update() {
      renderPolicy(localPolicy(password.value, confirm ? confirm.value : ""));
    }
    password.addEventListener("input", update);
    if (confirm) confirm.addEventListener("input", update);
    update();
  }

  /* --------------------------------------------------------------- step 8 -- */

  function renderSecrets(secrets) {
    Object.keys(secrets || {}).forEach(function (key) {
      var cell = $('[data-status-for="' + key + '"]');
      var value = $('[data-value-for="' + key + '"]');
      if (cell) {
        cell.innerHTML = '<span class="chip chip-pass">READY</span>';
      }
      if (value) value.textContent = secrets[key].preview;
    });
  }

  function bindSecurity() {
    var run = $("#btn-security-run");
    var regenerate = $("#btn-security-regenerate");
    if (!run && !regenerate) return;
    var form = $("#form-step8");
    var next = $("#btn-security-next");

    function submit(button, regenerate) {
      if (regenerate && !window.confirm("Regenerate every key?\n\nExisting sessions and signed tokens become invalid. Continue?")) {
        return Promise.resolve();
      }
      return withBusy(button, regenerate ? "Regenerating…" : "Applying…", function () {
        return post("security-run", form, { regenerate: regenerate ? "1" : "0" }).then(function (result) {
          if (!result) return null;
          renderSecrets((result.data && result.data.secrets) || {});
          var body = $("#security-checklist");
          if (body && result.data && result.data.checklist) {
            body.innerHTML = "";
            result.data.checklist.forEach(function (row) {
              body.insertAdjacentHTML("beforeend",
                "<tr class=\"row-" + escapeHtml(row.level) + "\"><td class=\"col-status\">" +
                '<span class="chip chip-' + escapeHtml(row.level) + '">' +
                escapeHtml(row.level === "pass" ? "PASS" : row.level === "warn" ? "WARNING" : "FAIL") +
                "</span></td><td>" + escapeHtml(row.label) + "</td><td>" + escapeHtml(row.note) + "</td></tr>");
            });
          }
          notify(result.level, result.message);
          var state = $("#security-state");
          if (state) state.textContent = result.ok ? "Applied just now." : "Not applied.";
          if (next) next.disabled = !result.ok;
          if (result.ok) {
            $$("#secret-body [data-status-for]").forEach(function (cell) {
              cell.innerHTML = '<span class="chip chip-pass">READY</span>';
            });
          }
          return result;
        });
      });
    }

    if (run) run.addEventListener("click", function () { submit(run, false); });
    if (regenerate) regenerate.addEventListener("click", function () { submit(regenerate, true); });
  }

  /* --------------------------------------------------------------- step 9 -- */

  function bindFinish() {
    var button = $("#btn-finish");
    if (!button) return;
    var form = button.closest("form");

    button.addEventListener("click", function (event) {
      event.preventDefault();
      if (!window.confirm("Finish the installation?\n\nThis writes installed.lock, disables the wizard, publishes the frontend and copies the backend. You will not be able to run it again without deleting the lock file.")) {
        return;
      }
      withBusy(button, "Installing…", function () {
        return post("finish", form).then(function (result) {
          if (!result) return null;
          if (result.ok) {
            window.location.href = "?step=10&done=1";
            return result;
          }
          notify(result.level, result.message + " " + ((result.data && result.data.messages) || []).join(" "));
          return result;
        });
      });
    });
  }

  /* ---------------------------------------------------------------- boot --- */

  function boot() {
    bindStorage();
    bindDbTest();
    bindProvision();
    bindPassword();
    bindSecurity();
    bindFinish();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
