import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { SupervisorService } from './supervisor.service';
import { ChatSpecialist } from './chat.specialist';
import { ConversationService } from './conversation.service';
import { SearchSpecialist } from './search.specialist';
import { ChatTrackerSpecialist } from './chat-tracker.specialist';
import { GmailSpecialist } from './gmail.specialist'; // ← NEW
import { ComposeSpecialist } from './compose.specialist';
import { ComposeHitlService } from './compose-hitl.service';
import { CalendarSpecialist } from './calendar.specialist';
import { SchedulerSpecialist } from './scheduler.specialist';
import { SchedulerHitlService } from './scheduler-hitl.service';
import { GraphModule } from '../graph/graph.module';
import { GmailModule } from '../gmail/gmail.module'; // ← NEW
import { OutlookSpecialist } from './outlook.specialist';
import { OutlookModule } from '../outlook/outlook.module';
import { CalendarModule } from '../calendar/calendar.module';
import { SettingsModule } from '../settings/settings.module'; // ← NEW

@Module({
  imports: [
    GraphModule,
    GmailModule,
    OutlookModule,
    CalendarModule,
    SettingsModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentService,
    SupervisorService,
    ChatSpecialist,
    ConversationService,
    SearchSpecialist,
    ChatTrackerSpecialist,
    GmailSpecialist,
    OutlookSpecialist,
    ComposeSpecialist,
    ComposeHitlService,
    CalendarSpecialist,
    SchedulerSpecialist,
    SchedulerHitlService,
  ],
  exports: [
    AgentService,
    ComposeHitlService,
    CalendarSpecialist,
    SchedulerHitlService,
  ],
})
export class AgentModule {}
