"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
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
exports.AuthService = void 0;
var common_1 = require("@nestjs/common");
var jwt_1 = require("@nestjs/jwt");
var config_1 = require("@nestjs/config");
var event_emitter_1 = require("@nestjs/event-emitter");
var bcrypt = __importStar(require("bcrypt"));
var crypto = __importStar(require("crypto"));
var prisma_service_1 = require("../../database/prisma.service");
var redis_service_1 = require("../../redis/redis.service");
var SALT_ROUNDS = 12;
var REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
var AuthService = /** @class */ (function () {
    function AuthService(prisma, jwt, config, redis, events) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.config = config;
        this.redis = redis;
        this.events = events;
    }
    AuthService.prototype.register = function (dto) {
        return __awaiter(this, void 0, void 0, function () {
            var existing, passwordHash, user;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.prisma.user.findUnique({
                            where: { email: dto.email },
                        })];
                    case 1:
                        existing = _a.sent();
                        if (existing) {
                            throw new common_1.ConflictException('Email already registered');
                        }
                        return [4 /*yield*/, bcrypt.hash(dto.password, SALT_ROUNDS)];
                    case 2:
                        passwordHash = _a.sent();
                        return [4 /*yield*/, this.prisma.user.create({
                                data: { email: dto.email, passwordHash: passwordHash },
                                select: { id: true, email: true, tier: true },
                            })];
                    case 3:
                        user = _a.sent();
                        this.events.emit('auth.user.registered', user);
                        return [2 /*return*/, user];
                }
            });
        });
    };
    AuthService.prototype.login = function (dto, deviceInfo) {
        return __awaiter(this, void 0, void 0, function () {
            var user, isValid, _a, tokens;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, this.prisma.user.findUnique({
                            where: { email: dto.email },
                        })];
                    case 1:
                        user = _b.sent();
                        if (!user) return [3 /*break*/, 3];
                        return [4 /*yield*/, bcrypt.compare(dto.password, user.passwordHash)];
                    case 2:
                        _a = _b.sent();
                        return [3 /*break*/, 5];
                    case 3: return [4 /*yield*/, bcrypt.compare(dto.password, '$2b$12$placeholder.hash.to.prevent.timing.attacks')];
                    case 4:
                        _a = _b.sent();
                        _b.label = 5;
                    case 5:
                        isValid = _a;
                        if (!user || !user.isActive || !isValid) {
                            this.events.emit('auth.login.failed', { email: dto.email, deviceInfo: deviceInfo });
                            throw new common_1.UnauthorizedException('Invalid credentials');
                        }
                        return [4 /*yield*/, this.generateAndStoreTokens(user)];
                    case 6:
                        tokens = _b.sent();
                        this.events.emit('auth.user.logged_in', { userId: user.id, deviceInfo: deviceInfo });
                        return [2 /*return*/, __assign(__assign({}, tokens), { user: { id: user.id, email: user.email, tier: user.tier } })];
                }
            });
        });
    };
    AuthService.prototype.refresh = function (rawRefreshToken) {
        return __awaiter(this, void 0, void 0, function () {
            var payload, tokenHash, stored, user;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        try {
                            payload = this.jwt.verify(rawRefreshToken, {
                                secret: this.config.get('JWT_REFRESH_SECRET'),
                            });
                        }
                        catch (_b) {
                            throw new common_1.UnauthorizedException('Invalid refresh token');
                        }
                        if (payload.type !== 'refresh') {
                            throw new common_1.UnauthorizedException('Invalid token type');
                        }
                        tokenHash = this.hashToken(rawRefreshToken);
                        return [4 /*yield*/, this.prisma.refreshToken.findUnique({
                                where: { token: tokenHash },
                            })];
                    case 1:
                        stored = _a.sent();
                        if (!stored || stored.expiresAt < new Date()) {
                            throw new common_1.UnauthorizedException('Refresh token expired or revoked');
                        }
                        return [4 /*yield*/, this.prisma.user.findUnique({
                                where: { id: payload.sub },
                            })];
                    case 2:
                        user = _a.sent();
                        if (!user || !user.isActive) {
                            throw new common_1.UnauthorizedException('User not found');
                        }
                        // Rotate — delete old, create new
                        return [4 /*yield*/, this.prisma.refreshToken.delete({ where: { token: tokenHash } })];
                    case 3:
                        // Rotate — delete old, create new
                        _a.sent();
                        return [2 /*return*/, this.generateAndStoreTokens(user)];
                }
            });
        });
    };
    AuthService.prototype.logout = function (rawRefreshToken, accessTokenJti) {
        return __awaiter(this, void 0, void 0, function () {
            var tokenHash, accessExpiry;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        tokenHash = this.hashToken(rawRefreshToken);
                        return [4 /*yield*/, this.prisma.refreshToken.deleteMany({ where: { token: tokenHash } })];
                    case 1:
                        _a.sent();
                        if (!accessTokenJti) return [3 /*break*/, 3];
                        accessExpiry = 15 * 60;
                        return [4 /*yield*/, this.redis.blacklistToken(accessTokenJti, accessExpiry)];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    // ── Private helpers ──────────────────────────────────
    AuthService.prototype.generateAndStoreTokens = function (user) {
        return __awaiter(this, void 0, void 0, function () {
            var jti, refreshJti, _a, accessToken, refreshToken, tokenHash;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        jti = crypto.randomUUID();
                        refreshJti = crypto.randomUUID();
                        return [4 /*yield*/, Promise.all([
                                this.jwt.signAsync({ sub: user.id, email: user.email, tier: user.tier, type: 'access', jti: jti }, { secret: this.config.get('JWT_ACCESS_SECRET'), expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m') }),
                                this.jwt.signAsync({ sub: user.id, email: user.email, tier: user.tier, type: 'refresh', jti: refreshJti }, { secret: this.config.get('JWT_REFRESH_SECRET'), expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d') }),
                            ])];
                    case 1:
                        _a = _b.sent(), accessToken = _a[0], refreshToken = _a[1];
                        tokenHash = this.hashToken(refreshToken);
                        return [4 /*yield*/, this.prisma.refreshToken.create({
                                data: {
                                    userId: user.id,
                                    token: tokenHash,
                                    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
                                },
                            })];
                    case 2:
                        _b.sent();
                        return [2 /*return*/, { accessToken: accessToken, refreshToken: refreshToken }];
                }
            });
        });
    };
    AuthService.prototype.hashToken = function (token) {
        return crypto.createHash('sha256').update(token).digest('hex');
    };
    AuthService = __decorate([
        (0, common_1.Injectable)(),
        __metadata("design:paramtypes", [prisma_service_1.PrismaService,
            jwt_1.JwtService,
            config_1.ConfigService,
            redis_service_1.RedisService,
            event_emitter_1.EventEmitter2])
    ], AuthService);
    return AuthService;
}());
exports.AuthService = AuthService;
