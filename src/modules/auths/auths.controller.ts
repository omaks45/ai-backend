import {
  Controller, Post, Body, HttpCode,
  HttpStatus, Req,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse,
  ApiBody, ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auths.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import {
  RegisterResponse,
  LoginResponse,
  RefreshResponse,
  MessageResponse,
  ErrorResponse,
} from '../../common/swagger/api-responses.swagger';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // POST register

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user account',
    description: `
Creates a new user account with the provided credentials.

**What happens after registration:**
- Password is hashed with bcrypt (12 rounds) before storage — never stored in plain text
- The new user is automatically assigned the **member** role
- A welcome conversation is created in the background
- A signup event is logged for analytics

**Password requirements:**
- Minimum 8 characters, maximum 128
- Must contain at least one uppercase letter
- Must contain at least one number

**Note:** The \`passwordHash\` field is never returned in any response.
    `,
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      standard: {
        summary: 'Standard registration',
        value: { email: 'user@example.com', password: 'SecurePass1' },
      },
      enterprise: {
        summary: 'Enterprise user',
        value: { email: 'enterprise@company.com', password: 'EnterprisePass1' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully. Returns user profile without sensitive fields.',
    type: RegisterResponse,
    example: {
      success: true,
      data: {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        email: 'user@example.com',
        tier: 'free',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: `**Validation failed.** Returned when:
- Email format is invalid
- Password is too short (< 8 chars) or too long (> 128 chars)
- Password missing uppercase letter or number
- Required fields are missing`,
    type: ErrorResponse,
    example: {
      success: false,
      statusCode: 400,
      error: {
        message: ['password must contain an uppercase letter', 'email must be an email'],
        error: 'Bad Request',
      },
      path: '/api/v1/auth/register',
      timestamp: '2026-04-24T10:00:00.000Z',
    },
  })
  @ApiResponse({
    status: 409,
    description: '**Email already registered.** A user with this email already exists.',
    type: ErrorResponse,
    example: {
      success: false,
      statusCode: 409,
      error: { message: 'Email already registered', error: 'Conflict' },
      path: '/api/v1/auth/register',
      timestamp: '2026-04-24T10:00:00.000Z',
    },
  })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // login

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login and receive JWT tokens',
    description: `
Authenticates the user and returns a short-lived **access token** and a long-lived **refresh token**.

**Token lifetimes:**
| Token | Lifetime | Purpose |
|-------|----------|---------|
| Access Token | 15 minutes | Sent with every API request in the \`Authorization\` header |
| Refresh Token | 7 days | Used **only** to obtain a new access token via \`POST /auth/refresh\` |

**How to use the access token:**
\`\`\`
Authorization: Bearer <accessToken>
\`\`\`

**Security notes:**
- Identical error message is returned for wrong email AND wrong password — this prevents user enumeration attacks
- The access token contains: \`sub\` (user ID), \`email\`, \`tier\`, \`type: "access"\`, \`jti\` (unique token ID)
- Inactive accounts receive the same generic error
    `,
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      standard: {
        summary: 'Standard login',
        value: { email: 'user@example.com', password: 'SecurePass1' },
      },
      admin: {
        summary: 'Admin login',
        value: { email: 'admin@docuchat.dev', password: 'Admin123!' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Store both tokens securely.',
    type: LoginResponse,
    example: {
      success: true,
      data: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmNDdhYzEwYiIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSIsInRpZXIiOiJmcmVlIiwidHlwZSI6ImFjY2VzcyIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAwOTAwfQ.signature',
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmNDdhYzEwYiIsInR5cGUiOiJyZWZyZXNoIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDA2MDQ4MDB9.signature',
        user: {
          id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          email: 'user@example.com',
          tier: 'free',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '**Validation failed.** Email format invalid or password field missing.',
    type: ErrorResponse,
    example: {
      success: false,
      statusCode: 400,
      error: { message: ['email must be an email'], error: 'Bad Request' },
      path: '/api/v1/auth/login',
      timestamp: '2026-04-24T10:00:00.000Z',
    },
  })
  @ApiResponse({
    status: 401,
    description: `**Authentication failed.** Returned for ALL of the following cases (intentionally identical):
- Email not found
- Wrong password
- Account is deactivated`,
    type: ErrorResponse,
    example: {
      success: false,
      statusCode: 401,
      error: { message: 'Invalid credentials', error: 'Unauthorized' },
      path: '/api/v1/auth/login',
      timestamp: '2026-04-24T10:00:00.000Z',
    },
  })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req.headers['user-agent']);
  }

  // refresh

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: `
Exchanges a valid refresh token for a new access token and a new refresh token.

**Refresh token rotation:** Every call to this endpoint invalidates the old refresh token and issues a brand new one. This means:
- Each refresh token can only be used **once**
- Store the new refresh token returned by this endpoint
- If the same refresh token is used twice, it will be rejected (possible token theft)

**When to call this:**
- When an API request returns \`401\` with message \`"Token expired"\`
- Proactively before the 15-minute access token window closes

**Recommended client flow:**
1. Receive \`401 Token expired\` from any endpoint
2. Call \`POST /auth/refresh\` with the stored refresh token
3. Store the new \`accessToken\` and \`refreshToken\`
4. Retry the original failed request with the new access token
    `,
  })
  @ApiBody({
    type: RefreshDto,
    examples: {
      standard: {
        summary: 'Refresh token exchange',
        value: { refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'New token pair issued. The old refresh token is now invalid.',
    type: RefreshResponse,
    example: {
      success: true,
      data: {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.new_access_token.signature',
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.new_refresh_token.signature',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '**Validation failed.** The `refreshToken` field is missing or empty.',
    type: ErrorResponse,
  })
  @ApiResponse({
    status: 401,
    description: `**Refresh failed.** Returned for any of:
- Token signature is invalid (tampered)
- Token has expired (7-day window passed)
- Token has already been used (rotation — use the latest one)
- Token was revoked via logout
- The token provided is an access token, not a refresh token`,
    type: ErrorResponse,
    example: {
      success: false,
      statusCode: 401,
      error: { message: 'Refresh token expired or revoked', error: 'Unauthorized' },
      path: '/api/v1/auth/refresh',
      timestamp: '2026-04-24T10:00:00.000Z',
    },
  })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  //logout 

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout and revoke tokens',
    description: `
Revokes the provided refresh token and blacklists the current access token.

**What this does:**
- Deletes the refresh token from the database — no new access tokens can be issued
- Blacklists the current access token in Redis until it naturally expires (max 15 min)
- After logout, both tokens are unusable

**Client responsibilities after logout:**
- Delete the stored access token
- Delete the stored refresh token
- Redirect to login screen

**Note:** Even without the \`Authorization\` header, the logout will still succeed — the refresh token is sufficient to invalidate the session. Sending the access token in the header allows immediate blacklisting for extra security.
    `,
  })
  @ApiBody({
    type: RefreshDto,
    examples: {
      standard: {
        summary: 'Logout with refresh token',
        value: { refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Logged out successfully. Both tokens are now invalid.',
    type: MessageResponse,
    example: {
      success: true,
      data: { message: 'Logged out successfully' },
    },
  })
  @ApiResponse({
    status: 400,
    description: '**Validation failed.** The `refreshToken` field is missing.',
    type: ErrorResponse,
  })
  async logout(@Body() dto: RefreshDto, @Req() req: Request) {
    const authHeader = req.headers.authorization;
    let jti: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = JSON.parse(
          Buffer.from(token.split('.')[1], 'base64').toString(),
        );
        jti = decoded.jti;
      } catch {
        // Ignore — logout still proceeds without blacklisting
      }
    }

    await this.auth.logout(dto.refreshToken, jti);
    return { message: 'Logged out successfully' };
  }
}