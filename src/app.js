import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import {
  errorHandler,
  notFoundHandler,
} from "./middleware/errors.js";

import cancherosRoutes from "./routes/cancheros.routes.js";
import managersRoutes from "./routes/managers.routes.js";
import gameweeksRoutes from "./routes/gameweeks.routes.js";
import standingsRoutes from "./routes/standings.routes.js";
import weeklyRoutes from "./routes/weekly.routes.js";
import monthlyRoutes from "./routes/monthly.routes.js";
import seasonRoutes from "./routes/season.routes.js";
import h2hRoutes from "./routes/h2h.routes.js";
import syncRoutes from "./routes/sync.routes.js";
import authRoutes from "./routes/auth.routes.js";

import {
  startLiveSyncScheduler,
  getLiveSyncStatus,
} from "./services/sync/live.scheduler.js";
import { startTelegramBot } from "./telegram/bot.js";
import { runMigrations } from "./database/runMigrations.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;

const corsOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(",").map((origin) => origin.trim())
  : true;

app.use(
  cors({
    origin: corsOrigins,
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "cancheros-api",
    liveSync: getLiveSyncStatus(),
  });
});

app.use("/api/cancheros", cancherosRoutes);
app.use("/api/managers", managersRoutes);
app.use("/api/gameweeks", gameweeksRoutes);
app.use("/api/standings", standingsRoutes);
app.use("/api/weekly", weeklyRoutes);
app.use("/api/monthly", monthlyRoutes);
app.use("/api/season", seasonRoutes);
app.use("/api/h2h", h2hRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/auth", authRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(port, async () => {
    console.log(
      `Cancheros API listening on http://localhost:${port}`
    );

    try {
      await runMigrations();
    } catch (error) {
      console.error("Startup migration failed:", error.message);
    }

    startLiveSyncScheduler();
    startTelegramBot();
  });
}

export default app;
