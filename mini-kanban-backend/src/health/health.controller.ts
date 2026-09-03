import { Controller, Get } from '@nestjs/common';

// No auth, no throttle override needed — Docker healthcheck and platform
// (Render/Railway) liveness probes hit this directly.
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
