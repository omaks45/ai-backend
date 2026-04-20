"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
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
exports.AuthController = void 0;
var openapi = require("@nestjs/swagger");
var common_1 = require("@nestjs/common");
var swagger_1 = require("@nestjs/swagger");
var auths_service_1 = require("./auths.service");
var register_dto_1 = require("./dto/register.dto");
var login_dto_1 = require("./dto/login.dto");
var refresh_dto_1 = require("./dto/refresh.dto");
var AuthController = /** @class */ (function () {
    function AuthController(auth) {
        this.auth = auth;
    }
    AuthController.prototype.register = function (dto) {
        return this.auth.register(dto);
    };
    AuthController.prototype.login = function (dto, req) {
        return this.auth.login(dto, req.headers['user-agent']);
    };
    AuthController.prototype.refresh = function (dto) {
        return this.auth.refresh(dto.refreshToken);
    };
    AuthController.prototype.logout = function (dto, req) {
        return __awaiter(this, void 0, void 0, function () {
            var authHeader, jti, token, decoded;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        authHeader = req.headers.authorization;
                        if (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith('Bearer ')) {
                            try {
                                token = authHeader.split(' ')[1];
                                decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                                jti = decoded.jti;
                            }
                            catch (_b) {
                                // ignore decode errors — logout still proceeds
                            }
                        }
                        return [4 /*yield*/, this.auth.logout(dto.refreshToken, jti)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, { message: 'Logged out successfully' }];
                }
            });
        });
    };
    __decorate([
        (0, common_1.Post)('register'),
        (0, swagger_1.ApiOperation)({ summary: 'Register a new user' }),
        (0, swagger_1.ApiResponse)({ status: 201, description: 'User created' }),
        (0, swagger_1.ApiResponse)({ status: 409, description: 'Email already registered' }),
        openapi.ApiResponse({ status: 201 }),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [register_dto_1.RegisterDto]),
        __metadata("design:returntype", void 0)
    ], AuthController.prototype, "register", null);
    __decorate([
        (0, common_1.Post)('login'),
        (0, common_1.HttpCode)(common_1.HttpStatus.OK),
        (0, swagger_1.ApiOperation)({ summary: 'Login and receive tokens' }),
        openapi.ApiResponse({ status: common_1.HttpStatus.OK }),
        __param(0, (0, common_1.Body)()),
        __param(1, (0, common_1.Req)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [login_dto_1.LoginDto, Object]),
        __metadata("design:returntype", void 0)
    ], AuthController.prototype, "login", null);
    __decorate([
        (0, common_1.Post)('refresh'),
        (0, common_1.HttpCode)(common_1.HttpStatus.OK),
        (0, swagger_1.ApiOperation)({ summary: 'Refresh access token' }),
        openapi.ApiResponse({ status: common_1.HttpStatus.OK }),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [refresh_dto_1.RefreshDto]),
        __metadata("design:returntype", void 0)
    ], AuthController.prototype, "refresh", null);
    __decorate([
        (0, common_1.Post)('logout'),
        (0, common_1.HttpCode)(common_1.HttpStatus.OK),
        (0, swagger_1.ApiOperation)({ summary: 'Revoke refresh token' }),
        openapi.ApiResponse({ status: common_1.HttpStatus.OK }),
        __param(0, (0, common_1.Body)()),
        __param(1, (0, common_1.Req)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [refresh_dto_1.RefreshDto, Object]),
        __metadata("design:returntype", Promise)
    ], AuthController.prototype, "logout", null);
    AuthController = __decorate([
        (0, swagger_1.ApiTags)('auth'),
        (0, common_1.Controller)('auth'),
        __metadata("design:paramtypes", [auths_service_1.AuthService])
    ], AuthController);
    return AuthController;
}());
exports.AuthController = AuthController;
