"use strict";

// 라운드 시스템(주기적 우승자 발표 + 전적 리셋)과 킬스트릭 공지를 담당한다.
// 공지는 문자열이 아니라 server_notice(key + params)로 보내고,
// 클라이언트(locale_class.js)가 사용자의 언어 설정에 맞춰 렌더링한다.

const config = require("./config");
const state = require("./state");
const net = require("./net");
const mapHelper = require("./map-helper");

// IMPORTANT:
// Timer must NOT start when the server starts.
// It starts only when rounds.start() is called by the first participant.
let roundEndTime = null;
let roundInfoTickCounter = 0;
let mapRotationIndex = 0;
let roundStarted = false;

// 라운드 종료(맵 교체 후)에 호출할 훅. ai/items 와의 순환 의존을 피하기 위해
// server.js 가 등록한다 (AI 리스폰, 아이템 재배치 등)
const roundEndCallbacks = [];

function onRoundEnd(callback) {
  roundEndCallbacks.push(callback);
}

function getDisplayName(player) {
  return player.name && player.name.trim() ? player.name : player.id;
}

// 킬 발생 시 킬스트릭 달성/저지 공지 (combat.applyDamage 에서 호출)
function announceKill(killer, victim, victimStreak) {
  if (config.KILLSTREAK_MILESTONES.indexOf(killer.streak) >= 0) {
    net.sendServerNotice("killstreak", {
      name: getDisplayName(killer),
      streak: killer.streak,
    });
  }

  // 3연속 킬 이상이던 플레이어가 처치되면 저지 공지
  if (victimStreak >= 3) {
    net.sendServerNotice("streak_stopped", {
      killer: getDisplayName(killer),
      victim: getDisplayName(victim),
      streak: victimStreak,
    });
  }
}

function getRemainMs() {
  // Game has not started yet
  if (!roundStarted || roundEndTime === null) {
    return 0;
  }

  return Math.max(0, roundEndTime - Date.now());
}

function broadcastRoundInfo() {
  net.sendAll("round_info", {
    remainMs: getRemainMs(),
    map: mapHelper.getActiveMapName(),
  });
}

function endRound() {
  let winner = undefined;

  function considerWinner(player) {
    if (!winner || player.kill > winner.kill) {
      winner = player;
    }
  }

  state.forEachPlayer(state.clients, considerWinner);

  // AI disabled, but left here for compatibility with the existing system.
  state.forEachPlayer(state.aiPlayers, considerWinner);

  if (winner && winner.kill > 0) {
    net.sendServerNotice("round_end_winner", {
      name: getDisplayName(winner),
      kill: winner.kill,
      death: winner.death,
    });
  } else {
    net.sendServerNotice("round_end", {});
  }

  function resetRecord(player) {
    player.streak = 0;
  }

  state.forEachPlayer(state.clients, resetRecord);
  state.forEachPlayer(state.aiPlayers, resetRecord);

  // 다음 맵으로 교체
  mapRotationIndex =
    (mapRotationIndex + 1) % config.MAP_ROTATION.length;

  const nextMapName = config.MAP_ROTATION[mapRotationIndex];

  mapHelper.setActiveMap(nextMapName);

  net.sendServerNotice("map_changed", {
    name: nextMapName,
  });

  for (let i = 0; i < roundEndCallbacks.length; i++) {
    roundEndCallbacks[i]();
  }

  // Start the next round immediately
  roundEndTime = Date.now() + config.ROUND_DURATION;
  roundInfoTickCounter = 0;

  net.sendServerNotice("round_start", {
    minutes: config.ROUND_DURATION / 60000,
  });

  broadcastRoundInfo();
}

// 라운드 타이머 시작.
// IMPORTANT: start() is called only when the first participant joins.
function start() {
  // Prevent duplicate timers / duplicate starts
  if (roundStarted) {
    return;
  }

  roundStarted = true;

  // EXACT moment the first participant starts the game
  roundEndTime = Date.now() + config.ROUND_DURATION;
  roundInfoTickCounter = 0;

  console.log(
    "ROUND TIMER STARTED:",
    config.ROUND_DURATION / 60000,
    "minutes"
  );

  // Keep server time synchronized
  setInterval(function () {
    if (!roundStarted || roundEndTime === null) {
      return;
    }

    if (Date.now() >= roundEndTime) {
      endRound();
      return;
    }

    // Every 10 seconds send remaining time to clients
    if (++roundInfoTickCounter >= 10) {
      roundInfoTickCounter = 0;
      broadcastRoundInfo();
    }
  }, 1000);
}

module.exports = {
  start,
  getRemainMs,
  announceKill,
  onRoundEnd,
};
