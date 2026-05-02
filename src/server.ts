import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import modules
import { PORT } from "./config/constants.js";
import "./config/firebase.js";
import { setupAuthRoutes } from "./auth/routes.js";
import { setupSocketEvents, setupCleanup } from "./socket/events.js";

// ==================== INITIALIZATION ====================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 20e6
});

// ==================== STATIC FILES ====================
app.use(express.static(path.join(__dirname, "..", "app")));

// ==================== ROUTES ====================
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "..", "app", "index.html")));

// Setup authentication routes
setupAuthRoutes(app);

// Setup socket events
setupSocketEvents(io);

// Setup cleanup routines
setupCleanup(io);

// ==================== START SERVER ====================
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing server or run with PORT=3001.`);
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, () => {
  console.log(`✨ Pitopi server running at http://localhost:${PORT}`);
});
