import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  configureApp(app);

  await app.listen(process.env.PORT ?? 4000);
}

// Without the catch, a boot failure surfaces as an unhandled promise
// rejection — which is exactly how the readable message from
// `validateEnv` (common/env.validation.ts) would have reached an operator:
// buried in a rejection trace, with a zero exit code on older Node. The
// whole point of validating the environment at boot is that a bad deploy
// says so plainly and exits non-zero so the orchestrator restarts or halts.
bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
