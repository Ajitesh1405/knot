import { Module } from '@nestjs/common';
import { GraphService } from './graph.service';

@Module({
  providers: [GraphService],
  exports: [GraphService], // ← KEY: lets other modules inject it
})
export class GraphModule {}
