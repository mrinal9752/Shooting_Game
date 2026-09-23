"use strict";

// Chat history for the current game session.
// Previous session chat is cleared when the server starts.

const fs = require("fs");
const path = require("path");
const config = require("./config");

const dataPath = path.join(__dirname, "datas");
const chatFilePath = path.join(dataPath, "user_chats.json");

if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true });
}

if (!fs.existsSync(chatFilePath)) {
  fs.writeFileSync(chatFilePath, "");
}

let userChats = [];

// Clear previous session history immediately.
function clear() {
  userChats = [];

  try {
    fs.writeFileSync(chatFilePath, "");
  } catch (error) {
    console.error(
      "failed to clear chat log:",
      error.message,
    );
  }
}

// Add a chat message.
function append(chatData) {
  userChats.push(chatData);

  if (userChats.length > config.CHAT_HISTORY_LIMIT) {
    userChats = userChats.slice(
      -config.CHAT_HISTORY_LIMIT,
    );
  }

  fs.appendFile(
    chatFilePath,
    `${JSON.stringify(chatData)},\n`,
    function (err) {
      if (err) {
        console.error(
          "failed to append chat log:",
          err.message,
        );
      }
    },
  );
}

// Get current-session chat only.
function getRecentChats() {
  return userChats.slice();
}

module.exports = {
  append,
  getRecentChats,
  clear,
};