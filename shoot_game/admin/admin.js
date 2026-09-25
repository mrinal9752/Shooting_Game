"use strict";

// ------------------------------------------------------------
// Admin session storage
// ------------------------------------------------------------

const ADMIN_SESSION_KEY = "flux_admin_session_v1";

const loginCard =
  document.getElementById("loginCard");

const dashboard =
  document.getElementById("dashboard");

const adminCodeInput =
  document.getElementById("adminCode");

const loginButton =
  document.getElementById("loginButton");

const loginMessage =
  document.getElementById("loginMessage");

const leaderboardBody =
  document.getElementById("leaderboardBody");

const status =
  document.getElementById("status");

let ws;


// ------------------------------------------------------------
// Get saved admin code
// ------------------------------------------------------------

function getSavedAdminCode() {
  try {
    return localStorage.getItem(
      ADMIN_SESSION_KEY,
    );
  } catch (error) {
    console.error(
      "Unable to read admin session:",
      error,
    );

    return null;
  }
}


// ------------------------------------------------------------
// Save admin code
// ------------------------------------------------------------

function saveAdminCode(code) {
  try {
    localStorage.setItem(
      ADMIN_SESSION_KEY,
      code,
    );
  } catch (error) {
    console.error(
      "Unable to save admin session:",
      error,
    );
  }
}


// ------------------------------------------------------------
// Remove saved admin code
// ------------------------------------------------------------

function clearAdminSession() {
  try {
    localStorage.removeItem(
      ADMIN_SESSION_KEY,
    );
  } catch (error) {
    console.error(
      "Unable to clear admin session:",
      error,
    );
  }
}


// ------------------------------------------------------------
// WebSocket URL
// ------------------------------------------------------------

function getWebSocketUrl() {
  if (window.GAME_SERVER_URL) {
    return (
      window.GAME_SERVER_URL.replace(/\/$/, "") +
      "/admin"
    );
  }

  const protocol =
    location.protocol === "https:"
      ? "wss:"
      : "ws:";

  return (
    protocol +
    "//" +
    location.hostname +
    ":8082/admin"
  );
}


// ------------------------------------------------------------
// Automatically login using saved session
// ------------------------------------------------------------

function autoLoginAdmin() {
  const savedCode =
    getSavedAdminCode();

  if (!savedCode) {
    return;
  }

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  status.textContent =
    "Restoring admin session...";

  ws.send(
    JSON.stringify({
      type: "admin_login",
      data: {
        code: savedCode,
      },
    }),
  );
}


// ------------------------------------------------------------
// Connect to server
// ------------------------------------------------------------

function connect() {
  ws = new WebSocket(
    getWebSocketUrl(),
  );

  ws.onopen = function () {
    status.textContent =
      "Connected to game server.";

    status.className = "online";

    // Automatically authenticate after refresh
    const savedCode =
      getSavedAdminCode();

    if (savedCode) {
      autoLoginAdmin();
    }
  };


  ws.onmessage = function (event) {
    let msg;

    try {
      msg = JSON.parse(event.data);
    } catch (error) {
      return;
    }

    switch (msg.type) {

      case "admin_login_required":
        // Nothing to do here.
        // Login card is already visible.
        break;


      case "admin_authenticated":

        // Save only after server confirms
        // that the code is valid.
        if (
          adminCodeInput.value.trim()
        ) {
          saveAdminCode(
            adminCodeInput.value.trim(),
          );
        }

        loginCard.style.display =
          "none";

        dashboard.style.display =
          "block";

        loginMessage.textContent = "";

        status.textContent =
          "Admin authenticated.";

        status.className = "online";

        break;


      case "admin_login_error":

        // Saved code is no longer valid.
        clearAdminSession();

        loginCard.style.display =
          "block";

        dashboard.style.display =
          "none";

        loginMessage.textContent =
          msg.data.message ||
          "Invalid admin access code.";

        break;


      case "admin_stats":

        renderLeaderboard(
          msg.data || [],
        );

        break;
    }
  };


  ws.onclose = function () {
    status.textContent =
      "Disconnected from game server.";

    status.className = "";
  };


  ws.onerror = function () {
    status.textContent =
      "Unable to connect to game server.";

    status.className = "";
  };
}


// ------------------------------------------------------------
// Manual admin login
// ------------------------------------------------------------

loginButton.addEventListener(
  "click",
  function () {

    const code =
      adminCodeInput.value.trim();

    if (!code) {
      loginMessage.textContent =
        "Enter the admin access code.";

      return;
    }

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {
      loginMessage.textContent =
        "Game server is not connected.";

      return;
    }

    loginMessage.textContent =
      "Checking access...";

    ws.send(
      JSON.stringify({
        type: "admin_login",
        data: {
          code: code,
        },
      }),
    );
  },
);


// ------------------------------------------------------------
// Enter key login
// ------------------------------------------------------------

adminCodeInput.addEventListener(
  "keydown",
  function (event) {

    if (event.key === "Enter") {
      loginButton.click();
    }

  },
);


// ------------------------------------------------------------
// Render leaderboard
// ------------------------------------------------------------

function renderLeaderboard(players) {

  leaderboardBody.innerHTML = "";

  players.forEach(
    function (player, index) {

      const row =
        document.createElement("tr");

      if (index === 0) {
        row.className =
          "top-player";
      }


      const rank =
        document.createElement("td");

      rank.className = "rank";

      rank.textContent =
        index + 1;


      const participant =
        document.createElement("td");

      participant.textContent =
        player.participantId || "-";


      const name =
        document.createElement("td");

      name.textContent =
        player.name || "Unknown";


      const kills =
        document.createElement("td");

      kills.className = "kills";

      kills.textContent =
        player.kill || 0;


      const deaths =
        document.createElement("td");

      deaths.textContent =
        player.death || 0;


      row.appendChild(rank);
      row.appendChild(participant);
      row.appendChild(name);
      row.appendChild(kills);
      row.appendChild(deaths);

      leaderboardBody.appendChild(row);

    },
  );
}


// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

connect();
