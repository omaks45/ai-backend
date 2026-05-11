
// MIDDLEWARE vs PIPES vs GUARDS vs INTERCEPTORS:
//
//  Middleware (SanitizeMiddleware, RequestLoggerMiddleware, etc.)
//    → Runs first, before guards. Registered in AppModule.configure().
//    → Has access to raw req/res — good for logging, sanitization, metrics.
//
//  Guards (JwtAuthGuard, PermissionsGuard)
//    → Run after middleware. Verify authentication and permissions.
//    → Return true/false — throw ForbiddenException / UnauthorizedException.
//
//  Pipes (ValidationPipe)
//    → Run after guards. Transform and validate request data.
//    → Throw BadRequestException on validation failure.
//
//  Interceptors (ResponseInterceptor)
//    → Wrap the controller response. Add { success: true, data: ... } envelope.

import { NestFactory }     from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder }  from '@nestjs/swagger';
import { AppModule }       from './app.module';
import { AppLoggerService }         from './modules/logger/logger.service';
import { GlobalExceptionFilter }    from './common/filters/http-exception.filter';
import { ResponseInterceptor }      from './common/interceptors/response.interceptor';
import { applySecurityMiddleware }  from './common/middleware/security-headers.middleware';
import { authLimiter, apiLimiter }  from './common/middleware/rate-limiter.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Replace NestJS default logger with Winston
  const appLogger = app.get(AppLoggerService);
  app.useLogger(appLogger);

  // 1. Security headers (Helmet) + CORS — must be FIRST
  const allowedOrigins = [
    process.env.FRONTEND_URL ?? 'http://localhost:3001',
  ];
  applySecurityMiddleware(app.getHttpAdapter().getInstance(), allowedOrigins);

  // 2. URL prefix + versioning
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // 3. Validation pipe
  //    whitelist: strips unknown props (mass-assignment defence)
  //    forbidNonWhitelisted: rejects unknown props with 400
  //    transform: converts JSON → typed DTO class instances
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:            true,
      forbidNonWhitelisted: true,
      transform:            true,
      transformOptions:     { enableImplicitConversion: true },
    }),
  );

  // 4. Global error handling
  app.useGlobalFilters(new GlobalExceptionFilter());

  // 5. Global response envelope { success: true, data: ... }
  app.useGlobalInterceptors(new ResponseInterceptor());

  // 6. Rate limiters
  //    authLimiter: 10 req/15min by IP — applied to all /auth routes
  //    apiLimiter:  tier-based by user ID — applied to all /api/v1 routes
  //    uploadLimiter and chatLimiter are applied directly in their controllers
  const http = app.getHttpAdapter().getInstance();
  http.use('/api/v1/auth', authLimiter);
  http.use('/api/v1',      apiLimiter);

  // 7. Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DocuChat API')
    .setDescription(
      `AI-Powered Document Q&A
      
Week 3: Rate Limiting · XSS Sanitization · Security Headers · Observability
Week 4: Embeddings (Ollama/OpenAI) · Document Ingestion · RAG Pipeline`,
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addServer('http://localhost:3001', 'Local development')
    .build();

  SwaggerModule.setup(
    'api-docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  appLogger.info('DocuChat started', {
    port,
    env:              process.env.NODE_ENV,
    embeddingProvider: process.env.EMBEDDING_PROVIDER ?? 'openai',
  });
  appLogger.info(`Swagger  → http://localhost:${port}/api-docs`);
  appLogger.info(`Metrics  → http://localhost:${port}/metrics`);
  appLogger.info(`Health   → http://localhost:${port}/api/v1/health/ready`);
}

bootstrap();