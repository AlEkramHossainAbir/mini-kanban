import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/common/configure-app';

// Phase 3 acceptance: the health route answers under the global prefix with
// helmet's headers in place. Built through configureApp() so this is the same
// wiring main.ts serves, not a bare testing module.
describe('App bootstrap (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(
      moduleFixture.createNestApplication<NestExpressApplication>(),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health → 200 { status: "ok" }', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('sends helmet security headers (PLAN §5)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    // helmet strips Express's advertisement of itself.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves nothing outside the /api/v1 prefix', () => {
    return request(app.getHttpServer()).get('/health').expect(404);
  });
});
