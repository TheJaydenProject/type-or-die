import http from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import cors from "cors";
import express from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
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
import { pickClientIp } from "./utils/clientIp.js";

const logger = pino();
const requiredEnvVars = ["DB_PASSWORD", "DB_HOST", "DB_NAME"];
const missing = requiredEnvVars.filter((key) => !process.env[key]);

if (missing.length > 0) {
	logger.fatal(`Missing environment variables: ${missing.join(", ")}`);
	process.exit(1);
}

const app = express();
// One proxy hop (Traefik or nginx) sits in front. The limiter keys on the visitor
// IP from pickClientIp; this only keeps req.ip sensible as its fallback.
app.set("trust proxy", 1);
const server = http.createServer(app);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 100,
	standardHeaders: true,
	legacyHeaders: false,
	// ipKeyGenerator groups IPv6 visitors by /56 so one user can't rotate addresses.
	keyGenerator: (req) =>
		ipKeyGenerator(pickClientIp(req.headers, req.ip ?? "")),
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

// Several backend replicas run behind Traefik. Without this, io.to(room).emit only
// reaches sockets on the same replica, so players on different replicas never see
// each other. Pub/sub needs its own connections, hence duplicate().
io.adapter(createAdapter(redis.duplicate(), redis.duplicate()));

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
