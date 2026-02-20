"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var socket_io_client_1 = require("socket.io-client");
var TARGET_URL = process.env.TARGET_URL || "http://localhost:3000";
var NUM_PLAYERS = 16;
var EMITS_PER_SECOND = 12; // ~140 WPM equivalent
var INTERVAL_MS = Math.floor(1000 / EMITS_PER_SECOND);
var MISTYPE_RATE = 0.01; // 1% intentional mistype rate
var metrics = {
    emittedChars: 0,
    ackedChars: 0,
    errors: 0,
    reconnects: 0,
};
var sockets = [];
var roomCode = null;
var gameActive = false;
// sentences[i] is the flat string for sentence i, derived from the server's word array
var sentences = [];
/** Flatten the server's word-array sentences into plain strings with spaces */
function buildFlatSentences(raw) {
    return raw.map(function (words) { return words.join(" "); });
}
function createSocket(nickname, isHost) {
    return new Promise(function (resolve, reject) {
        var socket = (0, socket_io_client_1.io)(TARGET_URL, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        });
        socket.on("connect", function () {
            // Only join during bootstrap. During the game, reconnects keep the existing
            // server-side session — re-joining would create a new playerId.
            if (gameActive)
                return;
            if (isHost) {
                socket.emit("create_room", { nickname: nickname, settings: { sentenceCount: 5 } }, function (res) {
                    if (!res.success)
                        return reject(new Error("create_room failed: ".concat(res.error)));
                    roomCode = res.roomCode;
                    resolve(socket);
                });
            }
            else if (roomCode) {
                socket.emit("join_room", { roomCode: roomCode, nickname: nickname }, function (res) {
                    if (!res.success)
                        return reject(new Error("join_room failed: ".concat(res.error)));
                    resolve(socket);
                });
            }
            else {
                reject(new Error("Room code not available for client join"));
            }
        });
        socket.on("player_progress", function () {
            metrics.ackedChars++;
        });
        socket.on("event_error", function (err) {
            console.error("[Socket ".concat(socket.id, "] Error:"), err);
            metrics.errors++;
        });
        socket.on("disconnect", function (reason) {
            if (reason === "io server disconnect") {
                socket.connect();
            }
        });
        socket.on("session_token", function (data) {
            socket.auth = { token: data.token };
        });
        setTimeout(function () { return reject(new Error("Connection timeout")); }, 5000);
    });
}
function startAssaultPhase() {
    console.log("[Phase 2] Commencing 12Hz I/O Assault...");
    gameActive = true;
    sockets.forEach(function (socket) {
        var state = { sentenceIndex: 0, charIndex: 0 };
        var interval = setInterval(function () {
            if (!gameActive) {
                clearInterval(interval);
                return;
            }
            if (!roomCode || !socket.connected)
                return;
            if (state.sentenceIndex >= sentences.length)
                return;
            var currentSentence = sentences[state.sentenceIndex];
            var targetChar = currentSentence[state.charIndex];
            if (targetChar === undefined)
                return;
            var isMistype = Math.random() < MISTYPE_RATE;
            var charToSend = isMistype ? "!" : targetChar;
            socket.emit("char_typed", {
                roomCode: roomCode,
                char: charToSend,
                charIndex: state.charIndex,
            });
            metrics.emittedChars++;
            if (isMistype) {
                // Server resets charIndex to 0 on mistype; mirror that locally
                state.charIndex = 0;
            }
            else {
                state.charIndex++;
                // Advance to next sentence when current one is complete
                if (state.charIndex >= currentSentence.length) {
                    state.sentenceIndex++;
                    state.charIndex = 0;
                }
            }
        }, INTERVAL_MS);
    });
}
function startChaosPhase() {
    console.log("[Phase 3] Injecting Chaos (Random Reconnects)...");
    setInterval(function () {
        if (!gameActive)
            return;
        // Avoid host (index 0) to prevent host-migration contamination
        var targetIndex = Math.floor(Math.random() * (NUM_PLAYERS - 1)) + 1;
        var targetSocket = sockets[targetIndex];
        if (targetSocket && targetSocket.connected) {
            targetSocket.disconnect();
            metrics.reconnects++;
            setTimeout(function () { return targetSocket.connect(); }, 200);
        }
    }, 5000);
}
function printTelemetry() {
    setInterval(function () {
        if (!gameActive)
            return;
        console.log("[Telemetry] Emitted: ".concat(metrics.emittedChars, " | Acked: ").concat(metrics.ackedChars, " | Reconnects: ").concat(metrics.reconnects, " | Errors: ").concat(metrics.errors));
    }, 5000);
}
function run() {
    return __awaiter(this, void 0, void 0, function () {
        var hostSocket, clientPromises, i, clientSockets, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 4, , 5]);
                    console.log("[Phase 1] Bootstrapping Sockets...");
                    return [4 /*yield*/, createSocket("HostPlayer", true)];
                case 1:
                    hostSocket = _a.sent();
                    sockets.push(hostSocket);
                    console.log("Host connected. Room: ".concat(roomCode));
                    if (!roomCode)
                        throw new Error("Failed to generate room code");
                    clientPromises = [];
                    for (i = 1; i < NUM_PLAYERS; i++) {
                        clientPromises.push(createSocket("Player_".concat(i), false));
                    }
                    return [4 /*yield*/, Promise.all(clientPromises)];
                case 2:
                    clientSockets = _a.sent();
                    sockets.push.apply(sockets, clientSockets);
                    console.log("All ".concat(NUM_PLAYERS, " sockets connected and joined."));
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 2000); })];
                case 3:
                    _a.sent();
                    sockets[0].emit("start_game", { roomCode: roomCode }, function (res) {
                        if (!(res === null || res === void 0 ? void 0 : res.success))
                            throw new Error("start_game failed: ".concat(res === null || res === void 0 ? void 0 : res.error));
                        console.log("[Phase 1] Countdown started, waiting for game_start...");
                    });
                    // game_start payload contains the actual sentences — use them
                    sockets[0].on("game_start", function (data) {
                        // data.firstSentence is a word array; full sentences come from countdown_start
                        startAssaultPhase();
                        startChaosPhase();
                        printTelemetry();
                    });
                    // countdown_start delivers all sentences as word arrays
                    sockets[0].on("countdown_start", function (data) {
                        var _a;
                        if ((data === null || data === void 0 ? void 0 : data.sentences) && Array.isArray(data.sentences)) {
                            sentences = buildFlatSentences(data.sentences);
                            console.log("[Phase 1] Got ".concat(sentences.length, " sentences from server. First: \"").concat((_a = sentences[0]) === null || _a === void 0 ? void 0 : _a.substring(0, 40), "...\""));
                        }
                    });
                    sockets[0].on("game_ended", function (data) {
                        var _a;
                        gameActive = false;
                        console.log("\n[DONE] Game ended. Reason: ".concat(data === null || data === void 0 ? void 0 : data.reason, " | Winner: ").concat((_a = data === null || data === void 0 ? void 0 : data.winnerId) !== null && _a !== void 0 ? _a : "none"));
                        console.log("[Final Telemetry] Emitted: ".concat(metrics.emittedChars, " | Acked: ").concat(metrics.ackedChars, " | Reconnects: ").concat(metrics.reconnects, " | Errors: ").concat(metrics.errors));
                        sockets.forEach(function (s) { return s.disconnect(); });
                        process.exit(0);
                    });
                    return [3 /*break*/, 5];
                case 4:
                    err_1 = _a.sent();
                    console.error("Fatal Test Error:", err_1);
                    process.exit(1);
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
run();
