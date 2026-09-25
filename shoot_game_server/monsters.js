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
function findNearestTarget(monster) {
  const centerX =
    monster.x +
    monster.width / 2;

  const centerY =
    monster.y +
    monster.height / 2;

  let best = undefined;

  let bestDistance =
    config.MONSTER_SIGHT_RANGE;

  function consider(player) {
    if (player.hp <= 0) {
      return;
    }

    const distance = getDistance(
      centerX,
      centerY,
      player.x + player.width / 2,
      player.y + player.height / 2,
    );

    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }

  // HUMAN PARTICIPANTS ONLY.
  state.forEachPlayer(
    state.clients,
    consider,
  );

  return best;
}

// ============================================================================
// MOVEMENT
// ============================================================================

function stepMonster(monster) {
  if (
    monster.x !== monster.destinationX ||
    monster.y !== monster.destinationY
  ) {
    const distance = getDistance(
      monster.x,
      monster.y,
      monster.destinationX,
      monster.destinationY,
    );

    if (
      config.MONSTER_MOVE_SPEED >=
      distance
    ) {
      monster.x =
        monster.destinationX;

      monster.y =
        monster.destinationY;
    } else {
      const radian = Math.atan2(
        monster.destinationY -
          monster.y,
        monster.destinationX -
          monster.x,
      );

      monster.x +=
        Math.cos(radian) *
        config.MONSTER_MOVE_SPEED;

      monster.y +=
        Math.sin(radian) *
        config.MONSTER_MOVE_SPEED;

      monster.direction =
        (radian / Math.PI) *
        180;
    }
  } else if (
    monster.isPathMovingActive
  ) {
    monster.currentMovingPathIndex++;

    if (
      monster.currentMovingPathIndex <
      monster.movingPath.length
    ) {
      monster.destinationX =
        monster.movingPath[
          monster.currentMovingPathIndex
        ].x;

      monster.destinationY =
        monster.movingPath[
          monster.currentMovingPathIndex
        ].y;
    } else {
      monster.isPathMovingActive =
        false;
    }
  }
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
) {
  const target =
    findNearestTarget(monster);

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

function start() {
  // Keep the normal future invasion schedule.

  // Watch for the first real participant.
  // This fixes the case where the scheduled invasion happened
  // before anyone joined.
  setInterval(function () {
    if (
      state.userCount > 0 &&
      !firstInvasionStarted
    ) {
      firstInvasionStarted = true;

      console.log(
        "First participant detected: starting zombie invasion.",
      );

      startInvasion();
    }
  }, 500);

  // Zombie movement/attack loop: 30 FPS.
// Zombie movement/attack loop: reduced network rate.
  const monsterNetworkHz =
    Number(config.MONSTER_NETWORK_HZ) > 0
      ? Number(config.MONSTER_NETWORK_HZ)
      : 15;
  
  setInterval(function () {
    const now = Date.now();

    if (
      invasionActive &&
      now >= invasionEndTime
    ) {
      endInvasion(false);
    }

    if (
      state.countPlayers(monsters) === 0
    ) {
      return;
    }

    const positions = [];

    state.forEachPlayer(
      monsters,
      function (monster) {
        processMonster(monster, now);

        positions.push({
          id: monster.id,
          x: Math.round(monster.x),
          y: Math.round(monster.y),
          direction: Math.round(
            monster.direction,
          ),
        });
      },
    );

    if (positions.length > 0) {
      net.sendAll(
        "monster_positions",
        positions,
      );
    }
  }, 1000 / monsterNetworkHz);
}

module.exports = {
  start,
  getMonstersSnapshot,
  resetForNewMap,
};
