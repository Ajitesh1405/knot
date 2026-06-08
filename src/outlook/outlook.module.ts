import { Module } from '@nestjs/common';
import { OutlookService } from './outlook.service';

@Module({
  providers: [OutlookService],
  exports: [OutlookService],
})
export class OutlookModule {}
