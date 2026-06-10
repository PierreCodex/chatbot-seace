import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { DevController } from './dev.controller';

@Module({
  imports: [SearchModule],
  controllers: [DevController],
})
export class DevModule {}
