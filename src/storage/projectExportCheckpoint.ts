import { randomId } from './randomId';

export const PROJECT_EXPORT_CHANNEL = 'mangasketcher-project-export';
export const EXPORT_CHECKPOINT_ACK_MS = 500;
export const EXPORT_CHECKPOINT_FLUSH_MS = 30_000;

export type ProjectExportCheckpointMessage =
  | { type: 'checkpoint-request'; projectId: string; requestId: string }
  | { type: 'checkpoint-ack'; requestId: string; tabId: string }
  | { type: 'checkpoint-done'; requestId: string; tabId: string }
  | { type: 'checkpoint-fail'; requestId: string; tabId: string; error: string };

export type ProjectExportChannel = {
  postMessage(message: ProjectExportCheckpointMessage): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
};

export type ProjectExportChannelFactory = () => ProjectExportChannel | null;

let tabId = randomId();

export function getProjectExportTabId(): string {
  return tabId;
}

export function resetProjectExportTabIdForTests(next = randomId()): void {
  tabId = next;
}

export function createProjectExportChannel(): ProjectExportChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }
  return new BroadcastChannel(PROJECT_EXPORT_CHANNEL);
}

function isCheckpointMessage(value: unknown): value is ProjectExportCheckpointMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const message = value as ProjectExportCheckpointMessage;
  switch (message.type) {
    case 'checkpoint-request':
      return typeof message.projectId === 'string' && typeof message.requestId === 'string';
    case 'checkpoint-ack':
    case 'checkpoint-done':
      return typeof message.requestId === 'string' && typeof message.tabId === 'string';
    case 'checkpoint-fail':
      return (
        typeof message.requestId === 'string' &&
        typeof message.tabId === 'string' &&
        typeof message.error === 'string'
      );
    default:
      return false;
  }
}

export class ProjectExportCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectExportCheckpointError';
  }
}

export async function requestProjectExportCheckpoint(
  projectId: string,
  options: {
    createChannel?: ProjectExportChannelFactory;
    ackMs?: number;
    flushMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<void> {
  const createChannel = options.createChannel ?? createProjectExportChannel;
  const channel = createChannel();
  if (!channel) {
    return;
  }

  const ackMs = options.ackMs ?? EXPORT_CHECKPOINT_ACK_MS;
  const flushMs = options.flushMs ?? EXPORT_CHECKPOINT_FLUSH_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());

  const requestId = randomId();
  const ackedTabs = new Set<string>();
  const doneTabs = new Set<string>();
  let failError: string | null = null;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      channel.removeEventListener('message', onMessage);
      channel.close();
      if (err) {
        reject(err);
        return;
      }
      resolve();
    };

    const onMessage = (event: { data: unknown }) => {
      if (!isCheckpointMessage(event.data) || event.data.requestId !== requestId) {
        return;
      }
      if (event.data.type === 'checkpoint-ack') {
        ackedTabs.add(event.data.tabId);
        return;
      }
      if (event.data.type === 'checkpoint-done') {
        doneTabs.add(event.data.tabId);
        if (failError == null && ackedTabs.size > 0 && doneTabs.size >= ackedTabs.size) {
          finish();
        }
        return;
      }
      if (event.data.type === 'checkpoint-fail') {
        failError = event.data.error;
        finish(new ProjectExportCheckpointError(event.data.error));
      }
    };

    channel.addEventListener('message', onMessage);
    channel.postMessage({
      type: 'checkpoint-request',
      projectId,
      requestId,
    } satisfies ProjectExportCheckpointMessage);

    void (async () => {
      await sleep(ackMs);
      if (settled) {
        return;
      }
      if (ackedTabs.size === 0) {
        finish();
        return;
      }

      const deadline = now() + flushMs;
      while (now() < deadline) {
        if (failError != null) {
          return;
        }
        if (doneTabs.size >= ackedTabs.size) {
          finish();
          return;
        }
        await sleep(50);
      }
      finish(
        new ProjectExportCheckpointError(
          'エディタの保存が完了しませんでした。エクスポートを中止しました。',
        ),
      );
    })();
  });
}

export function subscribeProjectExportCheckpoint(options: {
  projectId: string;
  tabId?: string;
  checkpoint: () => Promise<void>;
  createChannel?: ProjectExportChannelFactory;
}): () => void {
  const createChannel = options.createChannel ?? createProjectExportChannel;
  const channel = createChannel();
  if (!channel) {
    return () => {};
  }

  const tabId = options.tabId ?? getProjectExportTabId();
  let busyRequestId: string | null = null;

  const onMessage = (event: { data: unknown }) => {
    if (!isCheckpointMessage(event.data) || event.data.type !== 'checkpoint-request') {
      return;
    }
    if (event.data.projectId !== options.projectId) {
      return;
    }
    if (busyRequestId === event.data.requestId) {
      return;
    }
    busyRequestId = event.data.requestId;
    const requestId = event.data.requestId;

    channel.postMessage({
      type: 'checkpoint-ack',
      requestId,
      tabId,
    } satisfies ProjectExportCheckpointMessage);

    void options
      .checkpoint()
      .then(() => {
        channel.postMessage({
          type: 'checkpoint-done',
          requestId,
          tabId,
        } satisfies ProjectExportCheckpointMessage);
      })
      .catch((err) => {
        channel.postMessage({
          type: 'checkpoint-fail',
          requestId,
          tabId,
          error: err instanceof Error ? err.message : 'checkpoint failed',
        } satisfies ProjectExportCheckpointMessage);
      })
      .finally(() => {
        if (busyRequestId === requestId) {
          busyRequestId = null;
        }
      });
  };

  channel.addEventListener('message', onMessage);
  return () => {
    channel.removeEventListener('message', onMessage);
    channel.close();
  };
}
