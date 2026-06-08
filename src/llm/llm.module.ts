import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';

@Global() // injectable everywhere without import
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
