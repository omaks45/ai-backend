import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagController } from './context-assembler.service';

@Module({
  controllers: [RagController],
  providers: [RagService],
})
export class RagModule {}
