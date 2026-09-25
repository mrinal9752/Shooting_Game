// Always connect to the server that is hosting this copy of the game.
// - Local/LAN testing: http://HOST:8000 -> ws://HOST:8081
// - Public deployment: HTTPS reverse proxy -> wss://YOUR-DOMAIN/ws
"use strict";

// Public game WebSocket server.
const wsUri = "wss://shooting-game-i5f4.onrender.com";

class NetworkClass {

  constructor() {
    this.isConnected = false;
    this.reconnectCount = 0;
    this.latency = 0;
    this.playerName = undefined;
  
    // Remember participant login on this device/browser.
    this.savedLogin = this.loadSavedLogin();
    this.joinAttempting = false;
  
    // Reduce network traffic.
    this.positionSendInterval = 1000 / 15;
    this.directionSendInterval = 1000 / 15;
    this.lastPositionSentAt = 0;
    this.lastDirectionSentAt = 0;
  
    // Lightweight reconnect strategy.
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 15000;
    this.reconnectTimer = undefined;
    this.latencyTimer = undefined;
  
    this.joinGate = new JoinGateClass(this);
    this.initializeWebSocket();
  }

  getLatency() {
    return this.latency;
  }

  initializeWebSocket() {
    var self = this;
    this.webSocket = new WebSocket(wsUri);
    this.webSocket.onopen = function (evt) {
      self.onOpen(evt);
    };
    this.webSocket.onclose = function (evt) {
      self.onClose(evt);
    };
    this.webSocket.onmessage = function (evt) {
      self.onMessage(evt);
    };
    this.webSocket.onerror = function (evt) {
      self.onError(evt);
    };
  }

  checkLatency(self) {
    if (self.isConnected) {
      self.webSocket.send(
        JSON.stringify({ type: "echo", data: { tick: performance.now() } }),
      );
    }
  }

  getIsConnected() {
    return this.isConnected;
  }

  getPlayerName() {
    return this.playerName;
  }

  loadSavedLogin() {
  try {
    const raw = localStorage.getItem("flux_recruitment_session_v1");
    if (!raw) {
      return null;
    }

    const data = JSON.parse(raw);

    if (!data || !data.participantId || !data.accessCode || !data.name) {
      return null;
    }

    return {
      participantId: String(data.participantId),
      accessCode: String(data.accessCode),
      name: String(data.name),
    };
  } catch (e) {
    return null;
  }
}

saveLogin(name, participantId, accessCode) {
  const session = {
    name: String(name).trim(),
    participantId: String(participantId).trim().toUpperCase(),
    accessCode: String(accessCode).trim(),
  };

  this.savedLogin = session;

  try {
    localStorage.setItem(
      "flux_recruitment_session_v1",
      JSON.stringify(session),
    );
  } catch (e) {
    // Ignore storage errors.
  }
}

clearSavedLogin() {
  this.savedLogin = null;

  try {
    localStorage.removeItem("flux_recruitment_session_v1");
  } catch (e) {
    // Ignore storage errors.
  }
}

scheduleReconnect() {
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
  }

  const delay = this.reconnectDelay;

  this.reconnectDelay = Math.min(
    Math.ceil(this.reconnectDelay * 1.8),
    this.maxReconnectDelay,
  );

  const self = this;

  this.reconnectTimer = setTimeout(function () {
    self.initializeWebSocket();
  }, delay);
}

scheduleLatencyCheck() {
  if (this.latencyTimer) {
    clearTimeout(this.latencyTimer);
  }

  const self = this;

  this.latencyTimer = setTimeout(function () {
    self.checkLatency(self);
  }, 5000);
}

autoJoinSavedLogin() {
  if (!this.savedLogin) {
    return false;
  }

  this.joinAttempting = true;

  this.joinGame(
    this.savedLogin.name,
    this.savedLogin.participantId,
    this.savedLogin.accessCode,
    true,
  );

  return true;
}

  onOpen(e) {
    this.isConnected = true;
  
    if (this.connected) {
      this.connected();
    }
  
    const self = this;
  
    setTimeout(function () {
      if (!self.autoJoinSavedLogin()) {
        self.scheduleLatencyCheck();
      }
    }, 50);
  }

  onClose(e) {
    if (this.isConnected) {
      this.isConnected = false;
  
      if (this.disconnected) {
        this.disconnected();
      }
    }
  
    this.reconnectCount++;
  
    if (this.tryreconnect) {
      this.tryreconnect(this.reconnectCount);
    }
  
    this.playerName = undefined;
    this.joinAttempting = false;
  
    // Do NOT clear saved participant login.
    this.joinGate.showConnecting();
  
    this.scheduleReconnect();
  }

  onMessage(e) {
    var msg = JSON.parse(e.data);
    //console.log(e.data);
    switch (msg.type) {
      case "player_login_required":
        // Automatically reuse the saved participant login.
        if (this.savedLogin && !this.joinAttempting) {
          this.autoJoinSavedLogin();
        } else if (!this.savedLogin) {
          this.joinGate.showLogin();
        }
        break;
      
      case "player_joined":
        this.joinAttempting = false;
        this.playerName = msg.data.name;
      
        if (this.savedLogin) {
          this.saveLogin(
            msg.data.name,
            this.savedLogin.participantId,
            this.savedLogin.accessCode,
          );
        }
      
        // Successful connection: reset reconnect backoff.
        this.reconnectDelay = 1000;
        this.reconnectCount = 0;
      
        this.scheduleLatencyCheck();
        this.joinGate.showJoined();
        break;
      
      case "player_join_error": {
        this.joinAttempting = false;
      
        const message =
          msg.data && msg.data.message
            ? String(msg.data.message)
            : "Unable to join the game.";
      
        // Only forget the login when the credentials themselves are invalid.
        if (/invalid participant id or access code/i.test(message)) {
          this.clearSavedLogin();
        }
      
        this.joinGate.showError(message);
        break;
      }
      
      case "echo":
        if (msg.data.tick) {
          const now = performance.now();
          this.latency = Math.floor(now - msg.data.tick);
          this.scheduleLatencyCheck();
        }
        break;
      case "id":
        if (this.assignedid) {
          this.assignedid(msg.data);
        }
        break;
      case "user_connected":
        if (this.userconnected) {
          this.userconnected(
            msg.data.id,
            msg.data.name,
            msg.data.x,
            msg.data.y,
            msg.data.speedX,
            msg.data.speedY,
            msg.data.direction,
            msg.data.character,
            msg.data.weapon,
            msg.data.hp,
            msg.data.kill,
            msg.data.death,
            msg.data.protectedMs,
          );
        }
        break;
      case "user_disconnected":
        if (this.userdisconnected) {
          this.userdisconnected(msg.data.id);
        }
        break;
      case "user_count":
        if (this.usercountchanged) {
          this.usercountchanged(msg.data);
        }
        break;
      case "user_name":
        if (this.usernamechanged) {
          this.usernamechanged(msg.data.id, msg.data.name);
        }
        break;
      case "user_chat":
        if (this.userchat) {
          this.userchat(msg.data.id, msg.data.chat);
        }
        break;
      case "user_chat_history":
        if (this.userchathistory) {
          this.userchathistory(msg.data);
        }
        break;
      case "user_speed":
        if (this.userspeedchanged) {
          this.userspeedchanged(msg.data.id, msg.data.speedX, msg.data.speedY);
        }
        break;
      case "user_position":
        if (this.userpositionchanged) {
          this.userpositionchanged(msg.data.id, msg.data.x, msg.data.y);
        }
        break;
      case "user_direction":
        if (this.userdirectionchanged) {
          this.userdirectionchanged(msg.data.id, msg.data.direction);
        }
        break;
      case "user_character":
        if (this.usercharacterchanged) {
          this.usercharacterchanged(msg.data.id, msg.data.character);
        }
        break;
      case "user_weapon":
        if (this.userweaponchanged) {
          this.userweaponchanged(msg.data.id, msg.data.weapon);
        }
        break;
      case "user_shoot":
        if (this.usershoot) {
          this.usershoot(
            msg.data.id,
            msg.data.weapon,
            msg.data.muzzlePoint,
            msg.data.targetPoints,
            msg.data.angle,
          );
        }
        break;
      case "user_melee_attack":
        if (this.usermeleeattack) {
          this.usermeleeattack(msg.data.id, msg.data.weapon);
        }
        break;
      case "user_reload":
        if (this.userreload) {
          this.userreload(msg.data.id, msg.data.weapon);
        }
        break;
      case "item_list":
        if (this.itemlist) {
          this.itemlist(msg.data);
        }
        break;
      case "item_spawn":
        if (this.itemspawn) {
          this.itemspawn(msg.data);
        }
        break;
      case "item_picked":
        if (this.itempicked) {
          this.itempicked(msg.data.id, msg.data.by, msg.data.type);
        }
        break;
      case "ammo_refill":
        if (this.ammorefill) {
          this.ammorefill();
        }
        break;
      case "monster_list":
        if (this.monsterlist) {
          this.monsterlist(msg.data);
        }
        break;
      case "monster_spawn":
        if (this.monsterspawn) {
          this.monsterspawn(msg.data);
        }
        break;
      case "monster_positions":
        if (this.monsterpositions) {
          this.monsterpositions(msg.data);
        }
        break;
      case "monster_hp":
        if (this.monsterhp) {
          this.monsterhp(msg.data.id, msg.data.hp);
        }
        break;
      case "monster_attack":
        if (this.monsterattack) {
          this.monsterattack(msg.data.id);
        }
        break;
      case "monster_die":
        if (this.monsterdie) {
          this.monsterdie(msg.data.id);
        }
        break;
      case "round_info":
        if (this.roundinfo) {
          this.roundinfo(msg.data.remainMs, msg.data.map);
        }
        break;
      case "server_notice":
        if (this.servernotice) {
          this.servernotice(msg.data.key, msg.data.params);
        }
        break;
      case "user_hp":
        if (this.userhpchanged) {
          this.userhpchanged(msg.data.id, msg.data.hp);
        }
        break;
      case "user_die":
        if (this.userdie) {
          this.userdie(msg.data.id, msg.data.reason);
        }
        break;
      case "user_kill":
        if (this.userkillchanged) {
          this.userkillchanged(msg.data.id, msg.data.kill);
        }
        break;
      case "user_death":
        if (this.userdeathchanged) {
          this.userdeathchanged(msg.data.id, msg.data.death);
        }
        break;
    }
  }

  onError(e) {
    this.webSocket.close();
    console.log(e);
  }

  sendChat(chat) {
    this.webSocket.send(
      JSON.stringify({ type: "user_chat", data: { chat: chat } }),
    );
  }

joinGame(name, participantId, accessCode, isAutoJoin) {
  if (
    !this.webSocket ||
    this.webSocket.readyState !== WebSocket.OPEN
  ) {
    this.joinGate.showError(
      "The game server is not ready. Please wait a moment.",
    );
    return;
  }

  if (!name || !participantId || !accessCode) {
    this.joinGate.showError(
      "Participant ID, access code and name are required.",
    );
    return;
  }

  this.saveLogin(name, participantId, accessCode);
  this.joinAttempting = true;

  this.webSocket.send(
    JSON.stringify({
      type: "player_join",
      data: {
        name: name,
        participantId: participantId,
        accessCode: accessCode,
      },
    }),
  );
}

  sendNameChanged(name) {
    this.webSocket.send(
      JSON.stringify({ type: "user_name", data: { name: name } }),
    );
  }

  sendSpeedChanged(speedX, speedY) {
    this.webSocket.send(
      JSON.stringify({
        type: "user_speed",
        data: { speedX: speedX, speedY: speedY },
      }),
    );
  }

  sendPositionChanged(x, y, force) {
    const now = performance.now();
  
    if (
      !force &&
      now - this.lastPositionSentAt < this.positionSendInterval
    ) {
      return;
    }
  
    this.lastPositionSentAt = now;
  
    this.webSocket.send(
      JSON.stringify({
        type: "user_position",
        data: {
          x: x,
          y: y,
        },
      }),
    );
  }

  sendCharacterChanged(character) {
    this.webSocket.send(
      JSON.stringify({
        type: "user_character",
        data: { character: character },
      }),
    );
  }

  sendDirectionChanged(direction) {
    const now = performance.now();
  
    if (
      now - this.lastDirectionSentAt <
      this.directionSendInterval
    ) {
      return;
    }
  
    this.lastDirectionSentAt = now;
  
    this.webSocket.send(
      JSON.stringify({
        type: "user_direction",
        data: {
          direction: direction,
        },
      }),
    );
  }

  sendWeaponChanged(weapon) {
    this.webSocket.send(
      JSON.stringify({ type: "user_weapon", data: { weapon: weapon } }),
    );
  }

  sendShoot(weapon, muzzlePoint, targetPoints, angle) {
    this.webSocket.send(
      JSON.stringify({
        type: "user_shoot",
        data: {
          weapon: weapon,
          muzzlePoint: muzzlePoint,
          targetPoints: targetPoints,
          angle: angle,
        },
      }),
    );
  }

  sendMeleeAttack(weapon) {
    this.webSocket.send(
      JSON.stringify({
        type: "user_melee_attack",
        data: {
          weapon: weapon,
        },
      }),
    );
  }

  sendReload(weapon) {
    this.webSocket.send(
      JSON.stringify({ type: "user_reload", data: { weapon: weapon } }),
    );
  }

  sendUserInit(playerClass) {
    if (playerClass) {
      this.webSocket.send(
        JSON.stringify({
          type: "user_init",
          data: {
            name: playerClass.getName(),
            x: playerClass.getPositionX(),
            y: playerClass.getPositionY(),
            speedX: playerClass.getSpeedX(),
            speedY: playerClass.getSpeedY(),
            direction: playerClass.getDirection(),
            character: playerClass.getCharacter(),
            weapon: playerClass.getWeapon(),
            hp: playerClass.getHp(),
          },
        }),
      );
    }
  }
}
