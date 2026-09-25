"use strict";
module.exports = {
  
PORT: Number(process.env.PORT) || 8082,

PRIVATE_SERVER: {
  ENABLED: true,
  HOST: "0.0.0.0",
  MAX_PLAYERS: 20,
  PARTICIPANTS: [
    {
      id: "P001",
      code: "FLUX001",
    },
    {
      id: "P002",
      code: "FLUX002",
    },
    {
      id: "P003",
      code: "FLUX003",
    },
    {
      id: "P004",
      code: "FLUX004",
    },
    {
      id: "P005",
      code: "FLUX005",
    },
    {
      id: "P006",
      code: "FLUX006",
    },
    {
      id: "P007",
      code: "FLUX007",
    },
    {
      id: "P008",
      code: "FLUX008",
    },
    {
      id: "P009",
      code: "FLUX009",
    },
    {
      id: "P010",
      code: "FLUX010",
    },
    {
      id: "P011",
      code: "FLUX011",
    },
        {
      id: "P012",
      code: "FLUX012",
    },
        {
      id: "P013",
      code: "FLUX013",
    },
        {
      id: "P014",
      code: "FLUX014",
    },
        {
      id: "P015",
      code: "FLUX015",
    },

  ],

  
  ADMIN_CODE: "FLUX-ADMIN-2026",
},

JOIN: {
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 24,
},

  
  SPAWN_PROTECTION_DURATION: 3000, 
  SHOTGUN_PELLET_COUNT: 7, 
  SHOTGUN_SPREAD_ANGLE: (Math.PI / 180) * 12, 
  WEAPON_DAMAGE: {
    handgun: 10,
    rifle: 15,
    shotgun: 8, 
  },
  SHOOT_RANGE: 1000, 
  HIT_RADIUS: 16, 
  MELEE_RANGE: 56, 
  MELEE_ANGLE_TOLERANCE: 60, 
  MELEE_KNIFE_DAMAGE: 50, 
  MELEE_BASH_DAMAGE: 20, 

  
  AI_SIGHT_RANGE: 700, 
  AI_ATTACK_RANGE: 380, 
  AI_ATTACK_RANGE_BUFFER: 80, 
  AI_RETREAT_RANGE: 120, 
  AI_REPATH_INTERVAL: 300, 
  AI_TARGET_LOST_TIMEOUT: 2500, 
  AI_LAST_SEEN_ARRIVE_DISTANCE: 48, 
  AI_SHOOT_INTERVAL: 400, 
  AI_SHOOT_FACING_TOLERANCE: 25, 
  AI_MOVE_SPEED: 3, 
  AI_BODY_DISTANCE: 32, 
  AI_SPAWN_MIN_DISTANCE: 200, 

  
  AI_MAX_COUNT: 0, 
  AI_MIN_COUNT: 0, 
  AI_JOIN_INTERVAL_MIN: 20 * 1000, 
  AI_JOIN_INTERVAL_MAX: 80 * 1000, 
  AI_STAY_DURATION_MIN: 2 * 60 * 1000, 
  AI_STAY_DURATION_MAX: 7 * 60 * 1000, 
  AI_GREETING_CHANCE: 0.4, 
  AI_FAREWELL_CHANCE: 0.35, 

  AI_NAME_POOL: [,
    "Shadow",
    "nova7",
    "PewPew",
    "Ghost99",
    "mango",
    "Rookie",
    "headshot_kim",
    "ZeroCool",
    "BlueBerry",
    "xXSniperXx",
    "lucky",
    "DancingPotato",
    "Bro",
    "Ballmer",
  ],
  AI_GREETINGS: [
    "hi",
    "hello~",
   
  ],
  AI_FAREWELLS: [,
    "bye",
    "gg",

  ],
  AI_WEAPONS: ["handgun", "rifle", "shotgun"],

  
  ITEM_MAX_COUNT: 6, 
  ITEM_INITIAL_COUNT: 3, 
  ITEM_SPAWN_INTERVAL_MIN: 12 * 1000, 
  ITEM_SPAWN_INTERVAL_MAX: 25 * 1000, 
  ITEM_PICKUP_DISTANCE: 28, 
  ITEM_MEDKIT_HEAL: 50, 

  
  
  MONSTER_HP: 60, 
  MONSTER_MOVE_SPEED: 3.5, 
  MONSTER_SIGHT_RANGE: 1400, 
  MONSTER_ATTACK_RANGE: 46, 
  MONSTER_ATTACK_DAMAGE: 8, 
  MONSTER_ATTACK_INTERVAL: 800, 
  MONSTER_REPATH_INTERVAL: 500, 
  MONSTER_BODY_DISTANCE: 26, 
  MONSTER_SPAWN_MIN_DISTANCE: 360, 
  MONSTER_KILL_SCORE: 1, 
  MONSTER_NETWORK_HZ: 15,

  
  INVASION_INTERVAL_MIN: 3 * 60 * 1000, 
  INVASION_INTERVAL_MAX: 5 * 60 * 1000, 
  INVASION_WARN_DELAY: 5 * 1000, 
  INVASION_DURATION_MAX: 100 * 1000, 
  INVASION_WAVES: 3, 
  INVASION_WAVE_INTERVAL: 14 * 1000, 
  INVASION_BASE_COUNT: 4, 
  INVASION_PER_COMBATANT: 1, 
  INVASION_MAX_ALIVE: 28, 

  ROUND_DURATION: 10 * 60 * 1000, 
  
  MAP_ROTATION: ["office", "arena", "ruins"],
  
  
  KILLSTREAK_MILESTONES: [3, 5, 7, 10],

  
  CHAT_HISTORY_LIMIT: 100, 
};
