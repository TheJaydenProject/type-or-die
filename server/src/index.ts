import http from "node:http";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import pino from "pino";
import { Server } from "socket.io";
import "dotenv/config";

import type {
	ClientToServerEvents,
	ServerToClientEvents,
	SocketData,
} from "@typeordie/shared";
import db from "./config/database.js";
import redis from "./config/redis.js";
import setupSocketHandlers from "./handlers/socketHandlers.js";
import roomManager from "./services/roomManager.js";

const logger = pino();
const requiredEnvVars = ["DB_PASSWORD", "DB_HOST", "DB_NAME"];
const missing = requiredEnvVars.filter((key) => !process.env[key]);

if (missing.length > 0) {
	logger.fatal(`Missing environment variables: ${missing.join(", ")}`);
	process.exit(1);
}

const app = express();
const server = http.createServer(app);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 100,
	standardHeaders: true,
	legacyHeaders: false,
});

app.use(helmet());
app.use(limiter);
app.use(
	cors({
		origin: CLIENT_URL,
		credentials: true,
	}),
);
app.use(express.json());

const io = new Server<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>(server, {
	cors: {
		origin: CLIENT_URL,
		credentials: true,
	},
	maxHttpBufferSize: 1e6,
	pingTimeout: 20000,
	pingInterval: 25000,
	perMessageDeflate: false,
	transports: ["websocket", "polling"],
});

setupSocketHandlers(io);

app.get("/health", async (_req, res) => {
	try {
		const [redisCheck, dbCheck] = await Promise.all([
			redis
				.ping()
				.then(() => true)
				.catch(() => false),
			db
				.query("SELECT 1")
				.then(() => true)
				.catch(() => false),
		]);

		const metrics = await roomManager.getMetrics();

		if (!redisCheck || !dbCheck) {
			res
				.status(503)
				.json({ status: "degraded", redis: redisCheck, postgres: dbCheck });
			return;
		}

		res.json({
			status: "healthy",
			timestamp: Date.now(),
			uptime: process.uptime(),
			metrics,
		});
	} catch (error) {
		logger.error({ err: error }, "Health check failed");
		res.status(500).json({ status: "error" });
	}
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
	logger.info(`Type or Die Server running on port ${PORT}`);
});

process.on("SIGTERM", async () => {
	logger.info("SIGTERM received. Cleaning up...");
	server.close(async () => {
		try {
			await redis.quit();
			await db.end();
			process.exit(0);
		} catch (err) {
			logger.error({ err }, "Cleanup error");
			process.exit(1);
		}
	});
});
