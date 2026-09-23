"use strict";

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

function getWebSocketUrl() {
  if (window.GAME_SERVER_URL) {
    return window.GAME_SERVER_URL.replace(/\/$/, "") + "/admin";
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

function connect() {
  ws = new WebSocket(getWebSocketUrl());

  ws.onopen = function () {
    status.textContent = "Connected to game server.";
    status.className = "online";
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
        break;

      case "admin_authenticated":
        loginCard.style.display = "none";
        dashboard.style.display = "block";
        break;

      case "admin_login_error":
        loginMessage.textContent =
          msg.data.message ||
          "Invalid admin access code.";
        break;

      case "admin_stats":
        renderLeaderboard(msg.data || []);
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

adminCodeInput.addEventListener(
  "keydown",
  function (event) {
    if (event.key === "Enter") {
      loginButton.click();
    }
  },
);

function renderLeaderboard(players) {
  leaderboardBody.innerHTML = "";

  players.forEach(function (player, index) {
    const row =
      document.createElement("tr");

    if (index === 0) {
      row.className = "top-player";
    }

    const rank =
      document.createElement("td");

    rank.className = "rank";
    rank.textContent = index + 1;

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
  });
}

connect();