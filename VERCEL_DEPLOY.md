# Vercel deployment

Vercel hosts the static game page. The Node.js multiplayer server must run as a
separate WebSocket web service because the game keeps its live match state in
memory.

## 1. Create a GitHub repository

Create a private GitHub repository and upload this entire `Shooting_Game`
folder. Keep `shoot_game` and `shoot_game_server` together because the server
loads the map files from its sibling `shoot_game` folder.

## 2. Deploy the multiplayer server on Render

In Render, select **New > Web Service**, connect the GitHub repository, and
use these settings:

| Setting | Value |
| --- | --- |
| Root Directory | Leave empty |
| Build Command | `cd shoot_game_server && npm ci` |
| Start Command | `cd shoot_game_server && npm start` |
| Environment Variable | `NODE_VERSION` = `22.14.0` |

Render assigns an address like `https://club-game-server.onrender.com`. The
game WebSocket address is the same address with `wss://` instead of `https://`.

## 3. Connect the game page to the server

Open `shoot_game/game_server_config.js` and set the value to your Render
address. For example:

```js
window.GAME_SERVER_URL = "wss://club-game-server.onrender.com";
```

Save, commit, and push this change to GitHub.

## 4. Deploy the game page on Vercel

In Vercel, select **Add New > Project**, import the same GitHub repository,
and use these settings:

| Setting | Value |
| --- | --- |
| Root Directory | `shoot_game` |
| Framework Preset | Other |
| Build Command | Leave empty |
| Output Directory | Leave empty |

Deploy. Vercel gives you the link that participants can open.

## 5. Play

Open the Vercel link. Participants enter a name and select **Join game**;
they enter immediately.

Open the same site with `/admin/` at the end of the address to see the live
zombie-score dashboard. It updates when a participant kills a zombie.
