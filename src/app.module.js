"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
var common_1 = require("@nestjs/common");
var config_1 = require("@nestjs/config");
var event_emitter_1 = require("@nestjs/event-emitter");
var throttler_1 = require("@nestjs/throttler");
var auths_module_1 = require("./modules/auths/auths.module");
var prisma_service_1 = require("./database/prisma.service");
var redis_service_1 = require("./redis/redis.service");
var auth_events_1 = require("./modules/events/auth.events");
var AppModule = /** @class */ (function () {
    function AppModule() {
    }
    AppModule = __decorate([
        (0, common_1.Module)({
            imports: [
                config_1.ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
                event_emitter_1.EventEmitterModule.forRoot({ maxListeners: 20 }),
                throttler_1.ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
                auths_module_1.AuthModule,
            ],
            providers: [prisma_service_1.PrismaService, redis_service_1.RedisService, auth_events_1.AuthEventsListener],
        })
    ], AppModule);
    return AppModule;
}());
exports.AppModule = AppModule;
