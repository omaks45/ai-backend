"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
var common_1 = require("@nestjs/common");
var jwt_1 = require("@nestjs/jwt");
var passport_1 = require("@nestjs/passport");
var auths_controller_1 = require("./auths.controller");
var auths_service_1 = require("./auths.service");
var jwt_strategy_1 = require("./strategies/jwt.strategy");
var prisma_service_1 = require("../../database/prisma.service");
var redis_service_1 = require("../../redis/redis.service");
var AuthModule = /** @class */ (function () {
    function AuthModule() {
    }
    AuthModule = __decorate([
        (0, common_1.Module)({
            imports: [
                passport_1.PassportModule,
                jwt_1.JwtModule.register({}), // secrets set per-call in service
            ],
            controllers: [auths_controller_1.AuthController],
            providers: [auths_service_1.AuthService, jwt_strategy_1.JwtStrategy, prisma_service_1.PrismaService, redis_service_1.RedisService],
            exports: [auths_service_1.AuthService],
        })
    ], AuthModule);
    return AuthModule;
}());
exports.AuthModule = AuthModule;
