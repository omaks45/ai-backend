"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalExceptionFilter = void 0;
var common_1 = require("@nestjs/common");
var GlobalExceptionFilter = /** @class */ (function () {
    function GlobalExceptionFilter() {
        this.logger = new common_1.Logger(GlobalExceptionFilter_1.name);
    }
    GlobalExceptionFilter_1 = GlobalExceptionFilter;
    GlobalExceptionFilter.prototype.catch = function (exception, host) {
        var ctx = host.switchToHttp();
        var response = ctx.getResponse();
        var request = ctx.getRequest();
        var isHttpException = exception instanceof common_1.HttpException;
        var status = isHttpException
            ? exception.getStatus()
            : common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        var message = isHttpException
            ? exception.getResponse()
            : 'An unexpected error occurred';
        if (!isHttpException) {
            this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
        }
        response.status(status).json({
            success: false,
            statusCode: status,
            error: typeof message === 'object' ? message : { message: message },
            path: request.url,
            timestamp: new Date().toISOString(),
        });
    };
    var GlobalExceptionFilter_1;
    GlobalExceptionFilter = GlobalExceptionFilter_1 = __decorate([
        (0, common_1.Catch)()
    ], GlobalExceptionFilter);
    return GlobalExceptionFilter;
}());
exports.GlobalExceptionFilter = GlobalExceptionFilter;
