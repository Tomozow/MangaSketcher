import { describe, expect, test, vi } from 'vitest';
import {
  EXPORT_CHECKPOINT_FLUSH_MS,
  ProjectExportCheckpointError,
  requestProjectExportCheckpoint,
  subscribeProjectExportCheckpoint,
  type ProjectExportChannel,
  type ProjectExportCheckpointMessage,
} from '../projectExportCheckpoint';

type ChannelListener = (event: { data: unknown }) => void;

class MockExportChannel implements ProjectExportChannel {
  static readonly peers = new Set<MockExportChannel>();
  readonly listeners = new Set<ChannelListener>();

  constructor() {
    MockExportChannel.peers.add(this);
  }

  postMessage(message: ProjectExportCheckpointMessage): void {
    for (const peer of MockExportChannel.peers) {
      if (peer === this) {
        continue;
      }
      for (const listener of peer.listeners) {
        listener({ data: message });
      }
    }
  }

  addEventListener(_type: 'message', listener: ChannelListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: ChannelListener): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
    MockExportChannel.peers.delete(this);
  }

  static reset(): void {
    MockExportChannel.peers.clear();
  }
}

function createMockChannelFactory() {
  MockExportChannel.reset();
  return () => new MockExportChannel();
}

describe('requestProjectExportCheckpoint', () => {
  test('proceeds immediately when no editor responds', async () => {
    const createChannel = createMockChannelFactory();
    const listChannel = createChannel();
    await expect(
      requestProjectExportCheckpoint('project-a', {
        createChannel: () => listChannel,
        ackMs: 5,
        sleep: async () => {},
      }),
    ).resolves.toBeUndefined();
    listChannel.close();
  });

  test('waits for editor checkpoint done', async () => {
    const createChannel = createMockChannelFactory();
    const listChannel = createChannel()!;
    const order: string[] = [];

    subscribeProjectExportCheckpoint({
      projectId: 'project-a',
      tabId: 'editor-tab',
      createChannel,
      checkpoint: async () => {
        order.push('checkpoint');
      },
    });

    await requestProjectExportCheckpoint('project-a', {
      createChannel: () => listChannel,
      ackMs: 5,
      sleep: async () => {},
    });

    expect(order).toEqual(['checkpoint']);
    listChannel.close();
  });

  test('fails when editor acks but does not finish in time', async () => {
    const createChannel = createMockChannelFactory();
    const listChannel = createChannel()!;
    const editorChannel = createChannel()!;

    editorChannel.addEventListener('message', (event) => {
      const message = event.data as ProjectExportCheckpointMessage;
      if (message.type !== 'checkpoint-request') {
        return;
      }
      editorChannel.postMessage({
        type: 'checkpoint-ack',
        requestId: message.requestId,
        tabId: 'editor-tab',
      } satisfies ProjectExportCheckpointMessage);
    });

    await expect(
      requestProjectExportCheckpoint('project-a', {
        createChannel: () => listChannel,
        ackMs: 5,
        flushMs: 20,
        sleep: async (ms) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
        },
      }),
    ).rejects.toBeInstanceOf(ProjectExportCheckpointError);

    editorChannel.close();
    listChannel.close();
  });

  test('fails when editor reports checkpoint failure', async () => {
    const createChannel = createMockChannelFactory();
    const listChannel = createChannel()!;

    subscribeProjectExportCheckpoint({
      projectId: 'project-a',
      tabId: 'editor-tab',
      createChannel,
      checkpoint: async () => {
        throw new Error('ink not ready');
      },
    });

    await expect(
      requestProjectExportCheckpoint('project-a', {
        createChannel: () => listChannel,
        ackMs: 5,
        flushMs: EXPORT_CHECKPOINT_FLUSH_MS,
        sleep: async () => {},
      }),
    ).rejects.toThrow('ink not ready');

    listChannel.close();
  });
});

describe('subscribeProjectExportCheckpoint', () => {
  test('ignores requests for other projects', async () => {
    const createChannel = createMockChannelFactory();
    const checkpoint = vi.fn(async () => {});
    subscribeProjectExportCheckpoint({
      projectId: 'mine',
      createChannel,
      checkpoint,
    });
    const channel = createChannel()!;
    channel.postMessage({
      type: 'checkpoint-request',
      projectId: 'other',
      requestId: 'req-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(checkpoint).not.toHaveBeenCalled();
    channel.close();
  });
});
