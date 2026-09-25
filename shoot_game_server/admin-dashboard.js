"use strict";

// Admin dashboard:
// - Shows live leaderboard for human participants.
// - Admin clients are NOT game players.
// - Access is protected by the admin code.

const state = require("./state");
const config = require("./config");

const connections = new Set();

function getStatsSnapshot() {
  const players = [];

  state.forEachPlayer(
    state.clients,
    function (player) {
      players.push({
        id: player.id,
        participantId: player.participantId || null,
        name: player.name,

        // Overall player kills.
        kill: player.kill || 0,

        // Optional separate zombie statistics.
        zombieKills: player.zombieKills || 0,
        zombiePoints: player.zombiePoints || 0,

        death: player.death || 0,
      });
    },
  );

  // Highest overall kills first.
  players.sort(function (left, right) {
    return (
      right.kill - left.kill ||
      right.zombieKills - left.zombieKills ||
      right.zombiePoints - left.zombiePoints ||
      left.name.localeCompare(right.name)
    );
  });

  return players;
}

function getAdminCode() {
  const privateServer = config.PRIVATE_SERVER || {};

  return typeof privateServer.ADMIN_CODE === "string"
    ? privateServer.ADMIN_CODE.trim()
    : "";
}

function authenticate(ws, code) {
  const expectedCode = getAdminCode();

  if (!expectedCode) {
    return false;
  }

  if (typeof code !== "string") {
    return false;
  }

  return code.trim() === expectedCode;
}

function addConnection(ws) {
  // The admin socket starts unauthenticated.
  const adminClient = {
    ws: ws,
    authenticated: false,
  };

  connections.add(adminClient);

  send(ws, "admin_login_required", {});

  ws.on("message", function (rawMessage) {
    let msg;

    try {
      msg = JSON.parse(rawMessage.toString());
    } catch (error) {
      return;
    }

    if (!msg || typeof msg.type !== "string") {
      return;
    }

    // ----------------------------------------------------------
    // ADMIN LOGIN
    // ----------------------------------------------------------

    if (!adminClient.authenticated) {
      if (msg.type !== "admin_login") {
        return;
      }

      const data =
        msg.data && typeof msg.data === "object"
          ? msg.data
          : {};

      if (!authenticate(ws, data.code)) {
        send(ws, "admin_login_error", {
          message: "Invalid admin access code.",
        });

        return;
      }

      adminClient.authenticated = true;

      send(ws, "admin_authenticated", {
        message: "Admin authenticated.",
      });

      sendSnapshot(ws);
      return;
    }

    // ----------------------------------------------------------
    // AUTHENTICATED ADMIN REQUESTS
    // ----------------------------------------------------------

    if (msg.type === "admin_refresh") {
      sendSnapshot(ws);
    }
  });

  ws.on("close", function () {
    connections.delete(adminClient);
  });

  ws.on("error", function () {
    connections.delete(adminClient);
  });
}

function send(ws, type, data) {
  if (ws.readyState === 1) {
    ws.send(
      JSON.stringify({
        type: type,
        data: data,
      }),
    );
  }
}

function sendSnapshot(ws) {
  send(ws, "admin_stats", {
    liveParticipants: state.userCount,
    players: getStatsSnapshot(),
  });
}

function broadcastStats() {
  connections.forEach(function (adminClient) {
    if (
      adminClient.authenticated &&
      adminClient.ws.readyState === 1
    ) {
      sendSnapshot(adminClient.ws);
    } else if (adminClient.ws.readyState !== 1) {
      connections.delete(adminClient);
    }
  });
}

module.exports = {
  addConnection,
  broadcastStats,
  getStatsSnapshot,
};
