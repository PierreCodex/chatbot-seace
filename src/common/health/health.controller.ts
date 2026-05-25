import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get()
  health() {
    return {
      status: 'ok',
      service: this.config.get('SERVICE', { infer: true }),
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
