import { Body, Controller, Get, Post, Param } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  // Single endpoint now — supervisor figures out the rest
  @Post('message')
  message(@Body() body: { userId: string; text: string }) {
    return this.agent
      .handle(body.userId, body.text)
      .then((a) => ({ answer: a }));
  }

  @Get('memory/:userId')
  memory(@Param('userId') userId: string) {
    return this.agent.getMemory(userId);
  }
}
