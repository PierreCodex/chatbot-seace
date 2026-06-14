import { Injectable } from '@nestjs/common';
import type { Prisma, WaUser } from '@prisma/client';
import type {
  AdminRepoPort,
  AuditEntry,
  SetBlockedArgs,
  SetPlanArgs,
  StoredAdminUser,
  StoredAudit,
  StoredSeller,
} from '../../../ports/persistence/admin.repo.port';
import { PrismaService } from './prisma.service';

const TELEGRAM = 'telegram' as const;

@Injectable()
export class PrismaAdminRepo implements AdminRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  // ── sellers ──

  findActiveSeller(telegramId: string): Promise<StoredSeller | null> {
    return this.prisma.botSeller.findFirst({ where: { telegramId, active: true } });
  }

  listSellers(opts?: { includeRevoked?: boolean }): Promise<StoredSeller[]> {
    return this.prisma.botSeller.findMany({
      where: opts?.includeRevoked ? {} : { active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  addSeller(args: {
    telegramId: string;
    ownerId: string;
    note?: string | null;
  }): Promise<StoredSeller> {
    return this.prisma.$transaction(async (tx) => {
      const seller = await tx.botSeller.upsert({
        where: { telegramId: args.telegramId },
        create: {
          telegramId: args.telegramId,
          addedByOwnerId: args.ownerId,
          note: args.note ?? null,
          active: true,
        },
        update: {
          active: true,
          addedByOwnerId: args.ownerId,
          note: args.note ?? null,
          revokedAt: null,
          revokedBy: null,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorId: args.ownerId,
          actorRole: 'owner',
          action: 'seller_agregado',
          targetUserId: args.telegramId,
          note: args.note ?? null,
        },
      });
      return seller;
    });
  }

  revokeSeller(args: {
    telegramId: string;
    byId: string;
    emergency?: boolean;
  }): Promise<StoredSeller | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.botSeller.findUnique({ where: { telegramId: args.telegramId } });
      if (!existing || !existing.active) return existing;
      const seller = await tx.botSeller.update({
        where: { telegramId: args.telegramId },
        data: { active: false, revokedAt: new Date(), revokedBy: args.byId },
      });
      await tx.adminAuditLog.create({
        data: {
          actorId: args.byId,
          actorRole: 'owner',
          action: args.emergency ? 'seller_revocado_emergencia' : 'seller_revocado',
          targetUserId: args.telegramId,
        },
      });
      return seller;
    });
  }

  // ── usuarios ──

  findUser(telegramId: string): Promise<StoredAdminUser | null> {
    return this.prisma.waUser.findUnique({
      where: { channel_channelUserId: { channel: TELEGRAM, channelUserId: telegramId } },
    });
  }

  setPlan(args: SetPlanArgs): Promise<StoredAdminUser> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.waUser.findUnique({
        where: { channel_channelUserId: { channel: TELEGRAM, channelUserId: args.targetUserId } },
      });
      if (!before) throw new Error('USER_NOT_FOUND');
      const after = await tx.waUser.update({
        where: { id: before.id },
        data: { plan: args.plan, planExpiresAt: args.planExpiresAt },
      });
      await tx.adminAuditLog.create({
        data: {
          actorId: args.actorId,
          actorRole: args.actorRole,
          action: args.action,
          targetUserId: args.targetUserId,
          before: snapshot(before),
          after: snapshot(after),
          note: args.note ?? null,
        },
      });
      return after;
    });
  }

  setBlocked(args: SetBlockedArgs): Promise<StoredAdminUser> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.waUser.findUnique({
        where: { channel_channelUserId: { channel: TELEGRAM, channelUserId: args.targetUserId } },
      });
      if (!before) throw new Error('USER_NOT_FOUND');
      const after = await tx.waUser.update({
        where: { id: before.id },
        data: { blocked: args.blocked },
      });
      await tx.adminAuditLog.create({
        data: {
          actorId: args.actorId,
          actorRole: args.actorRole,
          action: args.blocked ? 'usuario_suspendido' : 'usuario_reactivado',
          targetUserId: args.targetUserId,
          before: snapshot(before),
          after: snapshot(after),
          note: args.note ?? null,
        },
      });
      return after;
    });
  }

  listActivePremium(limit: number): Promise<StoredAdminUser[]> {
    return this.prisma.waUser.findMany({
      where: {
        plan: 'premium',
        blocked: false,
        OR: [{ planExpiresAt: null }, { planExpiresAt: { gt: new Date() } }],
      },
      orderBy: { planExpiresAt: 'asc' },
      take: limit,
    });
  }

  listExpiringSoon(days: number, limit: number): Promise<StoredAdminUser[]> {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.prisma.waUser.findMany({
      where: { plan: 'premium', planExpiresAt: { gt: new Date(), lte: until } },
      orderBy: { planExpiresAt: 'asc' },
      take: limit,
    });
  }

  async expireOverdue(actorId: string): Promise<StoredAdminUser[]> {
    const overdue = await this.prisma.waUser.findMany({
      where: { plan: 'premium', planExpiresAt: { lt: new Date() } },
    });
    const updated: WaUser[] = [];
    for (const u of overdue) {
      const after = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.waUser.update({
          where: { id: u.id },
          data: { plan: 'free', planExpiresAt: null },
        });
        await tx.adminAuditLog.create({
          data: {
            actorId,
            actorRole: 'system',
            action: 'auto_vencido',
            targetUserId: u.channelUserId,
            before: snapshot(u),
            after: snapshot(fresh),
          },
        });
        return fresh;
      });
      updated.push(after);
    }
    return updated;
  }

  // ── auditoría ──

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        action: entry.action,
        targetUserId: entry.targetUserId ?? null,
        before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
        note: entry.note ?? null,
      },
    });
  }

  listAuditByTarget(telegramId: string, limit: number): Promise<StoredAudit[]> {
    return this.prisma.adminAuditLog.findMany({
      where: { targetUserId: telegramId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  listAuditByActor(actorId: string, limit: number): Promise<StoredAudit[]> {
    return this.prisma.adminAuditLog.findMany({
      where: { actorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  listAuditRecent(limit: number): Promise<StoredAudit[]> {
    return this.prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }
}

function snapshot(u: WaUser): Prisma.InputJsonValue {
  return {
    plan: u.plan,
    planExpiresAt: u.planExpiresAt ? u.planExpiresAt.toISOString() : null,
    blocked: u.blocked,
  } as Prisma.InputJsonValue;
}
