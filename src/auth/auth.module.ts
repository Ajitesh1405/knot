import { Module } from '@nestjs/common';
import { AuthController, MicrosoftAuthController } from './auth.controller';
import { GmailModule } from '../gmail/gmail.module';
import { OutlookModule } from '../outlook/outlook.module';

@Module({
  imports: [GmailModule, OutlookModule],
  controllers: [AuthController, MicrosoftAuthController],
})
export class AuthModule {}
