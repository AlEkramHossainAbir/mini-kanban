import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditAction, AuditEntity } from './audit.actions';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const create = jest.fn();
  const prisma = { auditLog: { create } } as unknown as PrismaService;
  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditService(prisma);
  });

  it('writes the event through to AuditLog', async () => {
    create.mockResolvedValue({});
    await service.log({
      userId: 'actor-1',
      boardId: 'board-1',
      action: AuditAction.BOARD_SHARE,
      entityType: AuditEntity.BOARD_MEMBER,
      entityId: 'target-1',
      metadata: { role: 'EDITOR' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'actor-1',
        boardId: 'board-1',
        action: 'BOARD_SHARE',
        entityType: 'BoardMember',
        entityId: 'target-1',
        metadata: { role: 'EDITOR' },
      },
    });
  });

  it('accepts a null boardId for non-board security events', async () => {
    create.mockResolvedValue({});
    await service.log({
      userId: 'victim-1',
      boardId: null,
      action: AuditAction.REFRESH_TOKEN_REUSE,
      entityType: AuditEntity.REFRESH_TOKEN,
      entityId: 'token-1',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ boardId: null, metadata: undefined }),
      }),
    );
  });

  // The caller's mutation has already committed by the time log() runs —
  // a failed audit insert must not turn a successful share into a 500.
  it('swallows and logs a write failure instead of throwing', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    create.mockRejectedValue(new Error('db down'));

    await expect(
      service.log({
        userId: 'actor-1',
        boardId: 'board-1',
        action: AuditAction.BOARD_DELETE,
        entityType: AuditEntity.BOARD,
        entityId: 'board-1',
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
