import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // ← @Global = no need to import everywhere
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
