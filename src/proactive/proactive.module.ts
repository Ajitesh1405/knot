import { Module } from '@nestjs/common';
import { GmailModule } from '../gmail/gmail.module';
import { TriageSpecialist } from './triage.specialist';
import { ProactiveService } from './proactive.service';
import { ProactiveScheduler } from './proactive.scheduler';

// Proactive auto-draft replies (Phase 1: dry-run triage + logging).
// LlmService and PrismaService are @Global, so only GmailModule is imported.
@Module({
  imports: [GmailModule],
  providers: [TriageSpecialist, ProactiveService, ProactiveScheduler],
  exports: [ProactiveService],
})
export class ProactiveModule {}
