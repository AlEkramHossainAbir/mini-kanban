import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGateway } from './board.gateway';

@Module({
  // AuthModule exports AuthService, which owns the ws-ticket store the
  // handshake validates against.
  imports: [AuthModule],
  providers: [BoardGateway],
  // TasksModule / ColumnsModule inject this to broadcast after commit.
  exports: [BoardGateway],
})
export class GatewayModule {}
