
// WHY CONFIGURE GLOBALLY HERE AND NOT IN MODULES?
// ValidationPipe, GlobalExceptionFilter, and ResponseInterceptor need to run
// on every single request regardless of which module handles it. NestJS's
// useGlobal* methods on the application instance apply them at the topmost
// layer — before any module-level middleware — which is exactly where
// cross-cutting concerns belong.
//
// VALIDATION PIPE OPTIONS EXPLAINED:
//   whitelist: true             — strips any request property not in the DTO.
//                                 Prevents mass-assignment attacks automatically.
//   forbidNonWhitelisted: true  — throws 400 for unknown properties instead of
//                                 silently stripping them. Fail loudly.
//   transform: true             — converts plain JSON objects into DTO class
//                                 instances so class-validator decorators and
//                                 class-transformer @Transform() work correctly.
//   enableImplicitConversion    — auto-coerces primitives (e.g. "42" → 42)
//                                 so you don't need explicit @Type() everywhere.

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  //  URL prefix + versioning 
  // All routes are prefixed with /api and versioned via the URI (e.g. /api/v1/…).
  // defaultVersion: '1' means controllers without an explicit @Version() tag
  // automatically resolve to v1 — no breaking change when you add v2 later.
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Global validation 
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,             // strips unknown props from every request body
      forbidNonWhitelisted: true,  // rejects requests that contain unknown props
      transform: true,             // deserialises JSON into typed DTO instances
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  //  Global error handling 
  // Catches every unhandled exception and formats it into a consistent error
  // envelope so clients always receive the same error shape.
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global response envelope
  // Wraps every successful response in { success: true, data: … } so the
  // client-side contract never changes regardless of what a controller returns.
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Swagger
  // addBearerAuth() tells Swagger UI to show the "Authorize" button and send
  // the JWT as "Authorization: Bearer <token>" on protected endpoints.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('DocuChat API')
    .setDescription(
      'AI-Powered Document Q&A — Build · Caching · Embeddings · Document Ingestion Pipeline',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    'api-docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  // Server
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`DocuChat running → http://localhost:${port}`);
  console.log(`Swagger docs    → http://localhost:${port}/api-docs`);
}

bootstrap();