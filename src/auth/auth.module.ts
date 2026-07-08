import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import {
  GoogleOAuthController,
  MicrosoftOAuthController,
} from './oauth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GmailModule } from '../gmail/gmail.module';
import { OutlookModule } from '../outlook/outlook.module';

@Module({
  imports: [GmailModule, OutlookModule],
  controllers: [
    AuthController, // user login/register/refresh/me
    GoogleOAuthController, // Gmail account linking
    MicrosoftOAuthController, // Outlook account linking
  ],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
