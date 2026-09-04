import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

// No auth, no throttle override needed — Docker healthcheck and platform
// (Render/Railway) liveness probes hit this directly.
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
