"use strict";

// Creates the HTTP server and attaches the WebSocket server.
// The listening host is controlled by config.PRIVATE_SERVER.HOST.

const http = require("http");
const WebSocketServer = require("ws").Server;
const config = require("./config");

module.exports = function createWebSocketServer(port) {
  const privateConfig = config.PRIVATE_SERVER || {};

  // For the private event server we use the configured LAN host.
  // Example:
  //   0.0.0.0  -> allow devices on the same LAN to connect
  //   127.0.0.1 -> this PC only
  const host =
    privateConfig.ENABLED && privateConfig.HOST
      ? privateConfig.HOST
      : "127.0.0.1";

const server = http.createServer(function (request, response) {
  console.log(
    new Date() + " Received request for " + request.url,
  );

  if (request.url === "/health" || request.url === "/") {
    response.writeHead(200, {
      "Content-Type": "text/plain",
    });
    response.end("OK");
    return;
  }

  response.writeHead(404);
  response.end();
});

  // Prevent a confusing unhandled EADDRINUSE crash.
  server.on("error", function (error) {
    if (error.code === "EADDRINUSE") {
      console.error(
        "ERROR: Port " +
          port +
          " is already in use. Stop the old Node.js server first.",
      );
    } else {
      console.error("HTTP server error:", error.message);
    }

    process.exit(1);
  });

  const wss = new WebSocketServer({
    server: server,
  });

  wss.on("error", function (error) {
    console.error("WebSocket server error:", error.message);
  });

  server.listen(port, host, function () {
    console.log(
      "websocket server listening on " + host + ":" + port,
    );

    if (host === "0.0.0.0") {
      console.log(
        "LAN mode enabled: participants can connect using this PC's LAN IP.",
      );
    } else if (host === "127.0.0.1") {
      console.log("Localhost-only mode enabled.");
    }
  });

  return wss;
};
