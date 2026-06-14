import { Global, Module } from '@nestjs/common';
import { ADMIN_REPO } from '../../../ports/persistence/admin.repo.port';
import { ENTITIES_REPO } from '../../../ports/persistence/entities.repo.port';
import { NOTIFICATIONS_REPO } from '../../../ports/persistence/notifications.repo.port';
import { PROCESSES_REPO } from '../../../ports/persistence/processes.repo.port';
import { SEARCHES_REPO } from '../../../ports/persistence/searches.repo.port';
import { SUBSCRIPTIONS_REPO } from '../../../ports/persistence/subscriptions.repo.port';
import { WA_USERS_REPO } from '../../../ports/persistence/wa-users.repo.port';
import { PrismaAdminRepo } from './admin.repo';
import { PrismaEntitiesRepo } from './entities.repo';
import { PrismaNotificationsRepo } from './notifications.repo';
import { PrismaProcessesRepo } from './processes.repo';
import { PrismaSearchesRepo } from './searches.repo';
import { PrismaService } from './prisma.service';
import { PrismaSubscriptionsRepo } from './subscriptions.repo';
import { PrismaWaUsersRepo } from './wa-users.repo';

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: PROCESSES_REPO, useClass: PrismaProcessesRepo },
    { provide: ENTITIES_REPO, useClass: PrismaEntitiesRepo },
    { provide: WA_USERS_REPO, useClass: PrismaWaUsersRepo },
    { provide: SUBSCRIPTIONS_REPO, useClass: PrismaSubscriptionsRepo },
    { provide: SEARCHES_REPO, useClass: PrismaSearchesRepo },
    { provide: NOTIFICATIONS_REPO, useClass: PrismaNotificationsRepo },
    { provide: ADMIN_REPO, useClass: PrismaAdminRepo },
  ],
  exports: [
    PrismaService,
    PROCESSES_REPO,
    ENTITIES_REPO,
    WA_USERS_REPO,
    SUBSCRIPTIONS_REPO,
    SEARCHES_REPO,
    NOTIFICATIONS_REPO,
    ADMIN_REPO,
  ],
})
export class PrismaPersistenceModule {}
