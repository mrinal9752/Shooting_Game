class JoinGateClass {
  constructor(networkClass) {
    this.networkClass = networkClass;

    this.root = document.getElementById("joinGate");
    this.form = document.getElementById("joinForm");

    this.nameInput = document.getElementById("playerName");

    // New private-server fields.
    this.participantIdInput =
      document.getElementById("participantId");

    this.accessCodeInput =
      document.getElementById("accessCode");

    this.status =
      document.getElementById("joinStatus");

    var self = this;

    // The game listens for mouse and keyboard events on the whole window.
    // Keep those controls from cancelling focus and typing in this HTML form.
    [
      "mousedown",
      "mouseup",
      "mousemove",
      "keydown",
      "keyup",
      "touchstart",
      "touchmove",
      "touchend",
    ].forEach(function (eventName) {
      self.root.addEventListener(
        eventName,
        function (event) {
          event.stopPropagation();
        },
      );
    });

    this.form.addEventListener(
      "submit",
      function (event) {
        event.preventDefault();
        self.join();
      },
    );
    // Restore participant login after page refresh.
    this.restoreSession();
  }

  join() {
    const name = this.nameInput.value.trim();

    if (!name) {
      this.showError(
        "Enter your name before joining.",
      );
      return;
    }

    // Private-server credentials.
    const participantId =
      this.participantIdInput
        ? this.participantIdInput.value.trim()
        : "";

    const accessCode =
      this.accessCodeInput
        ? this.accessCodeInput.value.trim()
        : "";

    if (!participantId) {
      this.showError(
        "Enter your participant ID.",
      );
      return;
    }

    if (!accessCode) {
      this.showError(
        "Enter your access code.",
      );
      return;
    }
    
    // Save login for this browser tab.
    // This survives refresh but is cleared when the tab/browser is closed.
    sessionStorage.setItem(
      "fluxParticipant",
      JSON.stringify({
        participantId: participantId,
        accessCode: accessCode,
        playerName: name,
      }),
    );
    
    this.setStatus(
      "Checking participant access…",
      "",
    );
    
    this.networkClass.joinGame(
      name,
      participantId,
      accessCode,
    );
  }

  showLogin() {
    this.root.hidden = false;
    this.form.hidden = false;

    this.setStatus(
      "Enter your participant ID, access code and name.",
      "",
    );

    this.nameInput.focus();
  }

  showJoined() {
    this.root.hidden = true;
  }

  showError(message) {
    this.root.hidden = false;
    this.form.hidden = false;

    this.setStatus(
      message,
      "error",
    );
  }

  showConnecting() {
    this.root.hidden = false;
    this.form.hidden = true;

    this.setStatus(
      "Connecting to the private game server…",
      "",
    );
  }

  setStatus(message, type) {
    this.status.textContent = message;

    this.status.className = type
      ? "join-status " + type
      : "join-status";
  }
  restoreSession() {
  const savedSession =
    sessionStorage.getItem("fluxParticipant");

  if (!savedSession) {
    return;
  }

  try {
    const participant =
      JSON.parse(savedSession);

    if (
      !participant.participantId ||
      !participant.accessCode ||
      !participant.playerName
    ) {
      sessionStorage.removeItem(
        "fluxParticipant",
      );
      return;
    }

    // Put saved values back into the login form.
    if (this.participantIdInput) {
      this.participantIdInput.value =
        participant.participantId;
    }

    if (this.accessCodeInput) {
      this.accessCodeInput.value =
        participant.accessCode;
    }

    this.nameInput.value =
      participant.playerName;

    this.setStatus(
      "Restoring your participant session…",
      "",
    );

    // Wait briefly so the WebSocket/network initialization
    // has time to finish before attempting to rejoin.
    var self = this;

    setTimeout(function () {
      self.networkClass.joinGame(
        participant.playerName,
        participant.participantId,
        participant.accessCode,
      );
    }, 300);
  } catch (error) {
    console.error(
      "Failed to restore participant session:",
      error,
    );

    sessionStorage.removeItem(
      "fluxParticipant",
    );
  }
}
}
