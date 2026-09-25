"use strict";

// ============================================================================
// ZOMBIE / PVE MONSTER SYSTEM
// ============================================================================
//
// - Zombies are 100% server-authoritative.
// - Only real human participants are targets.
// - AI player bots are completely removed from this system.
// - First invasion starts immediately when the server starts.
// - Future invasions continue on the configured schedule.
// ============================================================================

const config = require("./config");
const state = require("./state");
const net = require("./net");
const rounds = require("./rounds");
const combat = require("./combat");
const adminDashboard = require("./admin-dashboard");

const {
  getWalkableRandomPosition,
  setDestinationPath,
  isWalkablePosition,
} = require("./map-helper");

const { getDistance } = require("./utils");

const monsters = state.monsters;

let monsterIdCount = 0;

// ============================================================================
// INVASION STATE
// ============================================================================

let invasionActive = false;
let invasionEndTime = 0;
let spawnedAllWaves = false;

// Ensures the first invasion starts automatically when
// the first real participant joins.
let firstInvasionStarted = false;

// ============================================================================
// SPAWN / REMOVE / DAMAGE
// ============================================================================

function getMonsterSpawnPosition() {
  for (let attempt = 0; attempt < 24; attempt++) {
    const position = getWalkableRandomPosition();

    let tooClose = false;

    state.forEachPlayer(
      state.clients,
      function (player) {
        if (
          player.hp > 0 &&
          getDistance(
            position.x,
            position.y,
            player.x,
            player.y,
          ) < config.MONSTER_SPAWN_MIN_DISTANCE
        ) {
          tooClose = true;
        }
      },
    );

    if (!tooClose) {
      return position;
    }
  }

  return getWalkableRandomPosition();
}

function spawnMonster() {
  if (
    state.countPlayers(monsters) >=
    config.INVASION_MAX_ALIVE
  ) {
    return;
  }

  const position = getMonsterSpawnPosition();

  const id =
    "MONSTER_" +
    monsterIdCount++;

  const monster = {
    id: id,

    x: position.x,
    y: position.y,

    width: 32,
    height: 32,

    hp: config.MONSTER_HP,
    maxHp: config.MONSTER_HP,

    direction:
      Math.random() * 360 - 180,

    destinationX: position.x,
    destinationY: position.y,

    movingPath: [],
    currentMovingPathIndex: 0,
    isPathMovingActive: false,

    lastAttackTime: 0,
    lastRepathTime: 0,
  };

  // Called by combat.shootProcess() when a player shoots this monster.
  monster.takeDamage = function (
    damage,
    shooterId,
  ) {
    damageMonster(
      monster,
      damage,
      shooterId,
    );
  };

  monsters[id] = monster;
  monsters.push(id);

  net.sendAll("monster_spawn", {
    id: monster.id,
    x: Math.round(monster.x),
    y: Math.round(monster.y),
    hp: monster.hp,
    maxHp: monster.maxHp,
    direction: Math.round(
      monster.direction,
    ),
  });
}

function removeMonster(id) {
  if (!monsters[id]) {
    return;
  }

  delete monsters[id];

  const index = monsters.indexOf(id);

  if (index >= 0) {
    monsters.splice(index, 1);
  }
}

function damageMonster(
  monster,
  damage,
  shooterId,
) {
  if (monster.hp <= 0) {
    return;
  }

  if (
    typeof damage !== "number" ||
    !Number.isFinite(damage) ||
    damage <= 0
  ) {
    return;
  }

  monster.hp -= damage;

  if (monster.hp > 0) {
    net.sendAll("monster_hp", {
      id: monster.id,
      hp: monster.hp,
    });

    return;
  }

  killMonster(
    monster,
    shooterId,
  );
}

function killMonster(
  monster,
  shooterId,
) {
  removeMonster(monster.id);

  net.sendAll("monster_die", {
    id: monster.id,
  });

  // Only real participants can receive zombie kill credit.
  const killer = shooterId
    ? state.clients[shooterId]
    : undefined;

  if (killer && killer.hp > 0) {
    killer.kill +=
      config.MONSTER_KILL_SCORE;

    killer.zombieKills =
      (killer.zombieKills || 0) + 1;

    killer.zombiePoints =
      (killer.zombiePoints || 0) +
      config.MONSTER_KILL_SCORE;

    adminDashboard.broadcastStats();

    net.sendAll("user_kill", {
      id: killer.id,
      kill: killer.kill,
    });

    killer.streak =
      (killer.streak || 0) + 1;

    rounds.announceKill(
      killer,
      monster,
      0,
    );
  }

  checkInvasionCleared();
}

// ============================================================================
// TARGETING
// ============================================================================

// Find the nearest living HUMAN participant.
// AI players have been removed.
function getLiveTargets() {
  const targets = [];

  state.forEachPlayer(
    state.clients,
    function (player) {
      if (player && player.hp > 0) {
        targets.push(player);
      }
    },
  );

  return targets;
}

function findBalancedTarget(monster, targets) {
  if (!targets || targets.length === 0) {
    return undefined;
  }

  // Keep following the current target while they are alive.
  if (monster.targetId) {
    for (let i = 0; i < targets.length; i++) {
      if (targets[i].id === monster.targetId) {
        return targets[i];
      }
    }
  }

  // Spread monsters across players.
  // Monster number is used to choose a stable player index.
  const match = String(monster.id).match(/(\d+)$/);
  const monsterNumber = match
    ? parseInt(match[1], 10)
    : 0;

  const targetIndex =
    monsterNumber % targets.length;

  const target = targets[targetIndex];

  monster.targetId = target.id;

  return target;
}

// ============================================================================
// MOVEMENT
// ============================================================================

function canMonsterMoveTo(monster, x, y) {
  const padding = 2;

  return (
    isWalkablePosition(
      x + padding,
      y + padding,
    ) &&
    isWalkablePosition(
      x + monster.width - padding,
      y + padding,
    ) &&
    isWalkablePosition(
      x + padding,
      y + monster.height - padding,
    ) &&
    isWalkablePosition(
      x + monster.width - padding,
      y + monster.height - padding,
    )
  );
}

function stepMonster(monster) {
  const speed =
    Number(config.MONSTER_MOVE_SPEED) || 5;

  const dx =
    monster.destinationX -
    monster.x;

  const dy =
    monster.destinationY -
    monster.y;

  const distance =
    Math.sqrt(
      dx * dx +
      dy * dy,
    );

  // No movement required.
  if (distance <= 0.001) {
    if (
      monster.isPathMovingActive &&
      monster.currentMovingPathIndex + 1 <
        monster.movingPath.length
    ) {
      monster.currentMovingPathIndex++;

      monster.destinationX =
        monster.movingPath[
          monster.currentMovingPathIndex
        ].x;

      monster.destinationY =
        monster.movingPath[
          monster.currentMovingPathIndex
        ].y;

      return;
    }

    monster.isPathMovingActive = false;
    return;
  }

  // Reached current waypoint.
  if (distance <= speed) {
    monster.x =
      monster.destinationX;

    monster.y =
      monster.destinationY;

    if (
      monster.isPathMovingActive &&
      monster.currentMovingPathIndex + 1 <
        monster.movingPath.length
    ) {
      monster.currentMovingPathIndex++;

      monster.destinationX =
        monster.movingPath[
          monster.currentMovingPathIndex
        ].x;

      monster.destinationY =
        monster.movingPath[
          monster.currentMovingPathIndex
        ].y;

      return;
    }

    monster.isPathMovingActive = false;
    return;
  }

  // Move smoothly toward the waypoint.
  const ratio =
    speed / distance;

  monster.x += dx * ratio;
  monster.y += dy * ratio;

  monster.direction =
    (Math.atan2(dy, dx) /
      Math.PI) *
    180;
}

// ============================================================================
// MONSTER SEPARATION
// ============================================================================

function separate(monster) {
  let pushX = 0;
  let pushY = 0;

  const centerX =
    monster.x +
    monster.width / 2;

  const centerY =
    monster.y +
    monster.height / 2;

  state.forEachPlayer(
    monsters,
    function (other) {
      if (other.id === monster.id) {
        return;
      }

      const distance = getDistance(
        centerX,
        centerY,
        other.x + other.width / 2,
        other.y + other.height / 2,
      );

      if (
        distance >=
          config.MONSTER_BODY_DISTANCE ||
        distance < 0.001
      ) {
        return;
      }

      const angle = Math.atan2(
        centerY -
          (other.y + other.height / 2),
        centerX -
          (other.x + other.width / 2),
      );

      const strength =
        (config.MONSTER_BODY_DISTANCE -
          distance) /
        2;

      pushX +=
        Math.cos(angle) *
        strength;

      pushY +=
        Math.sin(angle) *
        strength;
    },
  );

  if (
    pushX === 0 &&
    pushY === 0
  ) {
    return;
  }

  const newX =
    monster.x + pushX;

  const newY =
    monster.y + pushY;

  if (
    isWalkablePosition(
      newX +
        monster.width / 2,
      newY +
        monster.height / 2,
    )
  ) {
    monster.x = newX;
    monster.y = newY;
  }
}

// ============================================================================
// MONSTER PROCESSING
// ============================================================================

function processMonster(
  monster,
  now,
  targets,
) {
  const target =
    findBalancedTarget(
      monster,
      targets,
    );

  if (!target) {
    return;
  }

  const centerX =
    monster.x +
    monster.width / 2;

  const centerY =
    monster.y +
    monster.height / 2;

  const targetX =
    target.x +
    target.width / 2;

  const targetY =
    target.y +
    target.height / 2;

  const distance =
    getDistance(
      centerX,
      centerY,
      targetX,
      targetY,
    );

  // --------------------------------------------------------------------------
  // ATTACK
  // --------------------------------------------------------------------------

  if (
    distance <=
    config.MONSTER_ATTACK_RANGE
  ) {
    monster.destinationX =
      monster.x;

    monster.destinationY =
      monster.y;

    monster.isPathMovingActive =
      false;

    monster.direction =
      (Math.atan2(
        targetY - centerY,
        targetX - centerX,
      ) /
        Math.PI) *
      180;

    if (
      now -
        monster.lastAttackTime >=
      config.MONSTER_ATTACK_INTERVAL
    ) {
      monster.lastAttackTime = now;

      net.sendAll(
        "monster_attack",
        {
          id: monster.id,
        },
      );

      combat.applyDamage(
        target,
        config.MONSTER_ATTACK_DAMAGE,
        "monster",
        monster.id,
        "melee",
      );
    }

    return;
  }

  // --------------------------------------------------------------------------
  // CHASE
  // --------------------------------------------------------------------------

  if (
    now -
      monster.lastRepathTime >=
      config.MONSTER_REPATH_INTERVAL ||
    !monster.isPathMovingActive
  ) {
    monster.lastRepathTime = now;

    setDestinationPath(
      monster,
      {
        x: targetX,
        y: targetY,
      },
    );

    // If A* produces no usable path, move directly.
    if (
      !monster.movingPath ||
      monster.movingPath.length === 0
    ) {
      monster.destinationX =
        targetX;

      monster.destinationY =
        targetY;

      monster.isPathMovingActive =
        false;
    }
  }

  stepMonster(monster);
}

// ============================================================================
// INVASION
// ============================================================================

function combatantCount() {
  // Only real human participants.
  return state.userCount;
}

function spawnWave(index) {
  if (!invasionActive) {
    return;
  }

  const count =
    config.INVASION_BASE_COUNT +
    combatantCount() *
      config.INVASION_PER_COMBATANT;

  for (
    let i = 0;
    i < count;
    i++
  ) {
    spawnMonster();
  }

  if (
    index + 1 <
    config.INVASION_WAVES
  ) {
    setTimeout(
      function () {
        spawnWave(index + 1);
      },
      config.INVASION_WAVE_INTERVAL,
    );
  } else {
    spawnedAllWaves = true;
  }
}

function startInvasion() {
  if (invasionActive) {
    return;
  }

  // Don't start an invasion with nobody connected.
  if (state.userCount <= 0) {
    return;
  }

  invasionActive = true;
  spawnedAllWaves = false;

  invasionEndTime =
    Date.now() +
    config.INVASION_WARN_DELAY +
    config.INVASION_DURATION_MAX;

  net.sendServerNotice(
    "invasion_incoming",
    {},
  );

  setTimeout(
    function () {
      if (
        invasionActive &&
        state.userCount > 0
      ) {
        spawnWave(0);
      }
    },
    config.INVASION_WARN_DELAY,
  );
}

function clearAllMonsters() {
  const ids = monsters.slice();

  for (
    let i = 0;
    i < ids.length;
    i++
  ) {
    removeMonster(ids[i]);

    net.sendAll(
      "monster_die",
      {
        id: ids[i],
      },
    );
  }
}

function endInvasion(cleared) {
  if (!invasionActive) {
    return;
  }

  invasionActive = false;
  spawnedAllWaves = false;

  clearAllMonsters();

  if (cleared) {
    net.sendServerNotice(
      "invasion_cleared",
      {},
    );
  }
}

function checkInvasionCleared() {
  if (
    invasionActive &&
    spawnedAllWaves &&
    state.countPlayers(monsters) === 0
  ) {
    endInvasion(true);
  }
}

function scheduleNextInvasion() {
  const delay =
    config.INVASION_INTERVAL_MIN +
    Math.random() *
      (
        config.INVASION_INTERVAL_MAX -
        config.INVASION_INTERVAL_MIN
      );

  setTimeout(
    function () {
      startInvasion();
      scheduleNextInvasion();
    },
    delay,
  );
}

// ============================================================================
// SNAPSHOT
// ============================================================================

function getMonstersSnapshot() {
  const list = [];

  state.forEachPlayer(
    monsters,
    function (monster) {
      list.push({
        id: monster.id,
        x: Math.round(monster.x),
        y: Math.round(monster.y),
        hp: monster.hp,
        maxHp: monster.maxHp,
        direction: Math.round(
          monster.direction,
        ),
      });
    },
  );

  return list;
}

// ============================================================================
// NEW MAP
// ============================================================================

function resetForNewMap() {
  clearAllMonsters();
}

// ============================================================================
// START
// ============================================================================

// ============================================================================
// START
// ============================================================================

function start() {
  // ------------------------------------------------------------
  // Watch for the first real participant.
  // Start the first zombie invasion when someone joins.
  // ------------------------------------------------------------
  setInterval(function () {
    if (state.userCount > 0 && !firstInvasionStarted) {
      firstInvasionStarted = true;

      console.log(
        "First participant detected: starting zombie invasion.",
      );

      startInvasion();
    }
  }, 500);

  // ------------------------------------------------------------
  // Keep future invasions scheduled.
  // ------------------------------------------------------------
  scheduleNextInvasion();

  // ------------------------------------------------------------
  // ZOMBIE SERVER SIMULATION
  // ------------------------------------------------------------
  // Zombie movement + attacks = 30 FPS
  // Network position snapshots = 20 FPS
  //
  // This keeps zombie movement smooth while reducing
  // unnecessary network traffic.
  // ------------------------------------------------------------

  const SIMULATION_HZ = 30;
  const NETWORK_HZ = 20;
  const NETWORK_INTERVAL = 1000 / NETWORK_HZ;

  let lastNetworkSend = 0;

  setInterval(function () {
    const now = Date.now();

    // End invasion when its maximum duration is reached.
    if (invasionActive && now >= invasionEndTime) {
      endInvasion(false);
    }

    // Nothing to simulate if there are no zombies.
    if (state.countPlayers(monsters) === 0) {
      return;
    }

    // Only real human participants are targets.
    const targets = getLiveTargets();

    // ----------------------------------------------------------
    // 1. UPDATE EVERY ZOMBIE
    // ----------------------------------------------------------

    state.forEachPlayer(
      monsters,
      function (monster) {
        processMonster(
          monster,
          now,
          targets,
        );
      },
    );

    // ----------------------------------------------------------
    // 2. SEND NETWORK SNAPSHOT AT 20 FPS
    // ----------------------------------------------------------

    if (now - lastNetworkSend < NETWORK_INTERVAL) {
      return;
    }

    lastNetworkSend = now;

    const positions = [];

    state.forEachPlayer(
      monsters,
      function (monster) {
        positions.push({
          id: monster.id,
          x: Math.round(monster.x),
          y: Math.round(monster.y),
          direction: Math.round(monster.direction),
        });
      },
    );

    if (positions.length > 0) {
      net.sendAll(
        "monster_positions",
        positions,
      );
    }
  }, 1000 / SIMULATION_HZ);
}

module.exports = {
  start,
  getMonstersSnapshot,
  resetForNewMap,
};
