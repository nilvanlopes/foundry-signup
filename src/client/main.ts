import "./styles.css";

const formElement = document.querySelector<HTMLFormElement>("#signup-form");
const cardElement = document.querySelector<HTMLElement>(".card");
const titleElement = document.querySelector<HTMLHeadingElement>("#page-title");
const submitButtonElement = document.querySelector<HTMLButtonElement>("#submit-button");
const googleButtonElement = document.querySelector<HTMLButtonElement>("#google-button");
const messageElement = document.querySelector<HTMLParagraphElement>("#message");
const itoken = new URLSearchParams(window.location.search).get("itoken") ?? "";

if (!formElement || !cardElement || !titleElement || !submitButtonElement || !googleButtonElement || !messageElement) {
  throw new Error("Signup UI failed to initialize");
}

const form = formElement;
const card = cardElement;
const title = titleElement;
const submitButton = submitButtonElement;
const googleButton = googleButtonElement;
const message = messageElement;

function setMessage(text: string, tone: "info" | "error" = "info") {
  message.textContent = text;
  message.dataset.tone = tone;
}

function showManualSignupComplete(messageText: string) {
  title.textContent = "Account created";
  card.classList.add("card--complete");
  card.innerHTML = `
    <div class="success-panel" role="status" aria-live="polite">
      <h2>${messageText}</h2>
      <p>You can close this page.</p>
    </div>
  `;
}

function showInvalidInvite() {
  title.textContent = "Invalid invitation link";
  card.classList.add("card--complete");
  card.innerHTML = `
    <div class="success-panel success-panel--error" role="alert">
      <h2>Invalid invitation link</h2>
      <p>Please contact the administrator.</p>
    </div>
  `;
}

if (!itoken) {
  showInvalidInvite();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const username = String(formData.get("username") ?? "").trim();

  if (!username) {
    setMessage("Enter a username before continuing.", "error");
    return;
  }

  submitButton.disabled = true;
  setMessage("Creating your account...");

  try {
    const response = await fetch("/api/signup/manual", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        itoken,
        username,
        email: String(formData.get("email") ?? "").trim(),
        password: String(formData.get("password") ?? ""),
        passwordRepeat: String(formData.get("passwordRepeat") ?? "")
      })
    });

    const body = await response.json();
    if (!response.ok) {
      const errorMessage = body.error === "invalid_invite"
        ? "Invalid invitation link."
        : body.error === "username_required"
          ? "Enter a username before continuing."
          : body.error === "enrollment_flow_failed"
            ? "Could not start the Authentik enrollment flow. Try again or contact the administrator."
            : "Review your information and try again.";
      setMessage(errorMessage, "error");
      return;
    }

    if (body.redirectTo) {
      window.location.href = body.redirectTo;
      return;
    }

    showManualSignupComplete(body.message ?? "Account created. Check your email to confirm access to Foundry.");
  } catch {
    setMessage("Could not complete signup right now.", "error");
  } finally {
    submitButton.disabled = false;
  }
});

googleButton.addEventListener("click", async () => {
  googleButton.disabled = true;
  setMessage("Opening Google...");

  try {
    const response = await fetch("/api/signup/google/start", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ itoken })
    });

    const body = await response.json();
    if (!response.ok) {
      const errorMessage = body.error === "invalid_invite"
        ? "Invalid invitation link."
        : "Could not start Google signup.";
      setMessage(errorMessage, "error");
      return;
    }

    window.location.href = body.redirectTo;
  } catch {
    setMessage("Could not open Google right now.", "error");
  } finally {
    googleButton.disabled = false;
  }
});
