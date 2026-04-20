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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginDto = void 0;
var openapi = require("@nestjs/swagger");
var class_validator_1 = require("class-validator");
var class_transformer_1 = require("class-transformer");
var swagger_1 = require("@nestjs/swagger");
var LoginDto = /** @class */ (function () {
    function LoginDto() {
    }
    LoginDto._OPENAPI_METADATA_FACTORY = function () {
        return { email: { required: true, type: function () { return String; } }, password: { required: true, type: function () { return String; }, minLength: 1 } };
    };
    __decorate([
        (0, swagger_1.ApiProperty)({ example: 'user@example.com' }),
        (0, class_validator_1.IsEmail)(),
        (0, class_transformer_1.Transform)(function (_a) {
            var value = _a.value;
            return value === null || value === void 0 ? void 0 : value.toLowerCase().trim();
        }),
        __metadata("design:type", String)
    ], LoginDto.prototype, "email", void 0);
    __decorate([
        (0, swagger_1.ApiProperty)(),
        (0, class_validator_1.IsString)(),
        (0, class_validator_1.MinLength)(1, { message: 'Password is required' }),
        __metadata("design:type", String)
    ], LoginDto.prototype, "password", void 0);
    return LoginDto;
}());
exports.LoginDto = LoginDto;
