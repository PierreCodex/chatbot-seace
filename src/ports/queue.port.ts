export interface EnqueuedJob {
  id: string;
  name: string;
}

export interface JobInfo<TData = unknown, TResult = unknown> {
  id: string;
  name: string;
  data: TData;
  attemptsMade: number;
  finishedOn: number | null;
  failedReason: string | null;
  returnValue: TResult | null;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused' | 'unknown';
}

export interface AddOptions {
  priority?: number;
  attempts?: number;
  delayMs?: number;
  jobId?: string;
  backoff?: { type: 'exponential' | 'fixed'; delay: number };
}

export type JobCompletedListener = (event: { jobId: string }) => void | Promise<void>;
export type JobFailedListener = (event: {
  jobId: string;
  failedReason: string;
}) => void | Promise<void>;

export interface QueuePort {
  add<T>(name: string, data: T, opts?: AddOptions): Promise<EnqueuedJob>;
  addBulk<T>(jobs: Array<{ name: string; data: T; opts?: AddOptions }>): Promise<EnqueuedJob[]>;
  getJob<TData = unknown, TResult = unknown>(id: string): Promise<JobInfo<TData, TResult> | null>;
  /**
   * Registra un listener que se dispara en cualquier proceso conectado al
   * mismo Redis cuando un job de esta cola finaliza con éxito.
   */
  onJobCompleted(listener: JobCompletedListener): void;
  onJobFailed(listener: JobFailedListener): void;
}

export const QUEUE_PORT = Symbol('QUEUE_PORT');

export interface JobHandlerCtx {
  jobId: string;
  jobName: string;
  attemptsMade: number;
}

export interface RegisterConsumerOptions<TData, TResult> {
  queue: string;
  jobNames: string[];
  concurrency?: number;
  handler: (data: TData, ctx: JobHandlerCtx) => Promise<TResult>;
}

/**
 * Abstrae el "worker side" de la cola: registrar un handler que se ejecuta
 * cuando llegan jobs. Aislar esto en un port permite que `src/workers/`
 * no dependa directamente de bullmq (y que F6 pueda mover a otra cola sin
 * tocar lógica de negocio).
 */
export interface JobConsumerPort {
  register<TData, TResult>(opts: RegisterConsumerOptions<TData, TResult>): Promise<void>;
}

export const JOB_CONSUMER_PORT = Symbol('JOB_CONSUMER_PORT');
