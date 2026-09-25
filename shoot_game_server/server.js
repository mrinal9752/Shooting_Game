"use strict";

// Main entry point:
// - accepts WebSocket connections
// - authenticates private participants
// - routes client messages
//
// Modules:
//  - config.js           all tuning/private-server settings
//  - state.js            shared players/AI/monsters
//  - net.js              broadcast/send helpers
//  - chat-store.js       chat persistence
//  - combat.js           server-authoritative combat
//  - ai.js               AI bots
//  - items.js            items
//  - monsters.js         PvE monsters
//  - rounds.js           round timer/map rotation
//  - map-helper.js       map/pathfinding
//  - admin-dashboard.js  admin websocket dashboard

const config = require("./config");
const state = require("./state");
const net = require("./net");
const chatStore = require("./chat-store");
const combat = require("./combat");
const items = require("./items");
const monsters = require("./monsters");
const rounds = require("./rounds");
const mapHelper = require("./map-helper");
const adminDashboard = require("./admin-dashboard");

const wss = require("./websocket-server")(config.PORT);

// Start every server session with a clean chat history.
chatStore.clear();

chatStore.append({
  id: "SERVER",
  name: "FLUX",
  chat: "FLUX RECRUITMENT 2026",
  date: Date.now(),
});

let connectionCount = 0;

// The round timer starts only when the first participant joins.
let roundsStarted = false;

// Connections that have opened a WebSocket but have not yet been
// authenticated/admitted as game players.
const joiningConnections = new Set();

// Active participant sessions.
// One participant ID can have only one active game connection.
const participantSessions = new Map();

const privateServer = config.PRIVATE_SERVER || {
  ENABLED: false,
  MAX_PLAYERS: 20,
  PARTICIPANTS: [],
};

wss.on("connection", function connection(ws, request) {
  const requestUrl =
    request && request.url ? request.url : "/";

  const requestPath = requestUrl.split("?")[0];

  // ------------------------------------------------------------
  // ADMIN CONNECTION
  // ------------------------------------------------------------
  //
  // For now the admin channel remains separate from game players.
  // We will protect this channel in a later step.
  //
  if (requestPath === "/admin" || requestPath === "/ws/admin") {
    adminDashboard.addConnection(ws);
    return;
  }

  // ------------------------------------------------------------
  // HUMAN PLAYER CONNECTION
  // ------------------------------------------------------------

  const joining = {
    ws: ws,
    name: "",
    participantId: "",
    participantCode: "",
    participantSessionToken: "",
    participant: undefined,
    client: undefined,
  };

  joiningConnections.add(joining);

  sendToSocket(ws, "player_login_required", {
    privateServer: !!privateServer.ENABLED,
  });

  ws.on("message", function incoming(message) {
    let msg;

    try {
      msg = JSON.parse(message.toString());
    } catch (error) {
      console.error(
        "invalid client message:",
        error.message,
      );
      return;
    }

    if (!msg || typeof msg.type !== "string") {
      return;
    }

    if (joining.client) {
      handleMessage(joining.client, msg, message);
    } else {
      handleJoinMessage(joining, msg);
    }
  });

  ws.on("close", function disconnection() {
    if (joining.client) {
      removeJoinedClient(joining.client);
    } else {
      joiningConnections.delete(joining);
    }
  });

  ws.on("error", function socketError(error) {
    console.error(
      "WebSocket connection error:",
      error.message,
    );
  });
});

// ------------------------------------------------------------
// PRIVATE PARTICIPANT AUTHENTICATION
// ------------------------------------------------------------

function handleJoinMessage(joining, msg) {
  // Echo is allowed before authentication so the client can
  // measure latency.
  if (msg.type === "echo") {
    sendToSocket(joining.ws, "echo", msg.data || {});
    return;
  }

  if (msg.type !== "player_join") {
    sendToSocket(joining.ws, "player_join_error", {
      message:
        "Enter your participant ID and access code, then select Join game.",
    });
    return;
  }

  const data =
    msg.data && typeof msg.data === "object"
      ? msg.data
      : {};

  const name = normalizePlayerName(data.name);

  if (!name) {
    sendToSocket(joining.ws, "player_join_error", {
      message:
        "Enter a name between 2 and 24 characters.",
    });
    return;
  }

  // ----------------------------------------------------------
  // PRIVATE SERVER CHECK
  // ----------------------------------------------------------

  if (privateServer.ENABLED) {
    const participantId =
      normalizeParticipantId(data.participantId);

    const accessCode =
      normalizeAccessCode(data.accessCode);

    const sessionToken =
      normalizeSessionToken(data.sessionToken);

      if (
        !participantId ||
        !accessCode ||
        !sessionToken
      ) {
      sendToSocket(joining.ws, "player_join_error", {
        message:
          "Participant ID and access code are required.",
      });
      return;
    }

    const participant = findParticipant(participantId);

    if (!participant) {
      console.log(
        "rejected participant: unknown ID " +
          participantId,
      );

      sendToSocket(joining.ws, "player_join_error", {
        message:
          "Invalid participant ID or access code.",
      });

      return;
    }

    if (participant.code !== accessCode) {
      console.log(
        "rejected participant: invalid code for " +
          participantId,
      );

      sendToSocket(joining.ws, "player_join_error", {
        message:
          "Invalid participant ID or access code.",
      });

      return;
    }

    // Do not allow the same participant account to be used
    // by two browsers at the same time.
    const existingSession =
      participantSessions.get(participant.id);
    
    if (existingSession) {
      // Same browser tab/session: this is most likely a refresh.
      if (
        existingSession.sessionToken ===
        sessionToken
      ) {
        console.log(
          "reconnecting participant: " +
            participant.id,
        );
    
        if (existingSession.client) {
          removeJoinedClient(
            existingSession.client,
          );
        } else if (
          existingSession.ws &&
          existingSession.ws.readyState === 1
        ) {
          existingSession.ws.close();
        }
      } else {
        // Different browser/tab: do not allow takeover.
        sendToSocket(joining.ws, "player_join_error", {
          message:
            "This participant is already connected.",
        });
    
        console.log(
          "rejected duplicate participant: " +
            participant.id,
        );
    
        return;
      }
    }

    // Enforce human participant limit.
    if (
      state.userCount >=
      Number(privateServer.MAX_PLAYERS || 20)
    ) {
      sendToSocket(joining.ws, "player_join_error", {
        message:
          "The game server is full.",
      });

      console.log(
        "rejected participant: server full",
      );

      return;
    }

    joining.participantId = participant.id;
    joining.participantCode = accessCode;
    joining.participantSessionToken =
      sessionToken;
    joining.participant = participant;
  }

  joining.name = name;

  admitJoiningConnection(joining);
}

// ------------------------------------------------------------
// VALIDATION HELPERS
// ------------------------------------------------------------

function normalizePlayerName(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const name = value.trim().replace(/\s+/g, " ");

  if (
    name.length <
      config.JOIN.NAME_MIN_LENGTH ||
    name.length >
      config.JOIN.NAME_MAX_LENGTH
  ) {
    return undefined;
  }

  return name;
}

function normalizeParticipantId(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const id = value.trim().toUpperCase();

  if (id.length < 2 || id.length > 64) {
    return undefined;
  }

  if (!/^[A-Z0-9_-]+$/.test(id)) {
    return undefined;
  }

  return id;
}

function normalizeAccessCode(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const code = value.trim();

  if (!code || code.length > 128) {
    return undefined;
  }

  return code;
}

function normalizeSessionToken(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const token = value.trim();

  if (token.length < 8 || token.length > 256) {
    return undefined;
  }

  return token;
}

function findParticipant(participantId) {
  const participants =
    Array.isArray(privateServer.PARTICIPANTS)
      ? privateServer.PARTICIPANTS
      : [];

  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i];

    if (!participant) {
      continue;
    }

    const configuredId =
      normalizeParticipantId(participant.id);

    if (configuredId === participantId) {
      return {
        id: configuredId,
        code:
          typeof participant.code === "string"
            ? participant.code.trim()
            : "",
      };
    }
  }

  return undefined;
}

function isParticipantAlreadyConnected(participantId) {
  let found = false;

  state.forEachPlayer(
    state.clients,
    function (player) {
      if (
        player.participantId ===
        participantId
      ) {
        found = true;
      }
    },
  );

  return found;
}

// ------------------------------------------------------------
// ADMIT AUTHENTICATED PARTICIPANT
// ------------------------------------------------------------

function admitJoiningConnection(joining) {
  const id = "USER_" + connectionCount++;

  const client = {
    ws: joining.ws,
    id: id,

    x: 0,
    y: 0,

    width: 32,
    height: 32,

    speedX: 0,
    speedY: 0,

    name: joining.name,

    // Private-server identity.
    participantId:
      joining.participantId || undefined,

    participantSessionToken:
      joining.participantSessionToken ||
      undefined,

    direction: 0,
    character: 0,
    weapon: "",

    kill: 0,
    death: 0,

    hp: 100.0,

    streak: 0,

    invincibleUntil: 0,

    zombieKills: 0,
    zombiePoints: 0,
  };

  joining.client = client;

  joiningConnections.delete(joining);

  state.clients[id] = client;
  state.clients.push(id);
  state.userCount++;

  if (client.participantId) {
  participantSessions.set(
    client.participantId,
    {
      client: client,
      ws: client.ws,
      sessionToken:
        client.participantSessionToken,
    },
  );
}

  // Start the global round timer when the first participant joins.
  if (!roundsStarted) {
    roundsStarted = true;
    rounds.start();
  
    console.log(
      "Game timer started: first participant joined.",
    );
  }

  adminDashboard.broadcastStats();

  console.log(
    "player joined: " +
      client.name +
      " (" +
      client.id +
      ")" +
      (
        client.participantId
          ? " participant=" +
            client.participantId
          : ""
      ),
  );

  sendToSocket(client.ws, "player_joined", {
    name: client.name,
    participantId:
      client.participantId || null,
  });

  sendInitialSnapshot(client);

  net.broadcastUserCount();
  adminDashboard.broadcastStats();
}

// ------------------------------------------------------------
// INITIAL SNAPSHOT
// ------------------------------------------------------------

function sendInitialSnapshot(client) {
  // round_info must arrive before id/user_init so the client
  // knows the active map before spawning.
  net.sendTo(client, "round_info", {
    remainMs: rounds.getRemainMs(),
    map: mapHelper.getActiveMapName(),
  });

  net.sendTo(
    client,
    "user_chat_history",
    chatStore.getRecentChats(),
  );

  net.sendTo(
    client,
    "item_list",
    items.getItemsSnapshot(),
  );

  net.sendTo(
    client,
    "monster_list",
    monsters.getMonstersSnapshot(),
  );

  net.sendTo(client, "id", client.id);
}

// ------------------------------------------------------------
// REMOVE PLAYER
// ------------------------------------------------------------

function removeJoinedClient(client) {
  if (!client || client._removed) {
    return;
  }

  client._removed = true;

  console.log(
    "user " +
      client.id +
      " disconnected" +
      (
        client.participantId
          ? " participant=" +
            client.participantId
          : ""
      ),
  );

    if (
    client.participantId &&
    participantSessions.get(
      client.participantId,
    )?.client === client
  ) {
    participantSessions.delete(
      client.participantId,
    );
  }
  
  delete state.clients[client.id];

  

  const index =
    state.clients.indexOf(client.id);

  if (index >= 0) {
    state.clients.splice(index, 1);
  }

  state.userCount--;
  adminDashboard.broadcastStats();

  if (state.userCount < 0) {
    state.userCount = 0;
  }

  net.broadcastUserCount();

  net.sendAll("user_disconnected", {
    id: client.id,
  });

  adminDashboard.broadcastStats();
}

// ------------------------------------------------------------
// SOCKET HELPERS
// ------------------------------------------------------------

function sendToSocket(ws, type, data) {
  if (ws.readyState === 1) {
    ws.send(
      JSON.stringify({
        type: type,
        data: data,
      }),
    );
  }
}

// ------------------------------------------------------------
// PLAYER SNAPSHOT
// ------------------------------------------------------------

function buildPlayerSnapshot(player) {
  return {
    id: player.id,

    name: player.name,

    x: player.x,
    y: player.y,

    speedX: player.speedX,
    speedY: player.speedY,

    direction: player.direction,

    character: player.character,
    weapon: player.weapon,

    hp: player.hp,

    kill: player.kill,
    death: player.death,

    protectedMs:
      combat.getProtectedMs(player),
  };
}

// ------------------------------------------------------------
// GAME MESSAGE ROUTING
// ------------------------------------------------------------

function handleMessage(
  client,
  msg,
  rawMessage,
) {
  const id = client.id;

  switch (msg.type) {
    case "echo":
      if (client.ws.readyState === 1) {
        client.ws.send(rawMessage);
      }
      break;

    case "user_init": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      if (
        !isFiniteNumber(data.x) ||
        !isFiniteNumber(data.y) ||
        !isFiniteNumber(data.speedX) ||
        !isFiniteNumber(data.speedY) ||
        !isFiniteNumber(data.direction)
      ) {
        return;
      }

      client.x = data.x;
      client.y = data.y;
      client.speedX = data.speedX;
      client.speedY = data.speedY;

      // The name is fixed when authentication succeeds.
      client.direction =
        data.direction;

      client.character =
        data.character;

      client.weapon =
        data.weapon;

      client.hp = 100.0;

      combat.grantSpawnProtection(
        client,
      );

      net.sendAll(
        "user_connected",
        buildPlayerSnapshot(client),
      );

      state.forEachPlayer(
        state.clients,
        function (other) {
          net.sendTo(
            client,
            "user_connected",
            buildPlayerSnapshot(other),
          );
        },
      );

      state.forEachPlayer(
        state.aiPlayers,
        function (aiPlayer) {
          net.sendTo(
            client,
            "user_connected",
            buildPlayerSnapshot(
              aiPlayer,
            ),
          );
        },
      );

      break;
    }

    case "user_position": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      if (
        !isFiniteNumber(data.x) ||
        !isFiniteNumber(data.y)
      ) {
        return;
      }

      client.x = data.x;
      client.y = data.y;

      if (
        client.speedX === 0 &&
        client.speedY === 0
      ) {
        net.sendAll(
          "user_position",
          {
            id: id,
            x: client.x,
            y: client.y,
          },
        );
      }

      break;
    }

    case "user_speed": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      if (
        !isFiniteNumber(data.speedX) ||
        !isFiniteNumber(data.speedY)
      ) {
        return;
      }

      client.speedX = data.speedX;
      client.speedY = data.speedY;

      net.sendAll("user_speed", {
        id: id,
        speedX: client.speedX,
        speedY: client.speedY,
      });

      break;
    }

    case "user_name":
      // Player names are fixed by authenticated join.
      net.sendTo(client, "user_name", {
        id: id,
        name: client.name,
      });
      break;

    case "user_chat": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      if (
        typeof data.chat !== "string"
      ) {
        return;
      }

      const chat =
        data.chat
          .slice(0, 500)
          .replace(/</gi, "&lt;")
          .replace(/>/gi, "&gt;");

      if (chat.charAt(0) === "/") {
        // Reserved for server commands.
        break;
      }

      const chatData = {
        id: id,
        name: client.name,
        chat: chat,
        date: Date.now(),
      };

      net.sendAll(
        "user_chat",
        chatData,
      );

      chatStore.append(chatData);

      break;
    }

    case "user_direction": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      if (
        !isFiniteNumber(data.direction)
      ) {
        return;
      }

      client.direction =
        data.direction;

      net.sendAll(
        "user_direction",
        {
          id: id,
          direction:
            client.direction,
        },
      );

      break;
    }

    case "user_character": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      client.character =
        data.character;

      net.sendAll(
        "user_character",
        {
          id: id,
          character:
            client.character,
        },
      );

      break;
    }

    case "user_weapon": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      client.weapon =
        data.weapon;

      net.sendAll(
        "user_weapon",
        {
          id: id,
          weapon: client.weapon,
        },
      );

      break;
    }

    case "user_shoot": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      if (
        !data.muzzlePoint ||
        !isFiniteNumber(
          data.muzzlePoint.x,
        ) ||
        !isFiniteNumber(
          data.muzzlePoint.y,
        )
      ) {
        return;
      }

      if (
        !isFiniteNumber(data.angle)
      ) {
        return;
      }

      const targetPoints =
        Array.isArray(
          data.targetPoints,
        )
          ? data.targetPoints
          : data.targetPoint
            ? [data.targetPoint]
            : [];

      if (
        targetPoints.length === 0 ||
        targetPoints.length > 20
      ) {
        return;
      }

      for (
        let i = 0;
        i < targetPoints.length;
        i++
      ) {
        const point =
          targetPoints[i];

        if (
          !point ||
          !isFiniteNumber(point.x) ||
          !isFiniteNumber(point.y)
        ) {
          return;
        }
      }

      for (
        let i = 0;
        i < targetPoints.length;
        i++
      ) {
        combat.shootProcess(
          id,
          data.weapon,
          "user",
          data.muzzlePoint.x,
          data.muzzlePoint.y,
          targetPoints[i].x,
          targetPoints[i].y,
        );
      }

      net.sendAll(
        "user_shoot",
        {
          id: id,
          weapon: data.weapon,
          muzzlePoint:
            data.muzzlePoint,
          targetPoints:
            targetPoints,
          angle: data.angle,
        },
      );

      break;
    }

    case "user_melee_attack": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      combat.meleeAttackProcess(
        id,
        "user",
        data.weapon,
      );

      net.sendAll(
        "user_melee_attack",
        {
          id: id,
          weapon: data.weapon,
        },
      );

      break;
    }

    case "user_reload": {
      const data =
        msg.data &&
        typeof msg.data === "object"
          ? msg.data
          : {};

      net.sendAll(
        "user_reload",
        {
          id: id,
          weapon: data.weapon,
        },
      );

      break;
    }

    case "user_disconnected":
      // The actual WebSocket close event controls
      // server-side removal. Do not trust the client
      // to disconnect another user.
      break;

    default:
      break;
  }
}

// ------------------------------------------------------------
// NUMBER VALIDATION
// ------------------------------------------------------------

function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

// ------------------------------------------------------------
// ROUND CALLBACKS
// ------------------------------------------------------------

rounds.onRoundEnd(function () {
  items.resetForNewMap();
  monsters.resetForNewMap();
});

// ------------------------------------------------------------
// START SUBSYSTEMS
// ------------------------------------------------------------

items.start();
monsters.start();
